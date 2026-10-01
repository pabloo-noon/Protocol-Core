# LayerZero configuration audit — Noon USN / sUSN OApps

Read-only, state as of 2026-10-01. Sources: endpoint/ULN/OApp contracts via RPC on Ethereum, zkSync Era, Sophon, Flare;
Sui via GraphQL (facts from earlier in the session); events via Etherscan v2 / zkSync explorer / Sophon RPC;
message status via LayerZero Scan API; DVN names via metadata.layerzero-api.com. Raw dump: `tmp/lz-audit-data.json`.

Chains / endpoints: Ethereum 30101 `0x1a44…28c` · zkSync 30165 `0xd07C…DDBF` · Sui 30378 `0x31be…6dac` · Sophon 30334 `0x5c6c…4ae7` · Flare 30295 `0x1a44…28c`.

## 1. Per-OApp state (live routes only)

| OApp | owner / delegate | route (eid) | libs | SEND ULN (req) | RECV ULN (req) | conf | executor | enforced SEND | nonces out / in (gap) |
|---|---|---|---|---|---|---|---|---|---|
| ETH USN `0xdA67…c1eD` | Safe `0x1ea1…327f` / same ✓ | zkSync 30165 | explicit ULN302 ✓ | **1: LZ Labs** | 2: LZ Labs, Nethermind | 15/15 | LZ `0x1732…3059`, 10000 | **EMPTY** | 140 / 118 (0) |
| ETH sUSN `0xE24a…B91D` | Safe / same ✓ | zkSync 30165 | explicit ✓ | 3: Horizen, **Frax**, LZ Labs | same 3 | 15/15 | LZ, 10000 | **EMPTY** | 46 / 50 (0) |
| ETH sUSN | | Sui 30378 | explicit ✓ | 3: Horizen, Nansen, LZ Labs | same 3 | 15/15 | LZ, 10000 | **EMPTY** (senders pass 500k) | 34 / 10 (0) |
| zkSync USN `0x0469…c0B6` | Safe `0x15d9…a263` / same ✓ | ETH 30101 | **DEFAULT** ULN302 | 2: LZ Labs, Nethermind | **1: LZ Labs** | 15/15 | LZ `0x664e…D8A6`, 10000 | lzReceive **65k** | 118 / 138 (**139,140 unverified**) |
| zkSync sUSN `0xB6a0…4c4f` | Safe / same ✓ | ETH 30101 | **DEFAULT** ULN302 | 3: Horizen, Frax, LZ Labs | same 3 | 15/15 | LZ, 10000 | lzReceive **65k** | 50 / 46 (0) |
| Sui sUSN OApp `0xe8a2…029f` | admin key `0x67cd…906d` (single ed25519) | ETH 30101 | ULN302 | 3: LZ Labs, Nansen, Horizen (proven by delivered msgs) | same | n/a | LZ Sui | **EMPTY** (senders pass 65k) | in sync (34 in / 10 out) |

Deprecated chains (still live on their side):

| OApp | owner / delegate | route | SEND ULN | RECV ULN | enforced | nonces out / in |
|---|---|---|---|---|---|---|
| Sophon USN `0xC1AA…6d36` | Safe `0x553d…88e0` / same | ETH 30101 (ETH side peer **cleared 2026-08-29**) | 2: LZ Labs, Nethermind | **1: LZ Labs** | 65k | 249 / 111 (**ETH←Sophon nonce 249 stuck; ETH→Sophon nonce 112 stuck**) |
| Sophon USN | | zkSync 30165 (zkSync side peer cleared) | **1: LZ Labs** | **1: LZ Labs** | 65k | 174 / 383 (0) |
| Sophon sUSN `0xb87d…5004` | Safe / same | ETH 30101 (cleared on ETH) | 3: LZ, Nethermind, Horizen | same 3 | 65k | 101 / 43 (0) |
| Sophon sUSN | | zkSync 30165 (cleared on zkSync) | 3 | 3 | 65k | 201 / 22 (0) |
| Flare USN `0x6086…C2Bd` / sUSN `0xF98A…8A41` | deployer EOA `0x1738…D699` / same | all peers 0 (zeroed 2026-10-01) | — | — | — | ETH→Flare USN: 12 sent / 0 delivered (dust) |

