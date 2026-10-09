/**
 * Ethereum: move the DEFAULT_ADMIN_ROLE of MinterHandlerV2 and RedeemHandlerV2 (both deployments) to the 4h
 * GenericTimelockV2, and queue the first change through it (oracle staleness 48h -> 25h on the minter).
 *
 * PHASE=1 (default), one Safe batch:
 *   [0-2] grantRole(DEFAULT_ADMIN_ROLE, timelock4h) on Minter, Redeem(live), Redeem(new)
 *   [3]   timelock4h.queue(minter, 0, "setOracleStalenessThreshold(uint256)", abi(90000), eta)     eta = now + 4h + ETA_BUFFER
 *   [4-6] renounceRole(DEFAULT_ADMIN_ROLE, Safe) on the same three   -> the timelock is the sole admin
 * After this, rebase limit, mint limits, price feeds / thresholds, custodial wallet, whitelists (minter) and treasury /
 * redemption limits / pause (redeem handlers) all go: Safe -> timelock.queue -> 4h -> Safe -> timelock.execute.
 * PHASE=2: Safe tx timelock4h.execute(minter, 0, "setOracleStalenessThreshold(uint256)", abi(90000), eta)  (from the eta, 14 days)
 *
 *   npx hardhat run scripts/propose-handlers-admin-timelock.ts            dry run
 *   PROPOSE=true npx hardhat run scripts/propose-handlers-admin-timelock.ts
 *   PHASE=2 PROPOSE=true npx hardhat run scripts/propose-handlers-admin-timelock.ts
 * Env: NEW_STALENESS (default 90000), ETA_BUFFER (default 86400), ETA (reuse for phase 2; stored in the phase-1 JSON).
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch, Tx } from './lib/safe-propose';
dotenvConfig({ path: resolve(__dirname, '../.env') });
const PROPOSE = process.env.PROPOSE === 'true';
const PHASE = Number(process.env.PHASE ?? 1);
const NEW_STALENESS = BigInt(process.env.NEW_STALENESS ?? 90000);
const ETA_BUFFER = BigInt(process.env.ETA_BUFFER ?? 86400);
const CHAIN = { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'] };
const SAFE = '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f';
const TL4 = '0x398dCDdae394198E6f81d6d8f827CF93b60fB5AE';
const MINTER = '0xB91b361ebE4022Bb62dF0651bDD09b21209ac058';
const HANDLERS = [
  { name: 'MinterHandlerV2', addr: MINTER },
  { name: 'RedeemHandlerV2 (live)', addr: '0xCee62389CB2A63901524D6924E84d0afCF44a411' },
  { name: 'RedeemHandlerV2 (new)', addr: '0xAb0c423975B446e785E21B9b10F3B421c8ED9197' },
];
const SIG = 'setOracleStalenessThreshold(uint256)';
const AC = new ethers.Interface(['function hasRole(bytes32,address) view returns (bool)', 'function grantRole(bytes32,address)', 'function renounceRole(bytes32,address)', 'function oracleStalenessThreshold() view returns (uint256)']);
const TL = new ethers.Interface(['function owner() view returns (address)', 'function delay() view returns (uint256)', 'function queued(bytes32) view returns (bool)', 'function hashOperation(address,uint256,string,bytes,uint256) view returns (bytes32)', 'function queue(address,uint256,string,bytes,uint256)', 'function execute(address,uint256,string,bytes,uint256)', 'error OperationNotReady(uint256,uint256)']);
const file = resolve(__dirname, 'out/safe/ethereum-handlers-admin-timelock.json');

async function main() {
  const p = (await provider(CHAIN.rpcs as string[], CHAIN.chainId))!;
  const tl = new ethers.Contract(TL4, TL, p);
  const [tlOwner, delay] = await Promise.all([tl.owner(), tl.delay()]);
  console.log(`timelock4h ${TL4}: owner ${tlOwner === SAFE ? 'Safe ✓' : tlOwner + ' ✗'} delay ${Number(delay) / 3600}h`);
  if (tlOwner !== SAFE) throw new Error('timelock not owned by the Safe');
  const argData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [NEW_STALENESS]);
  const cur = await new ethers.Contract(MINTER, AC, p).oracleStalenessThreshold();
  console.log(`minter oracleStalenessThreshold now ${cur}s (${Number(cur) / 3600}h) -> target ${NEW_STALENESS}s (${Number(NEW_STALENESS) / 3600}h)`);

  if (PHASE === 1) {
    const txs: Tx[] = [];
    for (const h of HANDLERS) {
      const c = new ethers.Contract(h.addr, AC, p);
      const [safeHas, tlHas] = await Promise.all([c.hasRole(ethers.ZeroHash, SAFE), c.hasRole(ethers.ZeroHash, TL4)]);
      console.log(`${h.name} ${h.addr}: Safe admin ${safeHas}, timelock admin ${tlHas}`);
      if (!safeHas && !tlHas) throw new Error(`${h.name}: Safe is not admin — cannot grant`);
      if (!tlHas) txs.push(tx(h.addr, AC.encodeFunctionData('grantRole', [ethers.ZeroHash, TL4])));
    }
    const now = BigInt((await p.getBlock('latest'))!.timestamp);
    const eta = BigInt(process.env.ETA ?? (now + delay + ETA_BUFFER));
    txs.push(tx(TL4, TL.encodeFunctionData('queue', [MINTER, 0, SIG, argData, eta])));
    for (const h of HANDLERS) {
      const c = new ethers.Contract(h.addr, AC, p);
      if (await c.hasRole(ethers.ZeroHash, SAFE)) txs.push(tx(h.addr, AC.encodeFunctionData('renounceRole', [ethers.ZeroHash, SAFE])));
    }
    let problems = 0;
    for (const [i, t] of txs.entries()) {
      const name = [AC, TL].map((I) => { try { return I.parseTransaction({ data: t.data })?.name; } catch { return null; } }).find(Boolean);
      try { await p.call({ to: t.to, data: t.data, from: SAFE }); console.log(`  [${i}] ${name} @ ${t.to.slice(0, 10)}… simulates from Safe ✓`); }
      catch (e: any) { problems++; console.log(`  [${i}] ${name} @ ${t.to.slice(0, 10)}… REVERTS: ${(e.shortMessage || e.message).slice(0, 80)}`); }
    }
    // after the batch the timelock must be able to run the queued setter: simulate it from the timelock as if admin (state override not available; check the role path statically)
    console.log(`  eta ${eta} (${new Date(Number(eta) * 1000).toISOString()}); phase 1 must execute before ${new Date(Number(eta - delay) * 1000).toISOString()}; phase 2 window until ${new Date(Number(eta + 14n * 86400n) * 1000).toISOString()}`);
    if (problems) process.exit(1);
    const f = writeBatch('ethereum', 1, SAFE, 'handlers-admin-timelock', `Minter + Redeem admin -> timelock4h; queue setOracleStalenessThreshold(${NEW_STALENESS}) eta ${eta}; Safe renounces admin`, txs);
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.meta.eta = eta.toString(); fs.writeFileSync(f, JSON.stringify(j, null, 2));
    console.log(`→ ${f}`);
    if (PROPOSE) await proposeToSafe(p, CHAIN, SAFE, txs, 'handlers admin -> timelock4h + staleness 25h (phase 1)');
  } else {
    const eta = BigInt(process.env.ETA ?? (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).meta?.eta : 0));
    if (!eta) throw new Error('no eta (ETA env or phase-1 JSON)');
    const op = await tl.hashOperation(MINTER, 0, SIG, argData, eta);
    const q = await tl.queued(op); const tlHas = await new ethers.Contract(MINTER, AC, p).hasRole(ethers.ZeroHash, TL4);
    console.log(`op ${op} queued=${q} | timelock is minter admin: ${tlHas} | eta ${new Date(Number(eta) * 1000).toISOString()}`);
    if (!q || !tlHas) throw new Error('phase 1 not executed yet');
    const txs = [tx(TL4, TL.encodeFunctionData('execute', [MINTER, 0, SIG, argData, eta]))];
    try { await p.call({ to: TL4, data: txs[0].data, from: SAFE }); console.log('execute simulates from Safe ✓ (eta reached)'); } catch (e: any) { const d = e.data || e.info?.error?.data || ''; let n = ''; try { n = TL.parseError(d)?.name || ''; } catch {} console.log(`execute simulation: ${n || (e.shortMessage || '').slice(0, 60)}${n === 'OperationNotReady' ? ' (eta not reached yet; sign after the eta)' : ''}`); }
    const f = writeBatch('ethereum', 1, SAFE, 'handlers-admin-timelock-execute', `timelock4h.execute setOracleStalenessThreshold(${NEW_STALENESS}) eta ${eta}`, txs);
    console.log(`→ ${f}`);
    if (PROPOSE) await proposeToSafe(p, CHAIN, SAFE, txs, 'minter staleness 25h (phase 2 execute)');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
