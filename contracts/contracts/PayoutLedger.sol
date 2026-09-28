// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {RoleAware} from "./RoleAware.sol";

/// @notice On-chain record of off-chain INR payouts. Money never moves here — this is the
/// entitlement/receipt ledger the payout adapter writes to after a UPI transfer settles.
contract PayoutLedger is RoleAware {
    enum Leg {
        ADVANCE,
        FINANCIER_REPAY,
        EXPORTER_BALANCE,
        PLATFORM_FEE
    }

    struct Payout {
        Leg leg;
        address to;
        uint64 inrMinor;
        bytes32 utrHash;
        uint64 ts;
    }

    mapping(bytes32 => Payout[]) public payouts;
    mapping(bytes32 => mapping(uint8 => bool)) private _legRecorded;

    event PayoutRecorded(bytes32 indexed sbHash, uint8 leg, address indexed to, uint64 inrMinor, bytes32 utrHash);

    error DuplicateLeg();

    constructor(address rolesAddr) RoleAware(rolesAddr) {}

    function recordPayout(bytes32 sbHash, Leg leg, address to, uint64 inrMinor, bytes32 utrHash)
        external
        onlyRole(roles.PAYOUT_ROLE())
    {
        if (_legRecorded[sbHash][uint8(leg)]) revert DuplicateLeg();
        _legRecorded[sbHash][uint8(leg)] = true;

        payouts[sbHash].push(Payout({leg: leg, to: to, inrMinor: inrMinor, utrHash: utrHash, ts: uint64(block.timestamp)}));

        emit PayoutRecorded(sbHash, uint8(leg), to, inrMinor, utrHash);
    }

    function hasLeg(bytes32 sbHash, uint8 leg) external view returns (bool) {
        return _legRecorded[sbHash][leg];
    }
}
