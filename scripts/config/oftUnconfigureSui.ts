import { ethers, network } from 'hardhat';

const ENDPOINT_V2 = '0x1a44076050125825900e736c501f859c50fE728c';

const ETH_SEND_LIB_302 =
  process.env.ETH_SEND_LIB || '0xbB2Ea70C9E858123480642Cf96acbcCE1372dCe1';
const ETH_RECEIVE_LIB_302 =
  process.env.ETH_RECEIVE_LIB || '0xc02Ab410f0734EFa3F14628780e6e695156024C2';

const SUI_EID = 30378;

const CONFIG_TYPE_EXECUTOR = 1;
const CONFIG_TYPE_ULN = 2;

const ENDPOINT_ABI = [
  'function setConfig(address oapp, address lib, tuple(uint32 eid, uint32 configType, bytes config)[] params) external',
  'function getSendLibrary(address sender, uint32 eid) external view returns (address)',
  'function getReceiveLibrary(address receiver, uint32 eid) external view returns (address, bool)',
];

const OAPP_ABI = [
  'function setPeer(uint32 eid, bytes32 peer) external',
  'function peers(uint32 eid) external view returns (bytes32)',
  'function endpoint() external view returns (address)',
];

function encodeEmptyUlnConfig(): string {
  // Zeros for every field — protocol treats this as "no OApp override, use
  // library default for this path".
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)',
    ],
    [
      {
        confirmations: 0,
        requiredDVNCount: 0,
        optionalDVNCount: 0,
        optionalDVNThreshold: 0,
        requiredDVNs: [],
        optionalDVNs: [],
      },
    ],
  );
}

function encodeEmptyExecutorConfig(): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(uint32 maxMessageSize, address executor)'],
    [{ maxMessageSize: 0, executor: ethers.ZeroAddress }],
  );
}

async function main() {
  const oappAddress = process.env.OAPP_ADDRESS;
  if (!oappAddress || !ethers.isAddress(oappAddress))
    throw new Error('OAPP_ADDRESS env var required (sUSN OFT proxy)');

  const dryRun = process.env.DRY_RUN === 'true';
  // When the OApp owner (multisig) differs from the endpoint delegate (EOA),
  // set SKIP_PEER=true so the delegate can wipe the endpoint config without
  // touching setPeer (which requires the owner).
  const skipPeer = process.env.SKIP_PEER === 'true';

  const [signer] = await ethers.getSigners();

  console.log(`Network:       ${network.name}`);
  console.log(`Signer:        ${signer.address}`);
  console.log(`OApp (sUSN):   ${oappAddress}`);
  console.log(`Endpoint:      ${ENDPOINT_V2}`);
  console.log(`Sui EID:       ${SUI_EID}`);
  console.log(`Send lib:      ${ETH_SEND_LIB_302}`);
  console.log(`Recv lib:      ${ETH_RECEIVE_LIB_302}`);
  console.log(`Mode:          ${dryRun ? 'DRY_RUN (calldata only)' : 'BROADCAST'}`);
  console.log(`Skip setPeer:  ${skipPeer}`);
  console.log('');

  const oapp = new ethers.Contract(oappAddress, OAPP_ABI, signer);
  const endpoint = new ethers.Contract(ENDPOINT_V2, ENDPOINT_ABI, signer);

  const wiredEndpoint = await oapp.endpoint();
  if (wiredEndpoint.toLowerCase() !== ENDPOINT_V2.toLowerCase()) {
    throw new Error(
      `OApp.endpoint() (${wiredEndpoint}) does not match ENDPOINT_V2 (${ENDPOINT_V2})`,
    );
  }

  const emptyUln = encodeEmptyUlnConfig();
  const emptyExec = encodeEmptyExecutorConfig();
  const zeroPeer = ethers.ZeroHash;

  const calls: { label: string; to: string; data: string }[] = [];

  if (!skipPeer) {
    calls.push({
      label: '1. oapp.setPeer(SUI_EID, bytes32(0))  // disables the path',
      to: oappAddress,
      data: oapp.interface.encodeFunctionData('setPeer', [SUI_EID, zeroPeer]),
    });
  }

  calls.push(
    {
      label: '2. endpoint.setConfig(SEND_LIB, ULN reset)  // drop OApp DVN override',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        ETH_SEND_LIB_302,
        [{ eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: emptyUln }],
      ]),
    },
    {
      label: '3. endpoint.setConfig(RECV_LIB, ULN reset)  // drop OApp DVN override',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        ETH_RECEIVE_LIB_302,
        [{ eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: emptyUln }],
      ]),
    },
    {
      label: '4. endpoint.setConfig(SEND_LIB, EXECUTOR reset)  // drop executor override',
      to: ENDPOINT_V2,
      data: endpoint.interface.encodeFunctionData('setConfig', [
        oappAddress,
        ETH_SEND_LIB_302,
        [
          {
            eid: SUI_EID,
            configType: CONFIG_TYPE_EXECUTOR,
            config: emptyExec,
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
    console.log('DRY_RUN=true — no transactions sent. Forward the calldata above to your multisig.');
    return;
  }

  const peer = await oapp.peers(SUI_EID);
  console.log('Post-flight state:');
  const peerNote = peer === zeroPeer
    ? '(cleared)'
    : skipPeer
      ? '(setPeer skipped — clear via owner)'
      : '(STILL SET)';
  console.log(`  peers(${SUI_EID}): ${peer} ${peerNote}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
