# Ownership / access-control audit — Noon USN/sUSN, all chains
Read-only, chain state as of 2026-10-01. Evidence: direct RPC reads (EIP-1967 slots, owner(), hasRole(), Safe getters), Etherscan v2 / zkSync / Sophon / Blockscout event APIs. "not read" = not fetched in this pass.

Legend: SAFE = that chain's Safe · DEPLOYER = 0x173806021b18c4E60170e412DC88F991eB00D699 · TL = Timelock (contracts/periphery/Timelock.sol, owner-only schedule/execute/cancel, delay bounded 1–2 days by constants, no separate proposer/executor roles).

## 1. Proxy → ProxyAdmin → Timelock → Safe

| chain | proxy | current impl | ProxyAdmin (OZ 5.0.0) | ProxyAdmin.owner | TL delay / owner | Safe |
|---|---|---|---|---|---|---|
| Ethereum | USN 0xdA67…c1eD | 0x961e…608e | 0x55f3…8239 | TL 0xE5e4…5A7F | 48h / SAFE | 0x1ea1…327f |
| Ethereum | sUSN 0xE24a…B91D | 0xEbBc…cd3D | 0x1908…BD81 | TL 0xE5e4…5A7F | 48h / SAFE | 0x1ea1…327f |
| Base | sUSN 0x34a2…999F | 0xdA67…c1eD | 0xdDC0…98A7 | TL 0xA9BB…5e85 | 48h / SAFE | 0xf56d…592D |
| HyperEVM | sUSN 0x34a2…999F | 0xdA67…c1eD | 0xdDC0…98A7 | TL 0x73D5…550d | **24h** / SAFE | 0x3D6B…C5b8 |
| Citrea | sUSN 0xdA67…c1eD | 0x0aDa…91B7 | 0x55f3…8239 | TL 0xf6f4…3fac | 48h / SAFE | 0xB2aD…Fc80 |
| Bera | sUSN 0xdA67…c1eD | 0x0aDa…91B7 | 0x55f3…8239 | TL 0xea84…0A02 | 48h / SAFE | 0x94E9…3C58 |
| zkSync | USN 0x0469…c0B6 | 0xa5b2…bf34 | 0x5a82…6F11 | **SAFE directly (no TL)** | — | 0x15d9…a263 |
| zkSync | sUSN 0xB6a0…4c4f | 0x9F80…e82a | 0x5130…decc | **SAFE directly (no TL)** | — | 0x15d9…a263 |
| TAC | USN 0x51A3…55F6 | 0x01a6…10c2 | 0xF405…2Bbe | **DEPLOYER EOA** | — | 0x868D…4750 |
| TAC | sUSN 0x5Ced…F81E | 0x6D10…88a8 | 0x3684…cFc7 | **DEPLOYER EOA** | — | 0x868D…4750 |
| Sophon | USN 0xC1AA…6d36 | 0xF90d…d957 | 0xaD87…5890 | SAFE directly (no TL) | — | 0x553d…88e0 |
| Sophon | sUSN 0xb87d…5004 | 0xF280…EF80 | 0x90D0…9D5f | **DEPLOYER EOA** | — | 0x553d…88e0 |

Ethereum periphery (not proxies): RedeemHandlerV2 live 0xCee6…4411, RedeemHandlerV2 new 0xAb0c…9197, MinterHandlerV2 live 0xB91b…c058 (= USN.admin, the only address that can mint), MinterHandlerV2 0x6C17…9A0e (unused, admin = DEPLOYER).

All ProxyAdmins are plain Ownable (no 2-step). No Timelock has a pendingOwner. All 6 scheduled upgrade ops (ETH ×2, Base, HyperEVM, Citrea, Bera) are past their delay and still unexecuted (`scheduledAt` non-zero); they stay executable indefinitely until executed or cancelled by the Safe.

## 2. Safes

