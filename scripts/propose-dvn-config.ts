/**
 * Bring USN's LayerZero ULN (DVN) configuration in line with sUSN on the
 * ETH <-> zkSync route. Since the KelpDAO incident the LayerZero Labs DVN no
 * longer signs as the sole required DVN, so USN's 1-of-1 legs are dead.
 *
 * For each side (ETH USN ↔ eid 30165, zkSync USN ↔ eid 30101) the script reads
 * sUSN's send-ULN and receive-ULN config bytes from the endpoint and proposes
 *   endpoint.setConfig(USN, sendLib,    [{eid, configType 2, config}])
 *   endpoint.setConfig(USN, receiveLib, [{eid, configType 2, config}])
 * from the OApp delegate (the chain Safe on both chains). Skips anything
 * already equal. Writes scripts/out/safe/<chain>-dvn-config.json; PROPOSE=true
 * queues it via the Safe service.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import {
  provider,
  proposeToSafe,
  tx,
  writeBatch,
  SAFE_SERVICE,
  Tx,
} from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const PROPOSE = process.env.PROPOSE === 'true';
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const CONFIG_TYPE_ULN = 2;

const EP_ABI = [
  'function delegates(address) view returns (address)',
  'function getSendLibrary(address,uint32) view returns (address)',
  'function getReceiveLibrary(address,uint32) view returns (address,bool)',
  'function getConfig(address oapp, address lib, uint32 eid, uint32 configType) view returns (bytes)',
  'function setConfig(address oapp, address lib, (uint32 eid, uint32 configType, bytes config)[] params)',
];
const ULN =
  'tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)';
const epIface = new ethers.Interface(EP_ABI);

const CHAINS = [
  {
    name: 'ethereum',
    chainId: 1,
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'],
    endpoint: '0x1a44076050125825900e736c501f859c50fE728c',
    usn: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD',
    susn: '0xE24a3DC889621612422A64E6388927901608B91D',
    eid: 30165,
  },
  {
    name: 'zksync',
    chainId: 324,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'],
    endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF',
    usn: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6',
    susn: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f',
    eid: 30101,
  },
];

const describe = (b: string) => {
  const u = ethers.AbiCoder.defaultAbiCoder().decode([ULN], b)[0];
  return `${u.requiredDVNCount} required [${u.requiredDVNs.map((a: string) => a.slice(0, 10)).join(', ')}]${Number(u.optionalDVNCount) ? ` + ${u.optionalDVNThreshold}/${u.optionalDVNCount} optional` : ''} conf=${u.confirmations}`;
};

async function main() {
  for (const chain of CHAINS) {
    if (ONLY && !ONLY.includes(chain.name)) continue;
    console.log(`\n== ${chain.name} (USN ↔ eid ${chain.eid})`);
    const p = await provider(chain.rpcs as string[], chain.chainId);
    if (!p) {
      console.log('  no reachable RPC');
      continue;
    }
    const ep = new ethers.Contract(chain.endpoint, EP_ABI, p);
    const delegate: string = await ep.delegates(chain.usn);
    const txs: Tx[] = [];
    for (const [side, getLib] of [
      ['send', async (o: string) => ep.getSendLibrary(o, chain.eid)],
      [
        'receive',
        async (o: string) => (await ep.getReceiveLibrary(o, chain.eid))[0],
      ],
    ] as const) {
      const libU: string = await getLib(chain.usn);
      const libS: string = await getLib(chain.susn);
      const cfgU: string = await ep.getConfig(
        chain.usn,
        libU,
        chain.eid,
        CONFIG_TYPE_ULN
      );
      const cfgS: string = await ep.getConfig(
        chain.susn,
        libS,
        chain.eid,
        CONFIG_TYPE_ULN
      );
      console.log(
        `  ${side.padEnd(7)} lib ${libU.slice(0, 10)}…${libU.toLowerCase() === libS.toLowerCase() ? '' : ` (sUSN uses ${libS.slice(0, 10)}… !)`}\n     USN  now: ${describe(cfgU)}\n     sUSN    : ${describe(cfgS)}`
      );
      if (cfgU.toLowerCase() === cfgS.toLowerCase()) {
        console.log('     already identical ✓');
        continue;
      }
      txs.push(
        tx(
          chain.endpoint,
          epIface.encodeFunctionData('setConfig', [
            chain.usn,
            libU,
            [{ eid: chain.eid, configType: CONFIG_TYPE_ULN, config: cfgS }],
          ])
        )
      );
    }
    if (!txs.length) {
      console.log('  nothing to change');
      continue;
    }
    // Simulate from the delegate: setConfig is delegate-gated on the endpoint.
    for (const t of txs) {
      try {
        await p.call({ to: t.to, data: t.data, from: delegate });
      } catch (e: any) {
        console.log(
          `  ✗ simulation from delegate ${delegate} failed: ${(e.shortMessage || e.message).slice(0, 80)}`
        );
      }
    }
    const f = writeBatch(
      chain.name,
      chain.chainId,
      delegate,
      'dvn-config',
      `USN ULN config = sUSN for eid ${chain.eid}`,
      txs
    );
    console.log(`  → ${f} (${txs.length} tx, delegate/Safe ${delegate})`);
    if (PROPOSE) {
      if (!SAFE_SERVICE[chain.name]) {
        console.log('  no Safe service — import the JSON');
        continue;
      }
      try {
        await proposeToSafe(
          p,
          chain,
          delegate,
          txs,
          `propose-dvn-config ${chain.name}`
        );
      } catch (e: any) {
        console.log(`  ✗ propose failed: ${String(e?.message).slice(0, 200)}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
