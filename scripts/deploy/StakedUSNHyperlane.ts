import { ethers, network, run, upgrades } from 'hardhat';

const CONTRACT_FQN =
  'contracts/remote/StakedUSNHyperlane.sol:StakedUSNHyperlane';

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

  const name = process.env.SUSN_NAME || 'Staked USN';
  const symbol = process.env.SUSN_SYMBOL || 'sUSN';

  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${(await ethers.getSigners())[0]}`);
  console.log(`Owner:          ${owner}`);
  console.log(`Token name:     ${name}`);
  console.log(`Token symbol:   ${symbol}`);

  const Factory = await ethers.getContractFactory(CONTRACT_FQN);
  const proxy = await upgrades.deployProxy(Factory, [name, symbol, owner], {
    initializer: 'initialize',
    unsafeAllow: ['constructor'],
  });
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress =
    await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Implementation: ${implAddress}`);
  console.log(`Proxy admin:    ${adminAddress}`);

  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('Skipping verification on local network.');
    return;
  }

  console.log('Waiting 30s for block explorer to index bytecode...');
  await new Promise((r) => setTimeout(r, 30_000));

  await verify(implAddress, []);
  await verify(proxyAddress, []);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
