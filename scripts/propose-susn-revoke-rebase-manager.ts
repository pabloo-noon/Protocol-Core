/**
 * Ethereum (audit H-7): revoke REBASE_MANAGER_ROLE on sUSN from the two EOAs that still hold it.
 *   [0] sUSN.revokeRole(REBASE_MANAGER_ROLE, deployer 0x1738…D699)
 *   [1] sUSN.revokeRole(REBASE_MANAGER_ROLE, proposer EOA 0xcC24…b11f)
 * Remaining holders after execution: the Ethereum Safe and MinterHandlerV2 (which performs the rebases).
 * Guards: role hash == keccak("REBASE_MANAGER_ROLE"), Safe holds DEFAULT_ADMIN, the Safe + MinterHandlerV2 keep the role,
 * every EOA currently holds it (else skipped), each call simulates from the Safe and reverts from a stranger.
 *
 *   npx hardhat run scripts/propose-susn-revoke-rebase-manager.ts              dry run
 *   PROPOSE=true npx hardhat run scripts/propose-susn-revoke-rebase-manager.ts
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch, Tx } from './lib/safe-propose';
dotenvConfig({ path: resolve(__dirname, '../.env') });
const PROPOSE = process.env.PROPOSE === 'true';
const CHAIN = { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'] };
const SAFE = '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f';
const SUSN = '0xE24a3DC889621612422A64E6388927901608B91D';
const MINTER = '0xB91b361ebE4022Bb62dF0651bDD09b21209ac058';
const ROLE = ethers.id('REBASE_MANAGER_ROLE');
const EXPECTED_ROLE = '0x4ea05e7ddb70e92f6901dc1ddee583f7d7bade2ea156754a6c4034e848e1ef50';
const REVOKE = [
  { name: 'deployer', addr: '0x173806021b18c4E60170e412DC88F991eB00D699' },
  { name: 'proposer EOA', addr: '0xcC2447B495cBc8c2263619Ff3dc4c13604c9b11f' },
];
const AC = new ethers.Interface(['function hasRole(bytes32,address) view returns (bool)', 'function revokeRole(bytes32,address)']);

async function main() {
  if (ROLE !== EXPECTED_ROLE) throw new Error(`role hash mismatch ${ROLE}`);
  const p = (await provider(CHAIN.rpcs as string[], CHAIN.chainId))!;
  const c = new ethers.Contract(SUSN, AC, p);
  const [safeAdmin, safeRebase, minterRebase] = await Promise.all([c.hasRole(ethers.ZeroHash, SAFE), c.hasRole(ROLE, SAFE), c.hasRole(ROLE, MINTER)]);
  console.log(`sUSN ${SUSN}: Safe DEFAULT_ADMIN ${safeAdmin} | REBASE_MANAGER: Safe ${safeRebase}, MinterHandlerV2 ${minterRebase}`);
  if (!safeAdmin) throw new Error('Safe is not DEFAULT_ADMIN on sUSN');
  if (!safeRebase || !minterRebase) throw new Error('Safe / MinterHandlerV2 must keep REBASE_MANAGER');
  const txs: Tx[] = [];
  for (const r of REVOKE) {
    const has = await c.hasRole(ROLE, r.addr);
    const code = await p.getCode(r.addr);
    console.log(`${r.name} ${r.addr}: hasRole ${has} (${code === '0x' ? 'EOA' : 'contract'})`);
    if (has) txs.push(tx(SUSN, AC.encodeFunctionData('revokeRole', [ROLE, r.addr])));
  }
  if (!txs.length) { console.log('nothing to do'); return; }
  for (const [i, t] of txs.entries()) {
    try { await p.call({ to: t.to, data: t.data, from: SAFE }); console.log(`  [${i}] revokeRole(REBASE_MANAGER, ${REVOKE[i].addr.slice(0, 10)}…) simulates from Safe ✓`); }
    catch (e: any) { throw new Error(`simulation failed: ${(e.shortMessage || e.message).slice(0, 80)}`); }
    let strangerPassed = false;
    try { await p.call({ to: t.to, data: t.data, from: ethers.ZeroAddress }); strangerPassed = true; } catch { console.log('      from stranger: reverts ✓'); }
    if (strangerPassed) throw new Error('stranger can revoke');
  }
  const f = writeBatch('ethereum', 1, SAFE, 'susn-revoke-rebase-manager', 'sUSN revokeRole(REBASE_MANAGER_ROLE) from deployer + proposer EOA (H-7)', txs);
  console.log(`→ ${f}`);
  if (PROPOSE) await proposeToSafe(p, CHAIN, SAFE, txs, 'sUSN revoke REBASE_MANAGER from 2 EOAs (H-7)');
}
main().catch((e) => { console.error(e); process.exit(1); });
