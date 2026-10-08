/**
 * Put the LayerZero configuration authority of USN and sUSN under the 4h GenericTimelockV2.
 *
 * On LayerZero V2 the endpoint gates setConfig / setSendLibrary / setReceiveLibrary / skip / clear / nilify / burn on
 * `endpoint.delegates(oapp)`. Today the delegate is the chain Safe. This proposes, per chain, one Safe batch:
 *   USN.setDelegate(timelockV2)  +  sUSN.setDelegate(timelockV2)          (setDelegate is onlyOwner on the OApp; owner = Safe)
 * After execution every DVN / library / nonce-skip change is: Safe -> timelockV2.queue(endpoint, 0, "setConfig(...)", args, eta)
 * -> 4h -> Safe -> timelockV2.execute(...). Peers, enforced options, pause, rate limiter wiring stay owner-level (Safe, immediate).
 *
 * Chains: ethereum (eid 30101) and zksync (eid 30165). Base / HyperEVM / Citrea / Bera have no LayerZero OApp.
 *
 *   npx hardhat run scripts/propose-lz-delegate-timelock.ts                dry run
 *   PROPOSE=true npx hardhat run scripts/propose-lz-delegate-timelock.ts   queue in the Safes
 * Env: CHAINS=…, TIMELOCK_<CHAIN> (else scripts/out/generic-timelocks-4h.json).
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch, Tx } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });
const PROPOSE = process.env.PROPOSE === 'true';
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const TLS = JSON.parse(fs.readFileSync(resolve(__dirname, 'out/generic-timelocks-4h.json'), 'utf8'));

const CHAINS = [
  { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'], safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f', endpoint: '0x1a44076050125825900e736c501f859c50fE728c', oapps: [['USN', '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD'], ['sUSN', '0xE24a3DC889621612422A64E6388927901608B91D']] },
  { name: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'], safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263', endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF', oapps: [['USN', '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6'], ['sUSN', '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f']] },
];
const OAPP = new ethers.Interface(['function owner() view returns (address)', 'function setDelegate(address)']);
const EP = new ethers.Interface(['function delegates(address) view returns (address)']);
const TL = new ethers.Interface(['function owner() view returns (address)', 'function delay() view returns (uint256)']);

async function main() {
  let problems = 0;
  for (const c of CHAINS) {
    if (ONLY && !ONLY.includes(c.name)) continue;
    const timelock = process.env[`TIMELOCK_${c.name.toUpperCase()}`] ?? TLS[c.name]?.timelock;
    console.log(`\n== ${c.name}  timelockV2 ${timelock}`);
    const p = (await provider(c.rpcs as string[], c.chainId))!;
    const tl = new ethers.Contract(timelock, TL, p);
    const [tlOwner, delay] = await Promise.all([tl.owner(), tl.delay()]);
    console.log(`  timelock owner ${tlOwner === c.safe ? 'Safe ✓' : tlOwner + ' ✗'} delay ${Number(delay) / 3600}h`);
    if (tlOwner !== c.safe) { problems++; continue; }
    const ep = new ethers.Contract(c.endpoint, EP, p);
    const txs: Tx[] = [];
    for (const [n, a] of c.oapps) {
      const owner = await new ethers.Contract(a, OAPP, p).owner();
      const delegate = await ep.delegates(a);
      console.log(`  ${n} ${a}: owner ${owner === c.safe ? 'Safe ✓' : owner} | delegate ${delegate === c.safe ? 'Safe' : delegate === timelock ? 'timelockV2 (already)' : delegate}`);
      if (owner !== c.safe) { problems++; continue; }
      if (delegate !== timelock) txs.push(tx(a, OAPP.encodeFunctionData('setDelegate', [timelock])));
    }
    if (!txs.length) { console.log('  nothing to do'); continue; }
    for (const [i, t] of txs.entries()) {
      try { await p.call({ to: t.to, data: t.data, from: c.safe }); console.log(`  [${i}] setDelegate(timelockV2) on ${t.to.slice(0, 10)}… simulates from Safe ✓`); }
      catch (e: any) { problems++; console.log(`  [${i}] REVERTS: ${(e.shortMessage || e.message).slice(0, 80)}`); }
      try { await p.call({ to: t.to, data: t.data, from: ethers.ZeroAddress }); console.log('      from stranger: PASSES ✗'); problems++; } catch { console.log('      from stranger: reverts ✓'); }
    }
    const f = writeBatch(c.name, c.chainId, c.safe, 'lz-delegate-timelock', `USN + sUSN setDelegate(${timelock}) — DVN/library/skip changes go through the 4h timelock`, txs);
    console.log(`  → ${f}`);
    if (PROPOSE && !problems) { try { await proposeToSafe(p, c, c.safe, txs, `lz-delegate-timelock ${c.name}`); } catch (e: any) { problems++; console.log(`  ✗ propose failed: ${String(e?.message).slice(0, 160)}`); } }
  }
  if (problems) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
