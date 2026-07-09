import { ethers, network } from 'hardhat';

// LayerZero V2 — Sepolia testnet endpoint
const ENDPOINT_V2 = '0x6EDCE65403992e310A62460808c4b910D972f10f';

// LZ V2 testnet libraries / executor on Sepolia (override via env if rotated)
const SEPOLIA_SEND_LIB_302 =
  process.env.SEPOLIA_SEND_LIB || '0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE';
const SEPOLIA_RECEIVE_LIB_302 =
  process.env.SEPOLIA_RECEIVE_LIB ||
  '0xdAf00F5eE2158dD58E0d3857851c432E34A3A851';
const SEPOLIA_EXECUTOR =
  process.env.SEPOLIA_EXECUTOR ||
  '0x718B92b5CB0a5552039B593faF724D182A881eDA';

// 1-of-1: Sui testnet only has LayerZero Labs DVN deployed. Nethermind missing.
const DVN_LZ_LABS =
  process.env.DVN_LZ_LABS || '0x8eebf8b423b73bfca51a1db4b7354aa0bfca9193';

// Sui testnet
const SUI_EID = 40378;
// Already-deployed Sui OFT package id (from /Users/testing/Desktop/dclf/sui/testnet_summary.txt)
const DEFAULT_SUI_OFT_PACKAGE =
  '0x98f04c2b1799363ce3b55e5da7d8550b57508c564a8e349105e42e859ae11c1f';

const CONFIG_TYPE_EXECUTOR = 1;
const CONFIG_TYPE_ULN = 2;

const ENDPOINT_ABI = [
  'function setSendLibrary(address oapp, uint32 eid, address newLib) external',
  'function setReceiveLibrary(address oapp, uint32 eid, address newLib, uint256 gracePeriod) external',
  'function setConfig(address oapp, address lib, tuple(uint32 eid, uint32 configType, bytes config)[] params) external',
  'function getSendLibrary(address sender, uint32 eid) external view returns (address)',
  'function getReceiveLibrary(address receiver, uint32 eid) external view returns (address, bool)',
];

const OAPP_ABI = [
  'function setPeer(uint32 eid, bytes32 peer) external',
  'function peers(uint32 eid) external view returns (bytes32)',
  'function owner() external view returns (address)',
  'function endpoint() external view returns (address)',
];

function padToBytes32(value: string): string {
  const v = value.toLowerCase().startsWith('0x') ? value.slice(2) : value;
  if (v.length > 64) throw new Error(`Value too long for bytes32: ${value}`);
  return '0x' + v.padStart(64, '0');
}

function encodeUlnConfig(
  confirmations: number,
  requiredDvns: string[],
  optionalDvns: string[] = [],
  optionalThreshold = 0,
): string {
  const sortedRequired = [...requiredDvns].map((a) => a.toLowerCase()).sort();
  const sortedOptional = [...optionalDvns].map((a) => a.toLowerCase()).sort();
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)',
    ],
    [
      {
        confirmations,
        requiredDVNCount: sortedRequired.length,
        optionalDVNCount: sortedOptional.length,
        optionalDVNThreshold: optionalThreshold,
        requiredDVNs: sortedRequired,
        optionalDVNs: sortedOptional,
      },
    ],
  );
}

function encodeExecutorConfig(
  maxMessageSize: number,
  executor: string,
): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(uint32 maxMessageSize, address executor)'],
    [{ maxMessageSize, executor }],
  );
}

