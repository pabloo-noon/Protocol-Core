# Addresses — audited bridge-rate-limiter upgrade (September 2026)

Everything deployed, proposed and executed for the rollout of the
`bridge-rate-limiter-v1` branch (Hashlock audit fixes L-01/L-02/L-04,
`_disableInitializers`, shared `BridgeRateLimiter`). Source of truth for the
per-run details is `scripts/out/audited-implementations.json`; the Safe
batches are in `scripts/out/safe/`.

Deployer for every implementation/limiter: `0x173806021b18c4E60170e412DC88F991eB00D699`.

## Ethereum (chainId 1)

| role                                                             | address                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| USN proxy                                                        | `0xdA67B4284609d2d48e5d10cfAc411572727dc1eD`                                                                                 |
| sUSN proxy (StakingVaultOFTUpgradeableHyperlane)                 | `0xE24a3DC889621612422A64E6388927901608B91D`                                                                                 |
| USN ProxyAdmin                                                   | `0x55f39512cb43111A13E8440ee3e3602e72628239`                                                                                 |
| sUSN ProxyAdmin                                                  | `0x1908284b50EE152C9f00c8E65a81fc1C4520BD81`                                                                                 |
| Upgrade Timelock (owns both ProxyAdmins, delay 48h)              | `0xE5e412C212B4FBbF550A94e7BD5e83dB0B315A7F`                                                                                 |
| Safe (owns timelock + tokens + limiter; 3-of-6)                  | `0x1ea169EcCcf7714E7ba04900e1a3357cCA77327f`                                                                                 |
| **BridgeRateLimiter**                                            | [`0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F`](https://etherscan.io/address/0xe8c94FA4FEdFa21B1d0D0Dd78E41bCE9d99d959F#code) |
| **USN new impl** (USNUpgradeableHyperlane)                       | [`0x79FD7FE2a8EbcAE47798321b2AC97107dF3de229`](https://etherscan.io/address/0x79FD7FE2a8EbcAE47798321b2AC97107dF3de229#code) |
| **sUSN new impl** (StakingVaultOFTUpgradeableHyperlane)          | [`0xeF2eA4250B7CE4D0aA9Ca70607ECeF278C6EAB15`](https://etherscan.io/address/0xeF2eA4250B7CE4D0aA9Ca70607ECeF278C6EAB15#code) |
| USN old impl (hijacked by a third party, orphaned after upgrade) | `0x961e78b26F6984A2DDAC42e4CE5B8014A311608e`                                                                                 |
| sUSN old impl                                                    | `0xEbBcbC6672683e1956125e7c5e89E14CeAC8cd3D`                                                                                 |
| LayerZero endpoint                                               | `0x1a44076050125825900e736c501f859c50fE728c`                                                                                 |
| RedeemHandlerV2 (new, mirrors `0xCee6…4411`)                     | [`0xAb0c423975B446e785E21B9b10F3B421c8ED9197`](https://etherscan.io/address/0xAb0c423975B446e785E21B9b10F3B421c8ED9197#code) |

- Phase 1 `scheduleUpgrade` ×2 — Safe nonce 345, tx `0x378af8384b0367504dfdaaea7721f8afa49c95da89e1c67e672af0a951f85761`, executable from **2026-09-30 16:11 UTC**.
- Op ids: USN `0x06cde24532e50f057d3d109c89f2cbb793aba243268c8f446fef37a06b4ed941`, sUSN `0x23d31f502eac6ffcbf206d15b5261842b93951dda9154755dcd9ec76b01019d3`.
- Phase 2 batch: `scripts/out/safe/ethereum-2-execute.json` (`executeUpgrade` ×2 + `setRateLimiter` ×2).

## Base (chainId 8453)

| role                                   | address                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| sUSN proxy                             | `0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F`                                                                                 |
| ProxyAdmin                             | `0xdDC0416e9bB96Dd1408CbAb19b48bd7d7B1498A7`                                                                                 |
| Upgrade Timelock (48h)                 | `0xA9BB96bb79492Aa64199f078362ECd069D565e85`                                                                                 |
| Safe (3-of-5)                          | `0xf56d33ef52642ce226A566610A979DC8d954592D`                                                                                 |
| **BridgeRateLimiter**                  | [`0xEFff8C4260aF5DA5eB26194CB45407f497756db7`](https://basescan.org/address/0xEFff8C4260aF5DA5eB26194CB45407f497756db7#code) |
| **sUSN new impl** (StakedUSNHyperlane) | [`0xa02Ca8C6130B75b320FAa785034E95D4374A8942`](https://basescan.org/address/0xa02Ca8C6130B75b320FAa785034E95D4374A8942#code) |
| sUSN old impl                          | `0xdA67B4284609d2d48e5d10cfAc411572727dc1eD`                                                                                 |

- Phase 1 — Safe nonce 4, tx `0xb67b03e82872cde2451adacaaeb2cdbad98449a5e0ec2c095e4afd24d9f59061`, executable from **2026-09-30 16:18 UTC**. Op id `0x75ef29445d8fda620cd745079106f162bc6b1777362dd8b78761355493cef052`.

## HyperEVM (chainId 999)

| role                                               | address                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| sUSN proxy                                         | `0x34a2798D47b238A7CbA9D87D49618DEE6C4D999F`                                                                                    |
| ProxyAdmin                                         | `0xdDC0416e9bB96Dd1408CbAb19b48bd7d7B1498A7`                                                                                    |
| Upgrade Timelock (**24h**)                         | `0x73D59063212c1A3fD32882d46A84EFb37911550d`                                                                                    |
| Safe (3-of-5)                                      | `0x3D6B578afDfdcd9e74EB0CdbDdCf2435502FC5b8`                                                                                    |
| **BridgeRateLimiter**                              | [`0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2`](https://hyperevmscan.io/address/0x77044C9C050BcFD80d1Ab42AA070bD3f65B32Ef2#code) |
| **sUSN new impl** (StakedUSNHyperlane; adds pause) | [`0xffC95e7E447DC94DcE706B8afda751349E676227`](https://hyperevmscan.io/address/0xffC95e7E447DC94DcE706B8afda751349E676227#code) |
| sUSN old impl (pre-Pausable build)                 | `0xdA67B4284609d2d48e5d10cfAc411572727dc1eD`                                                                                    |

- Phase 1 scheduled via Transaction Builder JSON on app.safe.global (chain `hyper-evm`, service slug `hyper`), executable from **2026-09-29 16:18 UTC**. Op id `0xf5ffefdfacd163d8b41dfe70e2c6f81c8838a5f65c1fa5412f762f02e44fbc48`.

## Citrea (chainId 4114)

| role                                   | address                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| sUSN proxy                             | `0xdA67B4284609d2d48e5d10cfAc411572727dc1eD`                                                                                                |
| ProxyAdmin                             | `0x55f39512cb43111A13E8440ee3e3602e72628239`                                                                                                |
| Upgrade Timelock (48h)                 | `0xf6f40baAFBCbB29855F4D9A29576B812E0B33fac`                                                                                                |
| Safe (3-of-5)                          | `0xB2aD758Ee2710527A28d906F9588938c2e5cFc80`                                                                                                |
| **BridgeRateLimiter**                  | [`0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815`](https://explorer.mainnet.citrea.xyz/address/0xC79A424a9FB6DD94cD54715b97F5D0703CEDE815#code) |
| **sUSN new impl** (StakedUSNHyperlane) | [`0x6D1019bdbe1Da163134Aba821bBfc1cCAEb988a8`](https://explorer.mainnet.citrea.xyz/address/0x6D1019bdbe1Da163134Aba821bBfc1cCAEb988a8#code) |
| sUSN old impl                          | `0x0aDa1cb43aC67FFfA2773B169920bfAB4c6391B7`                                                                                                |

- Phase 1 scheduled via JSON on https://safe.citrea.xyz (chain `citrea-mainnet`, service https://transaction.safe.citrea.xyz), executable from **2026-09-30 16:16 UTC**. Op id `0x0b12851d73d331a8d4d648fdb403217473d1a2d2587d1a82a415b26f503240ef`.

## Bera (chainId 80094)

| role                                   | address                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| sUSN proxy                             | `0xdA67B4284609d2d48e5d10cfAc411572727dc1eD`                                                                                 |
| ProxyAdmin                             | `0x55f39512cb43111A13E8440ee3e3602e72628239`                                                                                 |
| Upgrade Timelock (48h)                 | `0xea84aC70f00f47ad6FBE51233AAE25799B9f0A02`                                                                                 |
| Safe (3-of-5)                          | `0x94E9f383b085D32973634EA7c9bB2038eF9a3C58`                                                                                 |
| **BridgeRateLimiter**                  | [`0x51A30E647D33A044967FA3DBb04d6ED6F45455F6`](https://berascan.com/address/0x51A30E647D33A044967FA3DBb04d6ED6F45455F6#code) |
| **sUSN new impl** (StakedUSNHyperlane) | [`0x657284c8337ab91b1a7d4eb66Be97596f4878117`](https://berascan.com/address/0x657284c8337ab91b1a7d4eb66Be97596f4878117#code) |
| sUSN old impl                          | `0x0aDa1cb43aC67FFfA2773B169920bfAB4c6391B7`                                                                                 |

- Phase 1 — Safe nonce 3, tx `0xff93eb8022ad825defe3b49dfe54628979f7ce5c27934be3228ddc505b3d16a8`, executable from **2026-09-30 16:14 UTC**. Op id `0xbc15adbc1673522a3a1abdc617f2286cc91504834870e72ba0042e157054e13d`.

## zkSync Era (chainId 324)

| role                                                         | address                                                                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| USN proxy (OFT)                                              | `0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6`                                                                                           |
| sUSN proxy (OFT)                                             | `0xB6a09d426861c63722Aa0b333a9cE5d5a9B04c4f`                                                                                           |
| USN ProxyAdmin                                               | `0x5a82384A042cCe41f9aC6F0C110773E5B3266F11`                                                                                           |
| sUSN ProxyAdmin                                              | `0x5130C9cd9e85B4a95F9b44c7Eb8667106e8fdecc`                                                                                           |
| Safe (owns ProxyAdmins directly — no timelock; 3-of-4)       | `0x15d91EB2c3188BB85881D2E09b5025F3Fcc4a263`                                                                                           |
| **BridgeRateLimiter**                                        | [`0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E`](https://explorer.zksync.io/address/0xE69d7C7147B7ED370f28fedEd06FbAB0BD14455E#contract) |
| **USN new impl** (periphery/USNOFTHyperlane; no pause, not Pausable) | [`0xb00B492099323E386dFD1E014850Ca16396E8C22`](https://explorer.zksync.io/address/0xb00B492099323E386dFD1E014850Ca16396E8C22#contract) |
| **sUSN new impl** (remote/StakedUSNOFTHyperlane; adds pause) | [`0x8B9E886B6850615911c61a7cd10c9C6630d1A03d`](https://explorer.zksync.io/address/0x8B9E886B6850615911c61a7cd10c9C6630d1A03d#contract) |
| USN old impl                                                 | `0xa5b228237bEf9bC804D8d6E7c76d0853a406bf34`                                                                                           |
| sUSN old impl                                                | `0x9F80bbe82dBad5D74904c83bD8990c8Ba9dfe82a`                                                                                           |
| LayerZero endpoint                                           | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF`                                                                                           |
| MultiSendCallOnly (Safe batches)                             | `0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F`                                                                                           |

- Built with zksolc **1.5.15** + zkVM-solc 0.8.28-1.0.1 (the explorer only verifies zksolc ≥ 1.5.15). An earlier zksolc-1.5.7 set — limiter `0xf560D46796266f4bDb3ABB65123CAD377B9844EC`, USN `0xa2c4e462B5BA49F2D3c1366E5D4B565E13166488`, sUSN `0x081F52Ee87c6047CDc8e150704b2C858f7120Ca2` — is unverifiable and **abandoned**; nothing references it.
- Upgrade not proposed yet: `PROPOSE=true CHAINS=zksync npx hardhat run scripts/propose-upgrade.ts` (single batch: `upgradeAndCall` ×2 + `setRateLimiter` ×2).
- Enforced `lzReceive` gas toward Ethereum (`enforcedOptions(30101, 1)`) is still **65 000** on both OFTs (`…fde8`); raise to 120k (`…01d4c0`) or 150k (`…0249f0`) before the Ethereum phase 2.

## Not upgraded (deprecated routes)

| chain          | USN proxy                                    | sUSN proxy                                   | Safe                                                  |
| -------------- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| TAC (239)      | `0x51A30E647D33A044967FA3DBb04d6ED6F45455F6` | `0x5Ced7F73B76A555CCB372cc0F0137bEc5665F81E` | `0x868Dd9BCe1d60362f2169E7b91E6aA2f71F64750` (3-of-6) |
| Sophon (50104) | `0xC1AA99c3881B26901aF70738A7C217dc32536d36` | `0xb87dbe27db932bacaaa96478443b6519d52c5004` | `0x553d36879016Ce22977a622804EeE76Dc0dC88e0` (3-of-4) |

Their Hyperlane routes are still registered on ETH/zkSync (to be pointed at
`0x…dEaD`); Sophon still holds LayerZero peers to ETH/zkSync on its side.

## Sui (LayerZero eid 30378, sUSN only — not upgradeable from this repo)

| object | address |
| --- | --- |
| OFT package (ETH-side peer bytes32) | `0xa356ca2010fcdf44d6cecfcecf18b73c32188d361e39dff3a96ac8de0dec7b1b` |
| OFT object (shared, `oft::OFT<…::susn::SUSN>`) | `0xab496ed0068cba592901b15cf0192ad366c2634fae3a75eb9632cfa5bdaf567e` |
| OApp object (shared, peers / enforced options) | `0xe8a26b0ba4f665eb7f1bc1996ed9b93892bc9ed67013321b5b71de1f89b7029f` |
| AdminCap | `0x429cd02c7835a791701a612924b6d6788235a05e5a83de3032ac2dddba8cd662` |
| MigrationCap | `0x5cf78f25c993c7072bbaff72f3981c7114bb221855d04c93d70ccff061e64d0f` |
| Admin (holds AdminCap + MigrationCap + UpgradeCap) | `0x67cddd47a21038c0bf126096615a06d4dc33bb2de1ea991fff8461875321906d` — **single ed25519 key, not a multisig** |
| coin package | `0x0a672389b7b73df60d40666ac9545433d59d3128086b9e3a425a66bbffdf4dc5::susn::SUSN` (6 decimals) |
| LZ oapp package / endpointV2 / ULN302 / executor | `0xfdc28afc…6e24` / `0x31beaef8…36dac` / `0x3ce7457b…5dbb0` / `0xde7fe1a6…1989` |

- DVNs: 3 required both directions (LZ Labs, Nansen, Horizen) since 2026-08-26, proven by delivered messages on 09-09 and 09-24.
- Built-in rate limiter: 1,000,000 sUSN per 8h inbound and outbound vs eid 30101 (set 2026-08-24). ETH side will be 4M/8h (nonce 347) → effective 1M/8h until aligned.
- Enforced options empty on both sides. Sui→ETH senders pass **65 000** lzReceive gas → must set `oapp::set_enforced_options(OApp, AdminCap, 30101, 1, 0x0003…01d4c0)` (120k) **before Ethereum nonce 346**. Details in `context.txt` section 6.

## Implementations claimed on 2026-09-27 (initialize() to the chain Safe)

Base `0xdA67…c1eD`, HyperEVM `0xdA67…c1eD`, Citrea `0x0aDa…91B7`, Bera `0x0aDa…91B7`,
zkSync `0xa5b2…bf34` + `0x9F80…e82a`, TAC `0x01a6…10c2` + `0x6D10…88a8`,
Sophon `0xF90d…d957` + `0xF280…EF80`. Ethereum USN `0x961e…608e` was already
claimed by `0x4E92400fa2c7D3847bBd09d275A502b7bE29E8eB` and cannot be recovered.

## Delegate / proposer

`0xcC2447B495cBc8c2263619Ff3dc4c13604c9b11f` — registered Safe delegate on
Ethereum and zkSync; used to propose on Base and Bera as well.
