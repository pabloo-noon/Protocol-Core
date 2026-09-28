/**
 * Propose the proxy upgrades for the audited implementations, through whatever
 * owns each ProxyAdmin:
 *
 *   Timelock (ETH, Base, HyperEVM, Citrea, Bera — contracts/periphery/Timelock.sol,
 *   owned by the chain's token Safe):
 *     phase 1  Safe → Timelock.scheduleUpgrade(proxyAdmin, proxy, impl, 0x)
 *     wait     Timelock.delay() (48h; 24h on HyperEVM)
 *     phase 2  Safe → Timelock.executeUpgrade(proxyAdmin, proxy, impl, 0x)
 *              + token.setRateLimiter(limiter) in the same batch (same Safe;
 *              setRateLimiter only exists on the new implementation)
 *
 *   Safe directly (zkSync — the Safe owns the ProxyAdmin):
 *     Safe → ProxyAdmin.upgradeAndCall(proxy, impl, 0x) + token.setRateLimiter(limiter)
 *
 * The script reads on-chain state to tell which phase each upgrade is in
 * (not scheduled / scheduled, waiting / ready to execute / done) and writes one
 * Safe Transaction Builder JSON per chain and phase to scripts/out/safe/,
 * ready to import in the Safe UI (Apps → Transaction Builder → load batch).
 *
 * Inputs: implementation + limiter addresses from scripts/out/audited-implementations.json
 * (written by deploy-audited-implementations.ts), overridable with
 *   IMPL_<CHAIN>_<TOKEN>=0x...   LIMITER_<CHAIN>=0x...
 *
 * Usage:
 *   npx hardhat run scripts/propose-upgrade.ts                # all chains with deployed implementations → JSON files only
 *   CHAINS=base,bera npx hardhat run scripts/propose-upgrade.ts
 *   NO_LIMITER=true ...                                       # leave setRateLimiter out of the batch
 *   PROPOSE=true ...                                          # also queue the batch in the Safe via the Transaction Service
 *       needs SAFE_API_KEY and SAFE_PROPOSER_PRIVATE_KEY (an owner of the Safe) in .env;
 *       phase 1 is proposed when nothing is scheduled, phase 2 once the delay has elapsed
 *       (PROPOSE_PHASE=1|2 forces one). HyperEVM and Citrea have no Safe service: JSON import only.
 *   REGISTER_DELEGATE=true SAFE_OWNER_PRIVATE_KEY=0x... ...        # one-off: an owner registers the proposer key as a delegate
 *
 * Nothing is sent on-chain by this script; the Safe signers do that.
 */
import { config as dotenvConfig } from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '../.env') });

const ONLY = process.env.CHAINS?.split(',').map((s) => s.trim().toLowerCase());
const NO_LIMITER = process.env.NO_LIMITER === 'true';
// PROPOSE=true: push each batch into the Safe's queue through the Safe
// Transaction Service (SAFE_API_KEY), signed by SAFE_PROPOSER_PRIVATE_KEY —
// which must be an owner of that Safe (the service rejects anything else).
// Phase 2 is only proposed once the timelock delay has elapsed (or with
// PROPOSE_PHASE=2 to force it).
const PROPOSE = process.env.PROPOSE === 'true';
const PROPOSE_PHASE = process.env.PROPOSE_PHASE; // '1' | '2' | undefined (auto)
const SAFE_API_KEY = process.env.SAFE_API_KEY;
const SAFE_PROPOSER_PK = process.env.SAFE_PROPOSER_PRIVATE_KEY;
// Safe Transaction Service gateway slug per chain. HyperEVM and Citrea have
// no service (every route 404s): JSON import in the Safe UI only.
const SAFE_SERVICE: Record<string, string | null> = {
  ethereum: 'eth',
  base: 'base',
  hyperevm: null,
  bera: 'berachain',
  citrea: null,
  zksync: 'zksync',
};
// Safe web UI chain prefixes, for the queue links printed after proposing.
const SAFE_UI_PREFIX: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  hyperevm: 'hyperevm',
  bera: 'berachain',
  zksync: 'zksync',
};
// Canonical MultiSendCallOnly per Safe version (checked to have code on every chain above).
const MULTISEND_CALL_ONLY: Record<string, string> = {
  '1.4.1': '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
  '1.3.0': '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
  'zksync-1.3.0': '0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F',
};
const DEPLOYMENTS = resolve(__dirname, 'out/audited-implementations.json');
const OUT_DIR = resolve(__dirname, 'out/safe');

const IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

const CHAINS: {
  name: string;
  chainId: number;
  rpcs: string[];
  tokens: { token: string; proxy: string }[];
}[] = [
  {
    name: 'ethereum',
    chainId: 1,
    rpcs: [process.env.ETHEREUM_MAINNET_RPC_URL, 'https://eth.drpc.org'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'USN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' },
      { token: 'sUSN', proxy: '0xE24a3DC889621612422A64E6388927901608B91D' },
    ],
  },
  {
    name: 'base',
    chainId: 8453,
    rpcs: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F' },
    ],
  },
  {
    name: 'hyperevm',
    chainId: 999,
    rpcs: [
      process.env.HYPEREVM_RPC_URL,
      'https://rpc.hyperliquid.xyz/evm',
    ].filter(Boolean) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F' },
    ],
  },
  {
    name: 'citrea',
    chainId: 4114,
    rpcs: [process.env.CITREA_RPC_URL, 'https://rpc.mainnet.citrea.xyz'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' },
    ],
  },
  {
    name: 'bera',
    chainId: 80094,
    rpcs: [process.env.BERACHAIN_RPC_URL, 'https://rpc.berachain.com'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'sUSN', proxy: '0xdA67B4284609d2d48e5d10cfAc411572727dc1eD' },
    ],
  },
  {
    name: 'zksync',
    chainId: 324,
    rpcs: [process.env.ZKSYNC_RPC_URL, 'https://mainnet.era.zksync.io'].filter(
      Boolean
    ) as string[],
    tokens: [
      { token: 'USN', proxy: '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6' },
      { token: 'sUSN', proxy: '0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f' },
    ],
  },
];

const ABI = [
  'function owner() view returns (address)',
  'function rateLimiter() view returns (address)',
  'function setRateLimiter(address)',
  'function upgradeAndCall(address proxy, address implementation, bytes data) payable',
  // Timelock (contracts/periphery/Timelock.sol)
  'function delay() view returns (uint256)',
  'function scheduledAt(bytes32) view returns (uint256)',
  'function getOperationId(address proxyAdmin, address proxy, address implementation, bytes data) pure returns (bytes32)',
  'function scheduleUpgrade(address proxyAdmin, address proxy, address implementation, bytes data)',
  'function executeUpgrade(address proxyAdmin, address proxy, address implementation, bytes data) payable',
  // Safe
  'function getThreshold() view returns (uint256)',
];
const iface = new ethers.Interface(ABI);

type Tx = {
  to: string;
  value: string;
  data: string;
  contractMethod: null;
  contractInputsValues: null;
};
function safeBatch(
  chainId: number,
  safe: string,
  name: string,
  description: string,
  txs: Tx[]
) {
  return {
    version: '1.0',
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name,
      description,
      txBuilderVersion: '1.17.0',
      createdFromSafeAddress: safe,
      createdFromOwnerAddress: '',
    },
    transactions: txs,
  };
}
const tx = (to: string, data: string): Tx => ({
  to,
  value: '0',
  data,
  contractMethod: null,
  contractInputsValues: null,
});

// ── Safe Transaction Service proposer ──────────────────────────────────────

const SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function VERSION() view returns (string)',
  'function nonce() view returns (uint256)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
];
const MULTISEND_ABI = ['function multiSend(bytes transactions) payable'];
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

// MultiSendCallOnly packs each call as: operation(1) | to(20) | value(32) | data.length(32) | data
function encodeMultiSend(txs: Tx[]): string {
  const packed = txs
    .map((t) =>
      ethers.solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, t.to, BigInt(t.value), (t.data.length - 2) / 2, t.data]
      )
    )
    .map((h) => h.slice(2))
    .join('');
  return new ethers.Interface(MULTISEND_ABI).encodeFunctionData('multiSend', [
    '0x' + packed,
  ]);
}

async function safeApi(
  chain: string,
  path: string,
  init?: RequestInit
): Promise<any> {
  const slug = SAFE_SERVICE[chain];
  if (!slug)
    throw new Error(
      `${chain}: no Safe Transaction Service — import the JSON in the Safe UI`
    );
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
      `Safe service ${slug} ${path} → HTTP ${res.status}: ${typeof body === 'string' ? body.slice(0, 160) : JSON.stringify(body).slice(0, 160)}`
    );
  return body;
}

