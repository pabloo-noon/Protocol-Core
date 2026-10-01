/**
 * Post-upgrade LayerZero smoke test: send a small amount and wait for delivery.
 *
 *   ROUTE=usn-eth-zksync   USN  Ethereum -> zkSync  (eid 30165)   (the leg revived by ETH 348 + zkSync 39/40)
 *   ROUTE=susn-zksync-eth  sUSN zkSync   -> Ethereum (eid 30101)  (the leg that depends on the 120k enforced gas)
 *   ROUTE=susn-eth-zksync / usn-zksync-eth also supported.
 *
 *   npx hardhat run scripts/lz/test-bridge.ts                      dry run: balances, peer, quote, options
 *   ROUTE=... BROADCAST=true npx hardhat run scripts/lz/test-bridge.ts   send, then poll LayerZero Scan until DELIVERED
 *
 * Env: AMOUNT (default 0.01), RECIPIENT (default = signer), LZ_RECEIVE_GAS (extra gas; default 120000 when the
 * source enforces nothing i.e. from Ethereum, 0 from zkSync where 120k is enforced), WAIT_MINUTES (default 20),
 * DEPLOYER_WALLET_PRIVATE_KEY (signer), ETHEREUM_MAINNET_RPC_URL / ZKSYNC_RPC_URL.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider } from '../lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../../.env') });

const CHAINS = {
  eth: { name: 'Ethereum', chainId: 1, eid: 30101, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'], endpoint: '0x1a44076050125825900e736c501f859c50fE728c', explorer: 'https://etherscan.io/tx/', enforcesToward: {} as Record<number, boolean>, tokens: { usn: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', susn: '0xE24a3DC889621612422A64E6388927901608B91D' } },
  zksync: { name: 'zkSync Era', chainId: 324, eid: 30165, rpcs: ['https://mainnet.era.zksync.io', process.env.ZKSYNC_RPC_URL], endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF', explorer: 'https://explorer.zksync.io/tx/', enforcesToward: { 30101: true }, tokens: { usn: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6', susn: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f' } },
};
type Chain = keyof typeof CHAINS;
type Tok = 'usn' | 'susn';

const ROUTE = (process.env.ROUTE ?? 'usn-eth-zksync').toLowerCase();
const [tok, src, dst] = ROUTE.split('-') as [Tok, Chain, Chain];
if (!CHAINS[src] || !CHAINS[dst] || !['usn', 'susn'].includes(tok)) throw new Error(`bad ROUTE ${ROUTE}`);
const BROADCAST = process.env.BROADCAST === 'true';
const AMOUNT = ethers.parseEther(process.env.AMOUNT ?? '0.01');
const WAIT_MIN = Number(process.env.WAIT_MINUTES ?? 20);

const OFT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function peers(uint32) view returns (bytes32)',
  'function enforcedOptions(uint32,uint16) view returns (bytes)',
  'function rateLimiter() view returns (address)',
  'function quoteSend((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) p, bool payInLzToken) view returns ((uint256 nativeFee,uint256 lzTokenFee))',
  'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) p, (uint256 nativeFee,uint256 lzTokenFee) fee, address refund) payable returns ((bytes32 guid,uint64 nonce,(uint256,uint256) fee),(uint256 amountSentLD,uint256 amountReceivedLD))',
  'event OFTSent(bytes32 indexed guid, uint32 dstEid, address indexed fromAddress, uint256 amountSentLD, uint256 amountReceivedLD)',
];
const LIM_ABI = ['function getRateLimit(address,uint8,uint32,bool) view returns (uint256 limit,uint256 window,uint256 available)'];
const EP_ABI = ['function inboundNonce(address,uint32,bytes32) view returns (uint64)', 'function outboundNonce(address,uint32,bytes32) view returns (uint64)'];
const lzReceiveOption = (gas: bigint) => '0x000301001101' + gas.toString(16).padStart(32, '0');

async function main() {
  const S = CHAINS[src], D = CHAINS[dst];
  const pk = process.env.DEPLOYER_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_WALLET_PRIVATE_KEY not set');
  const ps = await provider(S.rpcs as string[], S.chainId);
  const pd = await provider(D.rpcs as string[], D.chainId);
  if (!ps || !pd) throw new Error('no reachable RPC');
  const signer = new ethers.Wallet(pk, ps);
  const recipient = ethers.getAddress(process.env.RECIPIENT ?? signer.address);
  const oft = new ethers.Contract(S.tokens[tok], OFT_ABI, signer);
  const dstOft = new ethers.Contract(D.tokens[tok], OFT_ABI, pd);

  console.log(`== ${tok.toUpperCase()} ${S.name} -> ${D.name} (eid ${D.eid})  amount ${ethers.formatEther(AMOUNT)}  recipient ${recipient}`);
  const peer = await oft.peers(D.eid);
  if (peer.toLowerCase() !== ethers.zeroPadValue(D.tokens[tok], 32).toLowerCase()) throw new Error(`peer mismatch: ${peer}`);
  const enforced: string = await oft.enforcedOptions(D.eid, 1);
  const defaultGas = enforced === '0x' ? 120000n : 0n;
  const extraGas = BigInt(process.env.LZ_RECEIVE_GAS ?? defaultGas);
  const extraOptions = extraGas > 0n ? lzReceiveOption(extraGas) : '0x';
  console.log(`  source enforcedOptions(${D.eid},SEND) = ${enforced === '0x' ? 'none' : enforced + ' (' + BigInt('0x' + enforced.slice(14, 46)) + ' gas)'}  -> extraOptions ${extraOptions === '0x' ? 'none' : extraGas + ' gas'}`);

  const [bal, native, dstBalBefore] = await Promise.all([oft.balanceOf(signer.address), ps.getBalance(signer.address), dstOft.balanceOf(recipient)]);
  console.log(`  signer ${signer.address}: ${ethers.formatEther(bal)} ${tok.toUpperCase()}, ${ethers.formatEther(native)} native | recipient on ${D.name} before: ${ethers.formatEther(dstBalBefore)}`);
  if (bal < AMOUNT) throw new Error('insufficient token balance');

  // limiter view on both ends
  for (const [label, chain, token, prov, out, remote] of [['source outbound', S, S.tokens[tok], ps, true, D.eid], ['dest inbound', D, D.tokens[tok], pd, false, S.eid]] as const) {
    const lim = await new ethers.Contract(token, OFT_ABI, prov).rateLimiter();
    const [l, w, a] = await new ethers.Contract(lim, LIM_ABI, prov).getRateLimit(token, 0, remote, out);
    console.log(`  ${label} bucket (${chain.name}): limit ${ethers.formatEther(l)} / ${w}s, available ${a === ethers.MaxUint256 ? 'unlimited' : ethers.formatEther(a)}`);
  }
  const epS = new ethers.Contract(S.endpoint, EP_ABI, ps), epD = new ethers.Contract(D.endpoint, EP_ABI, pd);
  const outN = await epS.outboundNonce(S.tokens[tok], D.eid, ethers.zeroPadValue(D.tokens[tok], 32));
  const inN = await epD.inboundNonce(D.tokens[tok], S.eid, ethers.zeroPadValue(S.tokens[tok], 32));
  console.log(`  channel: source outboundNonce ${outN}, dest inboundNonce ${inN}${outN !== inN ? '  ✗ GAP — do not send' : '  (in sync)'}`);
  if (outN !== inN) process.exit(1);

  const param = { dstEid: D.eid, to: ethers.zeroPadValue(recipient, 32), amountLD: AMOUNT, minAmountLD: AMOUNT, extraOptions, composeMsg: '0x', oftCmd: '0x' };
  const fee = await oft.quoteSend(param, false);
  console.log(`  quoted LayerZero fee: ${ethers.formatEther(fee.nativeFee)} native`);
  if (native < fee.nativeFee) throw new Error('insufficient native for the fee');
  if (!BROADCAST) {
    console.log('  dry run — BROADCAST=true to send');
    return;
  }

  const tx = await oft.send(param, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, signer.address, { value: fee.nativeFee });
  console.log(`  sent ${S.explorer}${tx.hash}`);
  const rc = await tx.wait();
  const guid = rc!.logs.map((l: any) => { try { return oft.interface.parseLog(l); } catch { return null; } }).find((x: any) => x?.name === 'OFTSent')?.args.guid;
  console.log(`  mined block ${rc!.blockNumber}, guid ${guid}  https://layerzeroscan.com/tx/${tx.hash}`);

  const deadline = Date.now() + WAIT_MIN * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30_000));
    const j: any = await fetch(`https://scan.layerzero-api.com/v1/messages/tx/${tx.hash}`).then((r) => r.json()).catch(() => null);
    const m = j?.data?.[0];
    const status = m?.status?.name ?? 'unknown';
    if (status !== last) { console.log(`  ${new Date().toISOString().slice(11, 19)} LZ Scan: ${status}${m?.destination?.tx?.txHash ? ' dst tx ' + D.explorer + m.destination.tx.txHash : ''}`); last = status; }
    if (status === 'DELIVERED') {
      const dstBalAfter = await dstOft.balanceOf(recipient);
      console.log(`  recipient on ${D.name} after: ${ethers.formatEther(dstBalAfter)} (+${ethers.formatEther(dstBalAfter - dstBalBefore)})`);
      console.log(`  dest inboundNonce now ${await epD.inboundNonce(D.tokens[tok], S.eid, ethers.zeroPadValue(S.tokens[tok], 32))}`);
      return;
    }
    if (status === 'FAILED' || status === 'BLOCKED') { console.log('  ✗ message failed/blocked — check LZ Scan'); process.exit(1); }
  }
  console.log(`  not delivered within ${WAIT_MIN} min — keep watching https://layerzeroscan.com/tx/${tx.hash}`);
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
