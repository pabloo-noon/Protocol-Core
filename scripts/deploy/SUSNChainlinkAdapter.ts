import { ethers, network, run } from 'hardhat';

/* -------------------------------------------------------------------------- */
/*                                    CONFIG                                  */
/* -------------------------------------------------------------------------- */

// Address of the sUSN ERC4626 vault. Its `asset()` MUST be USN.
const SUSN_ADDRESS = '0xE24a3DC889621612422A64E6388927901608B91D';

// Seconds to wait before attempting Etherscan verification so the bytecode is indexed.
const VERIFY_DELAY_MS = 30_000;

/* -------------------------------------------------------------------------- */

const CONTRACT_FQN = 'contracts/SUSNChainlinkAdapter.sol:SUSNChainlinkAdapter';

async function verify(address: string, constructorArguments: unknown[]) {
  console.log(`Verifying ${address}...`);
  try {
    await run('verify:verify', { address, constructorArguments });
    console.log(`Verified ${address}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('already verified')) {
      console.log(`${address} already verified`);
      return;
    }
    console.error(`Verification failed for ${address}: ${message}`);
  }
}

async function main() {
  if (!ethers.isAddress(SUSN_ADDRESS) || SUSN_ADDRESS === ethers.ZeroAddress) {
    throw new Error(
      `SUSN_ADDRESS is not set to a valid non-zero address: ${SUSN_ADDRESS}`
    );
  }

  const [deployer] = await ethers.getSigners();

  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`sUSN vault:     ${SUSN_ADDRESS}`);

  const Factory = await ethers.getContractFactory(CONTRACT_FQN);
  const feed = await Factory.deploy(SUSN_ADDRESS);
  await feed.waitForDeployment();
  const address = await feed.getAddress();
  console.log(`SUSNRateFeed:   ${address}`);

  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('Skipping verification on local network.');
    return;
  }

  console.log(
    `Waiting ${VERIFY_DELAY_MS / 1000}s for block explorer to index bytecode...`
  );
  await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));

  await verify(address, [SUSN_ADDRESS]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
