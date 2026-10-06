# GenericTimelock in front of each BridgeRateLimiter — tracking

Goal: make every change to a BridgeRateLimiter (limits, outbound block/unblock, in-flight reset) go through a
2-day timelock owned by the chain Safe, like the proxy upgrades already do. Contract: `contracts/periphery/GenericTimelock.sol`
(Ownable2Step; owner queues / executes / cancels; `MIN_DELAY` 2 days hard-coded, `GRACE_PERIOD` 14 days; delay changes via
`scheduleDelayChange` → wait current delay → `executeDelayChange`).

> **Decision still open before phase 1 is signed.** Once the timelock owns a limiter, `blockOutbound`, lowering a limit and
> `resetInFlight` on that chain also take the full 2 days. The limiter stops being an emergency control; the Safe can no longer
> cut a route during an incident. Alternative: a limiter revision with the owner behind the timelock and a guardian role on the
> Safe for block / lower / reset (redeploy + one `setRateLimiter` per chain, auditor review).

## CURRENT: GenericTimelockV2 — delay 4h, MIN_DELAY 4h, MAX_DELAY 48h (deployed 2026-10-06, all verified)

`contracts/periphery/GenericTimelockV2.sol`: same logic as GenericTimelock, but MIN_DELAY / MAX_DELAY are immutables set in the
constructor (owner, initialDelay, minDelay, maxDelay). 57/57 tests (`test/GenericTimelockV2.test.ts`). Chosen so limiter changes
and emergency actions take 4 hours instead of 2 days. The 2-day GenericTimelock deployments below are superseded and unused.