| chain | Safe | version | threshold | nonce | modules | guard | fallback |
|---|---|---|---|---|---|---|---|
| Ethereum | 0x1ea1…327f | 1.4.1 | 3/6 | 346 | none | none | 0xfd07…Ec99 (CompatibilityFallbackHandler) |
| Base | 0xf56d…592D | 1.4.1 | 3/5 | 5 | none | none | 0xfd07…Ec99 |
| HyperEVM | 0x3D6B…C5b8 | 1.4.1 | 3/5 | 4 | none | none | 0xfd07…Ec99 |
| Citrea | 0xB2aD…Fc80 | 1.4.1 | 3/5 | 4 | none | none | 0xfd07…Ec99 |
| Bera | 0x94E9…3C58 | 1.4.1 | 3/5 | 4 | none | none | 0xfd07…Ec99 |
| zkSync | 0x15d9…a263 | **1.3.0** | 3/4 | 37 | none | none | 0x2f87…492A |
| TAC | 0x868D…4750 | 1.4.1 | 3/6 | 4 | none | none | 0xfd07…Ec99 |
| Sophon | 0x553d…88e0 | 1.4.1 | 3/4 | 41 | none | none | 0x9301…9069 |

Signer overlap (8 Safes):
- 0xe45B…42D0 — 8/8
- 0x09CE…3799 — 8/8
- 0x7b11…be37 — 7/8 (all but Ethereum)
- 0x5eF8…23c3 — 5/8 (ETH, Base, HyperEVM, Citrea, Bera)
- 0x8B36…aD01 — 6/8 (ETH, Base, HyperEVM, Citrea, Bera, TAC)
- 0x0649…2d88 — 3/8 (zkSync, Sophon, TAC)
- 0xe824…6976 — 2/8 (ETH, TAC) · 0x0057…c722 — 1/8 (ETH)

Consequence: the pair {0xe45B…, 0x09CE…} plus any one of {0x7b11…, 0x8B36…} reaches threshold on every Safe except Ethereum; on Ethereum {0xe45B…, 0x09CE…} + one of {0x5eF8…, 0x8B36…}. Three keys compromise the whole multi-chain estate. zkSync and Sophon Safes are 3/4 with 0x0649… as the only non-shared signer.

## 3. Roles per contract (current holders, confirmed with hasRole)

Ethereum
- USN 0xdA67…: Ownable2Step, owner = SAFE, pendingOwner 0. `admin` (sole mint authority) = MinterHandlerV2 0xB91b…c058. paused=false, permissionless=true. No AccessControl.
- sUSN vault 0xE24a…: DEFAULT_ADMIN = SAFE only. BLACKLIST_MANAGER = none. **REBASE_MANAGER = DEPLOYER (EOA), 0xcC24…b11f (delegate EOA), SAFE, MinterHandlerV2 0xB91b…**. paused=false. LZ delegate = SAFE.
- MinterHandlerV2 live 0xB91b…: DEFAULT_ADMIN = SAFE. **MINTER = SAFE + 0x3769…76AE (EOA)**. paused not read.
- RedeemHandlerV2 live 0xCee6… and new 0xAb0c…: DEFAULT_ADMIN = SAFE. **APPROVER = treasury 0xFeD8…f14E (EOA)**; `treasury` = same EOA (holds collateral for redemptions). BURNER_ROLE holders: none found in events. paused=false.
- MinterHandlerV2 0x6C17…9A0e: **DEFAULT_ADMIN = DEPLOYER** (not wired to USN; USN.admin ≠ it, so cannot mint).
- BridgeRateLimiter 0xe8c9…: Ownable2Step, owner = SAFE, pendingOwner 0.

Base / HyperEVM / Citrea / Bera sUSN (StakedUSNHyperlane): owner = SAFE (Ownable2Step, pendingOwner 0). DEFAULT_ADMIN = SAFE, BLACKLIST_MANAGER = SAFE (event trail: 6 events each; deployer granted → Safe granted → deployer renounced — per coordinator, renounce done 2026-09-30 19:27 UTC; hasRole(DEPLOYER)=false confirmed on all four). paused=false (HyperEVM current impl has no paused()). No PAUSER_ROLE exists; pause is DEFAULT_ADMIN. mailbox set, ISM = 0 (default ISM), hyperlaneEnabled=true. Limiters: owner = SAFE, pendingOwner 0 on all.

zkSync: USN 0x0469… and sUSN 0xB6a0…: owner = SAFE, DEFAULT_ADMIN = SAFE (sUSN trail shows the Safe was granted then revoked at block 0x3542ba1 and re-granted — ended with SAFE=true), BLACKLIST_MANAGER = **nobody** (deployer revoked, Safe never granted). LZ delegates = SAFE. Limiter owner = SAFE.

