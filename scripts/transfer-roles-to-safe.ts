/**
 * Hand the sUSN receiver roles (DEFAULT_ADMIN_ROLE + BLACKLIST_MANAGER_ROLE) on
 * Base / HyperEVM / Bera / Citrea from the deployer EOA to each chain's Safe.
 * pause()/unpause() are gated by DEFAULT_ADMIN_ROLE, so without this the Safes
 * on Bera and Citrea can neither pause nor blacklist (review finding 2).
 *
 * Per chain, per role:
 *   1. grantRole(role, safe)          if the Safe does not hold it
 *   2. re-read hasRole(role, safe)    must be true before step 3
 *   3. renounceRole(role, deployer)   if RENOUNCE=true and the deployer holds it
 * Chains where the Safe already holds both roles and the deployer none are
 * reported and skipped. Roles live in proxy storage: independent of the upgrade.
 *
 *   npx hardhat run scripts/transfer-roles-to-safe.ts                  dry run (read-only)
 *   BROADCAST=true npx hardhat run scripts/transfer-roles-to-safe.ts   grant only
 *   BROADCAST=true RENOUNCE=true npx hardhat run scripts/...           grant, verify, then renounce
 *   CHAINS=bera,citrea                                                 restrict
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const BROADCAST = process.env.BROADCAST === 'true';
const RENOUNCE = process.env.RENOUNCE === 'true';
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());

const CHAINS = [
  {
    name: 'base',
    chainId: 8453,
    rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'],
    token: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F',
    safe: '0xf56d33ef52642ce226A566610A979DC8d954592D',
  },
  {
    name: 'hyperevm',
    chainId: 999,
    rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'],
    token: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F',
    safe: '0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8',
  },
  {
    name: 'bera',
    chainId: 80094,
    rpcs: [process.env.BERA_RPC_URL, 'https://rpc.berachain.com'],
    token: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD',
    safe: '0x94E9f383b085D32973634EA7c9bB2038eF9a3C58',
  },
  {
    name: 'citrea',
    chainId: 4114,
    rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'],
    token: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD',
    safe: '0xB2aD758Ee2710527A28d906F9588938c2e5cFc80',
  },
];

const ROLES: [string, string][] = [
  ['DEFAULT_ADMIN_ROLE', ethers.ZeroHash],
  ['BLACKLIST_MANAGER_ROLE', ethers.id('BLACKLIST_MANAGER_ROLE')],
];

const ABI = [
  'function hasRole(bytes32,address) view returns (bool)',
  'function grantRole(bytes32,address)',
  'function renounceRole(bytes32,address)',
];

async function main() {
  const pk = process.env.DEPLOYER_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_WALLET_PRIVATE_KEY not set');
  const deployer = new ethers.Wallet(pk).address;
  console.log(
    `deployer ${deployer} -> Safe per chain | ${BROADCAST ? 'BROADCAST' : 'dry run'}${RENOUNCE ? ' + RENOUNCE' : ''}`
  );

  let failures = 0;
  for (const chain of CHAINS) {
    if (ONLY && !ONLY.includes(chain.name)) continue;
    console.log(`\n== ${chain.name} sUSN ${chain.token} Safe ${chain.safe}`);
    const p = await provider(chain.rpcs as string[], chain.chainId);
    if (!p) {
      console.log('  no reachable RPC');
      failures++;
      continue;
    }
    const signer = new ethers.Wallet(pk, p);
    const c = new ethers.Contract(chain.token, ABI, signer);

    for (const [name, role] of ROLES) {
      let safeHas: boolean = await c.hasRole(role, chain.safe);
      const deployerHas: boolean = await c.hasRole(role, deployer);
      console.log(
        `  ${name.padEnd(22)} Safe=${safeHas} deployer=${deployerHas}`
      );

      if (!safeHas) {
        if (!deployerHas) {
          console.log(
            `    ✗ neither Safe nor deployer holds ${name}; cannot grant from here`
          );
          failures++;
          continue;
        }
        if (!BROADCAST) {
          console.log(`    would grantRole(${name}, Safe)`);
        } else {
          const tx = await c.grantRole(role, chain.safe);
          const rc = await tx.wait();
          console.log(
            `    ${rc?.status === 1 ? '✓' : '✗'} grantRole(${name}, Safe) ${tx.hash}`
          );
          safeHas = await c.hasRole(role, chain.safe);
          if (!safeHas) {
            console.log('    ✗ Safe still does not hold the role; stopping');
            failures++;
            continue;
          }
        }
      }

      if (deployerHas && RENOUNCE) {
        if (!safeHas) {
          console.log(`    skip renounce: Safe does not hold ${name} yet`);
          continue;
        }
        if (!BROADCAST) {
          console.log(`    would renounceRole(${name}, deployer)`);
        } else {
          const tx = await c.renounceRole(role, deployer);
          const rc = await tx.wait();
          console.log(
            `    ${rc?.status === 1 ? '✓' : '✗'} renounceRole(${name}, deployer) ${tx.hash}`
          );
        }
      } else if (deployerHas) {
        console.log(
          `    deployer still holds ${name} (RENOUNCE=true to drop it once the Safe has it)`
        );
      }
    }

    // Final state
    const final = await Promise.all(
      ROLES.map(async ([n, r]) => [
        n,
        await c.hasRole(r, chain.safe),
        await c.hasRole(r, deployer),
      ])
    );
    console.log(
      `  final: ${final.map(([n, s, d]) => `${n}: Safe=${s} deployer=${d}`).join(' | ')}`
    );
  }
  if (failures) {
    console.log(`\n${failures} problem(s) above`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