| chain | GenericTimelockV2 | Safe (owner) | deploy tx | verified |
|---|---|---|---|---|
| Ethereum | `0x398dCDdae394198E6f81d6d8f827CF93b60fB5AE` | `0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f` | [0xfdf0e09b…37b1](https://etherscan.io/tx/0xfdf0e09bebbf2719cbcb59f0f4e8425fc09e461ccdb03cfcb491222707b037b1) | [etherscan.io](https://etherscan.io/address/0x398dCDdae394198E6f81d6d8f827CF93b60fB5AE#code) |
| Base | `0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2` | `0xf56d33ef52642ce226A566610A979DC8d954592D` | [0x3738ee1b…238c](https://basescan.org/tx/0x3738ee1bbf296de4cfd211a6dc9677ff78b4ac5fee76e100b578863762af238c) | [basescan.org](https://basescan.org/address/0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2#code) |
| HyperEVM | `0x60E29F3b7A787A2afFe1D7F61AA6b581D5065eF1` | `0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8` | [0x5ad1e3ad…3fb3](https://hyperevmscan.io/tx/0x5ad1e3ade27fa9c01b70a565f0b242df81b6d6ee09a929e8f0e7bb74805f3fb3) | [hyperevmscan.io](https://hyperevmscan.io/address/0x60E29F3b7A787A2afFe1D7F61AA6b581D5065eF1#code) |
| Citrea | `0x8B83A9f5d422B062619aC0309Eab6D54566198a5` | `0xB2aD758Ee2710527A28d906F9588938c2e5cFc80` | [0x7df3374b…426a](https://explorer.mainnet.citrea.xyz/tx/0x7df3374b9f5e34c1778d28d4d0f029c3e4d5557f8a6e118dd128543b39b9426a) | [explorer.mainnet.citrea.xyz](https://explorer.mainnet.citrea.xyz/address/0x8B83A9f5d422B062619aC0309Eab6D54566198a5#code) |
| Bera | `0x033fa0371A5888d0eBA7D903330Ad709c2c77c36` | `0x94E9f383b085D32973634EA7c9bB2038eF9a3C58` | [0x62533df7…ac3e](https://berascan.com/tx/0x62533df79d8f94243d4b8fe026c2dca618f4beb4818034812945e8644558ac3e) | [berascan.com](https://berascan.com/address/0x033fa0371A5888d0eBA7D903330Ad709c2c77c36#code) |
| zkSync | `0x0948aA7e855f250173A124C4eAAf1a8F540B071D` | `0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263` | [0xca0e23d5…c124](https://explorer.zksync.io/tx/0xca0e23d59bd1a1aed89ef6238ac6c7167c0791006843a75903673d134fa8c124) | [explorer.zksync.io](https://explorer.zksync.io/address/0x0948aA7e855f250173A124C4eAAf1a8F540B071D#code) |

Address coincidences to keep straight: Base's V2 (`0x7704…2Ef2`) is the same address as HyperEVM's BridgeRateLimiter, and Citrea's V2
(`0x8B83…98a5`) is the same address as Bera's superseded 2-day timelock (same deployer, same nonce on different chains).

### Hand-over status (phase 1 re-proposed 2026-10-06 ~12:41 UTC against the V2 timelocks; the 2026-10-06 11:2x proposals against the
2-day timelocks were deleted from the Safe services, HTTP 204, before any signature)

| chain | phase 1 proposed | phase 1 executed | eta (execute phase 1 before eta − 4h) | phase 2 proposed | phase 2 executed |
|---|---|---|---|---|---|
| Ethereum | nonce 349, safeTxHash 0x0a25bc295866d9cc6fa7438271e123de3c8165496509a4a09144b58f0f6ec445 | — | 1791564059 = 2026-10-09 16:40:59 UTC | — | — |
| Base | nonce 7, safeTxHash 0x686ce85cdd37b5f2ef893dc6e8a9302e17a9d46d63251d459a15e0cdb12a91b5 | — | 1791564073 = 2026-10-09 16:41:13 UTC | — | — |
| HyperEVM | nonce 6, safeTxHash 0x31d3cc829fdc2f3d48ce4ae37a6d9dfbc1d938be0bffe0b63a0428950a8a74ac | — | 1791564084 = 2026-10-09 16:41:24 UTC | — | — |
| Citrea | nonce 6, safeTxHash 0x799d8f2e0006fdaeee1c505a29c70d0cefce15e12e20f56d15cb500093d8fd3e | — | 1791564085 = 2026-10-09 16:41:25 UTC | — | — |
| Bera | nonce 6, safeTxHash 0x2e6c5bebec12d140def7b0ee822129d2c7675d325db8b1b26c4022fd1c983c56 | — | 1791564092 = 2026-10-09 16:41:32 UTC | — | — |
| zkSync | nonce 41, safeTxHash 0xde994d4ccf030b5abb7861614c443112eed8ef2c98218590d6f07f58ef0a1717 | — | 1791564096 = 2026-10-09 16:41:36 UTC | — | — |

Safe links: see msg.txt STEP 6.

## SUPERSEDED: 2-day GenericTimelock deployments (unused, left on chain)

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
Both calls are `onlyOwner` on the timelock, so both are Safe transactions. Each chain's eta is fixed at proposal time and stored in
`scripts/out/safe/<chain>-limiter-timelock.json`; re-running the proposer for a chain that is already queued would mint a new eta, so
restrict re-runs with `CHAINS=…`. Status per chain:

| chain | phase 1 proposed | phase 1 executed | eta | phase 2 proposed | phase 2 executed |
|---|---|---|---|---|---|
| Ethereum | nonce 349, safeTxHash 0xed68741d327c247ea7e712681a6006386c4ec03cb07aa0a3e22f9537db3e6a47 (2026-10-06) | — | 1791717959 = 2026-10-11 11:25:59 UTC (phase 1 must execute before 2026-10-09 11:25 UTC) | — | — |
| Base | nonce 7, safeTxHash 0xb29f5743ce650854448d755d604f344b754139c0f29fa0c5dcde0b1952ef3301 (2026-10-06) | — | 1791717971 = 2026-10-11 11:26:11 UTC (phase 1 must execute before 2026-10-09 11:26 UTC) | — | — |
| HyperEVM | nonce 6, safeTxHash 0x9a8c3e60398b8605f1c7e9da725e89f69856a999fc1f446d1f09523bd76f743d (2026-10-06) | — | 1791717985 = 2026-10-11 11:26:25 UTC (phase 1 must execute before 2026-10-09 11:26 UTC) | — | — |
| Citrea | nonce 6, safeTxHash 0xf2dec1816f9d5813cffc8b45bceca9d609f3ad8551f8eadf518d64245547206f (2026-10-06) | — | 1791717581 = 2026-10-11 11:19:41 UTC (phase 1 must execute before 2026-10-09 11:19 UTC) | — | — |
| Bera | nonce 6, safeTxHash 0xe0344c721e75e3cc8061c03cc692330a38905854c7ead883e7bb0ecc0a520ab6 (2026-10-06) | — | 1791717986 = 2026-10-11 11:26:26 UTC (phase 1 must execute before 2026-10-09 11:26 UTC) | — | — |
| zkSync | nonce 41, safeTxHash 0xd2f602495466db4b242e0da0156eb62c746e1042c8aa57e07977a6fa09ab3aa5 (2026-10-06) | — | 1791717981 = 2026-10-11 11:26:21 UTC (phase 1 must execute before 2026-10-09 11:26 UTC) | — | — |

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