Residual ETH-side configs with peer cleared: USN eid 30334 recv [LZ Labs, Nethermind] / send [LZ Labs]; sUSN eid 30334 recv+send [Horizen, LZ Labs, Nethermind]; eid 30295 1-DVN both tokens. Harmless while peers are 0.

Common: all OFTs `oftVersion 0x02e49c2c/1`, decimals 18, sharedDecimals 6, `approvalRequired` false, no msgInspector / preCrime. Executor = LayerZero's default executor on every chain, maxMessageSize 10000. Every delegate equals the owner Safe (Flare: deployer EOA). ETH USN also carries a junk `enforcedOptions(30101 self, SEND)=65k` and both zkSync OFTs carry `enforcedOptions(30165 self)=65k` — unreachable, harmless. zkSync USN/sUSN once had `peers(30165)` (own eid) pointing at the Sophon addresses (2025-01-24); now 0.

LayerZero defaults for reference: ETH↔zkSync default DVN = **LZDeadDVN** both ways (any OApp relying on defaults on this pathway is bricked — ours are explicit ✓); default confirmations ETH send→zkSync 15, ETH recv←zkSync 20, zkSync send→ETH 20, ETH recv←Sui 5, ETH send→Sui 15 (default DVNs Horizen, LZ Labs, Canary, Nethermind). Sophon defaults 20 / LZDeadDVN.

## 2. Findings

### Critical
**C-1. zkSync→ETH and Sui→ETH messages run on 65k lzReceive gas; the queued Ethereum upgrade (Safe nonce 346) makes `_credit` cost 74–91k.**
Evidence: zkSync USN/sUSN `enforcedOptions(30101,1)=0x…fde8` (65 000); Sui OApp enforced_options table empty and LZ Scan shows Sui→ETH nonce 10 sent with `lzReceive gas 65000`; ETH executor txs for those deliveries used ≈64.7k inside lzReceive on the current impl. After 346, every delivery toward Ethereum on both routes OOGs and sits "payload stored" until re-executed with more gas by hand (no fund loss, but all transfers stall).
Closure: zkSync nonce 37 (setEnforcedOptions 120k ×2) ✓ queued; Sui `oapp::set_enforced_options(…, 30101, 1, 0x0003…01d4c0)` by the admin key — being prepared (Fordefi). Both MUST execute before 346. Nothing else closes it.

**C-2. USN ETH→zkSync channel is wedged: inboundNonce 138, Ethereum sent 140, nonces 139/140 have no payload hash.**
Evidence: endpoint reads above; LZ Scan: nonce 139 (tx `0xc9bc0922…3c76`, 50,000 USN from `0x9578…54AF`, 2026-05-08) and 140 (`0xc27bb7d5…9209`, 0.02 USN, 2026-05-11) INFLIGHT, DVN `0x620a9df7` (LZ Labs zkSync) never verified. The sole required DVN refuses to sign alone since the KelpDAO incident, and after nonce 39 changes the receive ULN they can never verify; the endpoint will not execute 141+ while they are missing.
Closure: zkSync nonce 40 (skip 139, skip 140) ✓ queued. Open: the two senders are debited on Ethereum with nothing minted on zkSync — 50,000.00 USN and 0.02 USN to refund off-chain.

### High
**H-1. USN ETH↔zkSync is single-DVN on two legs: ETH send = [LZ Labs] only; zkSync recv = [LZ Labs] only.** Dead leg today (LZ Labs sole-DVN refusal), and a 1-of-1 trust assumption when it did work. sUSN on the same pathway is 3-of-3.
Closure: ETH nonce 348 + zkSync nonce 39 copy sUSN's 3-DVN config (Horizen, Frax, LZ Labs on ETH `0x3802…`, `0x3865…`, `0x589d…`; zkSync `0x1253…`, `0x2Eb8…`, `0x620A…`) to USN send+recv ✓ queued. Note the ETH→zkSync direction stays unusable until 3f (nonce 40) also executes — order inside the zkSync queue (39 then 40) is right.

