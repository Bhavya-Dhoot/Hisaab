// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {RoleAware} from "./RoleAware.sol";

interface IReceivableTokenMintable {
    function mint(address exporter, uint256 id, uint256 amount) external;
    function adjustSupply(uint256 id, uint256 newSupply) external;
    function primaryLockFinancier(bytes32 sbHash) external view returns (address);
}

/// @notice Registry of shipping-bill-backed receivables. State transitions are driven either
/// directly (customs actions) or by the token/engine contracts via INTERNAL_ROLE-gated setters.
contract ShippingBillRegistry is RoleAware {
    uint8 public constant NONE = 0;
    uint8 public constant OPEN = 1;
    uint8 public constant FINANCED = 2;
    uint8 public constant PARTIAL = 3;
    uint8 public constant REALISED = 4;
    uint8 public constant DISPUTED = 5;

    struct ShippingBill {
        bytes32 iecHash;
        address exporter;
        uint64 fobMinor;
        bytes3 ccy;
        uint64 leoTs;
        uint8 state;
        uint64 realisedInr;
        uint64 fobInrMinor;
    }

    mapping(bytes32 => ShippingBill) public bills;

    IReceivableTokenMintable public token;

    event SBRegistered(
        bytes32 indexed sbHash,
        bytes32 iecHash,
        address indexed exporter,
        uint64 fobMinor,
        bytes3 ccy,
        uint64 leoTs,
        uint64 fobInrMinor
    );
    event SBAmended(bytes32 indexed sbHash, uint64 newFobMinor);
    event SBDisputed(bytes32 indexed sbHash);
    event SBDisputeResolved(bytes32 indexed sbHash);
    event SBStateChanged(bytes32 indexed sbHash, uint8 oldState, uint8 newState);

    error AlreadyRegistered();
    error UnknownBill();
    error NotDisputed();
    error NotLockHolder();
    error TokenNotSet();

    constructor(address rolesAddr) RoleAware(rolesAddr) {}

    function setToken(address tokenAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        token = IReceivableTokenMintable(tokenAddr);
    }

    function registerShippingBill(
        bytes32 sbHash,
        bytes32 iecHash,
        address exporter,
        uint64 fobMinor,
        bytes3 ccy,
        uint64 leoTs,
        uint64 fobInrMinor
    ) external onlyRole(roles.CUSTOMS_ROLE()) {
        if (bills[sbHash].state != NONE) revert AlreadyRegistered();
        if (address(token) == address(0)) revert TokenNotSet();

        bills[sbHash] = ShippingBill({
            iecHash: iecHash,
            exporter: exporter,
            fobMinor: fobMinor,
            ccy: ccy,
            leoTs: leoTs,
            state: OPEN,
            realisedInr: 0,
            fobInrMinor: fobInrMinor
        });

        token.mint(exporter, uint256(sbHash), fobMinor);

        emit SBRegistered(sbHash, iecHash, exporter, fobMinor, ccy, leoTs, fobInrMinor);
    }

    function amendShippingBill(bytes32 sbHash, uint64 newFobMinor) external onlyRole(roles.CUSTOMS_ROLE()) {
        ShippingBill storage bill = bills[sbHash];
        if (bill.state == NONE) revert UnknownBill();

        if (bill.state == FINANCED) {
            bill.state = DISPUTED;
            emit SBDisputed(sbHash);
            return;
        }

        bill.fobMinor = newFobMinor;
        token.adjustSupply(uint256(sbHash), newFobMinor);
        emit SBAmended(sbHash, newFobMinor);
    }

    function resolveDispute(bytes32 sbHash) external onlyRole(roles.FINANCIER_ROLE()) {
        ShippingBill storage bill = bills[sbHash];
        if (bill.state != DISPUTED) revert NotDisputed();
        if (token.primaryLockFinancier(sbHash) != msg.sender) revert NotLockHolder();
        bill.state = FINANCED;
        emit SBDisputeResolved(sbHash);
    }

    /// @notice Callable only by ReceivableToken / RealisationEngine (INTERNAL_ROLE).
    function setState(bytes32 sbHash, uint8 newState) external onlyRole(roles.INTERNAL_ROLE()) {
        ShippingBill storage bill = bills[sbHash];
        if (bill.state == NONE) revert UnknownBill();
        uint8 old = bill.state;
        bill.state = newState;
        emit SBStateChanged(sbHash, old, newState);
    }

    /// @notice Callable only by RealisationEngine (INTERNAL_ROLE). Adds to cumulative realised INR
    /// and returns the new cumulative total.
    function addRealised(bytes32 sbHash, uint64 amount) external onlyRole(roles.INTERNAL_ROLE()) returns (uint64) {
        ShippingBill storage bill = bills[sbHash];
        if (bill.state == NONE) revert UnknownBill();
        bill.realisedInr += amount;
        return bill.realisedInr;
    }

    function state(bytes32 sbHash) external view returns (uint8) {
        return bills[sbHash].state;
    }
}
