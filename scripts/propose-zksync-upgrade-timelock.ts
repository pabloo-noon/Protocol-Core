/**
 * zkSync: put the 48h upgrade Timelock (contracts/periphery/Timelock.sol) in front of both ProxyAdmins, and bundle
 * the two zkSync hygiene items from the audit, in ONE zkSync Safe batch:
 *
 *   1. ProxyAdmin(USN).transferOwnership(timelock)      (OZ v5 ProxyAdmin: single-step, immediate)
 *   2. ProxyAdmin(sUSN).transferOwnership(timelock)
 *   3. USN.grantRole(BLACKLIST_MANAGER_ROLE, Safe)      (held by nobody today)
 *   4. sUSN.grantRole(BLACKLIST_MANAGER_ROLE, Safe)
 *   5-8. endpoint.setSendLibrary / setReceiveLibrary(oapp, 30101, ULN302, 0) for USN and sUSN   (pin the default libs)
 *
 * After 1-2 every zkSync proxy upgrade is Safe -> timelock.scheduleUpgrade -> 48h -> Safe -> timelock.executeUpgrade,
 * exactly like Ethereum / Base / Citrea / Bera (HyperEVM 24h).
 *
 *   npx hardhat run scripts/propose-zksync-upgrade-timelock.ts               dry run + JSON
 *   PROPOSE=true npx hardhat run scripts/propose-zksync-upgrade-timelock.ts  queue in the zkSync Safe
 * Env: TIMELOCK (else scripts/out/zksync-upgrade-timelock.json), SKIP_LIBS=true, SKIP_ROLES=true.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch, Tx } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });
const PROPOSE = process.env.PROPOSE === 'true';
const CHAIN = { name: 'zksync', chainId: 324, rpcs: ['https://mainnet.era.zksync.io'] };
const SAFE = '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263';
const ENDPOINT = '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF';
const EID_ETH = 30101;
const T = [
  { name: 'USN', proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6', proxyAdmin: '0x5a82384A042cCe41f9aC6F0C110773E5B3266F11' },
  { name: 'sUSN', proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f', proxyAdmin: '0x5130C9cd9e85B4a95F9b44c7Eb8667106e8fdecc' },
];
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const PA = new ethers.Interface(['function owner() view returns (address)', 'function transferOwnership(address)']);
const TL = new ethers.Interface(['function owner() view returns (address)', 'function delay() view returns (uint256)', 'function pendingOwner() view returns (address)']);
const TOK = new ethers.Interface(['function hasRole(bytes32,address) view returns (bool)', 'function grantRole(bytes32,address)']);
const EP = new ethers.Interface(['function getSendLibrary(address,uint32) view returns (address)', 'function getReceiveLibrary(address,uint32) view returns (address,bool)', 'function isDefaultSendLibrary(address,uint32) view returns (bool)', 'function delegates(address) view returns (address)', 'function setSendLibrary(address,uint32,address)', 'function setReceiveLibrary(address,uint32,address,uint256)']);
const BLACKLIST = ethers.id('BLACKLIST_MANAGER_ROLE');

async function main() {
  const file = resolve(__dirname, 'out/zksync-upgrade-timelock.json');
  const timelock = process.env.TIMELOCK ?? (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).zksync?.timelock : undefined);
  if (!timelock) throw new Error('no timelock address (TIMELOCK env or scripts/out/zksync-upgrade-timelock.json)');
  const p = (await provider(CHAIN.rpcs, CHAIN.chainId))!;
  const tl = new ethers.Contract(timelock, TL, p);
  const [tlOwner, delay, pend] = await Promise.all([tl.owner(), tl.delay(), tl.pendingOwner()]);
  console.log(`timelock ${timelock}: owner ${tlOwner === SAFE ? 'Safe ✓' : tlOwner + ' ✗'} delay ${Number(delay) / 3600}h pendingOwner ${pend}`);
  if (tlOwner !== SAFE || delay !== 172800n) throw new Error('timelock not as expected (owner Safe, delay 48h)');
  const ep = new ethers.Contract(ENDPOINT, EP, p);
  const txs: Tx[] = [];
  for (const t of T) {
    const admin = ethers.getAddress('0x' + (await p.getStorage(t.proxy, ADMIN_SLOT)).slice(-40));
    const paOwner = await new ethers.Contract(t.proxyAdmin, PA, p).owner();
    console.log(`${t.name}: proxy admin slot ${admin} ${admin === t.proxyAdmin ? '✓' : '✗ expected ' + t.proxyAdmin}; ProxyAdmin.owner ${paOwner === SAFE ? 'Safe ✓' : paOwner}`);
    if (admin !== t.proxyAdmin) throw new Error('proxy admin mismatch');
    if (paOwner === timelock) console.log('  already owned by the timelock — skipping transfer');
    else if (paOwner === SAFE) txs.push(tx(t.proxyAdmin, PA.encodeFunctionData('transferOwnership', [timelock])));
    else throw new Error('ProxyAdmin owned by an unexpected address');
  }
  if (process.env.SKIP_ROLES !== 'true') for (const t of T) {
    const has = await new ethers.Contract(t.proxy, TOK, p).hasRole(BLACKLIST, SAFE);
    console.log(`${t.name}: Safe has BLACKLIST_MANAGER_ROLE ${has}`);
    if (!has) txs.push(tx(t.proxy, TOK.encodeFunctionData('grantRole', [BLACKLIST, SAFE])));
  }
  if (process.env.SKIP_LIBS !== 'true') for (const t of T) {
    const delegate = await ep.delegates(t.proxy);
    const sl = await ep.getSendLibrary(t.proxy, EID_ETH); const [rl, rDef] = await ep.getReceiveLibrary(t.proxy, EID_ETH); const sDef = await ep.isDefaultSendLibrary(t.proxy, EID_ETH);
    console.log(`${t.name}: delegate ${delegate === SAFE ? 'Safe ✓' : delegate} | sendLib ${sl} (default ${sDef}) recvLib ${rl} (default ${rDef})`);
    if (delegate !== SAFE) throw new Error('delegate is not the Safe');
    if (sDef) txs.push(tx(ENDPOINT, EP.encodeFunctionData('setSendLibrary', [t.proxy, EID_ETH, sl])));
    if (rDef) txs.push(tx(ENDPOINT, EP.encodeFunctionData('setReceiveLibrary', [t.proxy, EID_ETH, rl, 0])));
  }
  if (!txs.length) { console.log('nothing to do'); return; }
  console.log(`\n${txs.length} calls:`);
  let problems = 0;
  for (const [i, t] of txs.entries()) {
    const name = [PA, TOK, EP].map((I) => { try { return I.parseTransaction({ data: t.data })?.name; } catch { return null; } }).find(Boolean);
    try { await p.call({ to: t.to, data: t.data, from: SAFE }); console.log(`  [${i}] ${name} @ ${t.to.slice(0, 10)}… simulates from Safe ✓`); }
    catch (e: any) { problems++; console.log(`  [${i}] ${name} @ ${t.to.slice(0, 10)}… REVERTS: ${(e.shortMessage || e.message).slice(0, 80)}`); }
  }
  if (problems) process.exit(1);
  const f = writeBatch('zksync', CHAIN.chainId, SAFE, 'upgrade-timelock', `48h Timelock ${timelock} in front of both ProxyAdmins + blacklist role + pin ULN302 libs`, txs);
  console.log(`→ ${f}`);
  if (PROPOSE) await proposeToSafe(p, CHAIN, SAFE, txs, 'zksync upgrade timelock + hygiene');
}
main().catch((e) => { console.error(e); process.exit(1); });
