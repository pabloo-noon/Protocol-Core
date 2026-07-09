import { ethers, network, run } from 'hardhat';

/* -------------------------------------------------------------------------- */
/*                                    CONFIG                                  */
/* -------------------------------------------------------------------------- */

// Address of the Stork price oracle contract on the target network.
const STORK_ADDRESS = '0x035B5438444f26e6Aab81E91d475b7B1Ac4Fb22b';

// Stork asset/price feed id (bytes32). See the Stork Asset ID Registry.
const PRICE_ID =
  '0x980b98c48b802c650b260cc46c9c516cd3ed0873c66a52acb560c025cb4794f6';

// Decimals of Stork's `quantizedValue` for this specific feed. Varies by asset —
// check the Asset ID Registry; do NOT assume 18.
const FEED_DECIMALS = 18;

// Seconds to wait before attempting Etherscan verification so the bytecode is indexed.
const VERIFY_DELAY_MS = 30_000;

/* -------------------------------------------------------------------------- */

const CONTRACT_FQN =
  'contracts/StorkChainlinkAdapter.sol:StorkChainlinkAdapter';

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
  if (
    !ethers.isAddress(STORK_ADDRESS) ||
    STORK_ADDRESS === ethers.ZeroAddress
  ) {
    throw new Error(
      `STORK_ADDRESS is not set to a valid non-zero address: ${STORK_ADDRESS}`
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(PRICE_ID) || /^0x0+$/.test(PRICE_ID)) {
    throw new Error(
      `PRICE_ID must be a non-zero 32-byte hex string: ${PRICE_ID}`
    );
  }
  if (
    !Number.isInteger(FEED_DECIMALS) ||
    FEED_DECIMALS < 0 ||
    FEED_DECIMALS > 255
  ) {
    throw new Error(`FEED_DECIMALS must be a uint8 (0-255): ${FEED_DECIMALS}`);
  }

  const [deployer] = await ethers.getSigners();

  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`Stork oracle:   ${STORK_ADDRESS}`);
  console.log(`Price ID:       ${PRICE_ID}`);
  console.log(`Feed decimals:  ${FEED_DECIMALS}`);

  const Factory = await ethers.getContractFactory(CONTRACT_FQN);
  const adapter = await Factory.deploy(STORK_ADDRESS, PRICE_ID, FEED_DECIMALS);
  await adapter.waitForDeployment();
  const address = await adapter.getAddress();
  console.log(`StorkAdapter:   ${address}`);

  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('Skipping verification on local network.');
    return;
  }

  console.log(
    `Waiting ${VERIFY_DELAY_MS / 1000}s for block explorer to index bytecode...`
  );
  await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));

  await verify(address, [STORK_ADDRESS, PRICE_ID, FEED_DECIMALS]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
