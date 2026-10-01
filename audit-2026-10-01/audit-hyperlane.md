# Hyperlane configuration audit — Noon USN / sUSN (read 2026-10-01, read-only)

Scope: every Hyperlane-enabled Noon token on Ethereum, zkSync Era, Base, HyperEVM, Citrea, Bera, TAC, Sophon and Starknet.
Sources: direct `eth_call` on each chain (token getters, mailbox, ISM tree walk), Starknet `starknet_call` (zan.top), Hyperlane registry (`chains/<chain>/addresses.yaml`), Hyperlane SDK default validator aliases (`typescript/sdk/src/consts/multisigIsm.ts`), Hyperlane explorer Hasura (`explorer4.hasura.app`) for 90 days of messages. Raw state dump: `hl-state.json`, explorer rows: `hl-explorer.json` (same directory).

Severity scale: Critical / High / Medium / Low / Info.

---

## 0. Summary table

| # | Sev | Finding |
|---|-----|---------|
| H-1 | High | TAC and Sophon tokens stay fully armed on their side after our `0x…dEaD` closure: 3,882 USN + 536 sUSN on TAC and 8,265 USN + 147 sUSN on Sophon become unbridgeable; anyone who still bridges *from* them burns locally and the message is rejected at destination. TAC→ETH carried 21 messages in the last 90 days (last 2026-09-08). No pause() on any of the four tokens. |
| H-2 | High | Starknet USN and sUSN warp routers are owned by a single-signer Braavos account `0x25beda…3072` (one Stark key, no secp256r1/webauthn signer). That key can `upgrade(class_hash)`, `enroll/unenroll_remote_router`, `set_hook`. |
| M-1 | Medium | All tokens rely on the mailbox default ISM (custom ISM = 0, and there is no setter). Ethereum accepts mints/unlocks from TAC on **2-of-2**, from zkSync / HyperEVM / Citrea / Starknet on **2-of-3** validator multisigs (1 route-specific validator + 2 shared). The 4M/8h limiter is the only blast-radius control once it is set. |
| M-2 | Medium | HyperEVM sUSN registers Starknet (358974494) as a remote, but the Starknet sUSN router does not enroll HyperEVM. HyperEVM→Starknet sends would burn on HyperEVM and be rejected on Starknet. Same for HyperEVM USN? n/a (no USN on HyperEVM). |
| M-3 | Medium | Sophon→Ethereum / →Base / →HyperEVM is already dead at the ISM level: those three mailboxes' routing ISM has **no module for origin 50104**, so nothing from Sophon can verify there. Two messages *to* Sophon are undelivered (2026-07-14 ETH→Sophon 0.0001 USN, 2026-08-20 zkSync→Sophon 0.001 USN, both from team-looking wallets) — burned at source, never minted. |
| M-4 | Medium | Validator `0xA5962eFA…bf03` sits in almost every ETH/Base/HyperEVM/Citrea/TAC multisig and `0x4f977A59…5a36` (Mitosis) in almost every zkSync/TAC/Sophon one. 9 of the validator addresses in play have no alias in the SDK defaults (listed in §4). Operator concentration across routes. |
| L-1 | Low | `hyperlaneEnabled` is set `true` in the initializer and has no setter; Hyperlane cannot be switched off without pause (where present) or an upgrade. zkSync USN, TAC USN/sUSN, Sophon USN/sUSN have **no pause at all** — their only brake is the limiter (zkSync) or nothing (TAC/Sophon). |
| L-2 | Low | Tokens dispatch with `mailbox.dispatch(dest, recipient, body, hex"0001")` → default hook of each mailbox (IGP/routing hook). Fine, but the IGP quote is paid by `msg.value` from the user; no `hook()` override exposed. Starknet default hook is the protocol-fee hook only. |
| I-1 | Info | Every token's `mailbox` equals the canonical registry mailbox for its chain (9/9 chains). Owner = chain Safe on every EVM token (Sophon/TAC Safes included). |
| I-2 | Info | Remote-token adjacency is symmetric for every live EVM↔EVM pair and for ETH/zkSync/TAC/Sophon↔Starknet. Base has no Starknet route (fine). |
| I-3 | Info | The queued rate-limit batches cover **every** registered Hyperlane route on all six upgraded chains (in + out), and register `0x…dEaD` for TAC/Sophon on ETH, zkSync, Base and HyperEVM. Citrea/Bera only ever had the ETH route. |
| I-4 | Info | No undelivered messages on any live route in the last 90 days (184 messages checked); only the two toward Sophon above. |

