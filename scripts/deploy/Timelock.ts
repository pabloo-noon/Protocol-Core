import { ethers, network, run } from 'hardhat';

const CONTRACT_FQN = 'contracts/periphery/Timelock.sol:Timelock';

const MIN_DELAY = 24 * 60 * 60; // 1 day
const MAX_DELAY = 2 * 24 * 60 * 60; // 2 days

async function verify(address: string, constructorArguments: unknown[] = []) {
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
  const owner = process.env.OWNER_ADDRESS;
  if (!owner) throw new Error('OWNER_ADDRESS env var is required');
  if (!ethers.isAddress(owner))
    throw new Error(`OWNER_ADDRESS is not a valid address: ${owner}`);

  const delayRaw = process.env.INITIAL_DELAY || String(MIN_DELAY);
  const initialDelay = Number(delayRaw);
  if (
    !Number.isFinite(initialDelay) ||
    initialDelay < MIN_DELAY ||
    initialDelay > MAX_DELAY
  ) {
    throw new Error(
      `INITIAL_DELAY must be an integer in [${MIN_DELAY}, ${MAX_DELAY}] seconds — got ${delayRaw}`
    );
  }

  const [deployer] = await ethers.getSigners();

  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`Owner:          ${owner}`);
  console.log(`Initial delay:  ${initialDelay}s (${initialDelay / 3600}h)`);

  const Factory = await ethers.getContractFactory(CONTRACT_FQN);
  const timelock = await Factory.deploy(owner, initialDelay);
  await timelock.waitForDeployment();

  const address = await timelock.getAddress();
  console.log(`Timelock:       ${address}`);

  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('Skipping verification on local network.');
    return;
  }

  console.log('Waiting 30s for block explorer to index bytecode...');
  await new Promise((r) => setTimeout(r, 30_000));

  await verify(address, [owner, initialDelay]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
