import { ethers, network } from 'hardhat';

const ENDPOINT_V2 = '0x1a44076050125825900e736c501f859c50fE728c';

const ETH_SEND_LIB_302 =
  process.env.ETH_SEND_LIB || '0xbB2Ea70C9E858123480642Cf96acbcCE1372dCe1';
const ETH_RECEIVE_LIB_302 =
  process.env.ETH_RECEIVE_LIB || '0xc02Ab410f0734EFa3F14628780e6e695156024C2';
const ETH_EXECUTOR =
  process.env.ETH_EXECUTOR || '0x173272739Bd7Aa6e4e214714048a9fE699453059';
const DVN_LZ_LABS =
  process.env.DVN_LZ_LABS || '0x589dEDbD617e0CBcB916A9223F4d1300c294236b';
const DVN_NETHERMIND =
  process.env.DVN_NETHERMIND || '0xa59BA433ac34D2927232918Ef5B2eaAfcF130BA5';

const SUI_EID = 30378;

const CONFIG_TYPE_EXECUTOR = 1;
const CONFIG_TYPE_ULN = 2;

const ENDPOINT_ABI = [
  'function setSendLibrary(address oapp, uint32 eid, address newLib) external',
  'function setReceiveLibrary(address oapp, uint32 eid, address newLib, uint256 gracePeriod) external',
  'function setConfig(address oapp, address lib, tuple(uint32 eid, uint32 configType, bytes config)[] params) external',
  'function getSendLibrary(address sender, uint32 eid) external view returns (address)',
  'function getReceiveLibrary(address receiver, uint32 eid) external view returns (address, bool)',
  'function getConfig(address oapp, address lib, uint32 eid, uint32 configType) external view returns (bytes)',
];

const OAPP_ABI = [
  'function setPeer(uint32 eid, bytes32 peer) external',
  'function peers(uint32 eid) external view returns (bytes32)',
  'function owner() external view returns (address)',
  'function endpoint() external view returns (address)',
];

function padToBytes32(value: string): string {
  let v = value.toLowerCase().startsWith('0x') ? value.slice(2) : value;
  if (v.length > 64) throw new Error(`Value too long for bytes32: ${value}`);
  return '0x' + v.padStart(64, '0');
}

function encodeUlnConfig(
  confirmations: number,
  requiredDvns: string[],
  optionalDvns: string[] = [],
  optionalThreshold = 0
): string {
  // Required DVNs must be sorted ascending for LayerZero to accept the config.
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
    ]
  );
}

function encodeExecutorConfig(
  maxMessageSize: number,
  executor: string
): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(uint32 maxMessageSize, address executor)'],
    [{ maxMessageSize, executor }]
  );
}