---

## 1. Per-token configuration (on-chain, 2026-10-01)

Columns: mailbox canonical? · hyperlaneEnabled · custom ISM · owner = Safe? · remote tokens registered

| chain (domain) | token | mailbox ok | enabled | ISM | owner=Safe | remotes |
|---|---|---|---|---|---|---|
| Ethereum (1) | USN `0xdA67…c1eD` | ✓ `0xc005…D239` | true | 0 (default) | ✓ `0x1ea1…327f` | zkSync, TAC, Sophon, Starknet |
| Ethereum (1) | sUSN `0xE24a…B91D` (vault) | ✓ | true | 0 | ✓ (also DEFAULT_ADMIN) | zkSync, Base, HyperEVM, Citrea, Bera, TAC, Sophon, Starknet |
| zkSync (324) | USN `0x0469…c0B6` | ✓ `0x6bD0…cb6E` | true | 0 | ✓ `0x15d9…a263` | ETH, TAC, Sophon, Starknet |
| zkSync (324) | sUSN `0xB6a0…4c4f` | ✓ | true | 0 | ✓ | ETH, Base, HyperEVM, TAC, Sophon, Starknet |
| Base (8453) | sUSN `0x34a2…999F` | ✓ `0xeA87…4f1D` | true | 0 | ✓ `0xf56d…592D` | ETH, zkSync, HyperEVM, TAC, Sophon |
| HyperEVM (999) | sUSN `0x34a2…999F` | ✓ `0x3a46…775E` | true | 0 | ✓ `0x3D6B…C5b8` | ETH, zkSync, Base, TAC, Sophon, **Starknet** (asymmetric, M-2) |
| Citrea (4114) | sUSN `0xdA67…c1eD` | ✓ `0x3a46…775E` | true | 0 | ✓ `0xB2aD…Fc80` | ETH |
| Bera (80094) | sUSN `0xdA67…c1eD` | ✓ `0x7f50…7B39` | true | 0 | ✓ `0x94E9…3C58` | ETH |
| TAC (239) | USN `0x51A3…55F6` | ✓ `0x3a46…775E` | true | 0 | ✓ `0x868D…4750` | ETH, zkSync, Sophon, Starknet |
| TAC (239) | sUSN `0x5Ced…F81E` | ✓ | true | 0 | ✓ | ETH, zkSync, Base, HyperEVM, Sophon, Starknet |
| Sophon (50104) | USN `0xC1AA…6d36` | ✓ `0x9BbD…0ce7` | true | 0 | ✓ `0x553d…88e0` | ETH, zkSync, TAC, Starknet |
| Sophon (50104) | sUSN `0xb87d…5004` | ✓ | true | 0 | ✓ (owner; no AccessControl) | ETH, zkSync, Base, HyperEVM, TAC, Starknet |
| Starknet (358974494) | USN `0x01e6…135b` | ✓ `0x0552…cea8` | n/a (warp route) | 0 (`interchain_security_module()`=0) | ✗ owner `0x25be…3072` single-key Braavos | ETH, zkSync, TAC, Sophon |
| Starknet (358974494) | sUSN `0x0241…4d17` | ✓ | n/a | 0 | ✗ same owner | ETH, zkSync, TAC, Sophon |

