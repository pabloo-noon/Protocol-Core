import { ethers, network } from 'hardhat';

const OAPP = '0xCc2EBDdd298bc8787314c5926f68a464fEEDC480';

const SELECTORS: { sig: string; label: string }[] = [
  { sig: 'asset()', label: 'asset (ERC4626 underlying)' },
  { sig: 'usn()', label: 'usn' },
  { sig: 'usnToken()', label: 'usnToken' },
  { sig: 'underlying()', label: 'underlying' },
  { sig: 'totalAssets()', label: 'totalAssets' },
  { sig: 'totalSupply()', label: 'totalSupply' },
  { sig: 'owner()', label: 'owner' },
  { sig: 'paused()', label: 'paused' },
  { sig: 'name()', label: 'name' },
  { sig: 'symbol()', label: 'symbol' },
  { sig: 'DEFAULT_ADMIN_ROLE()', label: 'DEFAULT_ADMIN_ROLE' },
  { sig: 'MINTER_ROLE()', label: 'MINTER_ROLE' },
  { sig: 'REBASE_MANAGER_ROLE()', label: 'REBASE_MANAGER_ROLE' },
  { sig: 'mint(address,uint256)', label: 'mint(address,uint256)' },
  { sig: 'faucet(uint256)', label: 'faucet(uint256)' },
  { sig: 'faucet()', label: 'faucet()' },
];

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = signer.provider!;
  console.log(`Network: ${network.name}  signer: ${signer.address}`);
  console.log(`Probing ${OAPP}\n`);

  for (const { sig, label } of SELECTORS) {
    const selector = ethers.id(sig).slice(0, 10);
    try {
      const ret = await provider.call({ to: OAPP, data: selector });
      if (ret === '0x') {
        console.log(`  ${label.padEnd(28)}  (no function)`);
        continue;
      }
      console.log(`  ${label.padEnd(28)}  ${ret}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.slice(0, 80) : String(e);
      console.log(`  ${label.padEnd(28)}  reverted: ${msg}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  throw e;
});
