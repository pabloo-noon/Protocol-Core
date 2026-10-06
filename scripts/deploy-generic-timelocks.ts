/**
 * Deploy one GenericTimelock (contracts/periphery/GenericTimelock.sol) per chain, owned by the chain
 * Safe, delay 2 days (MIN_DELAY), to be put in front of each BridgeRateLimiter.
 *
 * Ethereum already has one owned by the Safe with a 2-day delay (0x36857EF0…9722, listed in the docs)
 * and is reused. Base / HyperEVM / Citrea / Bera deploy with plain ethers from the hardhat artifact.
 * zkSync must run under `--network zksync` (hardhat-zksync Deployer, zksolc 1.5.15 as for the audited impls).
 *
 *   npx hardhat run scripts/deploy-generic-timelocks.ts                       dry run
 *   BROADCAST=true npx hardhat run scripts/deploy-generic-timelocks.ts        deploy on the EVM chains + verify
 *   BROADCAST=true ZKSOLC_VERSION=1.5.15 npx hardhat run scripts/deploy-generic-timelocks.ts --network zksync
 *
 * Env: CHAINS=base,bera (restrict), TIMELOCK_<CHAIN>=0x… (resume: reuse an already deployed one),
 *      DELAY_SECONDS (default 172800), VERIFY=false, DEPLOYER_WALLET_PRIVATE_KEY.
 * Output: scripts/out/generic-timelocks.json  { chain: { timelock, safe, delay, tx } }
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { provider } from './lib/safe-propose';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require('hardhat');

dotenvConfig({ path: resolve(__dirname, '../.env') });
const BROADCAST = process.env.BROADCAST === 'true';
const VERIFY = process.env.VERIFY !== 'false';
const CONTRACT = process.env.CONTRACT ?? 'GenericTimelock'; // GenericTimelock (fixed 2d/30d bounds) or GenericTimelockV2 (bounds in constructor)
const V2 = CONTRACT === 'GenericTimelockV2';
const DELAY = BigInt(process.env.DELAY_SECONDS ?? (V2 ? 4 * 3600 : 172800));
const MIN = BigInt(process.env.MIN_DELAY_SECONDS ?? 4 * 3600);
const MAX = BigInt(process.env.MAX_DELAY_SECONDS ?? 48 * 3600);
const CTOR = V2 ? [DELAY, MIN, MAX] : [DELAY];
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const OUT = resolve(__dirname, process.env.OUT_FILE ?? (V2 ? 'out/generic-timelocks-4h.json' : 'out/generic-timelocks.json'));

const CHAINS = [
  { name: 'ethereum', chainId: 1, net: 'mainnet', rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'], safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f', existing: '0x36857EF0B10A61A68d58C29eE256990fa9699722' },
  { name: 'base', chainId: 8453, net: 'base', rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'], safe: '0xf56d33ef52642ce226A566610A979DC8d954592D' },
  { name: 'hyperevm', chainId: 999, net: 'hyperevm', rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'], safe: '0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8' },
  { name: 'citrea', chainId: 4114, net: 'citrea', rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'], safe: '0xB2aD758Ee2710527A28d906F9588938c2e5cFc80' },
  { name: 'bera', chainId: 80094, net: 'bera', rpcs: [process.env.BERA_RPC_URL, 'https://rpc.berachain.com'], safe: '0x94E9f383b085D32973634EA7c9bB2038eF9a3C58' },
  { name: 'zksync', chainId: 324, net: 'zksync', rpcs: ['https://mainnet.era.zksync.io'], safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263', zk: true },
];
const ABI = ['function owner() view returns (address)', 'function delay() view returns (uint256)', 'function MIN_DELAY() view returns (uint256)', 'function MAX_DELAY() view returns (uint256)', 'function pendingOwner() view returns (address)'];

const load = () => (fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {});
const save = (o: any) => { fs.mkdirSync(resolve(__dirname, 'out'), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(o, null, 2)); };

async function check(p: ethers.Provider, addr: string, safe: string) {
  const t = new ethers.Contract(addr, ABI, p);
  const [owner, delay, pend, mn, mx] = await Promise.all([t.owner(), t.delay(), t.pendingOwner(), t.MIN_DELAY(), t.MAX_DELAY()]);
  const ok = owner.toLowerCase() === safe.toLowerCase() && delay === DELAY && pend === ethers.ZeroAddress && (!V2 || (mn === MIN && mx === MAX));
  console.log(`  ${addr} owner ${owner} delay ${Number(delay) / 3600}h min ${Number(mn) / 3600}h max ${Number(mx) / 3600}h pendingOwner ${pend} ${ok ? '✓' : '✗ (expected owner = Safe, delay ' + Number(DELAY) / 3600 + 'h' + (V2 ? ', bounds ' + Number(MIN) / 3600 + 'h/' + Number(MAX) / 3600 + 'h' : '') + ')'}`);
  return ok;
}

function verify(net: string, addr: string, safe: string) {
  const args = ['hardhat', 'verify', '--network', net, '--contract', `contracts/periphery/${CONTRACT}.sol:${CONTRACT}`, addr, safe, ...CTOR.map(String)];
  console.log(`  verifying: npx ${args.join(' ')}`);
  const r = spawnSync('npx', args, { encoding: 'utf8', timeout: 300_000 });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(out.trim().split('\n').filter((l) => /verif|already|Success|error|Error/i.test(l)).slice(-3).map((l) => '    ' + l).join('\n'));
}

async function main() {
  const hreNet = hre.network?.name ?? process.env.HARDHAT_NETWORK;
  const out = load();
  const pk = process.env.DEPLOYER_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_WALLET_PRIVATE_KEY not set');
  const art = JSON.parse(fs.readFileSync(resolve(__dirname, `../artifacts/contracts/periphery/${CONTRACT}.sol/${CONTRACT}.json`), 'utf8'));
  console.log(`${CONTRACT}(owner = chain Safe, delay ${Number(DELAY) / 3600}h${V2 ? `, min ${Number(MIN) / 3600}h, max ${Number(MAX) / 3600}h` : ''}) — ${BROADCAST ? 'BROADCAST' : 'dry run'}`);

  for (const c of CHAINS) {
    if (ONLY && !ONLY.includes(c.name)) continue;
    if (c.zk && hreNet !== 'zksync') { console.log(`\n== ${c.name}: run with --network zksync (hardhat-zksync Deployer)`); continue; }
    if (!c.zk && hreNet === 'zksync') continue;
    console.log(`\n== ${c.name} (Safe ${c.safe})`);
    const p = await provider(c.rpcs as string[], c.chainId);
    if (!p) { console.log('  no RPC'); continue; }
    const existing = process.env[`TIMELOCK_${c.name.toUpperCase()}`] ?? (V2 ? undefined : c.existing) ?? out[c.name]?.timelock;
    if (existing) {
      console.log(`  existing timelock ${existing}`);
      if (await check(p, existing, c.safe)) { out[c.name] = { ...(out[c.name] ?? {}), timelock: existing, contract: CONTRACT, safe: c.safe, delay: Number(DELAY) }; save(out); }
      continue;
    }
    const wallet = new ethers.Wallet(pk, p);
    const bal = await p.getBalance(wallet.address);
    console.log(`  deployer ${wallet.address} balance ${ethers.formatEther(bal)}`);
    if (!BROADCAST) { console.log(`  would deploy ${CONTRACT}(${[c.safe, ...CTOR].join(', ')})`); continue; }

    let addr: string, txHash: string;
    if (c.zk) {
      const zv = (process.env.ZKSOLC_VERSION || '1.5.7').split('.').map(Number);
      if (zv[0] < 1 || (zv[0] === 1 && (zv[1] < 5 || (zv[1] === 5 && zv[2] < 15)))) throw new Error('set ZKSOLC_VERSION=1.5.15 — builds below 1.5.15 cannot be verified on the zkSync explorer');
      const { Deployer } = await import('@matterlabs/hardhat-zksync-deploy');
      const { Wallet } = await import('zksync-ethers');
      const deployer = new Deployer(hre as any, new Wallet(pk));
      const zart = await deployer.loadArtifact(CONTRACT);
      const contract = await deployer.deploy(zart, [c.safe, ...CTOR.map(String)]);
      addr = await contract.getAddress(); txHash = contract.deploymentTransaction()?.hash ?? '';
    } else {
      const f = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
      const est = await f.getDeployTransaction(c.safe, ...CTOR).then((tx) => p.estimateGas({ ...tx, from: wallet.address }));
      const contract = await f.deploy(c.safe, ...CTOR, { gasLimit: (est * 125n) / 100n });
      await contract.waitForDeployment();
      addr = await contract.getAddress(); txHash = contract.deploymentTransaction()?.hash ?? '';
    }
    console.log(`  deployed ${addr} (tx ${txHash})`);
    const ok = await check(p, addr, c.safe);
    out[c.name] = { timelock: addr, contract: CONTRACT, safe: c.safe, delay: Number(DELAY), ...(V2 ? { minDelay: Number(MIN), maxDelay: Number(MAX) } : {}), tx: txHash };
    save(out);
    if (!ok) throw new Error('post-deploy check failed');
    if (VERIFY && !c.zk) { await new Promise((r) => setTimeout(r, 30_000)); verify(c.net, addr, c.safe); console.log('  (if the spawned verify fails with "doesn\'t recognize chain", re-run it from a plain shell: env -u HARDHAT_NETWORK npx hardhat verify --network ' + c.net + ' ...)'); }
    if (VERIFY && c.zk) console.log('  zkSync: verify by POSTing the standard JSON to https://zksync2-mainnet-explorer.zksync.io/contract_verification (compilerZksolcVersion v1.5.15, compilerSolcVersion zkVM-0.8.28-1.0.1), as done for the audited impls — the hardhat plugin sends sourceCode as a string and is rejected.');
  }
  console.log(`\n→ ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
