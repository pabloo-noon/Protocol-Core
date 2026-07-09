// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IAggregatorV2V3} from "./interfaces/IAggregatorV2V3.sol";

contract SUSNChainlinkAdapter is IAggregatorV2V3 {
    error InvalidVault();
    error NoDataForRound();

    /// @notice The sUSN ERC4626 vault. `asset()` is USN.
    IERC4626 public immutable SUSN;

    /// @notice Number of decimals the answer is expressed in.
    uint8 private immutable _decimals;


    uint256 public immutable CONVERSION_SAMPLE;

    constructor(address susn) {
        if (susn == address(0)) revert InvalidVault();
        SUSN = IERC4626(susn);

        // USN decimals == underlying asset decimals of the vault.
        _decimals = IERC4626(susn).asset() == address(0) ? 18 : _tryDecimals(IERC4626(susn).asset());
        CONVERSION_SAMPLE = 10 ** IERC4626(susn).decimals();
    }

    function _tryDecimals(address token) private view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (ok && data.length >= 32) return abi.decode(data, (uint8));
        return 18;
    }

    /// @dev Core price computation: how much USN is 1 full sUSN share worth right now.
    function _price() internal view returns (int256) {
        uint256 assets = SUSN.convertToAssets(CONVERSION_SAMPLE);
        return int256(assets);
    }

    /* ------------------------------------------------------------------ */
    /*                             V3 INTERFACE                            */
    /* ------------------------------------------------------------------ */

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external pure override returns (string memory) {
        return "sUSN / USN ERC4626 rate feed";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function latestRoundData()
        public
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        // There is no historical round data: round 1 is always "now".
        roundId = 1;
        answer = _price();
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = 1;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (_roundId != 1) revert NoDataForRound();
        return latestRoundData();
    }

    /* ------------------------------------------------------------------ */
    /*                             V2 INTERFACE                             */
    /* ------------------------------------------------------------------ */

    function latestAnswer() external view override returns (int256) {
        return _price();
    }

    function latestTimestamp() external view override returns (uint256) {
        return block.timestamp;
    }

    function latestRound() external pure override returns (uint256) {
        return 1;
    }

    function getAnswer(uint256 roundId) external view override returns (int256) {
        if (roundId != 1) revert NoDataForRound();
        return _price();
    }

    function getTimestamp(uint256 roundId) external view override returns (uint256) {
        if (roundId != 1) revert NoDataForRound();
        return block.timestamp;
    }
}