TAC: USN/sUSN owner = SAFE, DEFAULT_ADMIN = SAFE, BLACKLIST_MANAGER = none of {Safe, deployer, delegate EOA, minter EOA}. ProxyAdmin owners = DEPLOYER.

Sophon: USN owner = SAFE, DEFAULT_ADMIN = none of 8 candidates (likely nobody). sUSN owner = SAFE but **DEFAULT_ADMIN = DEPLOYER, BLACKLIST_MANAGER = DEPLOYER** (Safe holds neither). LZ delegates (endpoint 0x5c6c…4ae7) = SAFE. sUSN ProxyAdmin owner = DEPLOYER.

Sui: AdminCap + MigrationCap + UpgradeCap held by single ed25519 key 0x67cd…906d (see context.txt §6; not re-read here).

## 4. Implementations

| chain | contract | init slot | notes |
|---|---|---|---|
| ETH | USN new 0x79FD… / sUSN new 0xeF2e… | disabled (max) | verified |
| ETH | USN old 0x961e… | 1, owner = 0x4E92…E8eB (unverified contract) | hijacked impl, orphaned after upgrade; harmless (proxy storage unaffected) |
| ETH | sUSN old 0xEbBc… | disabled | |
| Base/HyperEVM/Citrea/Bera | new impls | disabled | verified |
| Base/HyperEVM/Citrea/Bera | old impls | 1, owner = SAFE | claimed by us 2026-09-27 |
| zkSync | new USN 0xb00B… / sUSN 0x8B9E… | disabled | verified (zksolc 1.5.15) |
| zkSync | old impls | 1, owner = SAFE | claimed |
| zkSync | abandoned 1.5.7 impls | disabled | unverifiable, unreferenced |
| TAC | 0x01a6… / 0x6D10… | 1 | claimed |
| Sophon | 0xF90d… / 0xF280… | 1 | claimed |
| all | BridgeRateLimiter ×6 (+ abandoned zkSync 0xf560…) | 0 | **not Initializable at all** (constructor-owned Ownable2Step) — "0" is expected, not claimable |

No implementation is claimable.

## 5. Deployer EOA 0x1738…D699

Native: ETH 0.0034 · Base 0.0199 · HyperEVM 2.89 HYPE · Citrea 0.00006 cBTC · Bera 18.0 BERA · zkSync 0.0041 · TAC 39.6 · Sophon 4,597 SOPH. Tokens on Ethereum: 1.18 USN, 8.05 sUSN (dust). Other chains not read.
Privileges still held: ETH sUSN REBASE_MANAGER; ETH MinterHandlerV2 0x6C17… DEFAULT_ADMIN (inert); TAC both ProxyAdmins; Sophon sUSN ProxyAdmin + DEFAULT_ADMIN + BLACKLIST_MANAGER. Citrea balance (0.00006) is too low to send the sUSN renounce or any further tx there.

## 6. Findings

**HIGH**
- H-1 Three-key compromise of the whole estate. 0xe45B…42D0 and 0x09CE…3799 sit on all 8 Safes; with 0x7b11…be37 (7/8) or 0x8B36…aD01 (6/8) they meet threshold everywhere. No Safe guard, no module-based co-signing. Evidence: §2.
- H-2 Ethereum sUSN REBASE_MANAGER held by two EOAs (deployer 0x1738…, delegate 0xcC24…) besides the Safe and minter. Rebase changes the sUSN/USN rate for 29.4M sUSN. Evidence: RoleGranted trail on 0xE24a…, hasRole=true.
- H-3 MinterHandlerV2 MINTER_ROLE on EOA 0x3769…76AE; USN.admin = that handler, so this EOA can mint USN within the handler's rules (collateral checks apply; treasury EOA). Operational hot key — confirm it is an HSM/Fordefi key and has limits.
- H-4 Redemption treasury and sole APPROVER are one EOA 0xFeD8…f14E. Collateral custody and approval both on a single key.
- H-5 zkSync ProxyAdmins owned by the Safe with no timelock: 3/4 signers can swap USN/sUSN implementations instantly (30.5k USN + 904 sUSN there). Known; 5c in checklist.
- H-6 TAC ProxyAdmins (both) and Sophon sUSN ProxyAdmin owned by the deployer EOA: one key upgrades those proxies at will (TAC USN 3,882 / sUSN 536; Sophon sUSN 147). Deprecated routes, but Hyperlane remote tokens remain registered on ETH/zkSync/Base/HyperEVM until nonces 347/38/6/5 execute → a malicious TAC/Sophon impl could still send inbound Hyperlane messages before then.

