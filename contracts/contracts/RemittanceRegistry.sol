// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {RoleAware} from "./RoleAware.sol";

/// @notice Registry of inward remittance messages (IRMs). `allocate` is callable only by
/// RealisationEngine (INTERNAL_ROLE), which consumes IRM balance as bills are realised.
contract RemittanceRegistry is RoleAware {
    struct IRM {
        address bank;
        uint64 amountMinor;
        bytes3 ccy;
        uint64 inrMinor;
        uint64 creditTs;
        uint64 allocatedInr;
    }

    mapping(bytes32 => IRM) public irms;

    event IRMRegistered(bytes32 indexed irmHash, address indexed bank, uint64 amountMinor, bytes3 ccy, uint64 inrMinor, uint64 creditTs);
    event IRMAllocated(bytes32 indexed irmHash, uint64 allocInr, uint64 newAllocatedInr);

    error AlreadyRegistered();
    error UnknownIRM();
    error IRMOverAllocated();

    constructor(address rolesAddr) RoleAware(rolesAddr) {}

    /// @dev Idempotent by design choice: a second registration of the same irmHash reverts
    /// with AlreadyRegistered rather than silently no-op-ing, so the caller (AD bank / API)
    /// gets an explicit signal instead of assuming the second call's data was recorded.
    function registerIRM(bytes32 irmHash, uint64 amountMinor, bytes3 ccy, uint64 inrMinor, uint64 creditTs)
        external
        onlyRole(roles.AD_BANK_ROLE())
    {
        if (irms[irmHash].creditTs != 0) revert AlreadyRegistered();

        irms[irmHash] = IRM({
            bank: msg.sender,
            amountMinor: amountMinor,
            ccy: ccy,
            inrMinor: inrMinor,
            creditTs: creditTs,
            allocatedInr: 0
        });

        emit IRMRegistered(irmHash, msg.sender, amountMinor, ccy, inrMinor, creditTs);
    }

    function allocate(bytes32 irmHash, uint64 allocInr) external onlyRole(roles.INTERNAL_ROLE()) {
        IRM storage irm = irms[irmHash];
        if (irm.creditTs == 0) revert UnknownIRM();
        if (irm.allocatedInr + allocInr > irm.inrMinor) revert IRMOverAllocated();

        irm.allocatedInr += allocInr;
        emit IRMAllocated(irmHash, allocInr, irm.allocatedInr);
    }
}
