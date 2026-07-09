import { ethers } from 'hardhat';

const OAPP = '0xCc2EBDdd298bc8787314c5926f68a464fEEDC480';
const ERC20_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function totalSupply() external view returns (uint256)',
];
const OFT_ABI = [
  'function token() external view returns (address)',
  'function approvalRequired() external view returns (bool)',
];

async function main() {
  const [signer] = await ethers.getSigners();
  const oft = new ethers.Contract(OAPP, OFT_ABI, signer);

  let innerToken = OAPP;
  let approvalRequired = false;
  try {
    innerToken = await oft.token();
    approvalRequired = await oft.approvalRequired();
  } catch {
    // not an adapter — OFT is the token itself
  }

  const token = new ethers.Contract(innerToken, ERC20_ABI, signer);
  const [bal, dec, sym, supply] = await Promise.all([
    token.balanceOf(signer.address),
    token.decimals().catch(() => 18),
    token.symbol().catch(() => '?'),
    token.totalSupply().catch(() => 0n),
  ]);

  console.log(`Signer:            ${signer.address}`);
  console.log(`OFT proxy:         ${OAPP}`);
  console.log(`approvalRequired:  ${approvalRequired}`);
  console.log(`Inner token:       ${innerToken}`);
  console.log(`Symbol:            ${sym}`);
  console.log(`Decimals:          ${dec}`);
  console.log(`totalSupply:       ${supply} (${ethers.formatUnits(supply, dec)})`);
  console.log(`Signer balance:    ${bal} (${ethers.formatUnits(bal, dec)})`);
}

main().catch((e) => { console.error(e); throw e; });