**H-2. 229.70 USN stuck Sophon→ETH (nonce 249), user funds.** Sophon USN tx `0xa828b174…f270`, 2026-08-26, sender `0x000002c34bAE6DD7BeC72AcbA6aAAC1e01A359De`, burned on Sophon, not minted on ETH. LZ Scan: LZ Labs `0x589dedbd` SUCCEEDED, Nethermind `0xa59ba433` WAITING (ETH USN recv ULN for 30334 still requires both). Three days later (08-29) ETH cleared the Sophon peer, so even a late Nethermind verification cannot execute (lzReceive reverts OnlyPeer).
Recovery options: (a) on-chain: ETH Safe sets USN recv ULN for eid 30334 to required=[LZ Labs] (already attested) → `commitVerification` becomes possible → temporarily `setPeer(30334, Sophon USN)` → execute nonce 249 → clear peer again; 3 Safe calls + one permissionless execute. (b) off-chain refund of 229.70 USN. Not covered by any queued tx.

**H-3. Sophon still holds live supply with no exit: 8,264.58 USN and 146.79 sUSN** (`totalSupply` on `0xC1AA…` / `0xb87d…`). Both ETH and zkSync have already cleared their Sophon peers and the Sophon Hyperlane routes are being dEaD-ed (rate-limit batches); zeroing Sophon-side peers (step 4a) makes the stranding explicit. Holders need a documented redemption path (manual swap/refund) before the DD closes. Not covered by any queued tx.

### Medium
**M-1. Ethereum enforces no executor options toward zkSync (30165) or Sui (30378) on USN or sUSN.** Senders pass their own: ETH→Sui 500k (all 34 sends), ETH→zkSync 65k historically (and zkSync `_credit` after its own upgrade in nonce 37 also grows to ≈74–90k — the front-end must pass ≥120k toward zkSync too). A wallet/integrator calling `send()` with empty options gets `Executor_NoOptions`/OOG. Hardening: `setEnforcedOptions` on ETH USN+sUSN for 30165 (120k) and sUSN for 30378 (match Sui cost, 500k is what the FE uses). Optional but cheap; one Safe batch.

**M-2. DVN sets differ per route** — ETH↔zkSync (both tokens after 348/39): Horizen, Frax, LZ Labs; ETH↔Sui: Horizen, Nansen, LZ Labs; Sophon sUSN: LZ, Nethermind, Horizen. All ≥3 and all non-deprecated per LZ metadata, but "Frax" is a protocol-run DVN rather than an infra operator; consider standardising on one set (e.g. Horizen + Nansen + LZ Labs) when the ULN is next touched. No action required for safety.

**M-3. Sui OApp admin is a single ed25519 key `0x67cd…906d` holding AdminCap + MigrationCap + UpgradeCap** (5 txs, all flag-0x00). It can change peers, DVNs, enforced options, rate limits and upgrade the package unilaterally. Move to a Sui multisig (covered in checklist 5b).

**M-4. Sui↔ETH rate-limit asymmetry**: Sui OFT limiter 1,000,000 sUSN / 8h both directions (set 2026-08-24) vs Ethereum limiter 4,000,000 / 8h (nonce 347) → effective 1M/8h. Decide and align (checklist 5a).

### Low
**L-1. zkSync USN/sUSN and Sophon receive sides rely on the DEFAULT send/receive library** (`isDefaultSendLibrary=true`). The ULN configs themselves are explicit, but a LayerZero default-library change would silently move the OApp onto a new lib with default (dead) DVN config. Pin with `endpoint.setSendLibrary / setReceiveLibrary` to ULN302 (`0x07fD…E12c` / `0x0483…59e1`) from the zkSync Safe. Ethereum already pins.

**L-2. Confirmations 15 on every leg, below LayerZero's 20 default for ETH recv←zkSync and zkSync/Sophon send→ETH.** Fine for finality on these chains in practice; raise to 20 if the DD asks for "default or stricter".

**L-3. ETH→Sophon USN nonce 112 (0.01 USN, team wallet `0x8b93…d90C`, 2026-05-11) stuck**, Sophon LZ Labs DVN WAITING. Negligible value; will be orphaned when Sophon peers are zeroed.

