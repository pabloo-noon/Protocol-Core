import { ethers, network } from 'hardhat';

const ENDPOINT_V2 = ethers.getAddress(
  '0x6edce65403992e310a62460808c4b910d972f10f',
);
const SEPOLIA_SEND_LIB_302 = '0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE';
const SEPOLIA_RECEIVE_LIB_302 = '0xdAf00F5eE2158dD58E0d3857851c432E34A3A851';
const DVN_LZ_LABS = '0x8eebf8b423b73bfca51a1db4b7354aa0bfca9193';
const SUI_EID = 40378;
const CONFIG_TYPE_ULN = 2;

const ENDPOINT_ABI = [
  'function setConfig(address oapp, address lib, tuple(uint32 eid, uint32 configType, bytes config)[] params) external',
];

function encodeUlnConfig(confirmations: number, requiredDvns: string[]): string {
  const sorted = [...requiredDvns].map((a) => a.toLowerCase()).sort();
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)',
    ],
    [
      {
        confirmations,
        requiredDVNCount: sorted.length,
        optionalDVNCount: 0,
        optionalDVNThreshold: 0,
        requiredDVNs: sorted,
        optionalDVNs: [],
      },
    ],
  );
}

async function main() {
  const oapp = process.env.OAPP_ADDRESS;
  if (!oapp || !ethers.isAddress(oapp))
    throw new Error('OAPP_ADDRESS env var required');

  // Outbound (Sepolia→Sui) confs must be >= Sui's inbound requirement (15).
  // Inbound (Sui→Sepolia) confs match Sui's outbound (5).
  const sendConfs = Number(process.env.SEND_CONFIRMATIONS || 15);
  const recvConfs = Number(process.env.RECV_CONFIRMATIONS || 5);

  const [signer] = await ethers.getSigners();
  const endpoint = new ethers.Contract(ENDPOINT_V2, ENDPOINT_ABI, signer);

  console.log(`Network:  ${network.name}`);
  console.log(`Signer:   ${signer.address}`);
  console.log(`OApp:     ${oapp}`);
  console.log(`Sui EID:  ${SUI_EID}`);
  console.log(`Send confs (new): ${sendConfs}`);
  console.log(`Recv confs (new): ${recvConfs}\n`);

  const calls = [
    {
      label: `setConfig(SEND_LIB, ULN(confs=${sendConfs}))`,
      lib: SEPOLIA_SEND_LIB_302,
      config: encodeUlnConfig(sendConfs, [DVN_LZ_LABS]),
    },
    {
      label: `setConfig(RECV_LIB, ULN(confs=${recvConfs}))`,
      lib: SEPOLIA_RECEIVE_LIB_302,
      config: encodeUlnConfig(recvConfs, [DVN_LZ_LABS]),
    },
  ];

  for (const c of calls) {
    console.log(`--- ${c.label}`);
    const tx = await endpoint.setConfig(oapp, c.lib, [
      { eid: SUI_EID, configType: CONFIG_TYPE_ULN, config: c.config },
    ]);
    console.log(`    tx: ${tx.hash}`);
    await tx.wait();
  }

  console.log('\nDone. The previously blocked message should re-verify on Sui shortly.');
}

main().catch((e) => {
  console.error(e);
  throw e;
});