async function main() {
  const oappAddress = process.env.OAPP_ADDRESS;
  if (!oappAddress || !ethers.isAddress(oappAddress))
    throw new Error('OAPP_ADDRESS env var required (sUSN OFT proxy)');

  const suiOftRaw = process.env.SUI_OFT_PACKAGE;
  if (!suiOftRaw)
    throw new Error(
      'SUI_OFT_PACKAGE env var required (Sui OFT package id, 32-byte hex)'
    );
  const suiOftPeer = padToBytes32(suiOftRaw);

  const confirmations = Number(process.env.CONFIRMATIONS || 5);
  const maxMessageSize = Number(process.env.MAX_MESSAGE_SIZE || 10_000);
  const dryRun = process.env.DRY_RUN === 'true';
  // When the OApp owner (multisig) differs from the endpoint delegate (EOA),
  // set SKIP_PEER=true to run only the delegate-gated calls here and push
  // setPeer through the owner separately.
  const skipPeer = process.env.SKIP_PEER === 'true';

  const [signer] = await ethers.getSigners();

  console.log(`Network:         ${network.name}`);
  console.log(`Signer:          ${signer.address}`);
  console.log(`OApp (sUSN):     ${oappAddress}`);
  console.log(`Endpoint:        ${ENDPOINT_V2}`);
  console.log(`Sui EID:         ${SUI_EID}`);
  console.log(`Sui OFT peer:    ${suiOftPeer}`);
  console.log(`Send lib:        ${ETH_SEND_LIB_302}`);
  console.log(`Recv lib:        ${ETH_RECEIVE_LIB_302}`);
  console.log(`Executor:        ${ETH_EXECUTOR}`);
  console.log(
    `Required DVNs:   ${[DVN_LZ_LABS, DVN_NETHERMIND].sort().join(', ')} (2-of-2)`
  );
  console.log(`Confirmations:   ${confirmations}`);
  console.log(`Max msg size:    ${maxMessageSize}`);
  console.log(
    `Mode:            ${dryRun ? 'DRY_RUN (calldata only)' : 'BROADCAST'}`
  );
  console.log(`Skip setPeer:    ${skipPeer}`);
  console.log('');

  const oapp = new ethers.Contract(oappAddress, OAPP_ABI, signer);
  const endpoint = new ethers.Contract(ENDPOINT_V2, ENDPOINT_ABI, signer);

  // Sanity check: confirm OApp wired to the expected endpoint
  const wiredEndpoint = await oapp.endpoint();
  if (wiredEndpoint.toLowerCase() !== ENDPOINT_V2.toLowerCase()) {
    throw new Error(
      `OApp.endpoint() (${wiredEndpoint}) does not match ENDPOINT_V2 (${ENDPOINT_V2})`
    );
  }

  const ulnConfig = encodeUlnConfig(confirmations, [
    DVN_LZ_LABS,
    DVN_NETHERMIND,
  ]);
  const executorConfig = encodeExecutorConfig(maxMessageSize, ETH_EXECUTOR);

  const calls: { label: string; to: string; data: string }[] = [];

  if (!skipPeer) {
    calls.push({
      label: '1. oapp.setPeer(SUI_EID, suiOftPeer)',
      to: oappAddress,
      data: oapp.interface.encodeFunctionData('setPeer', [SUI_EID, suiOftPeer]),
    });
  }

  calls.push(
    {
      label: '2. endpoint.setSendLibrary(oapp, SUI_EID, SEND_LIB)',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setSendLibrary', [
        oappAddress,
        SUI_EID,
        ETH_SEND_LIB_302,
      ]),
    },
    {
      label: '3. endpoint.setReceiveLibrary(oapp, SUI_EID, RECV_LIB, 0)',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setReceiveLibrary', [
        oappAddress,
        SUI_EID,
        ETH_RECEIVE_LIB_302,
        0,
      ]),
    },
    {
      label: '4. endpoint.setConfig(SEND_LIB, ULN(confs+DVNs))',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        ETH_SEND_LIB_302,
        [{ eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: ulnConfig }],
      ]),
    },
    {
      label: '5. endpoint.setConfig(RECV_LIB, ULN(confs+DVNs))',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        ETH_RECEIVE_LIB_302,
        [{ eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: ulnConfig }],
      ]),
    },
    {
      label: '6. endpoint.setConfig(SEND_LIB, EXECUTOR(maxMsg+executor))',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        ETH_SEND_LIB_302,
        [
          {
            eid: SUI_EID,
            configType: CONFIG_TYPE_EXECUTOR,
            config: executorConfig,
          },
        ],
      ]),
    },
  );

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
      'DRY_RUN=true — no transactions sent. Forward the calldata above to your multisig.'
    );
    return;
  }

  // Post-flight reads
  const peer = await oapp.peers(SUI_EID);
  const sendLib = await endpoint.getSendLibrary(oappAddress, SUI_EID);
  const [recvLib] = await endpoint.getReceiveLibrary(oappAddress, SUI_EID);
  console.log('Post-flight state:');
  console.log(
    `  peers(${SUI_EID}):     ${peer}${skipPeer && peer === ethers.ZeroHash ? ' (setPeer skipped — push through owner)' : ''}`
  );
  console.log(`  getSendLibrary:    ${sendLib}`);
  console.log(`  getReceiveLibrary: ${recvLib}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
