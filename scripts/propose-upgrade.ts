/**
 * Propose the proxy upgrades for the audited implementations, through whatever
 * owns each ProxyAdmin:
 *
 *   Timelock (ETH, Base, HyperEVM, Citrea, Bera — contracts/periphery/Timelock.sol,
 *   owned by the chain's token Safe):
 *     phase 1  Safe → Timelock.scheduleUpgrade(proxyAdmin, proxy, impl, 0x)
 *     wait     Timelock.delay() (48h; 24h on HyperEVM)
 *     phase 2  Safe → Timelock.executeUpgrade(proxyAdmin, proxy, impl, 0x)
 *              + token.setRateLimiter(limiter) in the same batch (same Safe;
 *              setRateLimiter only exists on the new implementation)
 *
 *   Safe directly (zkSync — the Safe owns the ProxyAdmin):
 *     Safe → ProxyAdmin.upgradeAndCall(proxy, impl, 0x) + token.setRateLimiter(limiter)
 *
 * The script reads on-chain state to tell which phase each upgrade is in
 * (not scheduled / scheduled, waiting / ready to execute / done) and writes one
 * Safe Transaction Builder JSON per chain and phase to scripts/out/safe/,
 * ready to import in the Safe UI (Apps → Transaction Builder → load batch).
 *
 * Inputs: implementation + limiter addresses from scripts/out/audited-implementations.json
 * (written by deploy-audited-implementations.ts), overridable with
 *   IMPL_<CHAIN>_<TOKEN>=0x...   LIMITER_<CHAIN>=0x...
 *
 * Usage:
 *   npx hardhat run scripts/propose-upgrade.ts                # all chains with deployed implementations
 *   CHAINS=base,bera npx hardhat run scripts/propose-upgrade.ts
 *   NO_LIMITER=true ...                                       # leave setRateLimiter out of the batch
 *
 * Nothing is sent on-chain by this script; the Safe signers do that.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const NO_LIMITER = process.env.NO_LIMITER === 'true';
const DEPLOYMENTS = resolve(__dirname, 'out/audited-implementations.json');
const OUT_DIR = resolve(__dirname, 'out/safe');

const IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

const CHAINS: {
  name: string;
  chainId: number;
  rpcs: string[];
  tokens: { token: string; proxy: string }[];
}[] = [
  {
    name: 'ethereum',
    chainId: 1,
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'USN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' },
      { token: 'sUSN', proxy: '0xE24a3DC889621612422A64E6388927901608B91D' },
    ],
  },
  {
    name: 'base',
    chainId: 8453,
    rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F' },
    ],
  },
  {
    name: 'hyperevm',
    chainId: 999,
    rpcs: [
      process.env.HYPEREVM_RPC_URL,
      'https://rpc.hyperliquid.xyz/evm',
    ].filter(Boolean) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F' },
    ],
  },
  {
    name: 'citrea',
    chainId: 4114,
    rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' },
    ],
  },
  {
    name: 'bera',
    chainId: 80094,
    rpcs: [process.env.BERACHAIN_RPC_URL, 'https://rpc.berachain.com'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' },
    ],
  },
  {
    name: 'zksync',
    chainId: 324,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'USN', proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6' },
      { token: 'sUSN', proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f' },
    ],
  },
];

const ABI = [
  'function owner() view returns (address)',
  'function rateLimiter() view returns (address)',
  'function setRateLimiter(address)',
  'function upgradeAndCall(address proxy, address implementation, bytes data) payable',
  // Timelock (contracts/periphery/Timelock.sol)
  'function delay() view returns (uint256)',
  'function scheduledAt(bytes32) view returns (uint256)',
  'function getOperationId(address proxyAdmin, address proxy, address implementation, bytes data) pure returns (bytes32)',
  'function scheduleUpgrade(address proxyAdmin, address proxy, address implementation, bytes data)',
  'function executeUpgrade(address proxyAdmin, address proxy, address implementation, bytes data) payable',
  // Safe
  'function getThreshold() view returns (uint256)',
];
const iface = new ethers.Interface(ABI);

type Tx = {
  to: string;
  value: string;
  data: string;
  contractMethod: null;
  contractInputsValues: null;
};
function safeBatch(
  chainId: number,
  safe: string,
  name: string,
  description: string,
  txs: Tx[]
) {
  return {
    version: '1.0',
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name,
      description,
      txBuilderVersion: '1.17.0',
      createdFromSafeAddress: safe,
      createdFromOwnerAddress: '',
    },
    transactions: txs,
  };
}
const tx = (to: string, data: string): Tx => ({
  to,
  value: '0',
  data,
  contractMethod: null,
  contractInputsValues: null,
});

async function rpcChainId(rpc: string): Promise<number> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
      signal: ctl.signal,
    });
    const j: any = await res.json();
    if (!j?.result) throw new Error('bad eth_chainId');
    return Number(j.result);
  } finally {
    clearTimeout(t);
  }
}

function loadDeployments(): Record<
  string,
  { impl?: string; limiter?: string }
> {
  const out: Record<string, { impl?: string; limiter?: string }> = {};
  try {
    const runs: any[] = JSON.parse(fs.readFileSync(DEPLOYMENTS, 'utf8'));
    for (const run of runs) {
      if (!run.broadcast) continue;
      for (const p of run.plans ?? []) {
        if (!p.newImpl) continue;
        out[`${p.chain}:${p.token}`] = { impl: p.newImpl, limiter: p.limiter };
      }
    }
  } catch {}
  return out;
}

async function main() {
  const deployed = loadDeployments();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const now = Math.floor(Date.now() / 1000);

  for (const chain of CHAINS) {
    if (ONLY && !ONLY.includes(chain.name)) continue;
    let p: ethers.JsonRpcProvider | undefined;
    for (const rpc of chain.rpcs) {
      try {
        const id = await rpcChainId(rpc);
        if (id !== chain.chainId)
          throw new Error(`chainId ${id} != ${chain.chainId}`);
        p = new ethers.JsonRpcProvider(rpc, id, {
          staticNetwork: ethers.Network.from(id),
          batchMaxCount: 1,
        });
        break;
      } catch (e: any) {
        console.log(`  ${rpc}: ${String(e?.message).slice(0, 60)}`);
      }
    }
    console.log(`\n== ${chain.name}`);
    if (!p) {
      console.log('  no reachable RPC');
      continue;
    }

    const phase1: Tx[] = []; // schedule (timelock) or upgrade (direct) + setRateLimiter
    const phase2: Tx[] = []; // execute (timelock) after the delay
    let safe = '';
    let delayH = 0;
    let readyAt = 0;
    const notes: string[] = [];

    for (const t of chain.tokens) {
      const key = `${chain.name}:${t.token}`;
      const impl =
        process.env[
          `IMPL_${chain.name.toUpperCase()}_${t.token.toUpperCase()}`
        ] ?? deployed[key]?.impl;
      const limiter =
        process.env[`LIMITER_${chain.name.toUpperCase()}`] ??
        deployed[key]?.limiter;
      if (!impl) {
        console.log(
          `  ${t.token} ${t.proxy}: no new implementation recorded — deploy first (or set IMPL_${chain.name.toUpperCase()}_${t.token.toUpperCase()})`
        );
        continue;
      }
      const token = new ethers.Contract(t.proxy, ABI, p);
      const currentImpl = ethers.getAddress(
        '0x' + (await p.getStorage(t.proxy, IMPL_SLOT)).slice(-40)
      );
      const proxyAdmin = ethers.getAddress(
        '0x' + (await p.getStorage(t.proxy, ADMIN_SLOT)).slice(-40)
      );
      const adminOwner: string = await new ethers.Contract(
        proxyAdmin,
        ABI,
        p
      ).owner();
      const tokenOwner: string = await token.owner();
      if ((await p.getCode(impl)) === '0x')
        throw new Error(
          `${key}: implementation ${impl} has no code on ${chain.name}`
        );

      if (currentImpl.toLowerCase() === impl.toLowerCase()) {
        console.log(`  ${t.token} ${t.proxy}: already on ${impl} ✓`);
      } else {
        const upgradeData = iface.encodeFunctionData('upgradeAndCall', [
          t.proxy,
          impl,
          '0x',
        ]);
        // Is the ProxyAdmin owner our Timelock?
        const tl = new ethers.Contract(adminOwner, ABI, p);
        let isTimelock = false;
        let delay = 0n;
        try {
          delay = await tl.delay();
          isTimelock = true;
        } catch {}

        if (isTimelock) {
          const tlOwner: string = await tl.owner();
          safe = safe || tlOwner;
          if (tlOwner.toLowerCase() !== safe.toLowerCase())
            notes.push(
              `${t.token}: timelock owner ${tlOwner} differs from ${safe}`
            );
          delayH = Number(delay) / 3600;
          // Cross-check the operation id with the contract's own pure function.
          const opId: string = await tl.getOperationId(
            proxyAdmin,
            t.proxy,
            impl,
            '0x'
          );
          const local = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['address', 'address', 'address', 'bytes'],
              [proxyAdmin, t.proxy, impl, '0x']
            )
          );
          if (opId !== local)
            throw new Error(
              `${key}: operation id mismatch (ABI drift on ${adminOwner})`
            );
          const at = Number(await tl.scheduledAt(opId));
          const args = [proxyAdmin, t.proxy, impl, '0x'];
          if (at === 0) {
            phase1.push(
              tx(adminOwner, iface.encodeFunctionData('scheduleUpgrade', args))
            );
            phase2.push(
              tx(adminOwner, iface.encodeFunctionData('executeUpgrade', args))
            );
            console.log(
              `  ${t.token} ${t.proxy}: ${currentImpl} → ${impl}\n     NOT SCHEDULED — phase 1: Timelock ${adminOwner}.scheduleUpgrade (delay ${delayH}h), by Safe ${tlOwner}\n     opId ${opId}`
            );
          } else {
            const after = at + Number(delay);
            readyAt = Math.max(readyAt, after);
            phase2.push(
              tx(adminOwner, iface.encodeFunctionData('executeUpgrade', args))
            );
            const state =
              now >= after
                ? 'READY — phase 2: executeUpgrade'
                : `SCHEDULED, executable at ${new Date(after * 1000).toISOString()} (in ${((after - now) / 3600).toFixed(1)}h)`;
            console.log(
              `  ${t.token} ${t.proxy}: ${currentImpl} → ${impl}\n     ${state}\n     opId ${opId}`
            );
          }
        } else {
          // ProxyAdmin owned by the Safe (or an EOA) directly.
          safe = safe || adminOwner;
          phase1.push(tx(proxyAdmin, upgradeData));
          console.log(
            `  ${t.token} ${t.proxy}: ${currentImpl} → ${impl}\n     ProxyAdmin ${proxyAdmin} owned directly by ${adminOwner} — single tx upgradeAndCall`
          );
        }
      }

      // Limiter wiring: same Safe (token owner) — batch it with phase 1.
      if (!NO_LIMITER && limiter) {
        const wired: string = await token
          .rateLimiter()
          .catch(() => ethers.ZeroAddress);
        if (wired.toLowerCase() === limiter.toLowerCase()) {
          console.log(`     rateLimiter already ${limiter} ✓`);
        } else if (
          tokenOwner.toLowerCase() !== (safe || tokenOwner).toLowerCase()
        ) {
          notes.push(
            `${t.token}: token owner ${tokenOwner} is not the upgrade Safe ${safe}; setRateLimiter(${limiter}) needs its own batch from ${tokenOwner}`
          );
        } else {
          safe = safe || tokenOwner;
          // setRateLimiter only exists on the NEW implementation: it must run after the upgrade.
          // Timelock chains: append to phase 2; direct chains: same batch, after upgradeAndCall.
          (chain.name === 'zksync' ? phase1 : phase2).push(
            tx(t.proxy, iface.encodeFunctionData('setRateLimiter', [limiter]))
          );
          console.log(
            `     + ${t.token}.setRateLimiter(${limiter}) ${chain.name === 'zksync' ? 'in the same batch' : 'in phase 2 (after executeUpgrade)'}`
          );
        }
      }
    }

    if (!safe) continue;
    const write = (phase: string, txs: Tx[], desc: string) => {
      if (!txs.length) return;
      const f = resolve(OUT_DIR, `${chain.name}-${phase}.json`);
      fs.writeFileSync(
        f,
        JSON.stringify(
          safeBatch(chain.chainId, safe, `${chain.name} ${phase}`, desc, txs),
          null,
          2
        )
      );
      console.log(`  → ${f}  (${txs.length} tx, Safe ${safe})`);
    };
    write(
      '1-schedule',
      phase1,
      chain.name === 'zksync'
        ? 'ProxyAdmin.upgradeAndCall + setRateLimiter'
        : `Timelock.scheduleUpgrade (delay ${delayH}h)`
    );
    write(
      '2-execute',
      phase2,
      `Timelock.executeUpgrade after the delay, then setRateLimiter`
    );
    if (readyAt)
      console.log(
        `  phase 2 executable from ${new Date(readyAt * 1000).toISOString()}`
      );
    for (const n of notes) console.log(`  ! ${n}`);
  }
  console.log(
    '\nImport each JSON in the Safe UI: Apps → Transaction Builder → "load batch". Phase 2 files can be prepared now but will revert until the delay has elapsed.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
