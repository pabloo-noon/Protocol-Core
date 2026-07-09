import { ethers, network } from 'hardhat';

const ENDPOINT_V2 = ethers.getAddress(
  '0x6edce65403992e310a62460808c4b910d972f10f',
);
const SEPOLIA_SEND_LIB_302 = '0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE';
const SEPOLIA_RECEIVE_LIB_302 = '0xdAf00F5eE2158dD58E0d3857851c432E34A3A851';
const SUI_EID = 40378;
const CONFIG_TYPE_ULN = 2;
const CONFIG_TYPE_EXECUTOR = 1;

const ENDPOINT_ABI = [
  'function getConfig(address oapp, address lib, uint32 eid, uint32 configType) external view returns (bytes)',
  'function getSendLibrary(address sender, uint32 eid) external view returns (address)',
  'function getReceiveLibrary(address receiver, uint32 eid) external view returns (address, bool)',
];

const ULN_TUPLE =
  'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)';
const EXEC_TUPLE = 'tuple(uint32 maxMessageSize, address executor)';

async function main() {
  const oapp = process.env.OAPP_ADDRESS;
  if (!oapp || !ethers.isAddress(oapp))
    throw new Error('OAPP_ADDRESS env var required');

  const [signer] = await ethers.getSigners();
  const endpoint = new ethers.Contract(ENDPOINT_V2, ENDPOINT_ABI, signer);
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const sendLib = await endpoint.getSendLibrary(oapp, SUI_EID);
  const [recvLib] = await endpoint.getReceiveLibrary(oapp, SUI_EID);

  console.log(`Network: ${network.name}`);
  console.log(`OApp:    ${oapp}`);
  console.log(`SUI EID: ${SUI_EID}`);
  console.log(`sendLib (actual):   ${sendLib}  expected ${SEPOLIA_SEND_LIB_302}`);
  console.log(`recvLib (actual):   ${recvLib}  expected ${SEPOLIA_RECEIVE_LIB_302}\n`);

  const sendUlnRaw = await endpoint.getConfig(
    oapp,
    SEPOLIA_SEND_LIB_302,
    SUI_EID,
    CONFIG_TYPE_ULN,
  );
  const sendExecRaw = await endpoint.getConfig(
    oapp,
    SEPOLIA_SEND_LIB_302,
    SUI_EID,
    CONFIG_TYPE_EXECUTOR,
  );
  const recvUlnRaw = await endpoint.getConfig(
    oapp,
    SEPOLIA_RECEIVE_LIB_302,
    SUI_EID,
    CONFIG_TYPE_ULN,
  );

  const [sendUln] = coder.decode([ULN_TUPLE], sendUlnRaw);
  const [sendExec] = coder.decode([EXEC_TUPLE], sendExecRaw);
  const [recvUln] = coder.decode([ULN_TUPLE], recvUlnRaw);

  console.log('SEND_LIB ULN:');
  console.log(`  confirmations: ${sendUln.confirmations}`);
  console.log(`  requiredDVNs:  [${sendUln.requiredDVNs.join(', ')}]`);
  console.log(`  optionalDVNs:  [${sendUln.optionalDVNs.join(', ')}]`);

  console.log('SEND_LIB EXECUTOR:');
  console.log(`  maxMessageSize: ${sendExec.maxMessageSize}`);
  console.log(`  executor:       ${sendExec.executor}`);

  console.log('RECV_LIB ULN:');
  console.log(`  confirmations: ${recvUln.confirmations}`);
  console.log(`  requiredDVNs:  [${recvUln.requiredDVNs.join(', ')}]`);
  console.log(`  optionalDVNs:  [${recvUln.optionalDVNs.join(', ')}]`);
}

main().catch((e) => {
  console.error(e);
  throw e;
});