Reverse-mapping check (every registered remote points back to us): **symmetric** for all pairs except HyperEVM→Starknet (M-2). TAC/Sophon↔everyone is symmetric today and will be broken on purpose by the `0x…dEaD` batches (H-1).

`hook()`: not exposed by any token; dispatch uses the mailbox default hook with `StandardHookMetadata` variant 1 (empty) — i.e. the IGP. Default hooks: ETH `0x571f…7cB7`, zkSync `0xe4e9…F500`, Base `0x4Eb8…C9f2`, HyperEVM `0x5cD6…8cA1`, Citrea `0xf50e…1b2d`, Bera `0x7937…0ad9`, TAC `0x23cc…6D8e`, Sophon `0xc364…FC56`, Starknet `0x3de4…8869` (protocol-fee hook). Required hooks = merkle tree hooks per registry.

---

## 2. What verifies an inbound message (mailbox default ISM, walked per origin)

EVM pattern everywhere except zkSync/Sophon: `Aggregation 2-of-2 [ NULL , Routing(origin) → Aggregation 1-of-2 [ MessageIdMultisig , MerkleRootMultisig ] ]` — i.e. effectively **one multisig (same validator set for both leaves) per origin**. zkSync and Sophon mailboxes: `Routing(origin) → MessageIdMultisig`.

Thresholds that gate **minting/unlocking on the destination**:

| destination | origin | threshold | validators (alias from SDK; `?` = no alias) |
|---|---|---|---|
| **Ethereum** (sUSN vault unlock / USN mint) | TAC | **2-of-2** | Mitosis, `0xA596…bf03`? |
| | zkSync | 2-of-3 | Mitosis, `0xA596…bf03`?, Merkly |
| | HyperEVM | 2-of-3 | Luganodes, Mitosis, `0xA596…bf03`? |
| | Citrea | 2-of-3 | Mitosis, `0xA596…bf03`?, Citrea |
| | Base | 3-of-5 | Enigma, Zee Prime, `0xA596…bf03`?, Substance Labs, Luganodes |
| | Bera | 3-of-4 | Mitosis, `0xA596…bf03`?, Renzo, Merkly |
| | Starknet | 2-of-3 | Zee Prime, `0xA596…bf03`?, Staked |
| | Sophon | **no route** → unverifiable (M-3) |
| **zkSync** | Ethereum | 6-of-9 | `0x03c8…9541`?, DSRV, Zee Prime, Staked, AVS: Luganodes, `0x3786…9276`?, Mitosis, Substance Labs, Enigma |
| | TAC | 2-of-2 | `0x6065…DC36`?, Mitosis |
| | HyperEVM | 3-of-4 | `0x01BE…c26F`?, Merkly, Mitosis, Luganodes |
| | Base | 3-of-5 | `0xB945…3aF9`?, Zee Prime, Substance Labs, Luganodes, Enigma |
| | Sophon | 2-of-3 | `0xB84c…d10B`?, Merkly, Mitosis |
| | Starknet | 2-of-3 | `0x6120…489F`?, Zee Prime, Staked |
| **Base / HyperEVM / Citrea** | Ethereum | 6-of-9 | Substance Labs, Enigma, Mitosis, Zee Prime, DSRV, `0xA596…bf03`?, Staked, AVS: Luganodes, Citrea |
| **Bera / TAC** | Ethereum | 6-of-10 | same 9 + `0x03c8…9541`?/`0x3786…9276`? |
| Base/HyperEVM | TAC | 2-of-2 | Mitosis, `0xA596…bf03`? |
| Base/HyperEVM | zkSync | 2-of-3 | Mitosis, `0xA596…bf03`?, Merkly |
| Base/HyperEVM | Sophon | **no route** (M-3) |
| **Sophon** | Ethereum | 6-of-9 | as zkSync |
| **Starknet** | all | Aggregation, threshold 2 (`module_type` 2, `get_threshold` 2); leaf multisigs not readable via public RPC |

