/**
 * Community Fund Safe (owner of sNOON): sNOON.setMerkleRoot(root, totalAmount).
 *   ROOT=0x… TOTAL=1 PROPOSE=true npx hardhat run scripts/propose-snoon-merkleroot.ts
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch } from './lib/safe-propose';
dotenvConfig({ path: resolve(__dirname, '../.env') });
const CHAIN = { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'] };
const SAFE = '0x364a77729fc3eDdf7fC430C9F4913e055b0F68b9'; // Community Fund Safe = sNOON owner
const SNOON = '0x5f9ee665830BE17b2073a9800Eb7bbbe51b471D7';
const ROOT = process.env.ROOT ?? '0xac3dd3da73500724d522b68b0358e0f3c6575e6030c0fa6780f607150ef2859d';
const TOTAL = BigInt(process.env.TOTAL ?? 1);
const I = new ethers.Interface(['function setMerkleRoot(bytes32,uint256)', 'function merkleRoot() view returns (bytes32)', 'function totalClaimableAmount() view returns (uint256)', 'function owner() view returns (address)']);
async function main() {
  const p = (await provider(CHAIN.rpcs as string[], CHAIN.chainId))!;
  const c = new ethers.Contract(SNOON, I, p);
  console.log(`sNOON owner ${await c.owner()} (${(await c.owner()) === SAFE ? 'Community Fund Safe ✓' : '✗'}) | merkleRoot now ${await c.merkleRoot()} totalClaimable ${ethers.formatEther(await c.totalClaimableAmount())}`);
  const data = I.encodeFunctionData('setMerkleRoot', [ROOT, TOTAL]);
  await p.call({ to: SNOON, from: SAFE, data });
  console.log(`setMerkleRoot(${ROOT}, ${TOTAL} wei) simulates from the Safe ✓`);
  const txs = [tx(SNOON, data)];
  writeBatch('communityfund', 1, SAFE, 'snoon-setmerkleroot', `sNOON.setMerkleRoot(${ROOT}, ${TOTAL})`, txs);
  if (process.env.PROPOSE === 'true') await proposeToSafe(p, CHAIN, SAFE, txs, 'sNOON setMerkleRoot');
}
main().catch((e) => { console.error(e); process.exit(1); });
