import { ethers, network } from 'hardhat';

const OAPP = '0xCc2EBDdd298bc8787314c5926f68a464fEEDC480';

const CANDIDATES = [
  'mint(address,uint256)',
  'mint(uint256)',
  'mint(uint256,address)',
  'mintTo(address,uint256)',
  'faucet(uint256)',
  'faucet()',
  'deposit(uint256,address)',
  'deposit(uint256)',
  'rebase(uint256)',
  'rebase(uint256,uint256)',
  'setOwner(address)',
  'transferOwnership(address)',
];

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = signer.provider!;
  const code = await provider.getCode(OAPP);
  console.log(`Network: ${network.name}  contract: ${OAPP}  bytecode size: ${(code.length - 2) / 2} bytes\n`);
  for (const sig of CANDIDATES) {
    const sel = ethers.id(sig).slice(2, 10);
    const present = code.toLowerCase().includes(sel);
    console.log(`  ${present ? 'YES' : ' no'}  0x${sel}  ${sig}`);
  }
}

main().catch((e) => { console.error(e); throw e; });