Reading: inbound to **Ethereum** — where the real value sits (sUSN vault unlocks, USN mints) — is secured by 2 signatures on the TAC, zkSync, HyperEVM, Citrea and Starknet routes. Inbound to the L2s from Ethereum is 6-of-9/10. This is Hyperlane's published default and is not Noon-specific, but the DD should state it explicitly together with the limiter cap (4M per route per 8h after Safe nonce 347) that bounds a validator compromise.

---

## 3. Traffic and stuck messages (explorer, last 90 days, 184 unique messages)

| route | msgs | last | undelivered |
|---|---|---|---|
| ETH→Base 33 · ETH→zkSync 26 · ETH→Citrea 17 · ETH→TAC 16 · ETH→Bera 9 · ETH→Starknet 9 · ETH→HyperEVM 4 | | 2026-09-29 (Base) | 0 |
| Starknet→ETH 21 · TAC→ETH 21 · Base→ETH 7 · Citrea→ETH 7 · Bera→ETH 4 · HyperEVM→ETH 2 | | 2026-09-28 (Starknet) | 0 |
| zkSync→HyperEVM 2 · zkSync→Starknet 2 · HyperEVM→zkSync 1 · TAC→HyperEVM 1 | | | 0 |
| ETH→Sophon 1 (2026-07-14, 0.0001 USN, tx `0x90d22705…7e0e`, from `0x8b93…d90C`) | | | **1** |
| zkSync→Sophon 1 (2026-08-20, 0.001 USN, tx `0xd6c33e30…8678`, from `0x91d2…2be1`) | | | **1** |

Note: zkSync↔ETH USN/sUSN Hyperlane traffic is ETH→zkSync only in this window (26 msgs); nothing zkSync→ETH over Hyperlane in 90 days. TAC is still an actively used route (37 msgs) — relevant to H-1.

---

## 4. Findings in detail

### H-1 (High) — Closing TAC/Sophon only at our end strands the supply on TAC/Sophon and burns anything still sent from there
Evidence: TAC USN `totalSupply` 3,882.06, TAC sUSN 536.40, Sophon USN 8,264.58, Sophon sUSN 146.79 (read 2026-10-01). All four tokens: `hyperlaneEnabled=true` (no setter), `paused()` not implemented, remoteTokens still point at ETH/zkSync/Base/HyperEVM/Starknet. Queued batches (ETH 347, zkSync 38, Base 6, HyperEVM 5) set our side to `0x…dEaD` + 1-wei limits, so after they execute: TAC/Sophon→us messages are rejected by `InvalidRemoteToken` (post-upgrade) / limiter (1 wei) — tokens are burned on TAC/Sophon at dispatch and never minted. TAC→ETH saw 21 messages in the last 90 days.
Also: TAC/Sophon → **Starknet** stays fully open on both ends (Starknet routers still enroll TAC and Sophon), so TAC/Sophon supply can still exit to Starknet, and from Starknet onward to Ethereum — the closure is porous unless Starknet unenrolls 239 and 50104 too.
Recommendation: (a) announce + block in the front-end before the batches execute; (b) decide the make-whole path for the ~4.4k USN + ~0.7k sUSN on TAC and ~8.4k USN + ~0.15k sUSN on Sophon (snapshot + mint on ETH, or keep one exit open for a grace period); (c) on Starknet, `unenroll_remote_router(239)` and `(50104)` on both routers (owner `0x25be…3072`), or accept Starknet as the sanctioned exit; (d) on TAC/Sophon, point every remoteTokens entry at `0x…dEaD` too so the UI/SDK quote path reveals the dead route — it does **not** prevent the burn, so (a) is the real control.