async function isSafeDelegate(
  chain: string,
  safe: string,
  who: string
): Promise<boolean> {
  for (const path of [
    `/v2/delegates/?safe=${safe}`,
    `/v1/delegates/?safe=${safe}`,
  ]) {
    try {
      const d = await safeApi(chain, path);
      return (d.results ?? []).some(
        (x: any) => x.delegate?.toLowerCase() === who.toLowerCase()
      );
    } catch (e: any) {
      if (!/HTTP 404/.test(String(e?.message))) throw e;
    }
  }
  return false;
}

// REGISTER_DELEGATE=true: an owner (SAFE_OWNER_PRIVATE_KEY) registers
// SAFE_PROPOSER_PRIVATE_KEY's address as a delegate of the Safe, once per
// chain. Signature is the service's EIP-712 "Delegate" message (v2), with
// the v1 eth_sign fallback for services that do not have the v2 route.
async function registerDelegate(
  p: ethers.Provider,
  chain: { name: string; chainId: number },
  safe: string
) {
  const ownerPk = process.env.SAFE_OWNER_PRIVATE_KEY;
  if (!ownerPk || !SAFE_PROPOSER_PK)
    throw new Error(
      'REGISTER_DELEGATE=true needs SAFE_OWNER_PRIVATE_KEY and SAFE_PROPOSER_PRIVATE_KEY'
    );
  const owner = new ethers.Wallet(ownerPk, p);
  const delegate = new ethers.Wallet(SAFE_PROPOSER_PK).address;
  const owners: string[] = await new ethers.Contract(
    safe,
    SAFE_ABI,
    p
  ).getOwners();
  if (!owners.map((o) => o.toLowerCase()).includes(owner.address.toLowerCase()))
    throw new Error(
      `${chain.name}: SAFE_OWNER_PRIVATE_KEY ${owner.address} is not an owner of ${safe}`
    );
  if (await isSafeDelegate(chain.name, safe, delegate)) {
    console.log(`  ${delegate} is already a delegate of ${safe}`);
    return;
  }
  const totp = Math.floor(Date.now() / 1000 / 3600);
  const label = process.env.DELEGATE_LABEL ?? 'propose-upgrade';
  try {
    const signature = await owner.signTypedData(
      {
        name: 'Safe Transaction Service',
        version: '1.0',
        chainId: chain.chainId,
      },
      {
        Delegate: [
          { name: 'delegateAddress', type: 'address' },
          { name: 'totp', type: 'uint256' },
        ],
      },
      { delegateAddress: delegate, totp }
    );
    await safeApi(chain.name, `/v2/delegates/`, {
      method: 'POST',
      body: JSON.stringify({
        safe,
        delegate,
        delegator: owner.address,
        label,
        signature,
      }),
    });
  } catch (e: any) {
    if (!/HTTP 404/.test(String(e?.message))) throw e;
    // v1: eth_sign over keccak256(delegate + totp)
    const signature = await owner.signMessage(
      ethers.getBytes(
        ethers.keccak256(ethers.toUtf8Bytes(`${delegate}${totp}`))
      )
    );
    await safeApi(chain.name, `/v1/delegates/`, {
      method: 'POST',
      body: JSON.stringify({
        safe,
        delegate,
        delegator: owner.address,
        label,
        signature,
      }),
    });
  }
  console.log(
    `  ✓ registered ${delegate} as delegate of ${safe} (by owner ${owner.address})`
  );
}

