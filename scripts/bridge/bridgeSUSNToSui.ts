import { ethers, network } from 'hardhat';

const SUI_EID = 30378;
const DEFAULT_AMOUNT = '0.0001'; // sUSN
const DEFAULT_LZ_RECEIVE_GAS = 200_000n;

const OFT_ABI = [
  'function token() external view returns (address)',
  'function approvalRequired() external view returns (bool)',
  'function sharedDecimals() external view returns (uint8)',
  'function peers(uint32 eid) external view returns (bytes32)',
  'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (tuple(uint256 nativeFee, uint256 lzTokenFee))',
  'function send(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns (tuple(bytes32 guid, uint64 nonce, tuple(uint256 nativeFee, uint256 lzTokenFee) fee), tuple(uint256 amountSentLD, uint256 amountReceivedLD))',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

function padToBytes32(value: string): string {
  const v = value.toLowerCase().startsWith('0x') ? value.slice(2) : value;
  if (v.length > 64) throw new Error(`Value too long for bytes32: ${value}`);
  return '0x' + v.padStart(64, '0');
}

// LayerZero v2 Type-3 options carrying a single executor lzReceive(gas) option.
// Layout: 0x0003 | 0x01 (executor) | 0x0011 (option payload len = 17) | 0x01 (LZRECEIVE) | gas (uint128, 16 bytes)
function encodeLzReceiveOption(gas: bigint): string {
  if (gas < 0n) throw new Error('gas must be non-negative');
  const gasHex = gas.toString(16).padStart(32, '0');
  return '0x000301001101' + gasHex;
}

async function main() {
  const oappAddress = process.env.OAPP_ADDRESS;
  if (!oappAddress || !ethers.isAddress(oappAddress))
    throw new Error('OAPP_ADDRESS env var required (sUSN OFT proxy on ETH)');

  const suiRecipientRaw = process.env.SUI_RECIPIENT;
  if (!suiRecipientRaw)
    throw new Error(
      'SUI_RECIPIENT env var required (32-byte Sui address, hex)'
    );
  const suiRecipient = padToBytes32(suiRecipientRaw);

  const amountStr = process.env.AMOUNT || DEFAULT_AMOUNT;
  const dstEid = Number(process.env.DST_EID || SUI_EID);
  const lzReceiveGas = BigInt(
    process.env.LZ_RECEIVE_GAS || DEFAULT_LZ_RECEIVE_GAS
  );
  const dryRun = process.env.DRY_RUN === 'true';

  const [signer] = await ethers.getSigners();
  const oft = new ethers.Contract(oappAddress, OFT_ABI, signer);

  const peer = await oft.peers(dstEid);
  if (peer === ethers.ZeroHash)
    throw new Error(
      `OFT peers(${dstEid}) is zero — run oftConfigureSui before bridging`
    );

  const tokenAddress = await oft.token();
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const [tokenDecimals, tokenSymbol, needsApproval] = await Promise.all([
    token.decimals(),
    token.symbol(),
    oft.approvalRequired(),
  ]);

  const amountLD = ethers.parseUnits(amountStr, tokenDecimals);
  const minAmountLD = amountLD; // tight slippage for a tiny test bridge
  const extraOptions = encodeLzReceiveOption(lzReceiveGas);

  const sendParam = {
    dstEid,
    to: suiRecipient,
    amountLD,
    minAmountLD,
    extraOptions,
    composeMsg: '0x',
    oftCmd: '0x',
  };

  console.log(`Network:           ${network.name}`);
  console.log(`Signer:            ${signer.address}`);
  console.log(`OFT proxy:         ${oappAddress}`);
  console.log(`Inner token:       ${tokenAddress} (${tokenSymbol})`);
  console.log(`Approval required: ${needsApproval}`);
  console.log(`Dst EID:           ${dstEid}`);
  console.log(`Peer on dst:       ${peer}`);
  console.log(`Sui recipient:     ${suiRecipient}`);
  console.log(`Amount:            ${amountStr} ${tokenSymbol} (${amountLD} LD)`);
  console.log(`lzReceive gas:     ${lzReceiveGas}`);
  console.log(`extraOptions:      ${extraOptions}`);
  console.log(`Mode:              ${dryRun ? 'DRY_RUN (quote only)' : 'BROADCAST'}`);
  console.log('');

  const balance = await token.balanceOf(signer.address);
  if (balance < amountLD)
    throw new Error(
      `Signer ${tokenSymbol} balance ${balance} < requested ${amountLD}`
    );

  const fee = await oft.quoteSend(sendParam, false);
  console.log(`Quoted native fee: ${ethers.formatEther(fee.nativeFee)} ETH`);
  console.log(`Quoted lzToken fee: ${fee.lzTokenFee}`);

  if (dryRun) {
    console.log('\nDRY_RUN=true — no transactions sent.');
    return;
  }

  if (needsApproval) {
    const currentAllowance = await token.allowance(signer.address, oappAddress);
    if (currentAllowance < amountLD) {
      console.log(`Approving ${tokenSymbol} → OFT...`);
      const approveTx = await token.approve(oappAddress, amountLD);
      console.log(`  tx: ${approveTx.hash}`);
      await approveTx.wait();
    } else {
      console.log(`Allowance already sufficient (${currentAllowance}).`);
    }
  }

  const messagingFee = {
    nativeFee: fee.nativeFee,
    lzTokenFee: fee.lzTokenFee,
  };

  console.log('Sending OFT.send()...');
  const sendTx = await oft.send(sendParam, messagingFee, signer.address, {
    value: messagingFee.nativeFee,
  });
  console.log(`  tx: ${sendTx.hash}`);
  const receipt = await sendTx.wait();
  console.log(`  mined in block ${receipt?.blockNumber}`);
  console.log(
    `\nTrack the message at https://layerzeroscan.com/tx/${sendTx.hash}`
  );
}

main().catch((err) => {
  console.error(err);
  throw err;
});
