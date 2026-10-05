/**
 * Put a GenericTimelock in front of each BridgeRateLimiter (Ownable2Step), in two Safe transactions per chain:
 *
 *   PHASE=1 (default)  Safe batch:  limiter.transferOwnership(timelock)
 *                                   timelock.queue(limiter, 0, "acceptOwnership()", 0x, eta)
 *   PHASE=2            Safe tx:     timelock.execute(limiter, 0, "acceptOwnership()", 0x, eta)   (eta <= now <= eta + 14d)
 *
 * eta = now + timelock.delay() + ETA_BUFFER (default 3 days of signing slack; queue reverts EtaTooSoon if the Safe
 * executes phase 1 later than eta - delay). The eta is stored in scripts/out/safe/<chain>-limiter-timelock.json and
 * must be reused for phase 2 (ETA_<CHAIN> env or the file).
 *
 * After phase 2 the limiter owner is the timelock: every setRateLimits / blockOutbound / unblockOutbound /
 * resetInFlight goes through queue -> 2 days -> execute, both from the Safe. Read the WARNING in the summary.
 *
 *   npx hardhat run scripts/propose-limiter-timelock.ts                  dry run (JSON + simulations)
 *   PROPOSE=true npx hardhat run scripts/propose-limiter-timelock.ts     queue phase 1 in the Safes
 *   PHASE=2 PROPOSE=true npx hardhat run scripts/propose-limiter-timelock.ts
 * Env: CHAINS=…, TIMELOCK_<CHAIN> (else scripts/out/generic-timelocks.json), ETA_BUFFER (seconds), ETA_<CHAIN>.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch, SAFE_SERVICE, Tx } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });
const PROPOSE = process.env.PROPOSE === 'true';
const PHASE = Number(process.env.PHASE ?? 1);
const ETA_BUFFER = BigInt(process.env.ETA_BUFFER ?? 3 * 86400);
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const TL_FILE = resolve(__dirname, 'out/generic-timelocks.json');

const CHAINS = [
  { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'], safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f', limiter: '0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F' },
  { name: 'base', chainId: 8453, rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'], safe: '0xf56d33ef52642ce226A566610A979DC8d954592D', limiter: '0xEFff8C4260aF5DA5eB26194CB45407f497756db7' },
  { name: 'hyperevm', chainId: 999, rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'], safe: '0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8', limiter: '0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2' },
  { name: 'citrea', chainId: 4114, rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'], safe: '0xB2aD758Ee2710527A28d906F9588938c2e5cFc80', limiter: '0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815' },
  { name: 'bera', chainId: 80094, rpcs: [process.env.BERA_RPC_URL, 'https://rpc.berachain.com'], safe: '0x94E9f383b085D32973634EA7c9bB2038eF9a3C58', limiter: '0x51A30E647D33A044967FA3DBb04d6ED6F45455F6' },
  { name: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'], safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263', limiter: '0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E' },
];
const LIM = new ethers.Interface(['function owner() view returns (address)', 'function pendingOwner() view returns (address)', 'function transferOwnership(address)', 'function acceptOwnership()']);
const TL = new ethers.Interface(['function owner() view returns (address)', 'function delay() view returns (uint256)', 'function queued(bytes32) view returns (bool)', 'function hashOperation(address,uint256,string,bytes,uint256) view returns (bytes32)', 'function queue(address,uint256,string,bytes,uint256)', 'function execute(address,uint256,string,bytes,uint256)', 'error EtaTooSoon(uint256,uint256)', 'error OperationNotReady(uint256,uint256)', 'error OperationNotQueued(bytes32)']);
const SIG = 'acceptOwnership()';

async function main() {
  const tls = fs.existsSync(TL_FILE) ? JSON.parse(fs.readFileSync(TL_FILE, 'utf8')) : {};
  let problems = 0;
  for (const c of CHAINS) {
    if (ONLY && !ONLY.includes(c.name)) continue;
    const timelock = process.env[`TIMELOCK_${c.name.toUpperCase()}`] ?? tls[c.name]?.timelock;
    console.log(`\n== ${c.name}`);
    if (!timelock) { console.log('  no timelock address yet (deploy-generic-timelocks.ts) — skipped'); continue; }
    const p = await provider(c.rpcs as string[], c.chainId);
    if (!p) { console.log('  no RPC'); problems++; continue; }
    const lim = new ethers.Contract(c.limiter, LIM, p), tl = new ethers.Contract(timelock, TL, p);
    const [limOwner, limPending, tlOwner, delay] = await Promise.all([lim.owner(), lim.pendingOwner(), tl.owner(), tl.delay()]);
    console.log(`  limiter ${c.limiter} owner ${limOwner === c.safe ? 'Safe ✓' : limOwner} pendingOwner ${limPending === ethers.ZeroAddress ? '0' : limPending}`);
    console.log(`  timelock ${timelock} owner ${tlOwner === c.safe ? 'Safe ✓' : tlOwner + ' ✗'} delay ${Number(delay) / 86400}d`);
    if (tlOwner !== c.safe) { problems++; continue; }

    const file = resolve(__dirname, `out/safe/${c.name}-limiter-timelock.json`);
    let eta: bigint;
    if (PHASE === 1) {
      if (limOwner !== c.safe) { console.log('  limiter not owned by the Safe — nothing to do'); continue; }
      const now = BigInt((await p.getBlock('latest'))!.timestamp);
      eta = BigInt(process.env[`ETA_${c.name.toUpperCase()}`] ?? (now + delay + ETA_BUFFER));
      const txs: Tx[] = [
        tx(c.limiter, LIM.encodeFunctionData('transferOwnership', [timelock])),
        tx(timelock, TL.encodeFunctionData('queue', [c.limiter, 0, SIG, '0x', eta])),
      ];
      for (const [i, t] of txs.entries()) { try { await p.call({ to: t.to, data: t.data, from: c.safe }); console.log(`  [${i}] simulates from Safe ✓`); } catch (e: any) { problems++; console.log(`  [${i}] REVERTS from Safe: ${(e.shortMessage || e.message).slice(0, 80)}`); } }
      const f = writeBatch(c.name, c.chainId, c.safe, 'limiter-timelock', `phase 1: limiter.transferOwnership(timelock) + timelock.queue(acceptOwnership, eta ${eta})`, txs);
      const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.meta.eta = eta.toString(); j.meta.timelock = timelock; fs.writeFileSync(f, JSON.stringify(j, null, 2));
      console.log(`  eta ${eta} (${new Date(Number(eta) * 1000).toISOString()}); phase 1 must execute before ${new Date(Number(eta - delay) * 1000).toISOString()}; phase 2 window until ${new Date(Number(eta + 14n * 86400n) * 1000).toISOString()}`);
      console.log(`  → ${f}`);
      if (PROPOSE && SAFE_SERVICE[c.name]) { try { await proposeToSafe(p, c, c.safe, txs, `limiter-timelock phase 1 ${c.name}`); } catch (e: any) { problems++; console.log(`  ✗ propose failed: ${String(e?.message).slice(0, 160)}`); } }
      else if (PROPOSE) console.log('  no Safe service — import the JSON');
    } else {
      const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).meta?.eta : undefined;
      eta = BigInt(process.env[`ETA_${c.name.toUpperCase()}`] ?? stored ?? 0);
      if (!eta) { console.log('  no eta known for phase 2 (ETA_<CHAIN> or the phase-1 JSON) — skipped'); problems++; continue; }
      const opHash = await tl.hashOperation(c.limiter, 0, SIG, '0x', eta);
      const isQueued = await tl.queued(opHash);
      console.log(`  op ${opHash} queued=${isQueued} eta ${new Date(Number(eta) * 1000).toISOString()} | limiter pendingOwner ${limPending === timelock ? 'timelock ✓' : limPending}`);
      if (!isQueued || limPending !== timelock) { problems++; console.log('  phase 1 not executed yet — skipped'); continue; }
      const txs: Tx[] = [tx(timelock, TL.encodeFunctionData('execute', [c.limiter, 0, SIG, '0x', eta]))];
      try { await p.call({ to: txs[0].to, data: txs[0].data, from: c.safe }); console.log('  execute simulates from Safe ✓ (eta reached)'); } catch (e: any) { const d = e.data || e.info?.error?.data || ''; let n = ''; try { n = TL.parseError(d)?.name || ''; } catch {} console.log(`  execute simulation: ${n || (e.shortMessage || '').slice(0, 60)}${n === 'OperationNotReady' ? ' (eta not reached yet; proposing is still fine, sign after the eta)' : ''}`); }
      const f = writeBatch(c.name, c.chainId, c.safe, 'limiter-timelock-execute', `phase 2: timelock.execute(acceptOwnership, eta ${eta})`, txs);
      console.log(`  → ${f}`);
      if (PROPOSE && SAFE_SERVICE[c.name]) { try { await proposeToSafe(p, c, c.safe, txs, `limiter-timelock phase 2 ${c.name}`); } catch (e: any) { problems++; console.log(`  ✗ propose failed: ${String(e?.message).slice(0, 160)}`); } }
      else if (PROPOSE) console.log('  no Safe service — import the JSON');
    }
  }
  console.log(`\nWARNING: once the timelock owns a limiter, blockOutbound / lowering limits / resetInFlight on that chain also take the\nfull delay (MIN_DELAY is 2 days, hard-coded). The limiter stops being an emergency control. Decide before signing phase 1.`);
  if (problems) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
