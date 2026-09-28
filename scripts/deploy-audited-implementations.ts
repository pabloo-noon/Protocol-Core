/**
 * Deploy the audited implementations (bridge-rate-limiter-v1) on every chain
 * except TAC and Sophon, plus one BridgeRateLimiter per chain.
 *
 * Deploys IMPLEMENTATIONS ONLY — no proxy is touched. For each proxy the
 * script prints the ProxyAdmin.upgradeAndCall(...) and token.setRateLimiter(...)
 * calldata to hand to the owning Safe / timelock.
 *
 * Which contract goes where (verified against the live proxies' shape):
 *   ethereum  USN  → USNUpgradeableHyperlane(lzEndpoint)
 *   ethereum  sUSN → StakingVaultOFTUpgradeableHyperlane(lzEndpoint)
 *   base      sUSN → remote/StakedUSNHyperlane()
 *   hyperevm  sUSN → remote/StakedUSNHyperlane()        (current build has no pause — gains it)
 *   citrea    sUSN → remote/StakedUSNHyperlane()
 *   bera      sUSN → remote/StakedUSNHyperlane()
 *   zksync    USN  → periphery/USNOFTHyperlane(lzEndpoint)
 *   zksync    sUSN → remote/StakedUSNOFTHyperlane(lzEndpoint) (current build has no pause — gains it)
 *
 * The LZ endpoint is read from each proxy (endpoint()), never hardcoded.
 *
 * Two modes, because zkSync needs zksolc bytecode:
 *   EVM chains (ethers + this repo's artifacts, all chains in one run):
 *     npx hardhat run scripts/deploy-audited-implementations.ts                  # dry run: plan + pre-flight only
 *     BROADCAST=true npx hardhat run scripts/deploy-audited-implementations.ts   # deploy
 *     CHAINS=base,bera ...                                                       # restrict
 *     DEPLOY_LIMITER=false ...                                                   # skip BridgeRateLimiter
 *     VERIFY=false ... / VERIFY_DELAY_SECONDS=30                                  # explorer verification runs inline after each deploy
 *     LIMITER_ETHEREUM=0x... (LIMITER_<CHAIN>)                                     # resume: reuse a limiter from an interrupted run
 *     IMPL_ETHEREUM_USN=0x... (IMPL_<CHAIN>_<TOKEN>)                               # resume: reuse an implementation from an interrupted run
 *     DEPLOY_GAS_LIMIT=8000000                                                    # override the gas limit (default: estimate + 25%)
 *     PRIORITY_FEE_GWEI=0.1                                                       # EIP-1559 tip (max fee = 2×base + tip); needed where the RPC reports tip 0
 *     MAX_FEE_GWEI=3                                                              # cap maxFeePerGas (bounds the balance reservation gasLimit × maxFee)
 *   zkSync (hardhat-zksync Deployer, this network only):
 *     [BROADCAST=true] npx hardhat run scripts/deploy-audited-implementations.ts --network zksync
 *
 * Signer: DEPLOYER_WALLET_PRIVATE_KEY, funded with gas on each chain.
 * Results are appended to scripts/out/audited-implementations.json.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as hre from 'hardhat';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const BROADCAST = process.env.BROADCAST === 'true';
const DEPLOY_LIMITER = process.env.DEPLOY_LIMITER !== 'false';
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const VERIFY = process.env.VERIFY !== 'false'; // verify on the explorer right after deploying
const VERIFY_DELAY_MS = Number(process.env.VERIFY_DELAY_SECONDS ?? '30') * 1000;
// chain name → hardhat network name (verify needs a configured network)
const HH_NETWORK: Record<string, string> = {
  ethereum: 'mainnet',
  base: 'base',
  hyperevm: 'hyperevm',
  citrea: 'citrea',
  bera: 'bera',
  zksync: 'zksync',
};
const OUT = resolve(__dirname, 'out/audited-implementations.json');

const IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const EIP170 = 24576;

type Target = {
  token: 'USN' | 'sUSN';
  proxy: string;
  contract: string; // artifact name
  source: string; // for the verify command
  needsEndpoint: boolean;
};
type Chain = {
  name: string;
  rpcs: string[];
  targets: Target[];
  zksync?: boolean;
};

const CHAINS: Chain[] = [
  {
    name: 'ethereum',
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'].filter(
      Boolean
    ) as string[],
    targets: [
      {
        token: 'USN',
        proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD',
        contract: 'USNUpgradeableHyperlane',
        source: 'contracts/USNUpgradeableHyperlane.sol',
        needsEndpoint: true,
      },
      {
        token: 'sUSN',
        proxy: '0xE24a3DC889621612422A64E6388927901608B91D',
        contract: 'StakingVaultOFTUpgradeableHyperlane',
        source: 'contracts/StakingVaultOFTUpgradeableHyperlane.sol',
        needsEndpoint: true,
      },
    ],
  },
  ...(['base', 'hyperevm', 'citrea', 'bera'] as const).map((name) => ({
    name,
    rpcs: [
      process.env[`${name.toUpperCase()}_RPC_URL`],
      {
        base: 'https://mainnet.base.org',
        hyperevm: 'https://rpc.hyperliquid.xyz/evm',
        citrea: 'https://rpc.mainnet.citrea.xyz',
        bera: 'https://rpc.berachain.com',
      }[name],
    ].filter(Boolean) as string[],
    targets: [
      {
        token: 'sUSN' as const,
        proxy:
          name === 'base' || name === 'hyperevm'
            ? '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F'
            : '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD',
        contract: 'StakedUSNHyperlane',
        source: 'contracts/remote/StakedUSNHyperlane.sol',
        needsEndpoint: false,
      },
    ],
  })),
  {
    name: 'zksync',
    zksync: true,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'].filter(
      Boolean
    ) as string[],
    targets: [
      {
        token: 'USN',
        proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6',
        contract: 'USNOFTHyperlane',
        source: 'contracts/periphery/USNOFTHyperlane.sol',
        needsEndpoint: true,
      },
      {
        token: 'sUSN',
        proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f',
        contract: 'StakedUSNOFTHyperlane',
        source: 'contracts/remote/StakedUSNOFTHyperlane.sol',
        needsEndpoint: true,
      },
    ],
  },
];

const ABI = [
  'function owner() view returns (address)',
  'function endpoint() view returns (address)',
  'function paused() view returns (bool)',
  'function asset() view returns (address)',
  'function rateLimiter() view returns (address)',
  'function initialize(string,string,address)',
  'function initialize(address,string,string,address)',
  'function setRateLimiter(address)',
  'function upgradeAndCall(address proxy, address implementation, bytes data) payable',
  'error InvalidInitialization()',
];
const iface = new ethers.Interface(ABI);

const has = async (c: ethers.Contract, fn: string) => {
  try {
    await c[fn]();
    return true;
  } catch {
    return false;
  }
};

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
    if (!j?.result)
      throw new Error(`bad eth_chainId: ${JSON.stringify(j).slice(0, 60)}`);
    return Number(j.result);
  } finally {
    clearTimeout(t);
  }
}

async function provider(
  chain: Chain
): Promise<ethers.JsonRpcProvider | undefined> {
  for (const rpc of chain.rpcs) {
    try {
      const id = await rpcChainId(rpc);
      return new ethers.JsonRpcProvider(rpc, id, {
        staticNetwork: ethers.Network.from(id),
        batchMaxCount: 1,
      });
    } catch (e: any) {
      console.log(`  ${rpc}: ${String(e?.message).slice(0, 60)}`);
    }
  }
  return undefined;
}

type Plan = {
  chain: string;
  token: string;
  proxy: string;
  contract: string;
  source: string;
  ctorArgs: string[];
  currentImpl: string;
  proxyAdmin: string;
  proxyAdminOwner: string;
  tokenOwner: string;
  gainsPause: boolean;
  newImpl?: string;
  limiter?: string;
  txHash?: string;
};

// Pre-flight: the live proxy must be the same family as the contract we are
// about to deploy for it (same LZ / vault shape), or we stop.
async function preflight(
  p: ethers.Provider,
  chain: Chain,
  t: Target
): Promise<Plan> {
  const c = new ethers.Contract(t.proxy, ABI, p);
  const [hasEndpoint, hasPaused, hasAsset] = await Promise.all([
    has(c, 'endpoint'),
    has(c, 'paused'),
    has(c, 'asset'),
  ]);
  const expectVault = t.contract === 'StakingVaultOFTUpgradeableHyperlane';
  if (hasEndpoint !== t.needsEndpoint)
    throw new Error(
      `${chain.name} ${t.token}: proxy ${hasEndpoint ? 'has' : 'lacks'} endpoint() but ${t.contract} ${t.needsEndpoint ? 'needs' : 'has no'} LZ — wrong contract for this proxy`
    );
  if (hasAsset !== expectVault)
    throw new Error(
      `${chain.name} ${t.token}: proxy ${hasAsset ? 'is' : 'is not'} an ERC-4626 vault but target is ${t.contract}`
    );

  const currentImpl = ethers.getAddress(
    '0x' + (await p.getStorage(t.proxy, IMPL_SLOT)).slice(-40)
  );
  const proxyAdmin = ethers.getAddress(
    '0x' + (await p.getStorage(t.proxy, ADMIN_SLOT)).slice(-40)
  );
  let proxyAdminOwner = '?';
  try {
    proxyAdminOwner = await new ethers.Contract(proxyAdmin, ABI, p).owner();
  } catch {}
  const tokenOwner = await c.owner();
  const ctorArgs = t.needsEndpoint ? [await c.endpoint()] : [];
  return {
    chain: chain.name,
    token: t.token,
    proxy: t.proxy,
    contract: t.contract,
    source: t.source,
    ctorArgs,
    currentImpl,
    proxyAdmin,
    proxyAdminOwner,
    tokenOwner,
    gainsPause: !hasPaused,
  };
}

async function checkDeployed(p: ethers.Provider, plan: Plan, from: string) {
  const impl = plan.newImpl!;
  const code = await p.getCode(impl);
  const size = (code.length - 2) / 2;
  if (size === 0 || size > EIP170)
    throw new Error(`${impl}: deployed size ${size} bytes`);
  // Locked at deploy: initialize() on the bare implementation must revert InvalidInitialization.
  const data =
    plan.contract === 'StakingVaultOFTUpgradeableHyperlane'
      ? iface.encodeFunctionData('initialize(address,string,string,address)', [
          plan.proxy,
          'x',
          'x',
          from,
        ])
      : iface.encodeFunctionData('initialize(string,string,address)', [
          'x',
          'x',
          from,
        ]);
  let locked = false;
  try {
    await p.call({ to: impl, from, data });
  } catch (e: any) {
    const d: string = e?.data ?? e?.info?.error?.data ?? '';
    locked =
      (typeof d === 'string' &&
        d.startsWith(iface.getError('InvalidInitialization')!.selector)) ||
      /InvalidInitialization/.test(String(e?.message));
  }
  if (!locked)
    throw new Error(
      `${impl}: initialize() did NOT revert with InvalidInitialization — _disableInitializers missing?`
    );
  if (plan.ctorArgs.length) {
    const ep = await new ethers.Contract(impl, ABI, p).endpoint();
    if (ep.toLowerCase() !== plan.ctorArgs[0].toLowerCase())
      throw new Error(
        `${impl}: endpoint() ${ep} != proxy endpoint ${plan.ctorArgs[0]}`
      );
  }
  console.log(
    `    ✓ ${size} bytes, initializers disabled${plan.ctorArgs.length ? ', endpoint matches proxy' : ''}`
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// EIP-1559 fees set explicitly: some RPCs (Infura) report a 0 priority fee,
// which ethers then signs with and nodes reject ("gas tip cap 0"). Tip is
// PRIORITY_FEE_GWEI (default 0.1), max fee = 2 × base fee + tip.
async function feeOverrides(p: ethers.Provider) {
  const blk = await p.getBlock('latest');
  const base = blk?.baseFeePerGas ?? 0n;
  if (base === 0n) return {}; // legacy-fee chain, let ethers decide
  const tip = ethers.parseUnits(process.env.PRIORITY_FEE_GWEI ?? '0.1', 'gwei');
  // MAX_FEE_GWEI caps what the node reserves (gasLimit × maxFee) from the
  // balance; the tx just waits in the pool if the base fee is above it.
  const maxFee = process.env.MAX_FEE_GWEI
    ? ethers.parseUnits(process.env.MAX_FEE_GWEI, 'gwei')
    : base * 2n + tip;
  if (maxFee < base + tip)
    console.log(
      `    note: MAX_FEE_GWEI ${process.env.MAX_FEE_GWEI} is below base fee ${ethers.formatUnits(base, 'gwei')} — the tx will wait until the base fee drops`
    );
  return { maxPriorityFeePerGas: tip, maxFeePerGas: maxFee };
}

// Public/shared RPCs return transient errors (-32603 "Internal error", 429,
// timeouts). Retry a few times before giving up so one hiccup does not abort
// a multi-chain run half way.
async function withRetry<T>(
  what: string,
  fn: () => Promise<T>,
  tries = 4
): Promise<T> {
  let last: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      // Surface the RPC's own words: ethers hides them behind "could not coalesce error".
      const inner = e?.info?.error?.message ?? e?.error?.message ?? '';
      const method = e?.payload?.method ?? e?.info?.payload?.method ?? '';
      const msg = `${String(e?.shortMessage ?? e?.message ?? e)}${inner ? ` — ${inner}` : ''}${method ? ` [${method}]` : ''}`;
      if (/insufficient funds|exceeds the balance|balance too low/i.test(msg)) {
        throw new Error(
          `${what}: ${msg}\n    The node checks gasLimit × maxFeePerGas against the balance, not the effective price — top up the deployer.`
        );
      }
      const transient =
        /Internal error|-32603|429|timeout|ETIMEDOUT|ECONNRESET|SERVER_ERROR|coalesce/i.test(
          msg
        );
      if (!transient || i === tries) throw e;
      console.log(
        `    ${what}: transient RPC error (${msg.slice(0, 140)}) — retry ${i}/${tries - 1} in ${5 * i}s`
      );
      await sleep(5000 * i);
    }
  }
  throw last;
}

// Runs `hardhat verify` in a child process so it can target a different
// network than the one this script was started on. Never throws: a failed
// verification is reported and the manual command is printed.
async function verifyOnExplorer(
  chain: string,
  source: string,
  contract: string,
  address: string,
  ctorArgs: string[]
) {
  const net = HH_NETWORK[chain];
  const cmd =
    `npx hardhat verify --network ${net} --contract ${source}:${contract} ${address} ${ctorArgs.join(' ')}`.trim();
  if (!VERIFY) {
    console.log(`    verify manually: ${cmd}`);
    return;
  }
  console.log(`    verifying on ${net} (after ${VERIFY_DELAY_MS / 1000}s)…`);
  await sleep(VERIFY_DELAY_MS);
  const r = spawnSync(
    'npx',
    [
      'hardhat',
      'verify',
      '--network',
      net,
      '--contract',
      `${source}:${contract}`,
      address,
      ...ctorArgs,
    ],
    { encoding: 'utf8', env: process.env }
  );
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  if (r.status === 0 || /already verified|Already Verified/i.test(out)) {
    console.log(`    ✓ verified ${address}`);
  } else {
    const last = out.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
    console.log(`    ✗ verify failed: ${last}`);
    console.log(`      retry: ${cmd}`);
  }
}

function printRunbook(plan: Plan) {
  console.log(`\n  ${plan.chain} ${plan.token} — hand-off`);
  console.log(
    `    1) ProxyAdmin ${plan.proxyAdmin} (owner ${plan.proxyAdminOwner})`
  );
  console.log(`       upgradeAndCall(${plan.proxy}, ${plan.newImpl}, 0x)`);
  console.log(
    `       calldata: ${iface.encodeFunctionData('upgradeAndCall', [plan.proxy, plan.newImpl, '0x'])}`
  );
  if (plan.limiter) {
    console.log(
      `    2) token owner ${plan.tokenOwner} → ${plan.proxy}.setRateLimiter(${plan.limiter})`
    );
    console.log(
      `       calldata: ${iface.encodeFunctionData('setRateLimiter', [plan.limiter])}`
    );
    console.log(
      `       then setRateLimits(${plan.proxy}, ...) on the limiter (owner ${plan.tokenOwner})`
    );
  }
  if (plan.gainsPause)
    console.log(
      `    note: current implementation has no pause(); this one adds it (DEFAULT_ADMIN_ROLE).`
    );
}

function save(plans: Plan[]) {
  let all: any[] = [];
  try {
    all = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {}
  all.push({ at: new Date().toISOString(), broadcast: BROADCAST, plans });
  fs.mkdirSync(resolve(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log(`\nsaved → ${OUT}`);
}

async function runEvm(pk: string) {
  const plans: Plan[] = [];
  for (const chain of CHAINS) {
    if (chain.zksync) {
      if (!ONLY || ONLY.includes(chain.name))
        console.log(
          `\n== zksync: needs zksolc bytecode — run with --network zksync`
        );
      continue;
    }
    if (ONLY && !ONLY.includes(chain.name)) continue;
    console.log(`\n== ${chain.name}`);
    const p = await provider(chain);
    if (!p) {
      console.log(
        `  no reachable RPC — set ${chain.name.toUpperCase()}_RPC_URL`
      );
      continue;
    }
    const signer = new ethers.Wallet(pk, p);
    const bal = await p.getBalance(signer.address);
    console.log(
      `  deployer ${signer.address} balance ${ethers.formatEther(bal)}`
    );

    const chainPlans: Plan[] = [];
    for (const t of chain.targets)
      chainPlans.push(await preflight(p, chain, t));
    for (const plan of chainPlans) {
      console.log(
        `  ${plan.token} ${plan.proxy}: current impl ${plan.currentImpl} → deploy ${plan.contract}(${plan.ctorArgs.join(', ')})`
      );
      console.log(
        `     ProxyAdmin ${plan.proxyAdmin} owner ${plan.proxyAdminOwner} | token owner ${plan.tokenOwner}${plan.gainsPause ? ' | gains pause()' : ''}`
      );
    }

    // One limiter per chain, owned by the token owner (the chain's Safe).
    const limiterOwner = chainPlans[0].tokenOwner;
    if (DEPLOY_LIMITER)
      console.log(`  BridgeRateLimiter(owner ${limiterOwner})`);

    if (!BROADCAST) {
      for (const plan of chainPlans) {
        const art = await hre.artifacts.readArtifact(plan.contract);
        const f = new ethers.ContractFactory(art.abi, art.bytecode, signer);
        const gas = await p.estimateGas({
          from: signer.address,
          data: (await f.getDeployTransaction(...plan.ctorArgs)).data,
        });
        console.log(`     est. gas ${gas} for ${plan.contract}`);
      }
      plans.push(...chainPlans);
      continue;
    }

    let limiter: string | undefined =
      process.env[`LIMITER_${chain.name.toUpperCase()}`];
    if (limiter) {
      // Resume: reuse a limiter deployed by an earlier (interrupted) run.
      limiter = ethers.getAddress(limiter);
      const owner = await new ethers.Contract(limiter, ABI, p).owner();
      if (owner.toLowerCase() !== limiterOwner.toLowerCase())
        throw new Error(
          `LIMITER_${chain.name.toUpperCase()} ${limiter} is owned by ${owner}, expected ${limiterOwner}`
        );
      console.log(`  BridgeRateLimiter (existing) ${limiter}, owner ok`);
    } else if (DEPLOY_LIMITER) {
      const art = await hre.artifacts.readArtifact('BridgeRateLimiter');
      const c = await withRetry('deploy BridgeRateLimiter', async () => {
        const d = await new ethers.ContractFactory(
          art.abi,
          art.bytecode,
          signer
        ).deploy(limiterOwner, await feeOverrides(p));
        await d.waitForDeployment();
        return d;
      });
      limiter = await c.getAddress();
      console.log(
        `  BridgeRateLimiter → ${limiter} (${c.deploymentTransaction()?.hash})`
      );
      await verifyOnExplorer(
        chain.name,
        'contracts/BridgeRateLimiter.sol',
        'BridgeRateLimiter',
        limiter,
        [limiterOwner]
      );
    }
    for (const plan of chainPlans) {
      // Resume: reuse an implementation deployed by an earlier (interrupted) run.
      const existing =
        process.env[
          `IMPL_${chain.name.toUpperCase()}_${plan.token.toUpperCase()}`
        ];
      if (existing) {
        plan.newImpl = ethers.getAddress(existing);
        plan.limiter = limiter;
        console.log(`  ${plan.contract} (existing) ${plan.newImpl}`);
        await checkDeployed(p, plan, signer.address);
        continue;
      }
      const art = await hre.artifacts.readArtifact(plan.contract);
      // Explicit gas limit: estimateGas is exact-fit and nodes simulate the
      // send against the current block, so a 23 KB code deposit can trip
      // "creation code storage out of gas" with the bare estimate. Use the
      // estimate + 25% margin, or DEPLOY_GAS_LIMIT if set.
      const factory = new ethers.ContractFactory(art.abi, art.bytecode, signer);
      const est = await p.estimateGas({
        from: signer.address,
        data: (await factory.getDeployTransaction(...plan.ctorArgs)).data,
      });
      const gasLimit = process.env.DEPLOY_GAS_LIMIT
        ? BigInt(process.env.DEPLOY_GAS_LIMIT)
        : (est * 125n) / 100n;
      const fees = await feeOverrides(p);
      console.log(
        `  ${plan.contract}: gas estimate ${est}, sending with gasLimit ${gasLimit}`
      );
      const c = await withRetry(`deploy ${plan.contract}`, async () => {
        const d = await factory.deploy(...plan.ctorArgs, { gasLimit, ...fees });
        await d.waitForDeployment();
        return d;
      });
      plan.newImpl = await c.getAddress();
      plan.txHash = c.deploymentTransaction()?.hash;
      plan.limiter = limiter;
      console.log(`  ${plan.contract} → ${plan.newImpl} (${plan.txHash})`);
      await checkDeployed(p, plan, signer.address);
      await verifyOnExplorer(
        chain.name,
        plan.source,
        plan.contract,
        plan.newImpl,
        plan.ctorArgs
      );
    }
    for (const plan of chainPlans) printRunbook(plan);
    plans.push(...chainPlans);
    save(chainPlans); // per chain, so an abort later keeps this chain's addresses
  }
}

async function runZksync(pk: string) {
  // zkSync Era: EVM bytecode cannot be deployed; use the zksolc artifacts via
  // the hardhat-zksync Deployer (same pattern as deploy-susn-oft-hyperlane-zksync.ts).
  const { Deployer } = await import('@matterlabs/hardhat-zksync-deploy');
  const { Wallet } = await import('zksync-ethers');
  const chain = CHAINS.find((c) => c.zksync)!;
  const p = await provider(chain);
  if (!p) throw new Error('no reachable zkSync RPC');
  const wallet = new Wallet(pk);
  const deployer = new Deployer(hre as any, wallet);
  console.log(
    `\n== zksync (hardhat network ${hre.network.name})  deployer ${await wallet.getAddress()}`
  );

  const chainPlans: Plan[] = [];
  for (const t of chain.targets) chainPlans.push(await preflight(p, chain, t));
  for (const plan of chainPlans) {
    console.log(
      `  ${plan.token} ${plan.proxy}: current impl ${plan.currentImpl} → deploy ${plan.contract}(${plan.ctorArgs.join(', ')})`
    );
    console.log(
      `     ProxyAdmin ${plan.proxyAdmin} owner ${plan.proxyAdminOwner} | token owner ${plan.tokenOwner}${plan.gainsPause ? ' | gains pause()' : ''}`
    );
  }
  const limiterOwner = chainPlans[0].tokenOwner;
  if (!BROADCAST) {
    console.log(
      `  dry run — set BROADCAST=true to deploy${DEPLOY_LIMITER ? ` (+ BridgeRateLimiter owner ${limiterOwner})` : ''}`
    );
    save(chainPlans);
    return;
  }
  let limiter: string | undefined = process.env.LIMITER_ZKSYNC;
  if (limiter) {
    limiter = ethers.getAddress(limiter);
    console.log(`  BridgeRateLimiter (existing) ${limiter}`);
  } else if (DEPLOY_LIMITER) {
    const c = await deployer.deploy(
      await deployer.loadArtifact('BridgeRateLimiter'),
      [limiterOwner]
    );
    limiter = await c.getAddress();
    console.log(`  BridgeRateLimiter → ${limiter}`);
    await verifyOnExplorer(
      'zksync',
      'contracts/BridgeRateLimiter.sol',
      'BridgeRateLimiter',
      limiter,
      [limiterOwner]
    );
  }
  for (const plan of chainPlans) {
    const c = await deployer.deploy(
      await deployer.loadArtifact(plan.contract),
      plan.ctorArgs
    );
    plan.newImpl = await c.getAddress();
    plan.txHash = c.deploymentTransaction()?.hash;
    plan.limiter = limiter;
    console.log(`  ${plan.contract} → ${plan.newImpl} (${plan.txHash})`);
    await checkDeployed(p, plan, await wallet.getAddress());
    await verifyOnExplorer(
      'zksync',
      plan.source,
      plan.contract,
      plan.newImpl!,
      plan.ctorArgs
    );
  }
  for (const plan of chainPlans) printRunbook(plan);
  save(chainPlans);
}

async function main() {
  const pk = process.env.DEPLOYER_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_WALLET_PRIVATE_KEY not set');
  console.log(
    BROADCAST
      ? '*** BROADCAST=true — implementations WILL be deployed ***'
      : 'Dry run — pre-flight and plan only (BROADCAST=true to deploy)'
  );
  if ((hre.network as any).zksync || hre.network.name === 'zksync')
    await runZksync(pk);
  else await runEvm(pk);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
