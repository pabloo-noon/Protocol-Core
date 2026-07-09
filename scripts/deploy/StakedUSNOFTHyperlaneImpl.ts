import { ethers, network, run, upgrades } from 'hardhat';

const CONTRACT_FQN =
  'contracts/StakedUSNOFTHyperlane.sol:StakedUSNOFTHyperlane';

const DEFAULT_LZ_ENDPOINT = '0x1a44076050125825900e736c501f859c50fE728c';

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
  const proxyAddress = process.env.PROXY_ADDRESS;
  if (!proxyAddress) throw new Error('PROXY_ADDRESS env var is required');
  if (!ethers.isAddress(proxyAddress))
    throw new Error(`PROXY_ADDRESS is not a valid address: ${proxyAddress}`);

  const lzEndpoint = process.env.LZ_ENDPOINT || DEFAULT_LZ_ENDPOINT;
  if (!ethers.isAddress(lzEndpoint))
    throw new Error(`LZ_ENDPOINT is not a valid address: ${lzEndpoint}`);

  const [deployer] = await ethers.getSigners();

  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`LZ endpoint:    ${lzEndpoint}`);

  const Factory = await ethers.getContractFactory(CONTRACT_FQN);

  const currentImpl =
    await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`Current impl:   ${currentImpl}`);
  console.log(
    'NOTE: storage-layout vs live proxy is NOT checked here ' +
      '(forceImport cannot pass constructorArgs). Verify layout manually before upgrading.'
  );

  const newImpl = (await upgrades.deployImplementation(Factory, {
    constructorArgs: [lzEndpoint],
    unsafeAllow: ['constructor', 'state-variable-immutable'],
  })) as string;

  console.log(`New impl:       ${newImpl}`);

  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('Skipping verification on local network.');
    return;
  }

  console.log('Waiting 30s for block explorer to index bytecode...');
  await new Promise((r) => setTimeout(r, 30_000));

  await verify(newImpl, [lzEndpoint]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
