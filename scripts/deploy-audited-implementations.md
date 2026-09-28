# Rollout of the audited implementations (`bridge-rate-limiter-v1`)

What `scripts/deploy-audited-implementations.ts` does, and the manual steps
around it. Scope: every live USN/sUSN proxy except TAC and Sophon
(deprecated routes, left as they are).

## What changes on each chain

| chain    | token | proxy         | new implementation                    | ctor arg                  | notes                                                  |
| -------- | ----- | ------------- | ------------------------------------- | ------------------------- | ------------------------------------------------------ |
| Ethereum | USN   | `0xdA67…c1eD` | `USNUpgradeableHyperlane`             | LZ endpoint `0x1a44…728c` | leaves the hijacked impl `0x961e…608e`                 |
| Ethereum | sUSN  | `0xE24a…B91D` | `StakingVaultOFTUpgradeableHyperlane` | LZ endpoint `0x1a44…728c` |                                                        |
| Base     | sUSN  | `0x34a2…999F` | `remote/StakedUSNHyperlane`           | —                         |                                                        |
| HyperEVM | sUSN  | `0x34a2…999F` | `remote/StakedUSNHyperlane`           | —                         | current build has no `pause()`; gains it               |
| Citrea   | sUSN  | `0xdA67…c1eD` | `remote/StakedUSNHyperlane`           | —                         |                                                        |
| Bera     | sUSN  | `0xdA67…c1eD` | `remote/StakedUSNHyperlane`           | —                         |                                                        |
| zkSync   | USN   | `0x0469…c0B6` | `periphery/USNOFTHyperlane`           | LZ endpoint `0xd07C…DDBF` | zksolc build                                           |
| zkSync   | sUSN  | `0xB6a0…4c4f` | `remote/StakedUSNOFTHyperlane`        | LZ endpoint `0xd07C…DDBF` | current build has no `pause()`; gains it; zksolc build |

Plus one `BridgeRateLimiter` per chain, owned by that chain's token Safe.

All new implementations carry: the shared rate limiter hooks (L-01), the
registered-origin check in `handle()` (L-04), `_disableInitializers()` in the
constructor, and — on the vault — the `redeem()` owner check (L-02). Storage
layout is unchanged except `rateLimiter`, which packs into the slot already
holding `hyperlaneEnabled`; no migration, no initializer call on upgrade.

## Who signs what

On Ethereum, Base, HyperEVM, Citrea and Bera the ProxyAdmin is owned by an
**upgrade Timelock** (`contracts/periphery/Timelock.sol`), itself owned by the
chain's token Safe. Upgrades there are two Safe transactions separated by the
delay: `Timelock.scheduleUpgrade(...)`, wait, `Timelock.executeUpgrade(...)`.
On zkSync the Safe owns the ProxyAdmin directly (one `upgradeAndCall`).

| chain    | ProxyAdmin (USN / sUSN)       | upgrade Timelock (delay) | Safe (owns the Timelock and the token; signs everything) |
| -------- | ----------------------------- | ------------------------ | -------------------------------------------------------- |
| Ethereum | `0x55f3…8239` / `0x1908…BD81` | `0xE5e4…5A7F` (48h)      | `0x1ea1…327f` (3-of-6)                                   |
| Base     | `0xdDC0…98A7`                 | `0xA9BB…5e85` (48h)      | `0xf56d…592D` (3-of-5)                                   |
| HyperEVM | `0xdDC0…98A7`                 | `0x73D5…550d` (24h)      | `0x3D6B…C5b8` (3-of-5)                                   |
| Citrea   | `0x55f3…8239`                 | `0xf6f4…3fac` (48h)      | `0xB2aD…Fc80` (3-of-5)                                   |
| Bera     | `0x55f3…8239`                 | `0xea84…0A02` (48h)      | `0x94E9…3C58` (3-of-5)                                   |
| zkSync   | `0x5a82…6f11` / `0x5130…decc` | — (Safe owns ProxyAdmin) | `0x15d9…a263` (3-of-4)                                   |

