// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {HisabRoles} from "./HisabRoles.sol";

/// @notice Base contract for anything that checks roles through the shared HisabRoles registry
/// rather than inheriting AccessControl itself.
abstract contract RoleAware {
    HisabRoles public immutable roles;

    error Unauthorized(bytes32 role, address account);

    constructor(address rolesAddr) {
        roles = HisabRoles(rolesAddr);
    }

    modifier onlyRole(bytes32 role) {
        if (!roles.hasRole(role, msg.sender)) revert Unauthorized(role, msg.sender);
        _;
    }
}