### H-2 (High) — Starknet routers controlled by one key
Evidence: `owner()` of both Starknet routers = `0x25beda2df6bff2e5328d8dc873dd91c0c5ed3fac4ba9f295c022ea3217c3072`; class `0x3957f9f5…bf8a` is a Braavos account (`get_version` = 001.002.000); `get_signers()` returns one Stark signer `0x3815…f0b` and empty secp256r1/webauthn slots → single key. The router ABI exposes `upgrade(ClassHash)`, `enroll_remote_router`, `unenroll_remote_router`, `set_hook`, `set_destination_gas`, `transfer_ownership`. A compromised key can re-point `routers(1)` to an attacker contract on Ethereum… no — routers on Starknet only govern which *Ethereum sender* Starknet accepts and where Starknet sends; but `upgrade()` lets the key replace the whole token logic (unlimited mint on Starknet, then bridge to ETH up to the limiter cap).
Recommendation: move ownership to a Braavos/Argent multisig (or the Starknet Safe equivalent) with ≥2-of-3; until then, keep the ETH-side Starknet buckets conservative (the 4M/8h in the ETH batch is the cap on what a Starknet compromise can pull out per 8h).

### M-1 (Medium) — Default ISM, no custom ISM, no setter
Evidence: `interchainSecurityModule()` returns `_interchainSecurityModule`, which is 0 on every token and has no setter in any contract (`grep setInterchainSecurityModule` → none). Reaction to a validator-set compromise is therefore limited to pause (not on zkSync USN / TAC / Sophon) and the limiter.
Recommendation: DD wording: "security = Hyperlane default ISM per origin (table §2) + 4M/8h per-route limiter + pause". Consider a future upgrade adding `setInterchainSecurityModule(address)` (onlyOwner) so Noon can pin a stricter aggregation ISM (e.g. default + Noon-run validator) without redeploying.

### M-2 (Medium) — HyperEVM sUSN → Starknet asymmetric
Evidence: HyperEVM sUSN `remoteTokens(358974494)` = Starknet sUSN, but Starknet sUSN `domains()` = {1, 324, 239, 50104}; `routers(999)` not enrolled. A HyperEVM→Starknet send burns on HyperEVM and the Starknet mailbox has no enrolled router for origin 999 → undeliverable.
Recommendation: either `enroll_remote_router(999, HyperEVM sUSN)` on Starknet (and add the HyperEVM↔Starknet bucket to the limiter config), or set HyperEVM `remoteTokens(358974494)=0x…dEaD` (add to `DEAD_ROUTES`) so the route is explicitly closed. No traffic on that route in 90 days.

### M-3 (Medium) — Sophon→ETH/Base/HyperEVM already unverifiable; two undelivered messages toward Sophon
Evidence: Ethereum, Base and HyperEVM mailbox routing ISMs return no module for origin 50104; zkSync and TAC mailboxes do (2-of-3). Undelivered: ETH→Sophon 0.0001 USN (2026-07-14) and zkSync→Sophon 0.001 USN (2026-08-20) — dust from internal wallets, but they are burned on origin and will never mint. Nothing to do beyond noting them in the make-whole list.

