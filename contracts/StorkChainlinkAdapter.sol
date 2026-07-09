// SPDX-License-Identifier: Apache-2.0

pragma solidity >=0.8.24 <0.9.0;

/**
 * @title A port of the ChainlinkAggregatorV3 interface that supports Stork price feeds
 * @notice Fixed variant:
 *         1) `decimals` is set at deployment per price feed instead of hardcoded to 18 — Stork's
 *            `quantizedValue` precision varies by asset (check the Asset ID Registry).
 *         2) All returned timestamps are converted from Stork's nanosecond precision to Unix
 *            seconds, so staleness/heartbeat checks written for standard Chainlink feeds (which
 *            assume second-precision `updatedAt`) work correctly instead of reverting on
 *            underflow or silently misreporting freshness.
 */
contract StorkChainlinkAdapter {
    uint256 private constant NS_PER_SECOND = 1e9;

    bytes32 public priceId;
    IStorkTemporalNumericValueUnsafeGetter public stork;
    uint8 private immutable _decimals;

    constructor(address _stork, bytes32 _priceId, uint8 _feedDecimals) {
        priceId = _priceId;
        stork = IStorkTemporalNumericValueUnsafeGetter(_stork);
        _decimals = _feedDecimals;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() public pure returns (string memory) {
        return "A port of a chainlink aggregator powered by Stork";
    }

    function version() public pure returns (uint256) {
        return 1;
    }

    function latestAnswer() public view virtual returns (int256) {
        return stork.getTemporalNumericValueUnsafeV1(priceId).quantizedValue;
    }

    /// @notice Unix seconds (converted from Stork's nanosecond-precision timestamp).
    function latestTimestamp() public view returns (uint256) {
        return stork.getTemporalNumericValueUnsafeV1(priceId).timestampNs / NS_PER_SECOND;
    }

    function latestRound() public view returns (uint256) {
        // Use the seconds-precision timestamp as the round id, consistent with the rest of
        // this adapter now operating in seconds rather than nanoseconds.
        return latestTimestamp();
    }

    function getAnswer(uint256) public view returns (int256) {
        return latestAnswer();
    }

    /// @notice Unix seconds (converted from Stork's nanosecond-precision timestamp).
    function getTimestamp(uint256) external view returns (uint256) {
        return latestTimestamp();
    }

    /*
    * @notice This is exactly the same as `latestRoundData`, just including for parity with Chainlink
    * Stork doesn't store roundId on chain so there's no way to access old data by round id
    * Note: startedAt/updatedAt are in Unix seconds, converted from Stork's native nanosecond precision.
    */
    function getRoundData(
        uint80 _roundId
    )
    external
    view
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    )
    {
        StorkStructs.TemporalNumericValue memory value = stork.getTemporalNumericValueUnsafeV1(priceId);
        uint256 timestampSeconds = value.timestampNs / NS_PER_SECOND;
        return (
            _roundId,
            value.quantizedValue,
            timestampSeconds,
            timestampSeconds,
            _roundId
        );
    }

    /// @notice startedAt/updatedAt are returned in Unix seconds (converted from Stork's native
    ///         nanosecond precision) so standard Chainlink-style staleness/heartbeat checks work.
    function latestRoundData()
    external
    view
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    )
    {
        StorkStructs.TemporalNumericValue memory value = stork.getTemporalNumericValueUnsafeV1(priceId);
        uint256 timestampSeconds = value.timestampNs / NS_PER_SECOND;
        roundId = uint80(timestampSeconds);
        return (
            roundId,
            value.quantizedValue,
            timestampSeconds,
            timestampSeconds,
            roundId
        );
    }
}

interface IStorkTemporalNumericValueUnsafeGetter {
    function getTemporalNumericValueUnsafeV1(
        bytes32 id
    ) external view returns (StorkStructs.TemporalNumericValue memory value);
}

contract StorkStructs {
    struct TemporalNumericValue {
        // slot 1
        // nanosecond level precision timestamp of latest publisher update in batch
        uint64 timestampNs; // 8 bytes
        // should be able to hold all necessary numbers (up to 6277101735386680763835789423207666416102355444464034512895)
        int192 quantizedValue; // 8 bytes
    }
}
