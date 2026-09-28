// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {RoleAware} from "./RoleAware.sol";

interface IShippingBillRegistryState {
    function state(bytes32 sbHash) external view returns (uint8);
    function REALISED() external view returns (uint8);
}

/// @notice Anchors / revokes / verifies electronic Bank Realisation Certificates (eBRC) as
/// verifiable-credential hashes, once a shipping bill has reached REALISED.
contract EBRCIssuer is RoleAware {
    struct EBRC {
        bytes32 vcHash;
        address issuer;
        uint64 issuedTs;
        bool revoked;
    }

    mapping(bytes32 => EBRC) public ebrcs;

    IShippingBillRegistryState public registry;

    event EBRCAnchored(bytes32 indexed sbHash, bytes32 vcHash, address indexed issuer);
    event EBRCRevoked(bytes32 indexed sbHash, bytes32 reasonHash, address indexed by);

    error NotRealised();
    error AlreadyAnchored();
    error NotAnchored();
    error AlreadyRevoked();

    constructor(address rolesAddr) RoleAware(rolesAddr) {}

    function setRegistry(address registryAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        registry = IShippingBillRegistryState(registryAddr);
    }

    function anchor(bytes32 sbHash, bytes32 vcHash) external onlyRole(roles.AD_BANK_ROLE()) {
        if (registry.state(sbHash) != registry.REALISED()) revert NotRealised();
        if (ebrcs[sbHash].vcHash != bytes32(0)) revert AlreadyAnchored();

        ebrcs[sbHash] = EBRC({vcHash: vcHash, issuer: msg.sender, issuedTs: uint64(block.timestamp), revoked: false});

        emit EBRCAnchored(sbHash, vcHash, msg.sender);
    }

    function revoke(bytes32 sbHash, bytes32 reasonHash) external {
        bool isAdBank = roles.hasRole(roles.AD_BANK_ROLE(), msg.sender);
        bool isRegulator = roles.hasRole(roles.REGULATOR_ROLE(), msg.sender);
        if (!isAdBank && !isRegulator) revert Unauthorized(roles.AD_BANK_ROLE(), msg.sender);

        EBRC storage e = ebrcs[sbHash];
        if (e.vcHash == bytes32(0)) revert NotAnchored();
        if (e.revoked) revert AlreadyRevoked();

        e.revoked = true;
        emit EBRCRevoked(sbHash, reasonHash, msg.sender);
    }

    function verify(bytes32 sbHash, bytes32 vcHash) external view returns (bool) {
        EBRC memory e = ebrcs[sbHash];
        return e.vcHash != bytes32(0) && e.vcHash == vcHash && !e.revoked;
    }
}