`scripts/propose-upgrade.ts` reads all of this from chain state, checks each
upgrade's timelock status, and writes ready-to-import Safe Transaction Builder
batches to `scripts/out/safe/<chain>-1-schedule.json` / `<chain>-2-execute.json`.

## Steps

1. **Dry run** — pre-flight only, nothing sent. Confirms each proxy's shape
   matches the contract chosen for it, reads its LZ endpoint, ProxyAdmin and
   owners, and estimates gas.

   ```
   npx hardhat run scripts/deploy-audited-implementations.ts
   ```

2. **Fund the deployer** (`DEPLOYER_WALLET_PRIVATE_KEY`). Estimates from the
   dry run: Ethereum ≈ 4.5M + 5.3M gas (+ ~0.7M limiter), the four
   StakedUSNHyperlane chains ≈ 2.0–2.1M each (+ limiter).

3. **Deploy** (EVM chains in one run; restrict with `CHAINS=`):

   ```
   BROADCAST=true npx hardhat run scripts/deploy-audited-implementations.ts
   ```

   For each implementation the script then checks on-chain: code size under
   EIP-170, `initialize()` on the bare implementation reverts
   `InvalidInitialization`, `endpoint()` equals the proxy's. Addresses and
   tx hashes are appended to `scripts/out/audited-implementations.json`.

4. **zkSync** separately (needs zksolc artifacts):

   ```
   BROADCAST=true npx hardhat run scripts/deploy-audited-implementations.ts --network zksync
   ```

5. **Verify** on each explorer with the commands the script prints
   (`npx hardhat verify --contract <source>:<name> <impl> [<endpoint>]`).

6. **Before the mainnet upgrades: raise LayerZero `lzReceive` gas.** zkSync
   USN and sUSN enforce 65 000 toward Ethereum; the rate-limited `_credit`
   needs ~74k warm / ~91k cold. From the zkSync Safe, on both OFTs:
   `setEnforcedOptions([{eid: 30101, msgType: 1, options: 0x000301001101000000000000000000000000000249f0}])`
   (= 150 000). Check the front-end `extraOptions` for Ethereum → zkSync too.

7. **Propose the upgrades** — generate the Safe batches:

   ```
   npx hardhat run scripts/propose-upgrade.ts            # all chains with a deployed implementation
   CHAINS=base,bera npx hardhat run scripts/propose-upgrade.ts
   ```

   Timelock chains: import `<chain>-1-schedule.json` in the Safe
   (Apps → Transaction Builder → load batch), sign and execute. It calls
   `Timelock.scheduleUpgrade(proxyAdmin, proxy, newImpl, 0x)`. Re-running the
   script afterwards shows the exact time each upgrade becomes executable.
   zkSync: `zksync-1-schedule.json` is the whole upgrade
   (`ProxyAdmin.upgradeAndCall` + `setRateLimiter`), no waiting.

8. **After the delay — execute and wire the limiter**: import
   `<chain>-2-execute.json`. It calls `Timelock.executeUpgrade(...)` and then
   `token.setRateLimiter(limiter)` in the same batch (the setter only exists
   on the new implementation, so it has to come after the upgrade). Then
   `limiter.setRateLimits(token, [...])` from the same Safe with the limits
   you decide. Until `setRateLimits` is called a wired token is still
   unlimited. See the README section on `BridgeRateLimiter` for the
   semantics and the kill switch.

9. **Post-checks** per proxy: `rateLimiter()` returns the limiter (or zero if
   not wired yet), `paused()` is `false`, balances/`totalSupply` unchanged,
   a `handle()` from an unregistered origin reverts `InvalidRemoteToken`.

## Not covered

- TAC and Sophon proxies (deprecated) keep their current implementations.
- The already-claimed old implementations (Ethereum USN `0x961e…608e`,
  retired zkSync sUSN) cannot be reclaimed; after the upgrade nothing routes
  to them. All other live implementations were initialized to the Safes on
  2026-09-27 (`scripts/claim-open-implementations.ts`).
