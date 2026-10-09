/**
 * Ethereum: cancel the stale sUSN vault upgrade scheduled on the 48h Upgrade Timelock on 2026-06-10
 * (proxy 0xE24a…B91D -> impl 0xb9E5…a6E7, a pre-audit implementation). Its delay elapsed months ago, so the Safe
 * could execute it at any moment with no further delay. cancelUpgrade(proxyAdmin, proxy, implementation, data) is onlyOwner (Safe).
 *   PROPOSE=true npx hardhat run scripts/propose-cancel-stale-upgrade.ts
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';
import { provider, proposeToSafe, tx, writeBatch } from './lib/safe-propose';
dotenvConfig({ path: resolve(__dirname, '../.env') });
const CHAIN = { name: 'ethereum', chainId: 1, rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'] };
const SAFE = '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f';
const TL = '0xE5e412C212B4FBbF550A94e7BD5e83dB0B315A7F';
const OP = { pa: '0x1908284b50EE152C9f00c8E65a81fc1C4520BD81', proxy: '0xE24a3DC889621612422A64E6388927901608B91D', impl: '0xb9E5B8d826939580db142faBA61FcdEA9AAca6E7', data: '0x' };
const I = new ethers.Interface(['function cancelUpgrade(address,address,address,bytes)', 'function scheduledAt(bytes32) view returns (uint256)', 'function getOperationId(address,address,address,bytes) view returns (bytes32)']);
async function main() {
  const p = (await provider(CHAIN.rpcs as string[], CHAIN.chainId))!;
  const tl = new ethers.Contract(TL, I, p);
  const op = await tl.getOperationId(OP.pa, OP.proxy, OP.impl, OP.data);
  const at = await tl.scheduledAt(op);
  console.log(`op ${op} scheduledAt ${at} (${at ? new Date(Number(at) * 1000).toISOString() : 'not scheduled'})`);
  if (at === 0n) { console.log('already cancelled/executed — nothing to do'); return; }
  const data = I.encodeFunctionData('cancelUpgrade', [OP.pa, OP.proxy, OP.impl, OP.data]);
  await p.call({ to: TL, from: SAFE, data });
  console.log('cancelUpgrade simulates from Safe ✓');
  const txs = [tx(TL, data)];
  const f = writeBatch('ethereum', 1, SAFE, 'cancel-stale-susn-upgrade', `cancelUpgrade: stale 2026-06-10 sUSN upgrade to ${OP.impl} (op ${op})`, txs);
  console.log(`→ ${f}`);
  if (process.env.PROPOSE === 'true') await proposeToSafe(p, CHAIN, SAFE, txs, 'cancel stale sUSN upgrade (2026-06-10)');
}
main().catch((e) => { console.error(e); process.exit(1); });
