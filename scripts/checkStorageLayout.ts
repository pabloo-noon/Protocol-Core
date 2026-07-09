import { ethers, upgrades } from 'hardhat';

async function main() {
  const oldFqn = process.env.OLD_FQN;
  const newFqn = process.env.NEW_FQN;
  if (!oldFqn || !newFqn) {
    throw new Error(
      'OLD_FQN and NEW_FQN env vars required. ' +
        'Example: OLD_FQN=contracts/legacy/FooV0.sol:FooV0 NEW_FQN=contracts/Foo.sol:Foo'
    );
  }

  const kind = (process.env.PROXY_KIND || 'transparent') as
    | 'transparent'
    | 'uups'
    | 'beacon';

  console.log(`Reference (old): ${oldFqn}`);
  console.log(`Candidate (new): ${newFqn}`);
  console.log(`Proxy kind:      ${kind}`);

  const NewFactory = await ethers.getContractFactory(newFqn);

  try {
    await upgrades.validateUpgrade(oldFqn, NewFactory, {
      kind,
      unsafeAllow: ['constructor', 'state-variable-immutable'],
    });
    console.log('\n✓ Storage layout is upgrade-safe.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('\n✗ Storage layout is NOT upgrade-safe:\n');
    console.error(message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
