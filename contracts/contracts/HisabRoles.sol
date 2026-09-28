// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Single AccessControl registry shared by every Hisab contract.
contract HisabRoles is AccessControl {
    bytes32 public constant CUSTOMS_ROLE = keccak256("CUSTOMS");
    bytes32 public constant AD_BANK_ROLE = keccak256("AD_BANK");
    bytes32 public constant FINANCIER_ROLE = keccak256("FINANCIER");
    bytes32 public constant EXPORTER_ROLE = keccak256("EXPORTER");
    bytes32 public constant OPS_ROLE = keccak256("HISAB_OPS");
    bytes32 public constant PAYOUT_ROLE = keccak256("PAYOUT_ADAPTER");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR");

    /// @notice Cross-contract role: granted to ReceivableToken / RealisationEngine so they
    /// can call the internal setters on ShippingBillRegistry / RemittanceRegistry.
    bytes32 public constant INTERNAL_ROLE = keccak256("INTERNAL");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
}
