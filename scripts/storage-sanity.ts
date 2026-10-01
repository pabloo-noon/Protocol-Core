/**
 * Raw storage-slot sanity check for every upgraded proxy.
 *
 * For each proxy it reads the raw storage of every known slot at the block just before the upgrade
 * tx and at the latest block, decodes it, and classifies each difference as EXPECTED (the batches were
 * meant to write it) or UNEXPECTED. It also checks that each decoded value matches the live getter now.
 * Slots covered: EIP-1967 implementation/admin, every sequential variable of the implementation
 * (layouts from solc on the repo sources), known mapping entries (remoteTokens per domain), and the
 * ERC-7201 namespaced storage of OpenZeppelin (ERC20, Ownable, Ownable2Step, AccessControl, Initializable,
 * Pausable, ERC4626, ReentrancyGuard) and LayerZero (OAppCore peers, OptionsType3 enforcedOptions,
 * OFTCore msgInspector, PreCrime).
 *
 *   npx hardhat run scripts/storage-sanity.ts            (CHAINS=ethereum,zksync to restrict)
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());

const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const NS = {
  ERC20: '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00',
  Ownable: '0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300',
  Ownable2Step: '0x237e158222e3e6968b72b9db0d8043aacf074ad9f650f0d1606b4d82ee432c00',
  AccessControl: '0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800',
  Initializable: '0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00',
  Pausable: '0xcd5ed15c6e187e77e9aee88184c21f4f2182ab5827cb3b7e07fbedcd63f03300',
  ERC4626: '0x0773e532dfede91f04b12a73d3d2acd361424f41f76b4fb79f090161e36b4e00',
  ReentrancyGuard: '0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00',
  OAppCore: '0x72ab1bc1039b79dc4724ffca13de82c96834302d3c7e0d4252232d4b2dd8f900',
  OptionsType3: '0x8d2bda5d9f6ffb5796910376005392955773acee5548d0fcdb10e7c264ea0000',
  OFTCore: '0x41db8a78b0206aba5c54bcbfc2bda0d84082a84eb88e680379a57b9e9f653c00',
  PreCrime: '0xefb041d771d6daaa55702fff6eb740d63ba559a75d2d1d3e151c78ff2480b600',
};
const DEAD = '0x000000000000000000000000000000000000000000000000000000000000dead';
const DEPLOYER = '0x173806021b18c4E60170e412DC88F991eB00D699';
const DOMAINS = [1, 324, 8453, 999, 4114, 80094, 239, 50104, 358974494];
const EIDS = [30101, 30165, 30378];

type Seq = { slot: number; offset: number; size: number; label: string; kind: 'address' | 'bool' | 'mapping' | 'gap' };
const SEQ = {
  usnEth: [
    { slot: 0, offset: 0, size: 20, label: 'admin', kind: 'address' }, { slot: 0, offset: 20, size: 1, label: 'permissionless', kind: 'bool' },
    { slot: 1, offset: 0, size: 32, label: 'blacklist', kind: 'mapping' }, { slot: 2, offset: 0, size: 32, label: 'whitelistedAddresses', kind: 'mapping' },
    { slot: 3, offset: 0, size: 20, label: 'mailbox', kind: 'address' }, { slot: 4, offset: 0, size: 20, label: '_interchainSecurityModule', kind: 'address' },
    { slot: 5, offset: 0, size: 32, label: 'remoteTokens', kind: 'mapping' }, { slot: 6, offset: 0, size: 1, label: 'hyperlaneEnabled', kind: 'bool' }, { slot: 6, offset: 1, size: 20, label: 'rateLimiter', kind: 'address' },
  ] as Seq[],
  vault: [
    { slot: 0, offset: 0, size: 1600, label: '__gap[50]', kind: 'gap' },
    { slot: 50, offset: 0, size: 20, label: 'mailbox', kind: 'address' }, { slot: 51, offset: 0, size: 20, label: '_interchainSecurityModule', kind: 'address' },
    { slot: 52, offset: 0, size: 32, label: 'remoteTokens', kind: 'mapping' }, { slot: 53, offset: 0, size: 1, label: 'hyperlaneEnabled', kind: 'bool' }, { slot: 53, offset: 1, size: 20, label: 'rateLimiter', kind: 'address' },
  ] as Seq[],
  staked: [
    { slot: 0, offset: 0, size: 32, label: 'blacklist', kind: 'mapping' }, { slot: 1, offset: 0, size: 20, label: 'mailbox', kind: 'address' },
    { slot: 2, offset: 0, size: 20, label: '_interchainSecurityModule', kind: 'address' }, { slot: 3, offset: 0, size: 32, label: 'remoteTokens', kind: 'mapping' },
    { slot: 4, offset: 0, size: 1, label: 'hyperlaneEnabled', kind: 'bool' }, { slot: 4, offset: 1, size: 20, label: 'rateLimiter', kind: 'address' },
  ] as Seq[],
};

const PROXIES = [
  { chain: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'], name: 'USN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x79FD7FE2a8EbcAE47798321b2AC97107dF3de229', upgradeTx: '0xbbfd32feab45ce510cbc789d156e286ce67e956e0deb5da8680dfb5938bc305d', seq: SEQ.usnEth, limiter: '0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F', lz: true, dead: true, ns: ['ERC20', 'Ownable', 'Ownable2Step', 'Initializable', 'Pausable', 'OAppCore', 'OptionsType3', 'OFTCore', 'PreCrime'], safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f' },
  { chain: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'], name: 'sUSN vault', proxy: '0xE24a3DC889621612422A64E6388927901608B91D', impl: '0xeF2eA4250B7CE4D0aA9Ca70607ECeF278C6EAB15', upgradeTx: '0xbbfd32feab45ce510cbc789d156e286ce67e956e0deb5da8680dfb5938bc305d', seq: SEQ.vault, limiter: '0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F', lz: true, dead: true, ns: ['ERC20', 'ERC4626', 'AccessControl', 'Initializable', 'Pausable', 'ReentrancyGuard', 'OAppCore', 'OptionsType3', 'OFTCore', 'PreCrime'], safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f' },
  { chain: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'], name: 'USN', proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6', impl: '0xb00B492099323E386dFD1E014850Ca16396E8C22', upgradeTx: '0x9ce950f66d596811903c5c67877e403d5815d27fd096cc2895e97069f8143246', seq: SEQ.staked, limiter: '0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E', lz: true, dead: true, enforcedChange: true, ns: ['ERC20', 'Ownable', 'AccessControl', 'Initializable', 'OAppCore', 'OptionsType3', 'OFTCore', 'PreCrime'], safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263' },
  { chain: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'], name: 'sUSN', proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f', impl: '0x8B9E886B6850615911c61a7cd10c9C6630d1A03d', upgradeTx: '0x9ce950f66d596811903c5c67877e403d5815d27fd096cc2895e97069f8143246', seq: SEQ.staked, limiter: '0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E', lz: true, dead: true, enforcedChange: true, ns: ['ERC20', 'Ownable', 'AccessControl', 'Initializable', 'Pausable', 'OAppCore', 'OptionsType3', 'OFTCore', 'PreCrime'], safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263' },
  { chain: 'base', chainId: 8453, rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'], name: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F', impl: '0xa02Ca8C6130B75b320FAa785034E95D4374A8942', upgradeTx: '0x5a78b821c27f75291c2557b99b95beabe9c570a76c28cd0910893d84c90e480a', seq: SEQ.staked, limiter: '0xEFff8C4260aF5DA5eB26194CB45407f497756db7', lz: false, dead: true, ns: ['ERC20', 'Ownable', 'Ownable2Step', 'AccessControl', 'Initializable', 'Pausable'], safe: '0xf56d33ef52642ce226A566610A979DC8d954592D' },
  { chain: 'hyperevm', chainId: 999, rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'], name: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F', impl: '0xffC95e7E447DC94DcE706B8afda751349E676227', upgradeTx: '0xb74fafce9c8a1318acd5763deb94b36fa82477a5ce9d79232ada41b7b75bd867', seq: SEQ.staked, limiter: '0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2', lz: false, dead: true, ns: ['ERC20', 'Ownable', 'Ownable2Step', 'AccessControl', 'Initializable', 'Pausable'], safe: '0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8' },
  { chain: 'citrea', chainId: 4114, rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'], name: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x6D1019bdbe1Da163134Aba821bBfc1cCAEb988a8', upgradeTx: '0x42a7865f526fb65d84c799a3cb205612f564f0f88182f91368a67b593019a40a', seq: SEQ.staked, limiter: '0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815', lz: false, dead: false, ns: ['ERC20', 'Ownable', 'Ownable2Step', 'AccessControl', 'Initializable', 'Pausable'], safe: '0xB2aD758Ee2710527A28d906F9588938c2e5cFc80' },
  { chain: 'bera', chainId: 80094, rpcs: [process.env.BERA_RPC_URL, 'https://rpc.berachain.com'], name: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x657284c8337ab91b1a7d4eb66Be97596f4878117', upgradeTx: '0xd4c7c62a1d195ceac55be6e7679da7719c7c73dd0a4c3a2d8a3bba20ac97ea1b', seq: SEQ.staked, limiter: '0x51A30E647D33A044967FA3DBb04d6ED6F45455F6', lz: false, dead: false, ns: ['ERC20', 'Ownable', 'Ownable2Step', 'AccessControl', 'Initializable', 'Pausable'], safe: '0x94E9f383b085D32973634EA7c9bB2038eF9a3C58' },
];

const GETTERS = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function totalSupply() view returns (uint256)', 'function owner() view returns (address)', 'function pendingOwner() view returns (address)', 'function paused() view returns (bool)', 'function asset() view returns (address)', 'function mailbox() view returns (address)', 'function interchainSecurityModule() view returns (address)', 'function hyperlaneEnabled() view returns (bool)', 'function rateLimiter() view returns (address)', 'function remoteTokens(uint32) view returns (bytes32)', 'function peers(uint32) view returns (bytes32)', 'function enforcedOptions(uint32,uint16) view returns (bytes)', 'function hasRole(bytes32,address) view returns (bool)', 'function msgInspector() view returns (address)', 'function preCrime() view returns (address)', 'function admin() view returns (address)', 'function permissionless() view returns (bool)'];

const hex = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const mapSlot = (key: string, slot: string) => ethers.keccak256(ethers.concat([ethers.zeroPadValue(key, 32), slot]));
const add = (slot: string, i: number) => hex(BigInt(slot) + BigInt(i));
const addr = (w: string) => ethers.getAddress('0x' + w.slice(-40));
const addrAt = (w: string, offset: number) => ethers.getAddress('0x' + w.slice(2 + (32 - offset - 20) * 2, 2 + (32 - offset) * 2));
const byteAt = (w: string, offset: number) => parseInt(w.slice(2 + (31 - offset) * 2, 2 + (32 - offset) * 2), 16);
const shortStr = (w: string) => { const len = parseInt(w.slice(-2), 16); return len % 2 === 0 ? Buffer.from(w.slice(2, 2 + len), 'hex').toString() : '(long string)'; };

let pass = 0, fail = 0, expectedDiffs = 0, unexpectedDiffs = 0;
const ok = (c: boolean, msg: string) => { c ? pass++ : fail++; if (!c) console.log(`    ✗ ${msg}`); };

async function main() {
  for (const P of PROXIES) {
    if (ONLY && !ONLY.includes(P.chain)) continue;
    const p = await provider(P.rpcs as string[], P.chainId);
    if (!p) { console.log(`\n== ${P.chain} ${P.name}: no RPC`); fail++; continue; }
    const rc = await p.getTransactionReceipt(P.upgradeTx);
    const before = rc!.blockNumber - 1, latest = await p.getBlockNumber();
    const c = new ethers.Contract(P.proxy, GETTERS, p);
    console.log(`\n== ${P.chain} ${P.name} ${P.proxy}  (before = block ${before}, now = ${latest})`);

    // Build the slot list: [label, slot, decode, expectedChange?]
    type Entry = { label: string; slot: string; dec: (w: string) => string; expect?: string; getter?: () => Promise<string> };
    const E: Entry[] = [
      { label: 'eip1967.implementation', slot: IMPL_SLOT, dec: addr, expect: 'new impl', getter: async () => P.impl },
      { label: 'eip1967.admin', slot: ADMIN_SLOT, dec: addr },
    ];
    const seqSlots = new Map<number, Seq[]>();
    for (const v of P.seq) { if (v.kind === 'gap') continue; if (!seqSlots.has(v.slot)) seqSlots.set(v.slot, []); seqSlots.get(v.slot)!.push(v); }
    for (const [slot, vars] of seqSlots) {
      const label = vars.map((v) => v.label).join('+');
      const dec = (w: string) => vars.map((v) => v.kind === 'address' ? addrAt(w, v.offset) : v.kind === 'bool' ? String(byteAt(w, v.offset) !== 0) : 'mapping').join(' | ');
      const hasRL = vars.some((v) => v.label === 'rateLimiter');
      E.push({ label: `seq[${slot}] ${label}`, slot: hex(BigInt(slot)), dec, expect: hasRL ? 'rateLimiter set' : undefined });
      const rt = vars.find((v) => v.label === 'remoteTokens');
      if (rt) for (const d of DOMAINS) E.push({ label: `remoteTokens(${d})`, slot: mapSlot(hex(BigInt(d)), hex(BigInt(slot))), dec: (w) => w === ethers.ZeroHash ? '0' : w.toLowerCase() === DEAD ? 'dEaD' : addr(w), expect: P.dead && [239, 50104].includes(d) ? 'dEaD' : undefined, getter: async () => { const v: string = await c.remoteTokens(d); return v === ethers.ZeroHash ? '0' : v.toLowerCase() === DEAD ? 'dEaD' : addr(v); } });
    }
    if (P.ns.includes('ERC20')) E.push({ label: 'ERC20._totalSupply', slot: add(NS.ERC20, 2), dec: (w) => ethers.formatEther(BigInt(w)), expect: 'may drift with traffic', getter: async () => ethers.formatEther(await c.totalSupply()) }, { label: 'ERC20._name', slot: add(NS.ERC20, 3), dec: shortStr, getter: () => c.name() }, { label: 'ERC20._symbol', slot: add(NS.ERC20, 4), dec: shortStr, getter: () => c.symbol() });
    if (P.ns.includes('Ownable')) E.push({ label: 'Ownable._owner', slot: NS.Ownable, dec: addr, getter: () => c.owner() });
    if (P.ns.includes('Ownable2Step')) E.push({ label: 'Ownable2Step._pendingOwner', slot: NS.Ownable2Step, dec: addr, getter: () => c.pendingOwner() });
    if (P.ns.includes('AccessControl')) { const roleData = mapSlot(ethers.ZeroHash, NS.AccessControl); E.push({ label: 'AccessControl DEFAULT_ADMIN.hasRole[Safe]', slot: mapSlot(P.safe, roleData), dec: (w) => String(BigInt(w) !== 0n), getter: async () => String(await c.hasRole(ethers.ZeroHash, P.safe)) }, { label: 'AccessControl DEFAULT_ADMIN.hasRole[deployer]', slot: mapSlot(DEPLOYER, roleData), dec: (w) => String(BigInt(w) !== 0n), getter: async () => String(await c.hasRole(ethers.ZeroHash, DEPLOYER)) }); }
    if (P.ns.includes('Initializable')) E.push({ label: 'Initializable._initialized/_initializing', slot: NS.Initializable, dec: (w) => `${BigInt('0x' + w.slice(-16))} / ${byteAt(w, 8) !== 0}` });
    if (P.ns.includes('Pausable')) E.push({ label: 'Pausable._paused', slot: NS.Pausable, dec: (w) => String(byteAt(w, 0) !== 0), getter: async () => String(await c.paused()) });
    if (P.ns.includes('ERC4626')) E.push({ label: 'ERC4626._asset+_underlyingDecimals', slot: NS.ERC4626, dec: (w) => `${addrAt(w, 0)} / ${byteAt(w, 20)}`, getter: async () => `${await c.asset()} / 18` });
    if (P.ns.includes('ReentrancyGuard')) E.push({ label: 'ReentrancyGuard._status', slot: NS.ReentrancyGuard, dec: (w) => String(BigInt(w)) });
    if (P.ns.includes('OAppCore')) for (const eid of EIDS) E.push({ label: `OAppCore.peers(${eid})`, slot: mapSlot(hex(BigInt(eid)), NS.OAppCore), dec: (w) => w === ethers.ZeroHash ? '0' : w, getter: async () => { const v: string = await c.peers(eid); return v === ethers.ZeroHash ? '0' : v; } });
    if (P.ns.includes('OptionsType3')) for (const eid of EIDS) E.push({ label: `OptionsType3.enforcedOptions(${eid},1)`, slot: mapSlot(hex(1n), mapSlot(hex(BigInt(eid)), NS.OptionsType3)), dec: (w) => { const len = parseInt(w.slice(-2), 16); return len === 0 ? 'empty' : len % 2 === 0 ? '0x' + w.slice(2, 2 + len) : '(long)'; }, expect: P.enforcedChange && eid === 30101 ? '65k -> 120k' : undefined, getter: async () => { const v: string = await c.enforcedOptions(eid, 1); return v === '0x' ? 'empty' : v; } });
    if (P.ns.includes('OFTCore')) E.push({ label: 'OFTCore.msgInspector', slot: NS.OFTCore, dec: addr, getter: () => c.msgInspector().catch(() => 'n/a') });
    if (P.ns.includes('PreCrime')) E.push({ label: 'PreCrime.preCrime', slot: NS.PreCrime, dec: addr, getter: () => c.preCrime().catch(() => 'n/a') });

    // Detect non-archive RPCs: the implementation slot MUST differ before/after the upgrade tx (Upgraded event);
    // if a historical read returns the current value, the node is serving latest state for past blocks.
    let histOk = true;
    try { const implBefore = await p.getStorage(P.proxy, IMPL_SLOT, before); if (implBefore === (await p.getStorage(P.proxy, IMPL_SLOT))) histOk = false; } catch { histOk = false; }
    if (!histOk) console.log('    (RPC is not an archive node: historical reads return current state — before/after diff skipped, getters + invariants still checked)');
    for (const e of E) {
      const now = await p.getStorage(P.proxy, e.slot);
      let prev: string | null = null;
      if (histOk) { try { prev = await p.getStorage(P.proxy, e.slot, before); } catch { histOk = false; } }
      const dn = e.dec(now), dp = prev === null ? null : e.dec(prev);
      const changed = prev !== null && prev !== now;
      let flag = '';
      if (changed) { if (e.expect) { expectedDiffs++; flag = `  CHANGED (expected: ${e.expect}) ${dp} -> ${dn}`; } else { unexpectedDiffs++; flag = `  ✗ UNEXPECTED CHANGE ${dp} -> ${dn}`; } }
      else if (e.expect && e.expect !== 'may drift with traffic' && prev !== null) {
        // an expected change that did not happen: only the dead-route ones can legitimately be absent before (0 -> dEaD still a change) — flag it
        flag = `  ✗ expected change did not happen (${e.expect})`; unexpectedDiffs++;
      }
      let g = '';
      if (e.getter) { const gv = String(await e.getter()); const same = gv.toLowerCase() === dn.toLowerCase(); ok(same, `${e.label}: raw ${dn} != getter ${gv}`); g = same ? ' = getter ✓' : ` ≠ getter(${gv})`; }
      console.log(`    ${e.label.padEnd(44)} ${dn}${g}${flag}`);
    }
    // extra invariants
    const initWord = await p.getStorage(P.proxy, NS.Initializable); ok(BigInt('0x' + initWord.slice(-16)) >= 1n && BigInt('0x' + initWord.slice(-16)) < 255n, 'proxy _initialized should be >=1 and not disabled');
    const implInit = await p.getStorage(P.impl, NS.Initializable); ok(BigInt('0x' + implInit.slice(-16)) === 2n ** 64n - 1n, 'implementation _initialized should be uint64.max (disabled)');
    ok(addr(await p.getStorage(P.proxy, IMPL_SLOT)).toLowerCase() === P.impl.toLowerCase(), 'implementation slot == audited impl');
    const rl = P.seq.find((v) => v.label === 'rateLimiter')!; ok(addrAt(await p.getStorage(P.proxy, hex(BigInt(rl.slot))), rl.offset).toLowerCase() === P.limiter.toLowerCase(), 'rateLimiter slot == chain limiter');
  }
  console.log(`\n${pass} getter/invariant checks PASS, ${fail} FAIL | ${expectedDiffs} expected slot changes, ${unexpectedDiffs} unexpected`);
  process.exit(fail || unexpectedDiffs ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