// Propose one Safe transaction (a single call, or a MultiSendCallOnly batch)
// into the Safe's queue. Returns the safeTxHash, or the hash of an identical
// pending proposal if one is already queued.
async function proposeBatch(
  p: ethers.Provider,
  chain: { name: string; chainId: number },
  safe: string,
  label: string,
  txs: Tx[]
): Promise<string> {
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
  let isDelegate = false;
  if (!isOwner) {
    // A registered delegate may propose too (its signature is not a confirmation).
    isDelegate = await isSafeDelegate(chain.name, safe, signer.address);
  }
  if (!isOwner && !isDelegate)
    throw new Error(
      `${chain.name}: proposer ${signer.address} is neither an owner nor a delegate of Safe ${safe} (owners: ${owners.join(', ')})`
    );
  const version: string = await safeC.VERSION();

  // Single call → direct; several → MultiSendCallOnly via delegatecall (operation 1).
  let to: string, data: string, operation: number;
  if (txs.length === 1) {
    ({ to, data } = txs[0]);
    operation = 0;
  } else {
    to =
      chain.name === 'zksync'
        ? MULTISEND_CALL_ONLY['zksync-1.3.0']
        : (MULTISEND_CALL_ONLY[version] ?? MULTISEND_CALL_ONLY['1.4.1']);
    if ((await p.getCode(to)) === '0x')
      throw new Error(`${chain.name}: MultiSendCallOnly ${to} has no code`);
    data = encodeMultiSend(txs);
    operation = 1;
  }

  // Next nonce: on-chain nonce, or one past the highest queued proposal.
  const info = await safeApi(chain.name, `/v1/safes/${safe}/`);
  const queued = await safeApi(
    chain.name,
    `/v1/safes/${safe}/multisig-transactions/?executed=false&limit=50&ordering=-nonce`
  );
  const pending: any[] = queued.results ?? [];
  const dup = pending.find(
    (q) =>
      q.to?.toLowerCase() === to.toLowerCase() &&
      (q.data ?? '0x').toLowerCase() === data.toLowerCase() &&
      Number(q.operation) === operation
  );
  if (dup) {
    console.log(
      `  ${label}: identical proposal already queued (nonce ${dup.nonce}, ${dup.confirmations?.length ?? 0}/${info.threshold} confirmations) — ${dup.safeTxHash}`
    );
    return dup.safeTxHash;
  }
  const nonce = Math.max(
    Number(info.nonce),
    pending.length ? Math.max(...pending.map((q) => Number(q.nonce))) + 1 : 0
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
  // Cross-check our EIP-712 encoding against the Safe contract itself.
  const onchainHash: string = await safeC.getTransactionHash(
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
  if (onchainHash !== safeTxHash)
    throw new Error(
      `${chain.name}: safeTxHash mismatch (local ${safeTxHash}, Safe ${onchainHash})`
    );
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
      origin: `propose-upgrade.ts ${label}`,
    }),
  });
  const prefix = SAFE_UI_PREFIX[chain.name];
  console.log(
    `  ✓ proposed ${label} as nonce ${nonce} (${isOwner ? `1/${info.threshold} signed by owner` : `0/${info.threshold} — proposed by delegate`} ${signer.address})\n    ${safeTxHash}\n    https://app.safe.global/transactions/queue?safe=${prefix}:${safe}`
  );
  return safeTxHash;
}

async function rpcChainId(rpc: string): Promise<number> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
      signal: ctl.signal,
    });
    const j: any = await res.json();
    if (!j?.result) throw new Error('bad eth_chainId');
    return Number(j.result);
  } finally {
    clearTimeout(t);
  }
}

function loadDeployments(): Record<
  string,
  { impl?: string; limiter?: string }
> {
  const out: Record<string, { impl?: string; limiter?: string }> = {};
  try {
    const runs: any[] = JSON.parse(fs.readFileSync(DEPLOYMENTS, 'utf8'));
    for (const run of runs) {
      if (!run.broadcast) continue;
      for (const p of run.plans ?? []) {
        if (!p.newImpl) continue;
        out[`${p.chain}:${p.token}`] = { impl: p.newImpl, limiter: p.limiter };
      }
    }
  } catch {}
  return out;
}

