// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {RoleAware} from "./RoleAware.sol";

interface IShippingBillRegistryEngine {
    function bills(bytes32 sbHash)
        external
        view
        returns (
            bytes32 iecHash,
            address exporter,
            uint64 fobMinor,
            bytes3 ccy,
            uint64 leoTs,
            uint8 state,
            uint64 realisedInr,
            uint64 fobInrMinor
        );
    function setState(bytes32 sbHash, uint8 newState) external;
    function addRealised(bytes32 sbHash, uint64 amount) external returns (uint64);

    function OPEN() external view returns (uint8);
    function FINANCED() external view returns (uint8);
    function PARTIAL() external view returns (uint8);
    function REALISED() external view returns (uint8);
    function DISPUTED() external view returns (uint8);
    function NONE() external view returns (uint8);
}

interface IRemittanceRegistryEngine {
    function allocate(bytes32 irmHash, uint64 allocInr) external;
}

interface IReceivableTokenEngine {
    struct Lock {
        address financier;
        uint64 lockedUnits;
        uint64 advanceInrMinor;
        uint16 rateBps;
        uint64 lockTs;
        bool active;
    }

    function primaryLock(bytes32 sbHash) external view returns (Lock memory);
}

/// @notice Computes and records the realisation waterfall for a shipping bill.
contract RealisationEngine is RoleAware {
    uint16 public constant PLATFORM_FEE_BPS = 35;
    uint16 public constant TOLERANCE_BPS = 200;

    struct Waterfall {
        uint64 realisedInr;
        uint64 financierDue;
        uint64 platformFee;
        uint64 exporterBalance;
        uint64 shortfall;
    }

    IShippingBillRegistryEngine public registry;
    IRemittanceRegistryEngine public remittance;
    IReceivableTokenEngine public token;

    event Realised(bytes32 indexed sbHash, bytes32 indexed irmHash, uint64 allocInr, address indexed by, uint16 confidencePct);
    event WaterfallComputed(
        bytes32 indexed sbHash,
        uint64 realisedInr,
        uint64 financierDue,
        uint64 platformFee,
        uint64 exporterBalance,
        uint64 shortfall
    );

    error IRMOverAllocated();
    error ConfidenceTooLow();
    error InvalidState();
    error DependenciesNotSet();

    constructor(address rolesAddr) RoleAware(rolesAddr) {}

    function setRegistry(address registryAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        registry = IShippingBillRegistryEngine(registryAddr);
    }

    function setRemittance(address remittanceAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        remittance = IRemittanceRegistryEngine(remittanceAddr);
    }

    function setToken(address tokenAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        token = IReceivableTokenEngine(tokenAddr);
    }

    function realise(bytes32 sbHash, bytes32 irmHash, uint64 allocInr, uint16 confidencePct) external {
        bool isAdBank = roles.hasRole(roles.AD_BANK_ROLE(), msg.sender);
        bool isOps = roles.hasRole(roles.OPS_ROLE(), msg.sender);
        if (!isAdBank && !isOps) revert Unauthorized(roles.AD_BANK_ROLE(), msg.sender);
        if (address(registry) == address(0) || address(remittance) == address(0) || address(token) == address(0)) {
            revert DependenciesNotSet();
        }

        (, , , , , uint8 st, , uint64 fobInrMinor) = registry.bills(sbHash);
        uint8 NONE_ = registry.NONE();
        uint8 DISPUTED_ = registry.DISPUTED();
        uint8 REALISED_ = registry.REALISED();
        if (st == NONE_ || st == DISPUTED_ || st == REALISED_) revert InvalidState();

        if (confidencePct < 92 && !isOps) revert ConfidenceTooLow();

        // Reverts IRMOverAllocated inside RemittanceRegistry if over-consumed.
        remittance.allocate(irmHash, allocInr);

        uint64 cumulativeRealised = registry.addRealised(sbHash, allocInr);

        uint64 threshold = uint64((uint256(fobInrMinor) * (10_000 - TOLERANCE_BPS)) / 10_000);
        uint8 newState = cumulativeRealised >= threshold ? REALISED_ : registry.PARTIAL();
        registry.setState(sbHash, newState);

        emit Realised(sbHash, irmHash, allocInr, msg.sender, confidencePct);

        if (newState == REALISED_) {
            Waterfall memory wf = computeWaterfall(sbHash, cumulativeRealised);
            emit WaterfallComputed(sbHash, wf.realisedInr, wf.financierDue, wf.platformFee, wf.exporterBalance, wf.shortfall);
        }
    }

    function computeWaterfall(bytes32 sbHash, uint64 realisedInr) public view returns (Waterfall memory wf) {
        IReceivableTokenEngine.Lock memory L = token.primaryLock(sbHash);

        wf.realisedInr = realisedInr;

        if (L.financier == address(0)) {
            // Never financed: nothing is owed to a financier or the platform.
            wf.financierDue = 0;
            wf.platformFee = 0;
            wf.exporterBalance = realisedInr;
            wf.shortfall = 0;
            return wf;
        }

        uint64 daysElapsed = (uint64(block.timestamp) - L.lockTs) / 1 days;
        uint64 interest = uint64((uint256(L.advanceInrMinor) * L.rateBps * daysElapsed) / (10_000 * 365));
        wf.financierDue = L.advanceInrMinor + interest;
        wf.platformFee = uint64((uint256(L.advanceInrMinor) * PLATFORM_FEE_BPS) / 10_000);

        if (realisedInr >= wf.financierDue + wf.platformFee) {
            wf.exporterBalance = realisedInr - wf.financierDue - wf.platformFee;
        } else if (realisedInr >= wf.financierDue) {
            wf.platformFee = realisedInr - wf.financierDue; // fee absorbs first
            wf.exporterBalance = 0;
        } else {
            wf.shortfall = wf.financierDue - realisedInr;
            wf.platformFee = 0;
            wf.exporterBalance = 0;
        }
    }
}
