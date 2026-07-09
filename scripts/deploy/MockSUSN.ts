import { ethers, network, run } from 'hardhat';

const CONTRACT_FQN = 'contracts/mocks/MockSUSN.sol:MockSUSN';

// LayerZero V2 EndpointV2 — Sepolia. Override via LZ_ENDPOINT for other testnets.
const DEFAULT_LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f';

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
  const lzEndpoint = process.env.LZ_ENDPOINT || DEFAULT_LZ_ENDPOINT;
  if (!ethers.isAddress(lzEndpoint))
    throw new Error(`LZ_ENDPOINT is not a valid address: ${lzEndpoint}`);

  const [deployer] = await ethers.getSigners();
  const delegate = process.env.DELEGATE_ADDRESS || deployer.address;
  if (!ethers.isAddress(delegate))
    throw new Error(`DELEGATE_ADDRESS is not a valid address: ${delegate}`);

  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${deployer.address}`);
  console.log(`LZ endpoint:    ${lzEndpoint}`);
  console.log(`Delegate/owner: ${delegate}`);

  const Factory = await ethers.getContractFactory(CONTRACT_FQN);
  const mock = await Factory.deploy(lzEndpoint, delegate);
  await mock.waitForDeployment();
  const address = await mock.getAddress();
  console.log(`MockSUSN:       ${address}`);

  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('Skipping verification on local network.');
    return;
  }

  console.log('Waiting 30s for block explorer to index bytecode...');
  await new Promise((r) => setTimeout(r, 30_000));

  await verify(address, [lzEndpoint, delegate]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