async function main() {
  const deployed = loadDeployments();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const now = Math.floor(Date.now() / 1000);

  for (const chain of CHAINS) {
    if (ONLY && !ONLY.includes(chain.name)) continue;
    let p: ethers.JsonRpcProvider | undefined;
    for (const rpc of chain.rpcs) {
      try {
        const id = await rpcChainId(rpc);
        if (id !== chain.chainId)
          throw new Error(`chainId ${id} != ${chain.chainId}`);
        p = new ethers.JsonRpcProvider(rpc, id, {
          staticNetwork: ethers.Network.from(id),
          batchMaxCount: 1,
        });
        break;
      } catch (e: any) {
        console.log(`  ${rpc}: ${String(e?.message).slice(0, 60)}`);
      }
    }
    console.log(`\n== ${chain.name}`);
    if (!p) {
      console.log('  no reachable RPC');
      continue;
    }

    const phase1: Tx[] = []; // schedule (timelock) or upgrade (direct) + setRateLimiter
    const phase2: Tx[] = []; // execute (timelock) after the delay
    let safe = '';
    let delayH = 0;
    let readyAt = 0;
    const notes: string[] = [];

    for (const t of chain.tokens) {
      const key = `${chain.name}:${t.token}`;
      const impl =
        process.env[
          `IMPL_${chain.name.toUpperCase()}_${t.token.toUpperCase()}`
        ] ?? deployed[key]?.impl;
      const limiter =
        process.env[`LIMITER_${chain.name.toUpperCase()}`] ??
        deployed[key]?.limiter;
      if (!impl) {
        console.log(
          `  ${t.token} ${t.proxy}: no new implementation recorded — deploy first (or set IMPL_${chain.name.toUpperCase()}_${t.token.toUpperCase()})`
        );
        continue;
      }
      const token = new ethers.Contract(t.proxy, ABI, p);
      const currentImpl = ethers.getAddress(
        '0x' + (await p.getStorage(t.proxy, IMPL_SLOT)).slice(-40)
      );
      const proxyAdmin = ethers.getAddress(
        '0x' + (await p.getStorage(t.proxy, ADMIN_SLOT)).slice(-40)
      );
      const adminOwner: string = await new ethers.Contract(
        proxyAdmin,
        ABI,
        p
      ).owner();
      const tokenOwner: string = await token.owner();
      if ((await p.getCode(impl)) === '0x')
        throw new Error(
          `${key}: implementation ${impl} has no code on ${chain.name}`
        );

      if (currentImpl.toLowerCase() === impl.toLowerCase()) {
        console.log(`  ${t.token} ${t.proxy}: already on ${impl} ✓`);
      } else {
        const upgradeData = iface.encodeFunctionData('upgradeAndCall', [
          t.proxy,
          impl,
          '0x',
        ]);
        // Is the ProxyAdmin owner our Timelock?
        const tl = new ethers.Contract(adminOwner, ABI, p);
        let isTimelock = false;
        let delay = 0n;
        try {
          delay = await tl.delay();
          isTimelock = true;
        } catch {}

        if (isTimelock) {
          const tlOwner: string = await tl.owner();
          safe = safe || tlOwner;
          if (tlOwner.toLowerCase() !== safe.toLowerCase())
            notes.push(
              `${t.token}: timelock owner ${tlOwner} differs from ${safe}`
            );
          delayH = Number(delay) / 3600;
          // Cross-check the operation id with the contract's own pure function.
          const opId: string = await tl.getOperationId(
            proxyAdmin,
            t.proxy,
            impl,
            '0x'
          );
          const local = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['address', 'address', 'address', 'bytes'],
              [proxyAdmin, t.proxy, impl, '0x']
            )
          );
          if (opId !== local)
            throw new Error(
              `${key}: operation id mismatch (ABI drift on ${adminOwner})`
            );
          const at = Number(await tl.scheduledAt(opId));
          const args = [proxyAdmin, t.proxy, impl, '0x'];
          if (at === 0) {
            phase1.push(
              tx(adminOwner, iface.encodeFunctionData('scheduleUpgrade', args))
            );
            phase2.push(
              tx(adminOwner, iface.encodeFunctionData('executeUpgrade', args))
            );
            console.log(
              `  ${t.token} ${t.proxy}: ${currentImpl} → ${impl}\n     NOT SCHEDULED — phase 1: Timelock ${adminOwner}.scheduleUpgrade (delay ${delayH}h), by Safe ${tlOwner}\n     opId ${opId}`
            );
          } else {
            const after = at + Number(delay);
            readyAt = Math.max(readyAt, after);
            phase2.push(
              tx(adminOwner, iface.encodeFunctionData('executeUpgrade', args))
            );
            const state =
              now >= after
                ? 'READY — phase 2: executeUpgrade'
                : `SCHEDULED, executable at ${new Date(after * 1000).toISOString()} (in ${((after - now) / 3600).toFixed(1)}h)`;
            console.log(
              `  ${t.token} ${t.proxy}: ${currentImpl} → ${impl}\n     ${state}\n     opId ${opId}`
            );
          }
        } else {
          // ProxyAdmin owned by the Safe (or an EOA) directly.
          safe = safe || adminOwner;
          phase1.push(tx(proxyAdmin, upgradeData));
          console.log(
            `  ${t.token} ${t.proxy}: ${currentImpl} → ${impl}\n     ProxyAdmin ${proxyAdmin} owned directly by ${adminOwner} — single tx upgradeAndCall`
          );
        }
      }

      // Limiter wiring: same Safe (token owner) — batch it with phase 1.
      if (!NO_LIMITER && limiter) {
        const wired: string = await token
          .rateLimiter()
          .catch(() => ethers.ZeroAddress);
        if (wired.toLowerCase() === limiter.toLowerCase()) {
          console.log(`     rateLimiter already ${limiter} ✓`);
        } else if (
          tokenOwner.toLowerCase() !== (safe || tokenOwner).toLowerCase()
        ) {
          notes.push(
            `${t.token}: token owner ${tokenOwner} is not the upgrade Safe ${safe}; setRateLimiter(${limiter}) needs its own batch from ${tokenOwner}`
          );
        } else {
          safe = safe || tokenOwner;
          // setRateLimiter only exists on the NEW implementation: it must run after the upgrade.
          // Timelock chains: append to phase 2; direct chains: same batch, after upgradeAndCall.
          (chain.name === 'zksync' ? phase1 : phase2).push(
            tx(t.proxy, iface.encodeFunctionData('setRateLimiter', [limiter]))
          );
          console.log(
            `     + ${t.token}.setRateLimiter(${limiter}) ${chain.name === 'zksync' ? 'in the same batch' : 'in phase 2 (after executeUpgrade)'}`
          );
        }
      }
    }

    if (!safe) continue;
    const write = (phase: string, txs: Tx[], desc: string) => {
      if (!txs.length) return;
      const f = resolve(OUT_DIR, `${chain.name}-${phase}.json`);
      fs.writeFileSync(
        f,
        JSON.stringify(
          safeBatch(chain.chainId, safe, `${chain.name} ${phase}`, desc, txs),
          null,
          2
        )
      );
      console.log(`  → ${f}  (${txs.length} tx, Safe ${safe})`);
    };
    write(
      '1-schedule',
      phase1,
      chain.name === 'zksync'
        ? 'ProxyAdmin.upgradeAndCall + setRateLimiter'
        : `Timelock.scheduleUpgrade (delay ${delayH}h)`
    );
    write(
      '2-execute',
      phase2,
      `Timelock.executeUpgrade after the delay, then setRateLimiter`
    );
    if (readyAt)
      console.log(
        `  phase 2 executable from ${new Date(readyAt * 1000).toISOString()}`
      );
    for (const n of notes) console.log(`  ! ${n}`);

    if (process.env.REGISTER_DELEGATE === 'true' && SAFE_SERVICE[chain.name]) {
      try {
        await registerDelegate(p, chain, safe);
      } catch (e: any) {
        console.log(
          `  ✗ delegate registration failed: ${String(e?.message).slice(0, 200)}`
        );
      }
    }

    if (PROPOSE) {
      if (!SAFE_SERVICE[chain.name]) {
        console.log(
          `  ${chain.name}: Safe Transaction Service not available — use the JSON files above`
        );
        continue;
      }
      try {
        const wantPhase1 = PROPOSE_PHASE
          ? PROPOSE_PHASE === '1'
          : phase1.length > 0;
        const wantPhase2 = PROPOSE_PHASE
          ? PROPOSE_PHASE === '2'
          : phase1.length === 0 &&
            phase2.length > 0 &&
            readyAt > 0 &&
            now >= readyAt;
        if (wantPhase1 && phase1.length)
          await proposeBatch(
            p,
            chain,
            safe,
            `${chain.name} 1-schedule`,
            phase1
          );
        if (wantPhase2 && phase2.length)
          await proposeBatch(p, chain, safe, `${chain.name} 2-execute`, phase2);
        if (!wantPhase1 && !wantPhase2)
          console.log(
            `  nothing to propose yet${readyAt && now < readyAt ? ` (phase 2 executable from ${new Date(readyAt * 1000).toISOString()})` : ''}`
          );
      } catch (e: any) {
        console.log(`  ✗ propose failed: ${String(e?.message).slice(0, 300)}`);
      }
    }
  }
  console.log(
    '\nImport each JSON in the Safe UI: Apps → Transaction Builder → "load batch". Phase 2 files can be prepared now but will revert until the delay has elapsed.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