**MEDIUM**
- M-1 zkSync USN/sUSN BLACKLIST_MANAGER_ROLE held by nobody; Sophon USN DEFAULT_ADMIN likely nobody. Blacklisting on zkSync requires the Safe to grant itself first (it holds DEFAULT_ADMIN, so recoverable).
- M-2 Sophon sUSN: Safe holds no role (DEFAULT_ADMIN + BLACKLIST on deployer). Pause/blacklist impossible from the Safe.
- M-3 HyperEVM timelock delay 24h vs 48h elsewhere.
- M-4 zkSync Safe is 1.3.0 (others 1.4.1); 3/4 with one non-shared signer.
- M-5 All ProxyAdmins are single-step Ownable; Timelock ownership-transfer path exists but ProxyAdmin → new owner is immediate once executed. Fat-finger risk on 5c.
- M-6 Six timelock ops sit "ready" with no expiry; if any phase-2 Safe tx is abandoned, the op stays executable forever unless cancelled.

**LOW**
- L-1 Ethereum old USN impl 0x961e… owned by unknown 0x4E92… (unverified). No effect on proxy; cannot be reclaimed. Document.
- L-2 Unused MinterHandlerV2 0x6C17… admin = deployer. Not wired to USN; renounce or ignore.
- L-3 Deployer dust holdings (1.18 USN, 8.05 sUSN) and low gas on Ethereum/Citrea/zkSync.
- L-4 ISM = 0x0 (Hyperlane default ISM) on every receiver — security inherits the mailbox default; confirm this is intended (default = multisig of Hyperlane validators per origin).

**INFO**
- I-1 Flare peers zeroed; Sui admin single-key (context.txt §6); all BridgeRateLimiters owner = Safe, pendingOwner 0; all new impls `_disableInitializers`; LZ delegates = Safe on ETH/zkSync/Sophon.
- I-2 Base/Bera/Citrea/HyperEVM sUSN: Safe-only admin + blacklist confirmed after the 2026-09-30 renounce.

## 7. Recommended additional actions (on top of queued Safe txs)
1. ETH sUSN: revokeRole(REBASE_MANAGER, deployer) and (REBASE_MANAGER, 0xcC24…b11f) from the Safe; keep Safe + minter only. One Safe tx.
2. Rotate/limit the MINTER EOA 0x3769… and the treasury/APPROVER EOA 0xFeD8…: move to Fordefi/HSM policies or to a 2-of-N; at minimum split APPROVER from treasury.
3. Safe signer diversification: add at least 2 signers unique to Ethereum and to zkSync so that no 3-key set clears every chain; consider a guard or Zodiac delay on Ethereum.
4. TAC + Sophon: transfer the three deployer-owned ProxyAdmins to the chain Safes (deployer EOA tx, then Safe accepts — single-step, so verify the address twice), and grant Sophon sUSN DEFAULT_ADMIN + BLACKLIST to the Safe then renounce. Do this before or at the same time as the dEaD registrations execute.
5. zkSync: grant BLACKLIST_MANAGER_ROLE to the Safe on USN and sUSN (bundle into the timelock-deployment batch, 5c).
6. HyperEVM: setDelay(48h) on TL 0x73D5… once the pending op is executed.
7. Fund the deployer on Citrea (and top up ETH/zkSync) or it cannot run any further ops there.
8. Confirm Hyperlane ISM policy (default ISM vs explicit multisig ISM) and record it in docs.
9. After every phase-2 execution: cancel nothing, but verify `scheduledAt(op)` returns 0; cancel any op that will not be executed.
10. Renounce DEFAULT_ADMIN on the unused MinterHandlerV2 0x6C17… or formally retire it in docs.
