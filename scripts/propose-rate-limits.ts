/**
 * Configure the BridgeRateLimiter on every chain: one limit for every live
 * bridge route (LayerZero peer or Hyperlane remote token) of every token,
 * inbound and outbound, and a 1-wei "closed" limit on deprecated routes.
 *
 * Routes are discovered from chain state (peers() / remoteTokens()), never
 * hardcoded. setRateLimits lives on the limiter (owner = the chain Safe), so
 * this does NOT depend on the proxy upgrades: it can be proposed and executed
 * before or after them and takes effect once setRateLimiter is wired.
 *
 *   LIMIT=4000000          tokens per route per window (default 4M, 18 decimals)
 *   WINDOW=28800           sliding window in seconds (default 8h; 0 = per-tx cap)
 *   CLOSE_ROUTES=239,50104 Hyperlane domains / LZ eids to set to 1 wei (default: TAC 239 + Sophon 50104)
 *   DEAD_ROUTES=239,50104  Hyperlane domains whose remote token is re-registered as 0x…dEaD
 *                          (inbound then fails InvalidRemoteToken; default same as CLOSE_ROUTES; "" to skip)
 *   CHAINS=ethereum,base   restrict
 *   PROPOSE=true           queue in the Safe via the Transaction Service (SAFE_API_KEY, SAFE_PROPOSER_PRIVATE_KEY)
 *
 * Always writes scripts/out/safe/<chain>-rate-limits.json (Transaction Builder).
 * Idempotent: routes already at the target limit/window are skipped.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const LIMIT = ethers.parseUnits(process.env.LIMIT ?? '4000000', 18);
const WINDOW = BigInt(process.env.WINDOW ?? '28800');
const CLOSE = new Set(
  (process.env.CLOSE_ROUTES ?? '239,50104')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
);
const DEAD = new Set(
  (process.env.DEAD_ROUTES ?? process.env.CLOSE_ROUTES ?? '239,50104')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
);
const DEAD_ADDR = ethers.zeroPadValue(
  '0x000000000000000000000000000000000000dEaD',
  32
);
const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const PROPOSE = process.env.PROPOSE === 'true';
const SAFE_API_KEY = process.env.SAFE_API_KEY;
const SAFE_PROPOSER_PK = process.env.SAFE_PROPOSER_PRIVATE_KEY;
const OUT_DIR = resolve(__dirname, 'out/safe');
const DEPLOYMENTS = resolve(__dirname, 'out/audited-implementations.json');

const TRANSPORT_LZ = 0;
const TRANSPORT_HL = 1;
// LayerZero V2 eids and Hyperlane domains worth probing (plus anything found in events).
const LZ_EIDS: Record<number, string> = {
  30101: 'ETH',
  30165: 'zkSync',
  30334: 'Sophon',
  30378: 'Sui',
  30295: 'Flare',
  30362: 'Bera',
  30367: 'HyperEVM',
  30184: 'Base',
};
const HL_DOMAINS: Record<number, string> = {
  1: 'ETH',
  324: 'zkSync',
  239: 'TAC',
  8453: 'Base',
  999: 'HyperEVM',
  4114: 'Citrea',
  80094: 'Bera',
  50104: 'Sophon',
  358974494: 'Starknet',
};
const SAFE_SERVICE: Record<string, string | null> = {
  ethereum: 'eth',
  base: 'base',
  hyperevm: null,
  citrea: null,
  bera: 'berachain',
  zksync: 'zksync',
};
const SAFE_UI: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  bera: 'berachain',
  zksync: 'zksync',
};
const MULTISEND: Record<string, string> = {
  default: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
  zksync: '0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F',
};

const CHAINS = [
  {
    name: 'ethereum',
    chainId: 1,
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'],
    tokens: [
      ['USN', '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD'],
      ['sUSN', '0xE24a3DC889621612422A64E6388927901608B91D'],
    ],
  },
  {
    name: 'base',
    chainId: 8453,
    rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'],
    tokens: [['sUSN', '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F']],
  },
  {
    name: 'hyperevm',
    chainId: 999,
    rpcs: [process.env.HYPEREVM_RPC_URL, 'https://rpc.hyperliquid.xyz/evm'],
    tokens: [['sUSN', '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F']],
  },
  {
    name: 'citrea',
    chainId: 4114,
    rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'],
    tokens: [['sUSN', '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD']],
  },
  {
    name: 'bera',
    chainId: 80094,
    rpcs: [process.env.BERACHAIN_RPC_URL, 'https://rpc.berachain.com'],
    tokens: [['sUSN', '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD']],
  },
  {
    name: 'zksync',
    chainId: 324,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'],
    tokens: [
      ['USN', '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6'],
      ['sUSN', '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f'],
    ],
  },
].map((c) => ({ ...c, rpcs: c.rpcs.filter(Boolean) as string[] }));

const ABI = [
  'function peers(uint32) view returns (bytes32)',
  'function remoteTokens(uint32) view returns (bytes32)',
  'function owner() view returns (address)',
  'function rateLimiter() view returns (address)',
  'function getRateLimit(address caller, uint8 transport, uint32 remoteId, bool outbound) view returns (uint256 limit, uint256 window, uint256 available)',
  'function setRateLimits(address caller, (uint8 transport, uint32 remoteId, bool outbound, uint256 limit, uint256 window)[] configs)',
  'function registerHyperlaneRemoteToken(uint32 domain, bytes32 remoteToken)',
  'event PeerSet(uint32 eid, bytes32 peer)',
  'event RemoteTokenSet(uint32 indexed domain, bytes32 indexed remoteToken)',
];
const iface = new ethers.Interface(ABI);
const SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function VERSION() view returns (string)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
];
const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

type Tx = {
  to: string;
  value: string;
  data: string;
  contractMethod: null;
  contractInputsValues: null;
};
type Cfg = {
  transport: number;
  remoteId: number;
  outbound: boolean;
  limit: bigint;
  window: bigint;
};

function limiterFor(chain: string): string | undefined {
  if (process.env[`LIMITER_${chain.toUpperCase()}`])
    return process.env[`LIMITER_${chain.toUpperCase()}`];
  try {
    const runs: any[] = JSON.parse(fs.readFileSync(DEPLOYMENTS, 'utf8'));
    for (const run of runs.slice().reverse())
      if (run.broadcast)
        for (const p of run.plans ?? [])
          if (p.chain === chain && p.limiter) return p.limiter;
  } catch {}
  return undefined;
}

async function provider(
  rpcs: string[],
  chainId: number
): Promise<ethers.JsonRpcProvider | undefined> {
  for (const rpc of rpcs) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10_000);
      const j: any = await (
        await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_chainId',
            params: [],
          }),
          signal: ctl.signal,
        })
      ).json();
      clearTimeout(t);
      if (Number(j.result) !== chainId) throw new Error('wrong chain');
      return new ethers.JsonRpcProvider(rpc, chainId, {
        staticNetwork: ethers.Network.from(chainId),
        batchMaxCount: 1,
      });
    } catch {}
  }
  return undefined;
}

// Routes = every eid with a non-zero peer + every domain with a non-zero remote token.
async function routes(
  p: ethers.Provider,
  chainId: number,
  token: string
): Promise<{ transport: number; remoteId: number; name: string }[]> {
  const c = new ethers.Contract(token, ABI, p);
  const eids = new Set(Object.keys(LZ_EIDS).map(Number));
  const doms = new Set(Object.keys(HL_DOMAINS).map(Number));
  const key = process.env.ETHERSCAN_API_KEY;
  if (key && [1, 8453, 999, 80094, 324].includes(chainId)) {
    for (const [topic, set, pick] of [
      [
        ethers.id('PeerSet(uint32,bytes32)'),
        eids,
        (l: any) => Number(BigInt(l.data.slice(0, 66))),
      ],
      [
        ethers.id('RemoteTokenSet(uint32,bytes32)'),
        doms,
        (l: any) => Number(BigInt(l.topics[1])),
      ],
    ] as const) {
      try {
        const j: any = await (
          await fetch(
            `https://api.etherscan.io/v2/api?chainid=${chainId}&module=logs&action=getLogs&address=${token}&topic0=${topic}&fromBlock=0&toBlock=latest&apikey=${key}`
          )
        ).json();
        if (Array.isArray(j.result))
          for (const l of j.result) (set as Set<number>).add(pick(l));
      } catch {}
    }
  }
  const out: { transport: number; remoteId: number; name: string }[] = [];
  for (const e of eids)
    try {
      if ((await c.peers(e)) !== ethers.ZeroHash)
        out.push({
          transport: TRANSPORT_LZ,
          remoteId: e,
          name: `LZ ${LZ_EIDS[e] ?? e}`,
        });
    } catch {}
  for (const d of doms)
    try {
      if ((await c.remoteTokens(d)) !== ethers.ZeroHash)
        out.push({
          transport: TRANSPORT_HL,
          remoteId: d,
          name: `HL ${HL_DOMAINS[d] ?? d}`,
        });
    } catch {}
  return out;
}

function multiSend(txs: Tx[]): string {
  const packed = txs
    .map((t) =>
      ethers
        .solidityPacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [0, t.to, 0n, (t.data.length - 2) / 2, t.data]
        )
        .slice(2)
    )
    .join('');
  return new ethers.Interface(['function multiSend(bytes)']).encodeFunctionData(
    'multiSend',
    ['0x' + packed]
  );
}

async function safeApi(
  chain: string,
  path: string,
  init?: RequestInit
): Promise<any> {
  const slug = SAFE_SERVICE[chain];
  if (!slug) throw new Error('no Safe service on this chain');
  const res = await fetch(
    `https://api.safe.global/tx-service/${slug}/api${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${SAFE_API_KEY}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    }
  );
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok)
    throw new Error(
      `Safe ${slug} ${path} → HTTP ${res.status}: ${(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 140)}`
    );
  return body;
}

async function propose(
  p: ethers.Provider,
  chain: { name: string; chainId: number },
  safe: string,
  txs: Tx[],
  label: string
) {
  if (!SAFE_API_KEY || !SAFE_PROPOSER_PK)
    throw new Error(
      'PROPOSE=true needs SAFE_API_KEY and SAFE_PROPOSER_PRIVATE_KEY'
    );
  const signer = new ethers.Wallet(SAFE_PROPOSER_PK, p);
  const safeC = new ethers.Contract(safe, SAFE_ABI, p);
  const owners: string[] = await safeC.getOwners();
  const isOwner = owners
    .map((o) => o.toLowerCase())
    .includes(signer.address.toLowerCase());
  if (!isOwner) {
    let ok = false;
    for (const path of [
      `/v2/delegates/?safe=${safe}`,
      `/v1/delegates/?safe=${safe}`,
    ]) {
      try {
        ok = ((await safeApi(chain.name, path)).results ?? []).some(
          (x: any) => x.delegate?.toLowerCase() === signer.address.toLowerCase()
        );
        break;
      } catch (e: any) {
        if (!/HTTP 404/.test(String(e?.message))) throw e;
      }
    }
    if (!ok)
      throw new Error(
        `${signer.address} is neither owner nor delegate of ${safe}`
      );
  }
  let to: string, data: string, operation: number;
  if (txs.length === 1) {
    ({ to, data } = txs[0]);
    operation = 0;
  } else {
    to = MULTISEND[chain.name] ?? MULTISEND.default;
    data = multiSend(txs);
    operation = 1;
  }
  const info = await safeApi(chain.name, `/v1/safes/${safe}/`);
  const queued =
    (
      await safeApi(
        chain.name,
        `/v1/safes/${safe}/multisig-transactions/?executed=false&limit=50&ordering=-nonce`
      )
    ).results ?? [];
  const dup = queued.find(
    (q: any) =>
      q.to?.toLowerCase() === to.toLowerCase() &&
      (q.data ?? '0x').toLowerCase() === data.toLowerCase()
  );
  if (dup) {
    console.log(
      `  ${label}: identical proposal already queued (nonce ${dup.nonce}) ${dup.safeTxHash}`
    );
    return;
  }
  const nonce = Math.max(
    Number(info.nonce),
    queued.length ? Math.max(...queued.map((q: any) => Number(q.nonce))) + 1 : 0
  );
  const message = {
    to,
    value: 0n,
    data,
    operation,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ethers.ZeroAddress,
    refundReceiver: ethers.ZeroAddress,
    nonce: BigInt(nonce),
  };
  const domain = { chainId: chain.chainId, verifyingContract: safe };
  const safeTxHash = ethers.TypedDataEncoder.hash(
    domain,
    SAFE_TX_TYPES,
    message
  );
  const onchain: string = await safeC.getTransactionHash(
    to,
    0,
    data,
    operation,
    0,
    0,
    0,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    nonce
  );
  if (onchain !== safeTxHash) throw new Error('safeTxHash mismatch');
  const signature = await signer.signTypedData(domain, SAFE_TX_TYPES, message);
  await safeApi(chain.name, `/v1/safes/${safe}/multisig-transactions/`, {
    method: 'POST',
    body: JSON.stringify({
      to,
      value: '0',
      data,
      operation,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: ethers.ZeroAddress,
      refundReceiver: ethers.ZeroAddress,
      nonce,
      contractTransactionHash: safeTxHash,
      sender: signer.address,
      signature,
      origin: `propose-rate-limits.ts ${label}`,
    }),
  });
  console.log(
    `  ✓ proposed ${label} as nonce ${nonce} (${isOwner ? '1' : '0'}/${info.threshold})\n    ${safeTxHash}\n    https://app.safe.global/transactions/queue?safe=${SAFE_UI[chain.name]}:${safe}`
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `limit ${ethers.formatUnits(LIMIT, 18)} per route per ${WINDOW}s window, closed routes (1 wei): ${[...CLOSE].map((d) => HL_DOMAINS[d] ?? LZ_EIDS[d] ?? d).join(', ') || 'none'}${PROPOSE ? ' — PROPOSE=true' : ' — JSON only'}`
  );
  for (const chain of CHAINS) {
    if (ONLY && !ONLY.includes(chain.name)) continue;
    const limiter = limiterFor(chain.name);
    console.log(`\n== ${chain.name}`);
    if (!limiter) {
      console.log(
        '  no limiter recorded — set LIMITER_' + chain.name.toUpperCase()
      );
      continue;
    }
    const p = await provider(chain.rpcs, chain.chainId);
    if (!p) {
      console.log('  no reachable RPC');
      continue;
    }
    const lim = new ethers.Contract(limiter, ABI, p);
    const safe: string = await lim.owner();
    console.log(`  limiter ${limiter} owner ${safe}`);
    const txs: Tx[] = [];
    for (const [tok, proxy] of chain.tokens) {
      const rs = await routes(p, chain.chainId, proxy);
      const wired: string = await new ethers.Contract(proxy, ABI, p)
        .rateLimiter()
        .catch(() => '(not upgraded yet)');
      const cfgs: Cfg[] = [];
      const lines: string[] = [];
      for (const r of rs) {
        const target = CLOSE.has(r.remoteId) ? 1n : LIMIT;
        const win = CLOSE.has(r.remoteId) ? 0n : WINDOW;
        for (const outbound of [false, true]) {
          const cur = await lim.getRateLimit(
            proxy,
            r.transport,
            r.remoteId,
            outbound
          );
          const same = cur.limit === target && cur.window === win;
          if (!same)
            cfgs.push({
              transport: r.transport,
              remoteId: r.remoteId,
              outbound,
              limit: target,
              window: win,
            });
          lines.push(
            `     ${r.name.padEnd(14)} ${outbound ? 'out' : 'in '} ${same ? 'already' : 'set'} ${target === 1n ? 'CLOSED (1 wei)' : ethers.formatUnits(target, 18) + '/' + win + 's'}${same ? '' : ` (now ${cur.limit === 0n ? 'unlimited' : ethers.formatUnits(cur.limit, 18)})`}`
          );
        }
      }
      console.log(
        `  ${tok} ${proxy} (rateLimiter on token: ${wired}) — ${rs.length} routes`
      );
      for (const l of lines) console.log(l);
      for (const r of rs) {
        if (r.transport !== TRANSPORT_HL || !DEAD.has(r.remoteId)) continue;
        const cur: string = await new ethers.Contract(
          proxy,
          ABI,
          p
        ).remoteTokens(r.remoteId);
        if (cur.toLowerCase() === DEAD_ADDR.toLowerCase()) {
          lines.push(`     ${r.name.padEnd(14)} remote token already 0x…dEaD`);
          continue;
        }
        txs.push({
          to: proxy,
          value: '0',
          data: iface.encodeFunctionData('registerHyperlaneRemoteToken', [
            r.remoteId,
            DEAD_ADDR,
          ]),
          contractMethod: null,
          contractInputsValues: null,
        });
        lines.push(
          `     ${r.name.padEnd(14)} registerHyperlaneRemoteToken(${r.remoteId}, 0x…dEaD)  (now 0x${cur.slice(-40)})`
        );
      }
      if (cfgs.length)
        txs.push({
          to: limiter,
          value: '0',
          data: iface.encodeFunctionData('setRateLimits', [
            proxy,
            cfgs.map((c) => [
              c.transport,
              c.remoteId,
              c.outbound,
              c.limit,
              c.window,
            ]),
          ]),
          contractMethod: null,
          contractInputsValues: null,
        });
    }
    if (!txs.length) {
      console.log('  nothing to change');
      continue;
    }
    const f = resolve(OUT_DIR, `${chain.name}-rate-limits.json`);
    fs.writeFileSync(
      f,
      JSON.stringify(
        {
          version: '1.0',
          chainId: String(chain.chainId),
          createdAt: Date.now(),
          meta: {
            name: `${chain.name} rate limits`,
            description: `setRateLimits ${ethers.formatUnits(LIMIT, 18)}/${WINDOW}s`,
            txBuilderVersion: '1.17.0',
            createdFromSafeAddress: safe,
            createdFromOwnerAddress: '',
          },
          transactions: txs,
        },
        null,
        2
      )
    );
    console.log(`  → ${f} (${txs.length} tx, Safe ${safe})`);
    if (PROPOSE) {
      if (!SAFE_SERVICE[chain.name]) {
        console.log('  no Safe service — import the JSON');
        continue;
      }
      try {
        await propose(p, chain, safe, txs, `${chain.name} rate-limits`);
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
