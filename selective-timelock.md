# SelectiveTimelock — GenericTimelock with per-signature delays, in front of USN

`contracts/periphery/SelectiveTimelock.sol` is GenericTimelock with one change in the model: the delay is keyed by (target, selector) instead of being global. It becomes the owner of USN.

| delay of (target, selector) | path | notes |
|---|---|---|
| `x > 0` | `queue(target, value, signature, data, eta)` → `execute(...)` | `eta >= now + x` at queue time, 14-day grace after the eta |
| `0` | `call(target, value, signature, data)` | immediate |

Both paths are owner-only (the Safe). `signature` / `data` follow the GenericTimelock convention: a textual signature such as `"setAdmin(address)"` with ABI-encoded arguments, or an empty signature with raw calldata. `hashOperation`, `buildCalldata`, `queued`, `GRACE_PERIOD` and the queue/execute/cancel bodies are unchanged from GenericTimelock.

## USN wiring

| function | delay | why |
|---|---|---|
| `setAdmin(address)` | 24h | the admin is the sole minter |
| `transferOwnership(address)` | 24h | otherwise the Safe could hand USN to a fresh owner and call `setAdmin` in the same block |
| `renounceOwnership()` | 24h | same |
| everything else (`pause`, `unpause`, `blacklistAccount`, `unblacklistAccount`, whitelist, `setRateLimiter`, peers, enforced options, `setDelegate`, …) | 0 | Safe, instant, through `call` |

Pause and blacklist stay instant because their delay is 0; no separate guardian role is needed, the Safe is the guardian.

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

## Security considerations

The timelock only delays the selectors it is told to. Everything below is covered by tests in `test/SelectiveTimelock.test.ts`.

- **`transferOwnership` and `renounceOwnership` of the target must carry a delay at least as long as the longest delayed selector on that target.** With `transferOwnership` at 0 the Safe can `call` it, accept from the Safe and call `setAdmin` directly, a few seconds later (test "BYPASS: with transferOwnership at delay 0"). With `renounceOwnership` at 0 the Safe can orphan USN at once: no owner, so no `setAdmin`, no `unpause`, ever. The deploy script sets both to 24h. The contract does not enforce this invariant, so keep it in mind whenever a delay is lowered.
- **Lowering any delay waits the current delay of that pair.** Including lowering `transferOwnership` to 0. So the bypass above can only be reached after a 24h public window.
- **The timelock's own ownership (Ownable2Step) is not delayed**, same as GenericTimelock. A new owner inherits the map. `renounceOwnership` on the timelock orphans USN. Treat the Safe's ownership of the timelock as governance, not as something the timelock defends against.
- **The timelock cannot administer itself through `call`.** Its own functions are `onlyOwner`, and a forwarded call has `msg.sender == timelock`, so `call(timelock, scheduleDelayChange(...))` reverts.
- **Selector gating is by selector only.** A function that reaches the same state through another selector is not covered. On USN the admin is set only by `setAdmin`, and the proxy implementation is controlled by the ProxyAdmin behind the 48h upgrade Timelock, which this contract does not touch.
- **Delay changes apply to operations queued afterwards.** A queued operation keeps its eta. Raising a delay therefore does not stretch an operation that was already queued under the old delay.
- **Value**: `call` and `execute` forward exactly `msg.value`; there is no receive or fallback, so no ETH accumulates in the timelock.

## Operations

New minter:

```
timelock.queue(USN, 0, "setAdmin(address)", abi(newMinter), eta)     // Safe, eta >= now + 24h
timelock.execute(USN, 0, "setAdmin(address)", abi(newMinter), eta)   // Safe, from eta for 14 days
```

Cancel with `cancel(...)` and the same arguments. `delayFor(target, signature, data)` tells which delay applies to a call.

Emergency (Safe, instant):

```
timelock.call(USN, 0, "pause()", 0x)
timelock.call(USN, 0, "blacklistAccount(address)", abi(a))
timelock.call(USN, 0, "unpause()", 0x)
```

Leave the timelock: queue `transferOwnership(newOwner)` with eta ≥ now + its delay, execute from the eta, then `newOwner` calls `USN.acceptOwnership()`.

## Deployment

`scripts/deploy-selective-timelock.ts` deploys with the deployer as initial owner, sets the 24h delays, then offers ownership to the Safe. The Safe finishes with one batch:

1. `timelock.acceptOwnership()`
2. `USN.transferOwnership(timelock)`
3. `timelock.call(USN, 0, "acceptOwnership()", 0x)`

Verify with `env -u HARDHAT_NETWORK npx hardhat verify --network mainnet <timelock> <deployer>`.
