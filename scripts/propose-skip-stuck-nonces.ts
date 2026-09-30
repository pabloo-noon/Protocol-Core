/**
 * Propose EndpointV2.skip(...) for inbound LayerZero nonces that can never be
 * verified, so the channel can move again.
 *
 * Default channel: Ethereum USN (eid 30101) -> zkSync USN. That channel sits at
 * inboundNonce 138 while Ethereum has sent 140; nonces 139/140 carry no payload
 * hash because the sole required DVN (LayerZero Labs) never signed them. Once
 * the receive ULN moves to 3 DVNs (zkSync Safe nonce 39) they can never verify,
 * and the endpoint refuses to execute any later nonce while earlier ones are
 * missing. skip() must be called by the OApp delegate (= the zkSync Safe), one
 * nonce at a time, in order; both calls go in one MultiSend batch.
 *
 * Skipping does NOT refund the source-side senders — they were debited on
 * Ethereum. Making them whole is a separate, off-chain decision.
 *
 *   npx hardhat run scripts/propose-skip-stuck-nonces.ts               dry run + JSON
 *   PROPOSE=true npx hardhat run scripts/propose-skip-stuck-nonces.ts  queue in the Safe
 * Env: CHAIN (default zksync), DST_OAPP, SRC_EID, SRC_OAPP to target another channel.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import {
  provider,
  proposeToSafe,
  tx,
  writeBatch,
  Tx,
} from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const PROPOSE = process.env.PROPOSE === 'true';

const CHAINS: Record<
  string,
  { chainId: number; rpcs: (string | undefined)[]; endpoint: string; eid: number }
> = {
  zksync: {
    chainId: 324,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'],
    endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF',
    eid: 30165,
  },
  ethereum: {
    chainId: 1,
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'],
    endpoint: '0x1a44076050125825900e736c501f859c50fE728c',
    eid: 30101,
  },
};
const SRC_ENDPOINT: Record<number, { chain: string }> = {
  30101: { chain: 'ethereum' },
  30165: { chain: 'zksync' },
};

const CHAIN = (process.env.CHAIN ?? 'zksync').toLowerCase();
const DST_OAPP =
  process.env.DST_OAPP ?? '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6'; // zkSync USN
const SRC_EID = Number(process.env.SRC_EID ?? 30101);
const SRC_OAPP =
  process.env.SRC_OAPP ?? '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD'; // ETH USN

const EP_ABI = [
  'function skip(address _oapp, uint32 _srcEid, bytes32 _sender, uint64 _nonce)',
  'function inboundNonce(address,uint32,bytes32) view returns (uint64)',
  'function lazyInboundNonce(address,uint32,bytes32) view returns (uint64)',
  'function inboundPayloadHash(address,uint32,bytes32,uint64) view returns (bytes32)',
  'function outboundNonce(address,uint32,bytes32) view returns (uint64)',
  'function delegates(address) view returns (address)',
];
const epIface = new ethers.Interface(EP_ABI);

async function main() {
  const dst = CHAINS[CHAIN];
  if (!dst) throw new Error(`unknown CHAIN ${CHAIN}`);
  const src = CHAINS[SRC_ENDPOINT[SRC_EID]?.chain];
  if (!src) throw new Error(`no source endpoint known for eid ${SRC_EID}`);
  const pd = await provider(dst.rpcs as string[], dst.chainId);
  const ps = await provider(src.rpcs as string[], src.chainId);
  if (!pd || !ps) throw new Error('no reachable RPC');

  const epD = new ethers.Contract(dst.endpoint, EP_ABI, pd);
  const epS = new ethers.Contract(src.endpoint, EP_ABI, ps);
  const sender = ethers.zeroPadValue(SRC_OAPP, 32);
  const receiver = ethers.zeroPadValue(DST_OAPP, 32);

  const delegate: string = await epD.delegates(DST_OAPP);
  const inbound = Number(await epD.inboundNonce(DST_OAPP, SRC_EID, sender));
  const lazy = Number(await epD.lazyInboundNonce(DST_OAPP, SRC_EID, sender));
  const outbound = Number(await epS.outboundNonce(SRC_OAPP, dst.eid, receiver));
  console.log(
    `== ${SRC_ENDPOINT[SRC_EID].chain} ${SRC_OAPP} (eid ${SRC_EID}) -> ${CHAIN} ${DST_OAPP}\n` +
      `   source outboundNonce ${outbound} | dest inboundNonce ${inbound} lazyInboundNonce ${lazy} | delegate ${delegate}`
  );
  if (outbound <= inbound) {
    console.log('   channel is in sync — nothing to skip');
    return;
  }

  const txs: Tx[] = [];
  for (let n = inbound + 1; n <= outbound; n++) {
    const h: string = await epD.inboundPayloadHash(DST_OAPP, SRC_EID, sender, n);
    if (h !== ethers.ZeroHash) {
      console.log(
        `   nonce ${n}: payload hash ${h} is VERIFIED — execute it instead of skipping; stopping here`
      );
      break;
    }
    console.log(`   nonce ${n}: no payload hash -> skip(${DST_OAPP}, ${SRC_EID}, ${sender.slice(0, 10)}…, ${n})`);
    txs.push(
      tx(dst.endpoint, epIface.encodeFunctionData('skip', [DST_OAPP, SRC_EID, sender, n]))
    );
  }
  if (!txs.length) return;

  // Only the first skip can be simulated statelessly (each one needs nonce == inboundNonce + 1).
  try {
    await pd.call({ to: txs[0].to, data: txs[0].data, from: delegate });
    console.log(`   first skip simulates OK from the delegate ${delegate}`);
  } catch (e: any) {
    console.log(`   ✗ first skip REVERTS from the delegate: ${(e.shortMessage || e.message).slice(0, 100)}`);
    process.exit(1);
  }
  try {
    await pd.call({ to: txs[0].to, data: txs[0].data, from: ethers.ZeroAddress });
    console.log('   ✗ skip also passes from a stranger — check the delegate gate');
  } catch {
    console.log('   skip from a stranger reverts (delegate-gated) ✓');
  }

  const f = writeBatch(
    CHAIN,
    dst.chainId,
    delegate,
    'skip-stuck-nonces',
    `EndpointV2.skip nonces ${inbound + 1}..${inbound + txs.length} on ${DST_OAPP} from eid ${SRC_EID}`,
    txs
  );
  console.log(`   → ${f} (${txs.length} tx, delegate/Safe ${delegate})`);
  if (PROPOSE) {
    await proposeToSafe(pd, { name: CHAIN, chainId: dst.chainId }, delegate, txs, `skip-stuck-nonces ${CHAIN}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
