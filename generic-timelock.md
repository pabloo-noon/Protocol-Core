# GenericTimelock in front of each BridgeRateLimiter — tracking

Goal: make every change to a BridgeRateLimiter (limits, outbound block/unblock, in-flight reset) go through a
2-day timelock owned by the chain Safe, like the proxy upgrades already do. Contract: `contracts/periphery/GenericTimelock.sol`
(Ownable2Step; owner queues / executes / cancels; `MIN_DELAY` 2 days hard-coded, `GRACE_PERIOD` 14 days; delay changes via
`scheduleDelayChange` → wait current delay → `executeDelayChange`).

> **Decision still open before phase 1 is signed.** Once the timelock owns a limiter, `blockOutbound`, lowering a limit and
> `resetInFlight` on that chain also take the full 2 days. The limiter stops being an emergency control; the Safe can no longer
> cut a route during an incident. Alternative: a limiter revision with the owner behind the timelock and a guardian role on the
> Safe for block / lower / reset (redeploy + one `setRateLimiter` per chain, auditor review).

## Deployments (GenericTimelock(owner = chain Safe, delay = 172 800 s))

| chain | timelock | Safe (owner) | deploy tx | verified |
|---|---|---|---|---|
| Ethereum | `0x36857EF0B10A61A68d58C29eE256990fa9699722` (pre-existing, listed in the docs) | `0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f` | — | [etherscan](https://etherscan.io/address/0x36857EF0B10A61A68d58C29eE256990fa9699722#code) |
| Base | `0xF8241FCca17e8fD91506DaA3f6FF87Fe3eeFbAcB` | `0xf56d33ef52642ce226A566610A979DC8d954592D` | [0x17c5c1ea…ca8a](https://basescan.org/tx/0x17c5c1ea16eb59c0dd2c89ad1ffacdd728a2df912fd73eb2c92bde7c5d46ca8a) | [basescan](https://basescan.org/address/0xF8241FCca17e8fD91506DaA3f6FF87Fe3eeFbAcB#code) |
| HyperEVM | `0xDeFC5bFca15C45fE71339714fFc108518B35B1D3` | `0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8` | [0xf352c858…6cfe](https://hyperevmscan.io/tx/0xf352c858dd027ee4c4e994646b64b00d0c1d6186b05bca56e22e95172f1f6cfe) | [hyperevmscan](https://hyperevmscan.io/address/0xDeFC5bFca15C45fE71339714fFc108518B35B1D3#code) |
| Citrea | `0x69507fece7289E940E440b3e6cFc535c7aF306E9` | `0xB2aD758Ee2710527A28d906F9588938c2e5cFc80` | [0x09b3431a…5d82](https://explorer.mainnet.citrea.xyz/tx/0x09b3431a55d215ecf219177a20d1833118d5a437e62b1f342a1c2f0632745d82) | [citrea explorer](https://explorer.mainnet.citrea.xyz/address/0x69507fece7289E940E440b3e6cFc535c7aF306E9#code) |
| Bera | `0x8B83A9f5d422B062619aC0309Eab6D54566198a5` | `0x94E9f383b085D32973634EA7c9bB2038eF9a3C58` | [0xd2613ef3…b00c](https://berascan.com/tx/0xd2613ef38e6c2b538a77d74bdbd692c2e5a080268fca80383c0ede7b134db00c) | [berascan](https://berascan.com/address/0x8B83A9f5d422B062619aC0309Eab6D54566198a5#code) |
| zkSync | `0x3A3FB0727447E97ec944AE6D167fF7791B8992df` | `0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263` | [0x79cdaaeb…9509](https://explorer.zksync.io/tx/0x79cdaaeb4a3284b189cfdf712ac9f719fb3577923fbe9d6ec517986972ed9509) | [explorer.zksync.io](https://explorer.zksync.io/address/0x3A3FB0727447E97ec944AE6D167fF7791B8992df#contract) (standard-JSON POST, request 111001, successful 2026-10-06) |

Deployed 2026-10-05 (EVM chains) and 2026-10-06 11:01 UTC (zkSync, zksolc 1.5.15; the hardhat-zksync deployment saver crashed on a BigInt AFTER the deploy tx was sent, the contract is live) by `0x173806021b18c4E60170e412DC88F991eB00D699`. Post-deploy read on every chain: owner = Safe, delay 2d, pendingOwner 0.
Explorer verification: the in-script `hardhat verify` call fails when spawned from inside `hardhat run` (inherits
`HARDHAT_NETWORK`); run from a plain shell with `env -u HARDHAT_NETWORK npx hardhat verify --network <net> …` — all four
reported "already verified" on 2026-10-06. Record of record: `scripts/out/generic-timelocks.json`.

## Limiters to be moved under the timelocks

| chain | BridgeRateLimiter | owner today |
|---|---|---|
| Ethereum | `0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F` | Safe |
| Base | `0xEFff8C4260aF5DA5eB26194CB45407f497756db7` | Safe |
| HyperEVM | `0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2` | Safe |
| Citrea | `0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815` | Safe |
| Bera | `0x51A30E647D33A044967FA3DBb04d6ED6F45455F6` | Safe |
| zkSync | `0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E` | Safe |

## Ownership hand-over (two Safe transactions per chain) — `scripts/propose-limiter-timelock.ts`

Phase 1 (one batch): `limiter.transferOwnership(timelock)` + `timelock.queue(limiter, 0, "acceptOwnership()", 0x, eta)`.
`eta = now + delay + 3 days` of signing slack; phase 1 must be executed by the Safe before `eta - 2 days`, otherwise `queue`
reverts `EtaTooSoon` and the batch has to be rebuilt with a new eta.
Phase 2 (after the eta, within 14 days): `timelock.execute(limiter, 0, "acceptOwnership()", 0x, eta)` → limiter owner = timelock.
Both calls are `onlyOwner` on the timelock, so both are Safe transactions. Status per chain:

| chain | phase 1 proposed | phase 1 executed | eta | phase 2 proposed | phase 2 executed |
|---|---|---|---|---|---|
| Ethereum | — | — | — | — | — |
| Base | — | — | — | — | — |
| HyperEVM | — | — | — | — | — |
| Citrea | — | — | — | — | — |
| Bera | — | — | — | — | — |
| zkSync | — | — | — | — | — |

Commands:
```
npx hardhat run scripts/propose-limiter-timelock.ts                   # dry run, writes scripts/out/safe/<chain>-limiter-timelock.json with the eta
PROPOSE=true npx hardhat run scripts/propose-limiter-timelock.ts      # phase 1 on the Safes with a service (ETH, Base, Bera, zkSync, HyperEVM, Citrea)
PHASE=2 PROPOSE=true npx hardhat run scripts/propose-limiter-timelock.ts   # after phase 1 executed; reuses the stored eta
```

## After the hand-over: how limiter changes work

Every `setRateLimits` / `blockOutbound` / `unblockOutbound` / `resetInFlight` becomes: Safe → `timelock.queue(limiter, 0, "<sig>", abi-args, eta)`,
wait ≥ 2 days, Safe → `timelock.execute(...)` within 14 days of the eta. `timelock.cancel(...)` from the Safe drops a queued op.
`scripts/propose-rate-limits.ts` will need a TIMELOCK mode (wrap the `setRateLimits` calls in `queue`, then a second run for `execute`).