**L-4. Flare OFTs remain owned/delegated by the deployer EOA** `0x1738…D699` with zero peers and zero supply; 12 dust test sends (0.000001 USN each, 2025-01-10) from the deployer are permanently undelivered. Cosmetic; optionally transfer ownership to a Safe or leave as dead.

### Info
- Peer symmetry ✓ on every live route (ETH↔zkSync USN/sUSN, ETH↔Sui sUSN). ETH USN has no Sui peer (route never existed).
- SEND_AND_CALL (msgType 2) enforced options empty everywhere; compose is not used.
- Junk self-eid entries: ETH USN `enforcedOptions(30101)`, zkSync USN/sUSN `enforcedOptions(30165)` = 65k. Unreachable.
- Latest message on each live route: ETH→Sui nonce 34 DELIVERED (2026-09-24), Sui→ETH nonce 10 DELIVERED (2026-09-09); ETH→zkSync USN last DELIVERED is nonce 138 (40,000 USN, 2026-04-14); zkSync→ETH USN 118/118 and sUSN 50/50 in sync; ETH→zkSync sUSN 46/46.
- LayerZero's default DVN for ETH↔zkSync is LZDeadDVN: our explicit configs are what keep the route alive; never `resetConfig` on this pathway.

## 3. Do the queued Safe txs close the gaps?

| gap | queued tx | closes it? |
|---|---|---|
| 65k gas zkSync→ETH | zkSync 37 | yes (120k) |
| 65k gas Sui→ETH | — (Sui admin key, Fordefi) | **not a Safe tx; must land before ETH 346** |
| USN 1-DVN legs | ETH 348 + zkSync 39 | yes |
| USN channel wedged 139/140 | zkSync 40 | yes (skip); refunds open |
| ETH enforced options toward zkSync/Sui | — | **no** (M-1, optional) |
| Sophon→ETH 229.70 USN stuck | — | **no** (H-2) |
| Sophon residual supply 8.4k USN / 147 sUSN | — | **no** (H-3) |
| zkSync default libraries | — | no (L-1) |
| Sui single-key admin / 1M limiter | — | no (M-3, M-4) |

## 4. Recommended additional actions (beyond everything already queued)

1. **Sui `set_enforced_options(30101, SEND, 120k)` before Ethereum 346** — in progress via Fordefi. Verify with `get_enforced_options` and re-check LZ Scan options on the next Sui→ETH message.
2. **Recover or refund the 229.70 USN Sophon→ETH (nonce 249)** — option (a) ETH Safe batch: `setConfig(USN, receiveUln302, [{30334, 2, uln(required=[LZ Labs])}])` + `setPeer(30334, Sophon USN)` → anyone calls `commitVerification` + `lzReceive` → `setPeer(30334, 0)`; or (b) refund `0x000002c3…59De` off-chain. Do this before Sophon-side peers are zeroed if you want the on-chain path.
3. **Refund the 50,000 USN (`0x9578…54AF`) and 0.02 USN (`0x8b93…d90C`)** debited on Ethereum for zkSync nonces 139/140 once nonce 40 executes.
4. **Publish an exit path for Sophon holders** (8,264.58 USN, 146.79 sUSN) before the DD closes — manual redemption from treasury against a Sophon burn, or re-open one guarded route temporarily.
5. **ETH enforced options**: one Safe batch `setEnforcedOptions` on ETH USN+sUSN (30165 → 120k) and ETH sUSN (30378 → 500k) so delivery no longer depends on the front-end's extraOptions.
6. **Pin zkSync libraries** (`setSendLibrary`/`setReceiveLibrary` to ULN302) for USN and sUSN from the zkSync Safe.
7. **Sui admin → multisig** and **Sui limiter → 4M/8h** (or ETH 30378 buckets → 1M) — checklist 5a/5b.
8. **Standardise the DVN set** across ETH↔zkSync and ETH↔Sui at the next ULN change (Frax vs Nansen).
9. Post-execution verification run: re-read `inboundNonce`/`outboundNonce` on every route, send one tiny transfer per direction (ETH↔zkSync USN+sUSN, ETH↔Sui) and confirm DELIVERED on LZ Scan with the new DVN sets and gas.