### M-4 (Medium) — Validator concentration / unaliased validators
`0xA5962eFA3ec138Bf7CA8f7fDe86b7ee32E24bf03` is in the Ethereum-destination set for TAC, zkSync, HyperEVM, Citrea, Base, Bera and Starknet, and in Base/HyperEVM/Citrea/TAC sets — it carries one of the two required signatures on most 2-of-N routes into Ethereum. Not aliased in the SDK (likely Hyperlane/Abacus Works' own validator). Other unaliased: `0x03c842db…9541`, `0x3786083C…9276` (ETH-origin sets), `0x606561d6…DC36` (TAC-origin on zkSync/Sophon), `0x01BE14A9…c26F` (HyperEVM-origin on zkSync/Sophon/TAC), `0xB9453D67…3aF9` (Base-origin on zkSync/Sophon/TAC), `0xB84c5D02…d10B` (Sophon-origin), `0x61204C98…489F` (Starknet-origin), `0xaDd1D39c…5d1A` (zkSync-origin on TAC/Sophon).
Recommendation: ask Hyperlane for the operator list behind the unaliased addresses for the DD annex; this is informational unless Noon wants to pin its own ISM (M-1).

### L-1 (Low) — No off-switch for Hyperlane; no pause on five tokens
`hyperlaneEnabled` set only in `initialize`; no `pause()` on zkSync USN (USNOFTHyperlane), TAC USN/sUSN, Sophon USN/sUSN (deployed impls predate Pausable). Post-upgrade the zkSync USN brake is `setRateLimits(…, 1 wei)` from the zkSync Safe. TAC/Sophon have no brake and will not be upgraded.

### L-2 (Low) — Hook path
Dispatch always uses the mailbox default hook; fee quoted via `quoteDispatch` and paid from `msg.value`. If a chain's default hook changes (Hyperlane governance), quotes change silently. Informational.

### I-1..I-4 — positive confirmations
- Mailboxes match the registry on all 9 chains.
- Owners are the chain Safes on all EVM tokens; Ethereum sUSN, zkSync, Base, HyperEVM, Citrea, Bera, TAC also have the Safe as DEFAULT_ADMIN (Sophon sUSN is Ownable-only).
- Rate-limit batches vs registered routes: ETH USN {zkSync, TAC, Sophon, Starknet} ✓; ETH sUSN {zkSync, Base, HyperEVM, Citrea, Bera, TAC, Sophon, Starknet} ✓; zkSync USN {ETH, TAC, Sophon, Starknet} ✓; zkSync sUSN {ETH, Base, HyperEVM, TAC, Sophon, Starknet} ✓; Base {ETH, zkSync, HyperEVM, TAC, Sophon} ✓; HyperEVM {ETH, zkSync, Base, TAC, Sophon, Starknet} ✓; Citrea {ETH} ✓; Bera {ETH} ✓. All in+out, 4M/8h live, 1 wei TAC/Sophon, `0x…dEaD` registered on ETH/zkSync/Base/HyperEVM for 239 and 50104.
- No undelivered messages on any live route in 90 days.

---

## 5. Recommended additional actions (beyond the queued Safe txs)

1. **Before executing ETH 347 / zkSync 38 / Base 6 / HyperEVM 5**: publish the TAC + Sophon shutdown, block those routes in the front-end, and decide the make-whole for ~4.4k USN + 0.7k sUSN (TAC) and ~8.4k USN + 0.15k sUSN (Sophon). (H-1)
2. **Starknet**: `unenroll_remote_router(239)` and `unenroll_remote_router(50104)` on both Starknet routers, otherwise TAC/Sophon→Starknet→ETH stays open. (H-1)
3. **Starknet**: move both routers' ownership (`transfer_ownership`) from the single-key Braavos account to a multisig; until then treat the 4M/8h Starknet bucket on Ethereum as the hard cap of a Starknet compromise. (H-2)
4. **HyperEVM**: add Starknet (358974494) to `DEAD_ROUTES` for HyperEVM in `propose-rate-limits.ts` (or enroll HyperEVM on Starknet). Needs a new HyperEVM Safe tx. (M-2)
5. **DD annex**: include the per-origin validator table (§2) with thresholds, and the statement that Noon uses Hyperlane's default ISM with no custom override; list the two dust messages stranded toward Sophon. (M-1, M-3, M-4)
6. **Roadmap**: add `setInterchainSecurityModule(address)` (owner-only) to the Hyperlane receivers in the next upgrade so a stricter aggregation ISM can be pinned without redeploying. (M-1)
7. **Monitoring**: alert on `Dispatch`/`Process` events per route against the limiter buckets, and on any `routers`/`remoteTokens` change (owner tx) on Starknet and the EVM tokens.
8. **Post-execution check** (add to the runbook): for each upgraded chain re-read `remoteTokens(239)` and `remoteTokens(50104)` = `0x…dEaD`, and re-run the §1 matrix to confirm nothing else moved.
