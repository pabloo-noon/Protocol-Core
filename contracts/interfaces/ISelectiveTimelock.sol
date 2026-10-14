// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISelectiveTimelock
/// @notice Events and errors emitted by SelectiveTimelock. Same shapes as
///         IGenericTimelock for the queue / execute / cancel pipeline, with the
///         delay administration keyed by (target, selector) and two extra
///         paths: the owner's direct `call` and the guardians' `guardianCall`.
interface ISelectiveTimelock {
    // ============ Events ============

    /// @notice Emitted when a (target, selector) delay change is applied by
    ///         executeDelayChange.
    event DelayUpdated(
        address indexed target,
        bytes4 indexed selector,
        uint256 previousDelay,
        uint256 newDelay
    );

    /// @notice Emitted when a (target, selector) delay change is scheduled.
    /// @param eta Earliest timestamp at which executeDelayChange can succeed
    ///        (block.timestamp + current delay of that pair).
    event DelayChangeScheduled(
        address indexed target,
        bytes4 indexed selector,
        uint256 newDelay,
        uint256 eta
    );

    /// @notice Emitted when a pending (target, selector) delay change is cancelled.
    event DelayChangeCancelled(
        address indexed target,
        bytes4 indexed selector,
        uint256 pendingDelay
    );

    /// @notice Emitted when a call is queued for delayed execution.
    event OperationQueued(
        bytes32 indexed opHash,
        address indexed target,
        uint256 value,
        string signature,
        bytes data,
        uint256 eta
    );

    /// @notice Emitted after a queued operation is successfully executed.
    event OperationExecuted(
        bytes32 indexed opHash,
        address indexed target,
        uint256 value,
        string signature,
        bytes data,
        bytes returnData
    );

    /// @notice Emitted when a queued operation is cancelled (before or after expiry).
    event OperationCancelled(bytes32 indexed opHash);

    /// @notice Emitted when the owner executes a zero-delay call directly.
    event DirectCall(
        address indexed target,
        uint256 value,
        string signature,
        bytes data,
        bytes returnData
    );

    /// @notice Emitted when a guardian executes an allow-listed call.
    event GuardianCall(
        address indexed guardian,
        address indexed target,
        string signature,
        bytes data,
        bytes returnData
    );

    /// @notice Emitted when a (target, selector) is added to / removed from the guardian allow-list.
    event GuardianSelectorUpdated(
        address indexed target,
        bytes4 indexed selector,
        bool allowed
    );

    /// @notice Emitted when a guardian is added or removed.
    event GuardianUpdated(address indexed guardian, bool allowed);

    // ============ Errors ============

    /// @notice Given delay is outside [0, MAX_DELAY].
    error DelayOutOfBounds(uint256 given, uint256 min, uint256 max);

    /// @notice queue: `eta` must be at least `block.timestamp + delay[target][selector]`.
    error EtaTooSoon(uint256 eta, uint256 minEta);

    /// @notice Cannot queue: the identical operation is already queued.
    error OperationAlreadyQueued(bytes32 opHash);

    /// @notice Cannot execute/cancel: no such operation is currently queued.
    error OperationNotQueued(bytes32 opHash);

    /// @notice execute: current time has not yet reached `eta`.
    error OperationNotReady(uint256 eta, uint256 nowTs);

    /// @notice execute: current time is past `eta + GRACE_PERIOD`.
    error OperationExpired(uint256 eta, uint256 gracePeriodEnd, uint256 nowTs);

    /// @notice execute / call: `msg.value` did not match the value given for this op.
    error ValueMismatch(uint256 given, uint256 expected);

    /// @notice executeDelayChange / cancelDelayChange: no pending delay change for this pair.
    error NoPendingDelayChange(address target, bytes4 selector);

    /// @notice scheduleDelayChange: a delay change is already pending for this pair.
    error DelayChangeAlreadyPending(
        address target,
        bytes4 selector,
        uint256 pendingDelay,
        uint256 pendingEta
    );

    /// @notice executeDelayChange: current time has not yet reached the pending
    ///         delay change's eta.
    error DelayChangeNotReady(uint256 eta, uint256 nowTs);

    /// @notice execute / call / guardianCall: the forwarded target call reverted.
    error CallReverted(bytes returnData);

    /// @notice call / guardianCall: this (target, selector) carries a delay; use queue.
    error SelectorIsDelayed(address target, bytes4 selector, uint256 delay);

    /// @notice guardianCall: this (target, selector) is not on the guardian allow-list.
    error SelectorNotGuardian(address target, bytes4 selector);

    /// @notice guardianCall: caller is not a guardian.
    error NotGuardian(address caller);

    /// @notice Raw calldata shorter than a selector (1 to 3 bytes).
    error BadCalldata();

    /// @notice Zero address given where a target or guardian is required.
    error ZeroAddress();
}
