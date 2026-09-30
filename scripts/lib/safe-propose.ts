/**
 * Shared Safe helpers for the proposal scripts: Transaction Builder JSON
 * files and proposals through the Safe Transaction Service.
 */
import { ethers } from 'ethers';
import * as fs from 'fs';
import { resolve } from 'path';

export type Tx = {
  to: string;
  value: string;
  data: string;
  contractMethod: null;
  contractInputsValues: null;
};
export const tx = (to: string, data: string): Tx => ({
  to,
  value: '0',
  data,
  contractMethod: null,
  contractInputsValues: null,
});

export const OUT_DIR = resolve(__dirname, '../out/safe');

// Safe Transaction Service gateway slug per chain (null = no service: JSON only).
export const SAFE_SERVICE: Record<string, string | null> = {
  ethereum: 'eth',
  base: 'base',
  hyperevm: null,
  citrea: null,
  bera: 'berachain',
  zksync: 'zksync',
  sophon: null,
  flare: null,
};
export const SAFE_UI: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  bera: 'berachain',
  zksync: 'zksync',
};
export const MULTISEND: Record<string, string> = {
  default: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2', // MultiSendCallOnly 1.4.1
  zksync: '0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F', // 1.3.0 on zkSync Era
};

const SAFE_ABI = [
  'function getOwners() view returns (address[])',
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

export function writeBatch(
  chain: string,
  chainId: number,
  safe: string,
  name: string,
  description: string,
  txs: Tx[]
): string {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const f = resolve(OUT_DIR, `${chain}-${name}.json`);
  fs.writeFileSync(
    f,
    JSON.stringify(
      {
        version: '1.0',
        chainId: String(chainId),
        createdAt: Date.now(),
        meta: {
          name: `${chain} ${name}`,
          description,
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
  return f;
}

export function multiSend(txs: Tx[]): string {
  const packed = txs
    .map((t) =>
      ethers
        .solidityPacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [0, t.to, BigInt(t.value), (t.data.length - 2) / 2, t.data]
        )
        .slice(2)
    )
    .join('');
  return new ethers.Interface(['function multiSend(bytes)']).encodeFunctionData(
    'multiSend',
    ['0x' + packed]
  );
}

export async function safeApi(
  chain: string,
  path: string,
  init?: RequestInit
): Promise<any> {
  const slug = SAFE_SERVICE[chain];
  if (!slug) throw new Error(`${chain}: no Safe Transaction Service`);
  const res = await fetch(
    `https://api.safe.global/tx-service/${slug}/api${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.SAFE_API_KEY}`,
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

// Propose a batch (single call direct, several via MultiSendCallOnly) into the
// Safe's queue, signed by SAFE_PROPOSER_PRIVATE_KEY (owner or registered
// delegate). Skips if an identical proposal is already queued.
export async function proposeToSafe(
  p: ethers.Provider,
  chain: { name: string; chainId: number },
  safe: string,
  txs: Tx[],
  label: string
): Promise<string | undefined> {
  const pk = process.env.SAFE_PROPOSER_PRIVATE_KEY;
  if (!process.env.SAFE_API_KEY || !pk)
    throw new Error('needs SAFE_API_KEY and SAFE_PROPOSER_PRIVATE_KEY');
  const signer = new ethers.Wallet(pk, p);
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
  const queued: any[] =
    (
      await safeApi(
        chain.name,
        `/v1/safes/${safe}/multisig-transactions/?executed=false&limit=50&ordering=-nonce`
      )
    ).results ?? [];
  const dup = queued.find(
    (q) =>
      q.to?.toLowerCase() === to.toLowerCase() &&
      (q.data ?? '0x').toLowerCase() === data.toLowerCase()
  );
  if (dup) {
    console.log(
      `  ${label}: identical proposal already queued (nonce ${dup.nonce}) ${dup.safeTxHash}`
    );
    return dup.safeTxHash;
  }
  const nonce = Math.max(
    Number(info.nonce),
    queued.length ? Math.max(...queued.map((q) => Number(q.nonce))) + 1 : 0
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
      origin: label,
    }),
  });
  console.log(
    `  ✓ proposed ${label} as nonce ${nonce} (${isOwner ? '1' : '0'}/${info.threshold})\n    ${safeTxHash}\n    https://app.safe.global/transactions/queue?safe=${SAFE_UI[chain.name]}:${safe}`
  );
  return safeTxHash;
}

export async function provider(
  rpcs: string[],
  chainId: number
): Promise<ethers.JsonRpcProvider | undefined> {
  for (const rpc of rpcs.filter(Boolean)) {
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
