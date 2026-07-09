import { ethers, network } from 'hardhat';

const MSUSN = process.env.MSUSN || '0xCc2EBDdd298bc8787314c5926f68a464fEEDC480';

const MINT_ABI = [
  'function mint(address to, uint256 amount) external',
  'function owner() external view returns (address)',
  'function balanceOf(address) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

async function main() {
  const to = process.env.MINT_TO;
  const amountStr = process.env.MINT_AMOUNT || '0.001';
  if (!to || !ethers.isAddress(to))
    throw new Error('MINT_TO env var required (EVM address to receive msUSN)');

  const [signer] = await ethers.getSigners();
  const token = new ethers.Contract(MSUSN, MINT_ABI, signer);

  const [owner, dec, beforeBal] = await Promise.all([
    token.owner(),
    token.decimals(),
    token.balanceOf(to),
  ]);

  const amount = ethers.parseUnits(amountStr, dec);

  console.log(`Network: ${network.name}`);
  console.log(`msUSN:   ${MSUSN}`);
  console.log(`Signer:  ${signer.address}`);
  console.log(`Owner:   ${owner}`);
  console.log(`Mint to: ${to}`);
  console.log(`Amount:  ${amountStr} msUSN (${amount})`);
  console.log(`Before:  ${ethers.formatUnits(beforeBal, dec)}`);

  if (owner.toLowerCase() !== signer.address.toLowerCase())
    throw new Error(`Signer ${signer.address} is not owner ${owner}`);

  const tx = await token.mint(to, amount);
  console.log(`tx: ${tx.hash}`);
  await tx.wait();

  const afterBal = await token.balanceOf(to);
  console.log(`After:   ${ethers.formatUnits(afterBal, dec)}`);
}

main().catch((e) => {
  console.error(e);
  throw e;
});
