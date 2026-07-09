import { network, run } from 'hardhat';

/* -------------------------------------------------------------------------- */
/*                                    CONFIG                                  */
/* -------------------------------------------------------------------------- */

// Deployed contract address to verify on Etherscan.
const DEPLOYED_ADDRESS = '0x5B5501129048A2A7856c7778F509F7B0BD83311B';

// Constructor arg the contract was deployed with (the sUSN vault).
const SUSN_ADDRESS = '0xE24a3DC889621612422A64E6388927901608B91D';

/* -------------------------------------------------------------------------- */

const CONTRACT_FQN = 'contracts/SUSNChainlinkAdapter.sol:SUSNChainlinkAdapter';

async function main() {
  console.log(`Network:        ${network.name}`);
  console.log(`Address:        ${DEPLOYED_ADDRESS}`);
  console.log(`sUSN vault arg: ${SUSN_ADDRESS}`);
  console.log(`Contract:       ${CONTRACT_FQN}`);

  try {
    await run('verify:verify', {
      address: DEPLOYED_ADDRESS,
      constructorArguments: [SUSN_ADDRESS],
      contract: CONTRACT_FQN,
    });
    console.log(`Verified ${DEPLOYED_ADDRESS}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('already verified')) {
      console.log(`${DEPLOYED_ADDRESS} already verified`);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
