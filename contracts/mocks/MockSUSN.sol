// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockSUSN
 * @notice Faucet-style LayerZero V2 OFT used to dry-run the sUSN cross-chain
 *         pathway on testnets (Sepolia <-> Sui testnet, etc.). Anyone can mint
 *         to any address — do NOT deploy on mainnet.
 */
contract MockSUSN is OFT {
    constructor(
        address _lzEndpoint,
        address _delegate
    ) OFT("Mock sUSN", "msUSN", _lzEndpoint, _delegate) Ownable(_delegate) {}

    /// @notice Open mint, no caller check.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
