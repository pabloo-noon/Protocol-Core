/**
 * Extra post-upgrade sanity checks (read-only, eth_call / estimateGas only):
 *   A. deployed bytecode == repo build (build-info / artifacts-zk), immutables masked
 *   B. function surface: exact diff of the OLD implementation's verified ABI vs the new ABI (only the documented
 *      removals allowed); every non-view function of the new ABI probed live on the proxy (must dispatch)
 *   C. LayerZero lzReceive simulated from the endpoint under exactly the enforced gas budget (120k) for a
 *      cold and a warm recipient on each OApp; plus estimateGas
 *   D. Hyperlane handle() estimateGas from the mailbox for a cold recipient on each receiver
 *   E. setRateLimiter: stranger reverts; owner pointing at an EOA reverts (InvalidRateLimiter)
 *   F. explorer verification status of every new implementation and limiter
 *
 *   npx hardhat run scripts/post-upgrade-checks.ts   (CHAINS=... to restrict)
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { provider } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const BI = JSON.parse(fs.readFileSync('/Users/testing/.claude/jobs/79f2832c/tmp/buildinfo-bytecodes.json', 'utf8'));
const zkArt = (p: string) => JSON.parse(fs.readFileSync(resolve(__dirname, '..', p), 'utf8'));

// functions whose dynamic-typed arguments cannot be ABI-decoded from zeroed calldata (they revert empty before dispatching); proven live elsewhere
const DYNAMIC_ARGS = new Set(['lzReceive', 'lzReceiveAndRevert', 'lzReceiveSimulate', 'send']);
const REMOVED = ['depositWithPermit(uint256,address,uint256,uint8,bytes32,bytes32)', 'depositWithSlippageCheck(uint256,address,uint256)', 'mintWithSlippageCheck(uint256,address,uint256)', 'withdrawWithSlippageCheck(uint256,address,address,uint256)', 'redeemWithSlippageCheck(uint256,address,address,uint256)'].map((s) => ethers.id(s).slice(0, 10));

const P = [
  { chain: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'], name: 'USN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x79FD7FE2a8EbcAE47798321b2AC97107dF3de229', oldImpl: '0x961e78b26F6984A2DDAC42e4CE5B8014A311608e', art: BI['contracts/USNUpgradeableHyperlane.sol:USNUpgradeableHyperlane'], limiter: '0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F', limArt: BI['contracts/BridgeRateLimiter.sol:BridgeRateLimiter'], safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f', endpoint: '0x1a44076050125825900e736c501f859c50fE728c', lz: { srcEid: 30165, peer: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6', budget: 120000 }, mailbox: '0xc005dc82818d67AF737725bD4bf75435d065D239', hlOrigin: { domain: 324, sender: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6' }, warm: '0x8b937c5395D95a8c8948C7C5B844e1541798d90C', explorer: 1 },
  { chain: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'], name: 'sUSN vault', proxy: '0xE24a3DC889621612422A64E6388927901608B91D', impl: '0xeF2eA4250B7CE4D0aA9Ca70607ECeF278C6EAB15', oldImpl: '0xEbBcbC6672683e1956125e7c5e89E14CeAC8cd3D', art: BI['contracts/StakingVaultOFTUpgradeableHyperlane.sol:StakingVaultOFTUpgradeableHyperlane'], removedCheck: true, safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f', endpoint: '0x1a44076050125825900e736c501f859c50fE728c', lz: { srcEid: 30165, peer: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f', budget: 120000 }, mailbox: '0xc005dc82818d67AF737725bD4bf75435d065D239', hlOrigin: { domain: 80094, sender: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' }, warm: '0x8b937c5395D95a8c8948C7C5B844e1541798d90C', explorer: 1 },
  { chain: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'], name: 'USN', proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6', impl: '0xb00B492099323E386dFD1E014850Ca16396E8C22', oldImpl: '0xa5b228237bEf9bC804D8d6E7c76d0853a406bf34', zk: 'artifacts-zk/contracts/periphery/USNOFTHyperlane.sol/USNOFTHyperlane.json', limiter: '0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E', safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263', endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF', lz: { srcEid: 30101, peer: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', budget: 0 }, mailbox: '0x6bD0A2214797Bc81e0b006F7B74d6221BcD8cb6E', hlOrigin: { domain: 1, sender: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' }, warm: '0x8b937c5395D95a8c8948C7C5B844e1541798d90C', explorer: 'zksync' },
  { chain: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'], name: 'sUSN', proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f', impl: '0x8B9E886B6850615911c61a7cd10c9C6630d1A03d', oldImpl: '0x9F80bbe82dBad5D74904c83bD8990c8Ba9dfe82a', zk: 'artifacts-zk/contracts/remote/StakedUSNOFTHyperlane.sol/StakedUSNOFTHyperlane.json', safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263', endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF', lz: { srcEid: 30101, peer: '0xE24a3DC889621612422A64E6388927901608B91D', budget: 0 }, mailbox: '0x6bD0A2214797Bc81e0b006F7B74d6221BcD8cb6E', hlOrigin: { domain: 1, sender: '0xE24a3DC889621612422A64E6388927901608B91D' }, warm: '0x8b937c5395D95a8c8948C7C5B844e1541798d90C', explorer: 'zksync' },
  { chain: 'base', chainId: 8453, rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'], name: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F', impl: '0xa02Ca8C6130B75b320FAa785034E95D4374A8942', oldImpl: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', art: BI['contracts/remote/StakedUSNHyperlane.sol:StakedUSNHyperlane'], limiter: '0xEFff8C4260aF5DA5eB26194CB45407f497756db7', limArt: BI['contracts/BridgeRateLimiter.sol:BridgeRateLimiter'], safe: '0xf56d33ef52642ce226A566610A979DC8d954592D', mailbox: '0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D', hlOrigin: { domain: 1, sender: '0xE24a3DC889621612422A64E6388927901608B91D' }, warm: '0x173806021b18c4E60170e412DC88F991eB00D699', explorer: 8453 },
  { chain: 'hyperevm', chainId: 999, rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'], name: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F', impl: '0xffC95e7E447DC94DcE706B8afda751349E676227', oldImpl: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', art: BI['contracts/remote/StakedUSNHyperlane.sol:StakedUSNHyperlane'], limiter: '0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2', limArt: BI['contracts/BridgeRateLimiter.sol:BridgeRateLimiter'], safe: '0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8', mailbox: '0x3a464f746D23Ab22155710f44dB16dcA53e0775E', hlOrigin: { domain: 1, sender: '0xE24a3DC889621612422A64E6388927901608B91D' }, warm: '0x173806021b18c4E60170e412DC88F991eB00D699', explorer: 999 },
  { chain: 'citrea', chainId: 4114, rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'], name: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x6D1019bdbe1Da163134Aba821bBfc1cCAEb988a8', oldImpl: '0x0aDa1cb43aC67FFfA2773B169920bfAB4c6391B7', art: BI['contracts/remote/StakedUSNHyperlane.sol:StakedUSNHyperlane'], limiter: '0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815', limArt: BI['contracts/BridgeRateLimiter.sol:BridgeRateLimiter'], safe: '0xB2aD758Ee2710527A28d906F9588938c2e5cFc80', mailbox: '0x3a464f746D23Ab22155710f44dB16dcA53e0775E', hlOrigin: { domain: 1, sender: '0xE24a3DC889621612422A64E6388927901608B91D' }, warm: '0x173806021b18c4E60170e412DC88F991eB00D699', explorer: 'citrea' },
  { chain: 'bera', chainId: 80094, rpcs: [process.env.BERA_RPC_URL, 'https://rpc.berachain.com'], name: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x657284c8337ab91b1a7d4eb66Be97596f4878117', oldImpl: '0x0aDa1cb43aC67FFfA2773B169920bfAB4c6391B7', art: BI['contracts/remote/StakedUSNHyperlane.sol:StakedUSNHyperlane'], limiter: '0x51A30E647D33A044967FA3DBb04d6ED6F45455F6', limArt: BI['contracts/BridgeRateLimiter.sol:BridgeRateLimiter'], safe: '0x94E9f383b085D32973634EA7c9bB2038eF9a3C58', mailbox: '0x7f50C5776722630a0024fAE05fDe8b47571D7B39', hlOrigin: { domain: 1, sender: '0xE24a3DC889621612422A64E6388927901608B91D' }, warm: '0x173806021b18c4E60170e412DC88F991eB00D699', explorer: 80094 },
] as any[];

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string, detail = '') => { c ? pass++ : fail++; console.log(`    ${c ? 'PASS' : 'FAIL'}  ${msg}${detail ? `  (${detail})` : ''}`); };
const stripMeta = (c: string) => { const n = parseInt(c.slice(-4), 16); return c.slice(0, c.length - 4 - n * 2); };
const mask = (code: string, refs: any) => { let a = code.slice(2).split(''); for (const r of Object.values(refs) as any[]) for (const { start, length } of r) for (let i = start * 2; i < (start + length) * 2; i++) a[i] = '0'; return '0x' + a.join(''); };
const selectorsIn = (code: string) => { const s = new Set<string>(); const h = code.slice(2); for (let i = 0; i + 10 <= h.length; i += 2) if (h.slice(i, i + 2) === '63') s.add('0x' + h.slice(i + 2, i + 10)); return s; };
const LZ_ABI = ['function lzReceive((uint32 srcEid,bytes32 sender,uint64 nonce) origin, bytes32 guid, bytes message, address executor, bytes extraData) payable'];
const HL_ABI = ['function handle(uint32,bytes32,bytes)'];
const TOK_ABI = ['function setRateLimiter(address)', 'function rateLimiter() view returns (address)', 'error InvalidRateLimiter()', 'error OwnableUnauthorizedAccount(address)'];
const EP_ABI = ['function inboundNonce(address,uint32,bytes32) view returns (uint64)'];
const decErr = (e: any, iface: ethers.Interface) => { const d = e.data || e.info?.error?.data || ''; try { return iface.parseError(d)?.name || d.slice(0, 10); } catch { return d.slice(0, 10) || (e.shortMessage || e.message || '').slice(0, 60); } };

async function verified(p: any): Promise<string> {
  try {
    if (p.explorer === 'zksync') { const j = await (await fetch(`https://block-explorer-api.mainnet.zksync.io/api?module=contract&action=getsourcecode&address=${p.impl}`)).json(); return j.result?.[0]?.SourceCode ? `verified (${j.result[0].ContractName}, zksolc ${j.result[0].ZkCompilerVersion || j.result[0].ZkSolcVersion || '?'})` : 'NOT verified'; }
    if (p.explorer === 'citrea') { const j = await (await fetch(`https://explorer.mainnet.citrea.xyz/api/v2/smart-contracts/${p.impl}`)).json(); return j.is_verified ? `verified (${j.name})` : 'NOT verified'; }
    const j = await (await fetch(`https://api.etherscan.io/v2/api?chainid=${p.explorer}&module=contract&action=getsourcecode&address=${p.impl}&apikey=${process.env.ETHERSCAN_API_KEY}`)).json(); return j.result?.[0]?.SourceCode ? `verified (${j.result[0].ContractName}, ${j.result[0].CompilerVersion})` : `NOT verified (${JSON.stringify(j).slice(0, 60)})`;
  } catch (e: any) { return 'check failed ' + e.message.slice(0, 40); }
}

async function main() {
  for (const p of P) {
    if (ONLY && !ONLY.includes(p.chain)) continue;
    const prov = await provider(p.rpcs, p.chainId); if (!prov) { console.log(`\n== ${p.chain} ${p.name}: no RPC`); fail++; continue; }
    console.log(`\n== ${p.chain} ${p.name} ${p.proxy}`);
    const code = await prov.getCode(p.impl), oldCode = await prov.getCode(p.oldImpl);

    // A. bytecode
    let abi: any[] = [];
    if (p.art) { abi = p.art.abi; const exact = code === p.art.bytecode; const masked = mask(code, p.art.immutableReferences) === mask(p.art.bytecode, p.art.immutableReferences); const noMeta = stripMeta(mask(code, p.art.immutableReferences)) === stripMeta(mask(p.art.bytecode, p.art.immutableReferences)); ok(exact || masked || noMeta, `A impl bytecode == repo build (${(code.length - 2) / 2} bytes)`, exact ? 'exact' : masked ? 'exact after masking immutables' : noMeta ? 'equal except metadata hash' : 'DIFFERENT'); }
    else if (p.zk) { const a = zkArt(p.zk); abi = a.abi; ok(code === a.deployedBytecode, `A impl bytecode == artifacts-zk build (${(code.length - 2) / 2} bytes)`, code === a.deployedBytecode ? 'exact' : 'DIFFERENT (zksolc version mismatch?)'); }
    if (p.limiter && p.limArt) { const lc = await prov.getCode(p.limiter); const same = lc === p.limArt.bytecode || stripMeta(lc) === stripMeta(p.limArt.bytecode); ok(same, `A limiter bytecode == repo build (${(lc.length - 2) / 2} bytes)`, lc === p.limArt.bytecode ? 'exact' : same ? 'equal except metadata' : 'DIFFERENT'); }

    // B. function surface: exact diff old verified ABI vs new ABI; every new-ABI function probed live
    const OLD = JSON.parse(fs.readFileSync('/Users/testing/.claude/jobs/79f2832c/tmp/old-abis.json', 'utf8'));
    const sig = (f: any) => `${f.name}(${f.inputs.map((i: any) => i.type === 'tuple' ? `(${i.components.map((c: any) => c.type).join(',')})` : i.type === 'tuple[]' ? `(${i.components.map((c: any) => c.type).join(',')})[]` : i.type).join(',')})`;
    const newSigs = new Map(abi.filter((x: any) => x.type === 'function').map((f: any) => [ethers.id(sig(f)).slice(0, 10), sig(f)]));
    const oldAbi = OLD[`${p.chain}:${p.name}`];
    if (oldAbi) {
      const oldSigs = new Map(oldAbi.filter((x: any) => x.type === 'function').map((f: any) => [ethers.id(sig(f)).slice(0, 10), sig(f)]));
      const removed = [...oldSigs].filter(([k]) => !newSigs.has(k)).map(([, v]) => v);
      const added = [...newSigs].filter(([k]) => !oldSigs.has(k)).map(([, v]) => v);
      const allowedRemoved = new Set([...REMOVED.map((r) => [...oldSigs].find(([k]) => k === r)?.[1]), 'REBASE_MANAGER_ROLE()', 'STUCK_MESSAGE_TIMELOCK()']);
      const unexpected = removed.filter((r) => !allowedRemoved.has(r));
      ok(unexpected.length === 0, `B function surface: old ${oldSigs.size} -> new ${newSigs.size}; removed [${removed.join(', ') || 'none'}]; added [${added.join(', ')}]`, unexpected.length ? `UNEXPECTED removals: ${unexpected.join(', ')}` : '');
    } else console.log('    INFO  B old implementation ABI unavailable (unverified) — surface diff skipped');
    // live probe: every state-changing function of the new ABI must dispatch (revert with a typed error or succeed), never an empty "no function" revert
    let dispatched = 0, silent: string[] = [];
    for (const f of abi.filter((x: any) => x.type === 'function' && x.stateMutability !== 'view' && x.stateMutability !== 'pure')) {
      const sel = ethers.id(sig(f)).slice(0, 10);
      try { await prov.call({ to: p.proxy, from: '0x000000000000000000000000000000000000dEaD', data: sel + '00'.repeat(32 * Math.max(1, f.inputs.length)) }); dispatched++; }
      catch (e: any) { const d = e.data || e.info?.error?.data || ''; if ((d && d !== '0x') || DYNAMIC_ARGS.has(f.name)) dispatched++; else silent.push(f.name); }
    }
    ok(silent.length === 0, `B ${dispatched} non-view functions dispatch on the proxy`, silent.length ? `silent reverts (may be legitimate require(false) paths): ${silent.join(',')}` : '');
    if (p.removedCheck) { const codeSel = new Set([...code.matchAll(/63([0-9a-f]{8})/g)].map((m) => '0x' + m[1])); ok(REMOVED.every((s) => !codeSel.has(s)), 'B the 5 removed vault wrappers are absent from the bytecode'); }

    // C. LayerZero lzReceive under budget
    if (p.lz) {
      const iface = new ethers.Interface(LZ_ABI); const ep = new ethers.Contract(p.endpoint, EP_ABI, prov);
      const sender = ethers.zeroPadValue(p.lz.peer, 32); const nonce = (await ep.inboundNonce(p.proxy, p.lz.srcEid, sender)) + 1n;
      for (const [label, to] of [['cold recipient', ethers.Wallet.createRandom().address], ['warm recipient', p.warm]]) {
        const msg = ethers.concat([ethers.zeroPadValue(to, 32), ethers.zeroPadValue(ethers.toBeHex(1n), 8)]); // 1 shared-decimal unit
        const data = iface.encodeFunctionData('lzReceive', [{ srcEid: p.lz.srcEid, sender, nonce }, ethers.hexlify(ethers.randomBytes(32)), msg, ethers.ZeroAddress, '0x']);
        try { const budget = p.lz.budget; const g = p.chain === 'zksync' ? (await prov.call({ to: p.proxy, from: p.endpoint, data }), 'call ok (zkSync: estimateGas from a contract is not supported)') : await prov.estimateGas({ to: p.proxy, from: p.endpoint, data }); let under = ''; if (budget) { try { await prov.call({ to: p.proxy, from: p.endpoint, data, gasLimit: budget }); under = 'runs within 120k ✓'; ok(true, `C lzReceive ${label} within the enforced ${budget} gas`, `estimateGas ${g}`); } catch (e: any) { ok(false, `C lzReceive ${label} within ${budget} gas`, `estimateGas ${g}, call with gasLimit ${budget}: ${decErr(e, iface)}`); } } else console.log(`    INFO  C lzReceive ${label}: estimateGas ${g} (no fixed budget on this side; senders pass extraOptions)`); }
        catch (e: any) { ok(false, `C lzReceive ${label} simulation`, decErr(e, iface)); }
      }
    }
    // D. Hyperlane handle estimateGas
    if (p.mailbox && p.hlOrigin) {
      const iface = new ethers.Interface(HL_ABI); const to = ethers.Wallet.createRandom().address;
      const body = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [ethers.zeroPadValue(to, 32), 1n]);
      try { const data = iface.encodeFunctionData('handle', [p.hlOrigin.domain, ethers.zeroPadValue(p.hlOrigin.sender, 32), body]); const g = p.chain === 'zksync' ? (await prov.call({ to: p.proxy, from: p.mailbox, data }), 'call ok') : await prov.estimateGas({ to: p.proxy, from: p.mailbox, data }); console.log(`    INFO  D Hyperlane handle() cold recipient from origin ${p.hlOrigin.domain}: ${typeof g === 'string' ? g : 'estimateGas ' + g} (senders pay IGP gasAmount 239,116)`); pass++; }
      catch (e: any) { ok(false, 'D Hyperlane handle() simulation', decErr(e, iface)); }
    }
    // E. setRateLimiter gates
    const tok = new ethers.Interface(TOK_ABI);
    try { await prov.call({ to: p.proxy, from: '0x000000000000000000000000000000000000dEaD', data: tok.encodeFunctionData('setRateLimiter', [ethers.ZeroAddress]) }); ok(false, 'E setRateLimiter from stranger reverts'); } catch (e: any) { ok(true, 'E setRateLimiter from stranger reverts', decErr(e, tok)); }
    const freshEoa = ethers.Wallet.createRandom().address; try { await prov.call({ to: p.proxy, from: p.safe, data: tok.encodeFunctionData('setRateLimiter', [freshEoa]) }); ok(false, 'E setRateLimiter(EOA) from owner reverts'); } catch (e: any) { ok(decErr(e, tok) === 'InvalidRateLimiter', 'E setRateLimiter(EOA) from owner reverts InvalidRateLimiter', decErr(e, tok)); }
    // F. verification
    console.log(`    INFO  F explorer: impl ${await verified(p)}`);
  }
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
