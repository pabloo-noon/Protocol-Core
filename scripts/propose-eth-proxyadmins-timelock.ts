/**
 * Ethereum: put the sNOON Vesting and Reward ProxyAdmins behind the existing 48h Upgrade Timelock
 * (0xE5e412C2…5A7F, owner = Ethereum Safe), like USN / sUSN / NOON / sNOON already are.
 *   ProxyAdmin(Vesting 0x9091…0acc).transferOwnership(timelock)   ProxyAdmin(Reward 0x9088…e1Fe).transferOwnership(timelock)
 * OZ ProxyAdmin is single-step Ownable: the transfer is immediate once the Safe executes.
 *   npx hardhat run scripts/propose-eth-proxyadmins-timelock.ts            dry run
 *   PROPOSE=true npx hardhat run scripts/propose-eth-proxyadmins-timelock.ts
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch, Tx } from './lib/safe-propose';
dotenvConfig({ path: resolve(__dirname, '../.env') });
const PROPOSE = process.env.PROPOSE === 'true';
const CHAIN = { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'] };
const SAFE = '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f';
const TIMELOCK = '0xE5e412C212B4FBbF550A94e7BD5e83dB0B315A7F';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const T = [
  { name: 'sNOON Vesting', proxy: '0x56993afd8CdF9409ACf3b3AA96F0C10595a070D2', proxyAdmin: '0x9091847a864d35CeB6907827437E664138b40acc' },
  { name: 'Reward', proxy: '0x22C9e2eD2f016Ae4A0131C251BF3FCe882a92eD5', proxyAdmin: '0x9088e8cC6c4Af8f3032aebde937C1b33E3f0e1Fe' },
];
const PA = new ethers.Interface(['function owner() view returns (address)', 'function transferOwnership(address)']);
const TL = new ethers.Interface(['function owner() view returns (address)', 'function delay() view returns (uint256)']);
async function main() {
  const p = (await provider(CHAIN.rpcs as string[], CHAIN.chainId))!;
  const tl = new ethers.Contract(TIMELOCK, TL, p);
  const [o, d] = await Promise.all([tl.owner(), tl.delay()]);
  console.log(`Upgrade Timelock ${TIMELOCK}: owner ${o === SAFE ? 'Safe ✓' : o + ' ✗'} delay ${Number(d) / 3600}h`);
  if (o !== SAFE || d !== 172800n) throw new Error('timelock not as expected');
  const txs: Tx[] = [];
  for (const t of T) {
    const admin = ethers.getAddress('0x' + (await p.getStorage(t.proxy, ADMIN_SLOT)).slice(-40));
    const paOwner = await new ethers.Contract(t.proxyAdmin, PA, p).owner();
    console.log(`${t.name}: proxy admin slot ${admin} ${admin === t.proxyAdmin ? '✓' : '✗'} | ProxyAdmin.owner ${paOwner === SAFE ? 'Safe' : paOwner === TIMELOCK ? 'timelock (already)' : paOwner}`);
    if (admin !== t.proxyAdmin) throw new Error('admin mismatch');
    if (paOwner === SAFE) txs.push(tx(t.proxyAdmin, PA.encodeFunctionData('transferOwnership', [TIMELOCK])));
    else if (paOwner !== TIMELOCK) throw new Error('unexpected ProxyAdmin owner');
  }
  if (!txs.length) { console.log('nothing to do'); return; }
  for (const [i, t] of txs.entries()) {
    try { await p.call({ to: t.to, data: t.data, from: SAFE }); console.log(`  [${i}] transferOwnership(timelock) @ ${t.to.slice(0, 10)}… simulates from Safe ✓`); } catch (e: any) { throw new Error(`simulation failed: ${(e.shortMessage || e.message).slice(0, 80)}`); }
    let strangerPassed = false;
    try { await p.call({ to: t.to, data: t.data, from: ethers.ZeroAddress }); strangerPassed = true; } catch { console.log('      from stranger: reverts ✓'); }
    if (strangerPassed) throw new Error('stranger can call transferOwnership');
  }
  const f = writeBatch('ethereum', 1, SAFE, 'vesting-reward-proxyadmins-timelock', `Vesting + Reward ProxyAdmins -> 48h Upgrade Timelock ${TIMELOCK}`, txs);
  console.log(`→ ${f}`);
  if (PROPOSE) await proposeToSafe(p, CHAIN, SAFE, txs, 'vesting + reward proxyadmins -> upgrade timelock');
}
main().catch((e) => { console.error(e); process.exit(1); });
