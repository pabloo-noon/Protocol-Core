/**
 * Post-rollout verification: one read-only pass over every chain that prints
 * PASS / FAIL per check, so the state after the Safe txs execute can be
 * confirmed in one run (and re-run any time). No transactions are sent.
 *
 *   npx hardhat run scripts/verify-rollout.ts
 *   CHAINS=ethereum,zksync npx hardhat run scripts/verify-rollout.ts
 *
 * Checks per chain / token:
 *   impl      proxy implementation == audited implementation (addresses.md)
 *   limiter   token.rateLimiter() == BridgeRateLimiter, limiter.owner() == Safe
 *   paused    paused() == false (skipped where the contract has no pause)
 *   limits    every live route (LZ peers + Hyperlane remote tokens) in+out at LIMIT/WINDOW,
 *             TAC 239 + Sophon 50104 at 1 wei, their remote token == 0x…dEaD
 *   lz        enforced lzReceive gas toward ETH >= 120k (zkSync), DVNs: USN == sUSN per eid,
 *             no inbound nonce gap on any ETH<->zkSync channel
 *   roles     Safe holds DEFAULT_ADMIN + BLACKLIST_MANAGER on the sUSN receivers,
 *             deployer EOA holds neither
 *   sophon    Sophon USN/sUSN peers to ETH and zkSync == 0
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import { resolve } from 'path';
import { provider } from './lib/safe-propose';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const LIMIT = ethers.parseEther(process.env.LIMIT ?? '4000000');
const WINDOW = BigInt(process.env.WINDOW ?? '28800');
const DEAD = ethers.zeroPadValue('0x000000000000000000000000000000000000dEaD', 32);
const DEPLOYER = '0x173806021b18c4E60170e412DC88F991eB00D699';
const CLOSED_HL = [239, 50104];
const LZ_EIDS = [30101, 30165, 30378];
const HL_DOMAINS = [1, 324, 8453, 999, 4114, 80094, 239, 50104, 358974494];

type Token = {
  name: string;
  proxy: string;
  impl: string;
  lz?: boolean;
  hl?: boolean;
  pausable: boolean;
  roles?: boolean;
};
const CHAINS: {
  name: string;
  chainId: number;
  rpcs: (string | undefined)[];
  safe: string;
  limiter: string;
  endpoint?: string;
  tokens: Token[];
}[] = [
  {
    name: 'ethereum',
    chainId: 1,
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'],
    safe: '0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f',
    limiter: '0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F',
    endpoint: '0x1a44076050125825900e736c501f859c50fE728c',
    tokens: [
      { name: 'USN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x79FD7FE2a8EbcAE47798321b2AC97107dF3de229', lz: true, hl: true, pausable: true },
      { name: 'sUSN', proxy: '0xE24a3DC889621612422A64E6388927901608B91D', impl: '0xeF2eA4250B7CE4D0aA9Ca70607ECeF278C6EAB15', lz: true, hl: true, pausable: true },
    ],
  },
  {
    name: 'zksync',
    chainId: 324,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'],
    safe: '0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263',
    limiter: '0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E',
    endpoint: '0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF',
    tokens: [
      { name: 'USN', proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6', impl: '0xb00B492099323E386dFD1E014850Ca16396E8C22', lz: true, hl: true, pausable: false },
      { name: 'sUSN', proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f', impl: '0x8B9E886B6850615911c61a7cd10c9C6630d1A03d', lz: true, hl: true, pausable: true },
    ],
  },
  {
    name: 'base',
    chainId: 8453,
    rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'],
    safe: '0xf56d33ef52642ce226A566610A979DC8d954592D',
    limiter: '0xEFff8C4260aF5DA5eB26194CB45407f497756db7',
    tokens: [{ name: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F', impl: '0xa02Ca8C6130B75b320FAa785034E95D4374A8942', hl: true, pausable: true, roles: true }],
  },
  {
    name: 'hyperevm',
    chainId: 999,
    rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'],
    safe: '0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8',
    limiter: '0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2',
    tokens: [{ name: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F', impl: '0xffC95e7E447DC94DcE706B8afda751349E676227', hl: true, pausable: true, roles: true }],
  },
  {
    name: 'citrea',
    chainId: 4114,
    rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'],
    safe: '0xB2aD758Ee2710527A28d906F9588938c2e5cFc80',
    limiter: '0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815',
    tokens: [{ name: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x6D1019bdbe1Da163134Aba821bBfc1cCAEb988a8', hl: true, pausable: true, roles: true }],
  },
  {
    name: 'bera',
    chainId: 80094,
    rpcs: [process.env.BERA_RPC_URL, 'https://rpc.berachain.com'],
    safe: '0x94E9f383b085D32973634EA7c9bB2038eF9a3C58',
    limiter: '0x51A30E647D33A044967FA3DBb04d6ED6F45455F6',
    tokens: [{ name: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD', impl: '0x657284c8337ab91b1a7d4eb66Be97596f4878117', hl: true, pausable: true, roles: true }],
  },
];

const TOKEN_ABI = [
  'function rateLimiter() view returns (address)',
  'function paused() view returns (bool)',
  'function peers(uint32) view returns (bytes32)',
  'function remoteTokens(uint32) view returns (bytes32)',
  'function enforcedOptions(uint32,uint16) view returns (bytes)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function owner() view returns (address)',
];
const LIMITER_ABI = [
  'function owner() view returns (address)',
  'function getRateLimit(address,uint8,uint32,bool) view returns (uint256 limit,uint256 window,uint256 available)',
];
const EP_ABI = [
  'function getSendLibrary(address,uint32) view returns (address)',
  'function getReceiveLibrary(address,uint32) view returns (address,bool)',
  'function getConfig(address,address,uint32,uint32) view returns (bytes)',
  'function inboundNonce(address,uint32,bytes32) view returns (uint64)',
  'function outboundNonce(address,uint32,bytes32) view returns (uint64)',
  'function delegates(address) view returns (address)',
];
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

let pass = 0,
  fail = 0;
const check = (ok: boolean, what: string, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
};

async function main() {
  const byName = Object.fromEntries(CHAINS.map((c) => [c.name, c]));
  for (const chain of CHAINS) {
    if (ONLY && !ONLY.includes(chain.name)) continue;
    console.log(`\n== ${chain.name}`);
    const p = await provider(chain.rpcs as string[], chain.chainId);
    if (!p) {
      check(false, 'rpc reachable');
      continue;
    }
    const limiter = new ethers.Contract(chain.limiter, LIMITER_ABI, p);
    check((await limiter.owner()).toLowerCase() === chain.safe.toLowerCase(), 'limiter owner == Safe');

    for (const t of chain.tokens) {
      const c = new ethers.Contract(t.proxy, TOKEN_ABI, p);
      const impl = '0x' + (await p.getStorage(t.proxy, IMPL_SLOT)).slice(-40);
      check(impl.toLowerCase() === t.impl.toLowerCase(), `${t.name} impl == audited`, impl);
      let rl = '';
      try {
        rl = await c.rateLimiter();
      } catch {}
      check(rl.toLowerCase() === chain.limiter.toLowerCase(), `${t.name} rateLimiter() wired`, rl || 'n/a');
      if (t.pausable) {
        try {
          check((await c.paused()) === false, `${t.name} not paused`);
        } catch {
          check(false, `${t.name} paused() unreadable (old impl?)`);
        }
      }
      if (t.roles) {
        for (const [n, r] of [
          ['DEFAULT_ADMIN', ethers.ZeroHash],
          ['BLACKLIST_MANAGER', ethers.id('BLACKLIST_MANAGER_ROLE')],
        ] as const) {
          check(await c.hasRole(r, chain.safe), `${t.name} Safe has ${n}`);
          check(!(await c.hasRole(r, DEPLOYER)), `${t.name} deployer has no ${n}`);
        }
      }

      // Routes + limits
      const routes: { transport: number; id: number; closed: boolean }[] = [];
      if (t.lz)
        for (const eid of LZ_EIDS) {
          const peer = await c.peers(eid).catch(() => ethers.ZeroHash);
          if (peer !== ethers.ZeroHash) routes.push({ transport: 0, id: eid, closed: false });
        }
      if (t.hl)
        for (const d of HL_DOMAINS) {
          const rt = await c.remoteTokens(d).catch(() => ethers.ZeroHash);
          if (rt === ethers.ZeroHash) continue;
          const closed = CLOSED_HL.includes(d);
          if (closed) check(rt === DEAD, `${t.name} HL ${d} remote token == dEaD`, rt);
          routes.push({ transport: 1, id: d, closed });
        }
      for (const r of routes)
        for (const out of [false, true]) {
          const [lim, win] = await limiter.getRateLimit(t.proxy, r.transport, r.id, out);
          const label = `${t.name} ${r.transport === 0 ? 'LZ' : 'HL'} ${r.id} ${out ? 'out' : 'in'}`;
          if (r.closed) check(lim === 1n, `${label} closed (1 wei)`, `${lim}/${win}`);
          else check(lim === LIMIT && win === WINDOW, `${label} ${ethers.formatEther(LIMIT)}/${WINDOW}s`, `${ethers.formatEther(lim)}/${win}`);
        }

      // LayerZero specifics
      if (t.lz && chain.endpoint) {
        const ep = new ethers.Contract(chain.endpoint, EP_ABI, p);
        check((await ep.delegates(t.proxy)).toLowerCase() === chain.safe.toLowerCase(), `${t.name} LZ delegate == Safe`);
        if (chain.name === 'zksync') {
          const eo: string = await c.enforcedOptions(30101, 1);
          const gas = eo.length >= 46 ? BigInt('0x' + eo.slice(14, 46)) : 0n;
          check(gas >= 120000n, `${t.name} enforced lzReceive gas toward ETH >= 120k`, gas.toString());
        }
        const other = chain.name === 'ethereum' ? byName.zksync : byName.ethereum;
        const otherEid = chain.name === 'ethereum' ? 30165 : 30101;
        const peerTok = other.tokens.find((x) => x.name === t.name)!;
        const sender = ethers.zeroPadValue(peerTok.proxy, 32);
        const po = await provider(other.rpcs as string[], other.chainId);
        if (po) {
          const epo = new ethers.Contract(other.endpoint!, EP_ABI, po);
          const inb = await ep.inboundNonce(t.proxy, otherEid, sender);
          const outb = await epo.outboundNonce(peerTok.proxy, chain.name === 'ethereum' ? 30101 : 30165, ethers.zeroPadValue(t.proxy, 32));
          check(inb === outb, `${t.name} inbound from ${other.name} in sync`, `in ${inb} / sent ${outb}`);
        }
      }
    }
    // USN DVN config == sUSN (ETH + zkSync)
    if (chain.endpoint && chain.tokens.length === 2) {
      const ep = new ethers.Contract(chain.endpoint, EP_ABI, p);
      const eid = chain.name === 'ethereum' ? 30165 : 30101;
      const [usn, susn] = chain.tokens.map((x) => x.proxy);
      for (const side of ['send', 'recv'] as const) {
        const libU = side === 'send' ? await ep.getSendLibrary(usn, eid) : (await ep.getReceiveLibrary(usn, eid))[0];
        const libS = side === 'send' ? await ep.getSendLibrary(susn, eid) : (await ep.getReceiveLibrary(susn, eid))[0];
        const cu = await ep.getConfig(usn, libU, eid, 2);
        const cs = await ep.getConfig(susn, libS, eid, 2);
        check(cu.toLowerCase() === cs.toLowerCase(), `USN ${side} ULN config == sUSN (eid ${eid})`);
      }
    }
  }

  if (!ONLY || ONLY.includes('sophon')) {
    console.log('\n== sophon');
    const p = await provider([process.env.SOPHON_RPC_URL, 'https://rpc.sophon.xyz'] as string[], 50104);
    if (!p) check(false, 'rpc reachable');
    else
      for (const [n, a] of [
        ['USN', '0xC1AA99c3881B26901aF70738A7C217dc32536d36'],
        ['sUSN', '0xb87dbe27db932bacaaa96478443b6519d52c5004'],
      ]) {
        const c = new ethers.Contract(a, TOKEN_ABI, p);
        for (const eid of [30101, 30165]) check((await c.peers(eid)) === ethers.ZeroHash, `Sophon ${n} peer(${eid}) == 0`);
      }
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
