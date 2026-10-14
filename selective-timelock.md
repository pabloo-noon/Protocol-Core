# SelectiveTimelock — GenericTimelock with per-signature delays, in front of USN

`contracts/periphery/SelectiveTimelock.sol` is GenericTimelock with one change in the model: the delay is keyed by (target, selector) instead of being global. It becomes the owner of USN.

| delay of (target, selector) | path | who | notes |
|---|---|---|---|
| `x > 0` | `queue(target, value, signature, data, eta)` → `execute(...)` | Safe | `eta >= now + x` at queue time, 14-day grace after the eta |
| `0` | `call(target, value, signature, data)` | Safe | immediate |
| `0` + allow-listed | `guardianCall(target, signature, data)` | guardians | immediate, allow-list only, no value |

`signature` / `data` follow the GenericTimelock convention: a textual signature such as `"setAdmin(address)"` with ABI-encoded arguments, or an empty signature with raw calldata. `hashOperation`, `buildCalldata`, `queued`, `GRACE_PERIOD` and the queue/execute/cancel bodies are unchanged from GenericTimelock.

## USN wiring

| function | delay | why |
|---|---|---|
| `setAdmin(address)` | 24h | the admin is the sole minter |
| `transferOwnership(address)` | 24h | otherwise the Safe could hand USN to a fresh owner and call `setAdmin` in the same block |
| `renounceOwnership()` | 24h | same |
| `pause()`, `blacklistAccount(address)` | 0, guardian | instant for guardians and for the Safe |
| everything else (unpause, unblacklist, whitelist, `setRateLimiter`, peers, enforced options, `setDelegate`, …) | 0 | Safe, instant |

Delays per selector are independent; `transferOwnership` could sit at 48h while `setAdmin` stays at 24h.

## Changing a delay

Same two-step flow as GenericTimelock, per pair, with the pair's **current** delay applied to the change:

```
scheduleDelayChange(target, selector, newDelay)   // eta = now + delay[target][selector]
executeDelayChange(target, selector)              // once the eta is reached
cancelDelayChange(target, selector)
```

- Lowering `setAdmin` from 24h to 0 therefore waits 24h. Raising it also waits 24h.
- A fresh pair has delay 0, so putting a function under a delay for the first time is immediate (schedule then execute in the next block).
- One pending change per pair. An already-queued operation keeps its eta.
- `MAX_DELAY` is 30 days; there is no minimum because 0 means "direct".

## Other invariants

- A pair can never be both delayed and guardian-callable. `setGuardianSelector` refuses a delayed pair, and `guardianCall` re-checks the delay at call time, so delaying an allow-listed pair closes the guardian path as soon as the change executes.
- Guardians and the allow-list are owner-managed and immediate (`setGuardian`, `setGuardianSelector`).
- Timelock ownership rotates with Ownable2Step and is not delayed. A new owner inherits the same map.
- Proxy upgrades are unaffected: USN's ProxyAdmin stays behind the 48h upgrade Timelock.

## Operations

New minter:

```
timelock.queue(USN, 0, "setAdmin(address)", abi(newMinter), eta)     // Safe, eta >= now + 24h
timelock.execute(USN, 0, "setAdmin(address)", abi(newMinter), eta)   // Safe, from eta for 14 days
```

Cancel with `cancel(...)` and the same arguments. `delayFor(target, signature, data)` tells which delay applies to a call.

Emergency:

```
timelock.guardianCall(USN, "pause()", 0x)                     // any guardian, instant
timelock.guardianCall(USN, "blacklistAccount(address)", abi(a)) // any guardian, instant
timelock.call(USN, 0, "unpause()", 0x)                        // Safe, instant
```

Leave the timelock: queue `transferOwnership(newOwner)` with eta ≥ now + its delay, execute from the eta, then `newOwner` calls `USN.acceptOwnership()`.

## Deployment

`scripts/deploy-selective-timelock.ts` deploys with the deployer as initial owner, sets the 24h delays and the guardian allow-list, then offers ownership to the Safe. The Safe finishes with one batch:

1. `timelock.acceptOwnership()`
2. `USN.transferOwnership(timelock)`
3. `timelock.call(USN, 0, "acceptOwnership()", 0x)`

Verify with `env -u HARDHAT_NETWORK npx hardhat verify --network mainnet <timelock> <deployer>`.