async function main() {
  const oappAddress = process.env.OAPP_ADDRESS;
  if (!oappAddress || !ethers.isAddress(oappAddress))
    throw new Error(
      'OAPP_ADDRESS env var required (Sepolia sUSN OFT, e.g. 0xCc2EBDdd298bc8787314c5926f68a464fEEDC480)',
    );

  const suiOftRaw = process.env.SUI_OFT_PACKAGE || DEFAULT_SUI_OFT_PACKAGE;
  const suiOftPeer = padToBytes32(suiOftRaw);

  // Confirmations are a property of the SOURCE chain's finality, not the
  // destination's. Sepolia → Sui needs 15 Sepolia confs (slow finality);
  // Sui → Sepolia needs 5 Sui confs (near-instant finality). Sepolia's
  // OUTBOUND must be >= Sui's matching INBOUND, otherwise the DVN's signed
  // confs fall short of Sui's receive-lib requirement and the message blocks.
  const sendConfirmations = Number(process.env.SEND_CONFIRMATIONS || 15);
  const recvConfirmations = Number(process.env.RECV_CONFIRMATIONS || 5);
  const maxMessageSize = Number(process.env.MAX_MESSAGE_SIZE || 10_000);
  const dryRun = process.env.DRY_RUN === 'true';

  const [signer] = await ethers.getSigners();

  console.log(`Network:            ${network.name}`);
  console.log(`Signer:             ${signer.address}`);
  console.log(`OApp (Sepolia):     ${oappAddress}`);
  console.log(`Endpoint:           ${ENDPOINT_V2}`);
  console.log(`Sui testnet EID:    ${SUI_EID}`);
  console.log(`Sui OFT package:    ${suiOftPeer}`);
  console.log(`Send lib:           ${SEPOLIA_SEND_LIB_302}`);
  console.log(`Recv lib:           ${SEPOLIA_RECEIVE_LIB_302}`);
  console.log(`Executor:           ${SEPOLIA_EXECUTOR}`);
  console.log(`Required DVN:       ${DVN_LZ_LABS} (1-of-1 LayerZero Labs)`);
  console.log(`Send confirmations: ${sendConfirmations}`);
  console.log(`Recv confirmations: ${recvConfirmations}`);
  console.log(`Max msg size:       ${maxMessageSize}`);
  console.log(
    `Mode:               ${dryRun ? 'DRY_RUN (calldata only)' : 'BROADCAST'}`,
  );
  console.log('');

  const oapp = new ethers.Contract(oappAddress, OAPP_ABI, signer);
  const endpoint = new ethers.Contract(ENDPOINT_V2, ENDPOINT_ABI, signer);

  const wiredEndpoint = await oapp.endpoint();
  if (wiredEndpoint.toLowerCase() !== ENDPOINT_V2.toLowerCase()) {
    throw new Error(
      `OApp.endpoint() (${wiredEndpoint}) does not match Sepolia ENDPOINT_V2 (${ENDPOINT_V2}). ` +
        `Wrong OAPP_ADDRESS for this network?`,
    );
  }

  const sendUln = encodeUlnConfig(sendConfirmations, [DVN_LZ_LABS]);
  const recvUln = encodeUlnConfig(recvConfirmations, [DVN_LZ_LABS]);
  const executorConfig = encodeExecutorConfig(maxMessageSize, SEPOLIA_EXECUTOR);

  const calls: { label: string; to: string; data: string }[] = [
    {
      label: '1. oapp.setPeer(SUI_TESTNET_EID, suiOftPackage)',
      to: oappAddress,
      data: oapp.interface.encodeFunctionData('setPeer', [SUI_EID, suiOftPeer]),
    },
    {
      label: '2. endpoint.setSendLibrary(oapp, SUI_TESTNET_EID, SEND_LIB)',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setSendLibrary', [
        oappAddress,
        SUI_EID,
        SEPOLIA_SEND_LIB_302,
      ]),
    },
    {
      label: '3. endpoint.setReceiveLibrary(oapp, SUI_TESTNET_EID, RECV_LIB, 0)',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setReceiveLibrary', [
        oappAddress,
        SUI_EID,
        SEPOLIA_RECEIVE_LIB_302,
        0,
      ]),
    },
    {
      label: `4. endpoint.setConfig(SEND_LIB, ULN(confs=${sendConfirmations}, DVN=[LZLabs]))`,
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        SEPOLIA_SEND_LIB_302,
        [{ eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: sendUln }],
      ]),
    },
    {
      label: `5. endpoint.setConfig(RECV_LIB, ULN(confs=${recvConfirmations}, DVN=[LZLabs]))`,
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        SEPOLIA_RECEIVE_LIB_302,
        [{ eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: recvUln }],
      ]),
    },
    {
      label: `6. endpoint.setConfig(SEND_LIB, EXECUTOR(maxMsg=${maxMessageSize}))`,
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        SEPOLIA_SEND_LIB_302,
        [
          {
            eid: SUI_EID,
            configType: CONFIG_TYPE_EXECUTOR,
            config: executorConfig,
          },
        ],
      ]),
    },
  ];

  for (const c of calls) {
    console.log(`--- ${c.label}`);
    console.log(`    to:   ${c.to}`);
    console.log(`    data: ${c.data}`);
    if (!dryRun) {
      const tx = await signer.sendTransaction({ to: c.to, data: c.data });
      console.log(`    tx:   ${tx.hash}`);
      await tx.wait();
    }
    console.log('');
  }

  if (dryRun) {
    console.log(
      'DRY_RUN=true — no transactions sent. Forward the calldata above to your multisig.',
    );
    return;
  }

  const peer = await oapp.peers(SUI_EID);
  const sendLib = await endpoint.getSendLibrary(oappAddress, SUI_EID);
  const [recvLib] = await endpoint.getReceiveLibrary(oappAddress, SUI_EID);
  console.log('Post-flight state:');
  console.log(`  peers(${SUI_EID}):     ${peer}`);
  console.log(
    `  expected peer:     ${suiOftPeer} ${peer === suiOftPeer ? '(OK)' : '(MISMATCH)'}`,
  );
  console.log(`  getSendLibrary:    ${sendLib}`);
  console.log(`  getReceiveLibrary: ${recvLib}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
