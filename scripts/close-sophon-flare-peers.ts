/**
 * Zero the LayerZero peers that still point at us from deprecated chains:
 *
 *   Sophon USN / sUSN → setPeer(30101 ETH, 0) + setPeer(30165 zkSync, 0)
 *     owner = Sophon Safe 0x553d… (no Safe service / UI on Sophon): the script
 *     writes scripts/out/safe/sophon-zero-peers.json for raw signing with
 *     scripts/safe-raw-tx.ts (hash → 3× sign → exec).
 *   Flare USN / sUSN → setPeer(30101 ETH, 0)
 *     owner = deployer EOA 0x1738… : sent directly with BROADCAST=true
 *     (DEPLOYER_WALLET_PRIVATE_KEY, needs a little FLR).
 *
 * ETH and zkSync already have peers(30334)/peers(30295) = 0, so these routes
 * are dead already; this makes the closure symmetric and legible on-chain.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider, tx, writeBatch, Tx } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const BROADCAST = process.env.BROADCAST === 'true';
const ABI = [
  'function peers(uint32) view returns (bytes32)',
  'function setPeer(uint32 eid, bytes32 peer)',
  'function owner() view returns (address)',
];
const iface = new ethers.Interface(ABI);
const EID: Record<number, string> = { 30101: 'ETH', 30165: 'zkSync' };

const SOPHON = {
  name: 'sophon',
  chainId: 50104,
  rpcs: [process.env.SOPHON_RPC_URL, 'https://rpc.sophon.xyz'],
  tokens: [
    ['USN', '0xC1AA99c3881B26901aF70738A7C217dc32536d36'],
    ['sUSN', '0xb87dbe27db932bacaaa96478443b6519d52c5004'],
  ],
  eids: [30101, 30165],
};
const FLARE = {
  name: 'flare',
  chainId: 14,
  rpcs: [
    process.env.FLARE_RPC_URL,
    'https://flare-api.flare.network/ext/bc/C/rpc',
  ],
  tokens: [
    ['sUSN', '0xF98AF70f2A5a9526248076Df6706Ac96BD1F8A41'],
    ['USN', '0x6086d52F28c7b7481d8aE0FAdD4349cbB608C2Bd'],
  ],
  eids: [30101],
};

async function plan(chain: typeof SOPHON | typeof FLARE) {
  const p = await provider(chain.rpcs as string[], chain.chainId);
  if (!p) throw new Error(`${chain.name}: no reachable RPC`);
  const txs: Tx[] = [];
  let owner = '';
  for (const [tok, addr] of chain.tokens) {
    const c = new ethers.Contract(addr, ABI, p);
    owner = await c.owner();
    for (const eid of chain.eids) {
      const cur = await c.peers(eid);
      if (cur === ethers.ZeroHash) {
        console.log(`  ${tok} peer(${EID[eid]}) already 0`);
        continue;
      }
      console.log(
        `  ${tok} peer(${EID[eid]}) = 0x${cur.slice(-40)} → setPeer(${eid}, 0)`
      );
      txs.push(
        tx(addr, iface.encodeFunctionData('setPeer', [eid, ethers.ZeroHash]))
      );
    }
  }
  return { p, txs, owner };
}

async function main() {
  console.log('== sophon');
  const s = await plan(SOPHON);
  if (s.txs.length) {
    const f = writeBatch(
      'sophon',
      SOPHON.chainId,
      s.owner,
      'zero-peers',
      'setPeer(ETH,0) + setPeer(zkSync,0) on USN and sUSN',
      s.txs
    );
    console.log(
      `  → ${f} (${s.txs.length} tx, Safe ${s.owner}) — no Safe service on Sophon: sign with scripts/safe-raw-tx.ts`
    );
  } else console.log('  nothing to do');

  console.log('\n== flare');
  const f = await plan(FLARE);
  if (!f.txs.length) {
    console.log('  nothing to do');
    return;
  }
  const pk = process.env.DEPLOYER_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_WALLET_PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, f.p);
  if (signer.address.toLowerCase() !== f.owner.toLowerCase())
    throw new Error(
      `Flare tokens are owned by ${f.owner}, signer is ${signer.address}`
    );
  console.log(
    `  owner is the deployer ${signer.address} (FLR balance ${ethers.formatEther(await f.p.getBalance(signer.address))})`
  );
  if (!BROADCAST) {
    console.log('  dry run — BROADCAST=true to send');
    return;
  }
  for (const t of f.txs) {
    const sent = await signer.sendTransaction({ to: t.to, data: t.data });
    const rc = await sent.wait();
    console.log(
      `  ${rc?.status === 1 ? '✓' : '✗'} ${t.to} setPeer → ${sent.hash}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
