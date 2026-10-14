/**
 * Deploy a SelectiveTimelock in front of USN and wire it:
 *   delay 24h : USN.setAdmin, USN.transferOwnership, USN.renounceOwnership
 *   guardian  : USN.pause, USN.blacklistAccount
 * The deployer is the initial owner so it can wire the map in the same run (a fresh pair has delay 0, so
 * scheduleDelayChange + executeDelayChange apply at once), then hands the timelock to the Safe (Ownable2Step).
 * Nothing changes on USN itself here — the Safe later executes one batch:
 *   [0] timelock.acceptOwnership()
 *   [1] USN.transferOwnership(timelock)
 *   [2] timelock.call(USN, 0, "acceptOwnership()", 0x)
 *
 *   npx hardhat run scripts/deploy-selective-timelock.ts --network mainnet            dry run (prints the plan)
 *   BROADCAST=true npx hardhat run scripts/deploy-selective-timelock.ts --network mainnet
 * Env: SAFE (owner after hand-over), USN (target), GUARDIAN (comma-separated), DELAY (seconds, default 86400).
 * Verify afterwards from a plain shell:
 *   env -u HARDHAT_NETWORK npx hardhat verify --network mainnet <timelock> <deployer>
 */
import { ethers } from 'hardhat';

const BROADCAST = process.env.BROADCAST === 'true';
const SAFE = process.env.SAFE ?? '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f';
const USN = process.env.USN ?? '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD';
const GUARDIANS = (process.env.GUARDIAN ?? SAFE)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DELAY = BigInt(process.env.DELAY ?? 86400);

const USN_ABI = [
  'function owner() view returns (address)',
  'function admin() view returns (address)',
  'function setAdmin(address)',
  'function transferOwnership(address)',
  'function renounceOwnership()',
  'function pause()',
  'function blacklistAccount(address)',
];
const DELAYED = ['setAdmin', 'transferOwnership', 'renounceOwnership'];
const GUARDIAN_FNS = ['pause', 'blacklistAccount'];

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const usn = new ethers.Contract(USN, USN_ABI, ethers.provider);
  const [usnOwner, usnAdmin] = await Promise.all([usn.owner(), usn.admin()]);
  const iface = new ethers.Interface(USN_ABI);
  const sel = (fn: string) => iface.getFunction(fn)!.selector;
  console.log(
    `chain ${net.chainId} deployer ${deployer.address} | USN ${USN} owner ${usnOwner}${usnOwner === SAFE ? ' (Safe ✓)' : ' ✗ expected the Safe'} admin ${usnAdmin}`
  );
  console.log(`plan: SelectiveTimelock(owner=deployer)`);
  for (const fn of DELAYED)
    console.log(
      `  scheduleDelayChange + executeDelayChange(USN, ${fn} ${sel(fn)}, ${DELAY}s = ${Number(DELAY) / 3600}h)`
    );
  for (const fn of GUARDIAN_FNS)
    console.log(`  setGuardianSelector(USN, ${fn} ${sel(fn)}, true)`);
  for (const g of GUARDIANS) console.log(`  setGuardian(${g}, true)`);
  console.log(`  transferOwnership(${SAFE})  -> Safe must acceptOwnership()`);
  if (usnOwner !== SAFE) throw new Error('USN owner is not the Safe');
  if (!BROADCAST) {
    console.log('dry run — set BROADCAST=true to deploy');
    return;
  }

  const TL = await ethers.getContractFactory('SelectiveTimelock', deployer);
  const tl = await TL.deploy(deployer.address);
  await tl.waitForDeployment();
  const addr = await tl.getAddress();
  console.log(
    `SelectiveTimelock deployed ${addr} (tx ${tl.deploymentTransaction()?.hash})`
  );
  for (const fn of DELAYED) {
    await (await tl.scheduleDelayChange(USN, sel(fn), DELAY)).wait();
    await (await tl.executeDelayChange(USN, sel(fn))).wait();
    console.log(`  delay ${fn} = ${await tl.delay(USN, sel(fn))}s ✓`);
  }
  for (const fn of GUARDIAN_FNS) {
    await (await tl.setGuardianSelector(USN, sel(fn), true)).wait();
    console.log(`  guardian selector ${fn} ✓`);
  }
  for (const g of GUARDIANS) {
    await (await tl.setGuardian(g, true)).wait();
    console.log(`  guardian ${g} ✓`);
  }
  await (await tl.transferOwnership(SAFE)).wait();
  console.log(`  ownership offered to ${SAFE} ✓ (pendingOwner)`);
  console.log(
    `\nNext (Safe batch): timelock.acceptOwnership(); USN.transferOwnership(${addr}); timelock.call(USN, 0, "acceptOwnership()", 0x)`
  );
  console.log(
    `Verify: env -u HARDHAT_NETWORK npx hardhat verify --network <net> ${addr} ${deployer.address}`
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
