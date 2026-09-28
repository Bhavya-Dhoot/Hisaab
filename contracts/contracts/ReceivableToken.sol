// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {RoleAware} from "./RoleAware.sol";

interface IShippingBillRegistryView {
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

    function OPEN() external view returns (uint8);
    function FINANCED() external view returns (uint8);
}

interface IPayoutLedgerView {
    function hasLeg(bytes32 sbHash, uint8 leg) external view returns (bool);
}

/// @notice ERC1155 receivable token. id = uint256(sbHash), supply = fobMinor.
/// The contract is its own escrow: locked units are transferred to address(this).
contract ReceivableToken is ERC1155, ERC1155Supply, ERC1155Holder, RoleAware {
    uint8 public constant ADVANCE_LEG = 0; // PayoutLedger.Leg.ADVANCE

    struct Lock {
        address financier;
        uint64 lockedUnits;
        uint64 advanceInrMinor;
        uint16 rateBps;
        uint64 lockTs;
        bool active;
    }

    mapping(uint256 => Lock[]) public locks;
    mapping(uint256 => uint64) public lockedTotal;

    IShippingBillRegistryView public registry;
    IPayoutLedgerView public payoutLedger;

    event TokenLocked(uint256 indexed id, address indexed financier, uint64 units, uint64 advanceInrMinor, uint16 rateBps);
    event TokenReleased(uint256 indexed id, address indexed financier, uint64 units);

    error AlreadyLocked(uint256 id, address existingFinancier);
    error Locked(uint256 id);
    error NotExporter();
    error NotLockFinancier();
    error AdvanceAlreadyPaid();
    error NoActiveLock();
    error RegistryNotSet();

    constructor(address rolesAddr, string memory uri_) ERC1155(uri_) RoleAware(rolesAddr) {}

    function setRegistry(address registryAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        registry = IShippingBillRegistryView(registryAddr);
    }

    function setPayoutLedger(address ledgerAddr) external onlyRole(roles.DEFAULT_ADMIN_ROLE()) {
        payoutLedger = IPayoutLedgerView(ledgerAddr);
    }

    /// @notice Called only by ShippingBillRegistry on registration / amendment.
    function mint(address exporter, uint256 id, uint256 amount) external {
        if (msg.sender != address(registry)) revert Unauthorized(bytes32(0), msg.sender);
        _mint(exporter, id, amount, "");
    }

    function adjustSupply(uint256 id, uint256 newSupply) external {
        if (msg.sender != address(registry)) revert Unauthorized(bytes32(0), msg.sender);
        uint256 current = totalSupply(id);
        if (newSupply > current) {
            _mint(_exporterOf(id), id, newSupply - current, "");
        } else if (newSupply < current) {
            _burn(_exporterOf(id), id, current - newSupply);
        }
    }

    function lock(uint256 id, address financier, uint64 units, uint64 advanceInrMinor, uint16 rateBps)
        external
        onlyRole(roles.EXPORTER_ROLE())
    {
        if (address(registry) == address(0)) revert RegistryNotSet();
        if (_exporterOf(id) != msg.sender) revert NotExporter();
        if (lockedTotal[id] != 0) revert AlreadyLocked(id, locks[id][0].financier);

        safeTransferFrom(msg.sender, address(this), id, units, "");

        locks[id].push(
            Lock({
                financier: financier,
                lockedUnits: units,
                advanceInrMinor: advanceInrMinor,
                rateBps: rateBps,
                lockTs: uint64(block.timestamp),
                active: true
            })
        );
        lockedTotal[id] += units;

        registry.setState(bytes32(id), registry.FINANCED());

        emit TokenLocked(id, financier, units, advanceInrMinor, rateBps);
    }

    function release(uint256 id, uint256 lockIdx) external onlyRole(roles.FINANCIER_ROLE()) {
        if (lockIdx >= locks[id].length) revert NoActiveLock();
        Lock storage L = locks[id][lockIdx];
        if (!L.active) revert NoActiveLock();
        if (L.financier != msg.sender) revert NotLockFinancier();
        if (address(payoutLedger) != address(0) && payoutLedger.hasLeg(bytes32(id), ADVANCE_LEG)) {
            revert AdvanceAlreadyPaid();
        }

        uint64 units = L.lockedUnits;
        L.active = false;
        lockedTotal[id] -= units;

        _safeTransferFrom(address(this), _exporterOf(id), id, units, "");

        registry.setState(bytes32(id), registry.OPEN());

        emit TokenReleased(id, L.financier, units);
    }

    function primaryLock(bytes32 sbHash) external view returns (Lock memory) {
        uint256 id = uint256(sbHash);
        if (locks[id].length == 0) {
            return Lock({financier: address(0), lockedUnits: 0, advanceInrMinor: 0, rateBps: 0, lockTs: 0, active: false});
        }
        return locks[id][0];
    }

    function primaryLockFinancier(bytes32 sbHash) external view returns (address) {
        uint256 id = uint256(sbHash);
        if (locks[id].length == 0) return address(0);
        return locks[id][0].financier;
    }

    function _exporterOf(uint256 id) internal view returns (address exporter) {
        (, exporter, , , , , , ) = registry.bills(bytes32(id));
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        for (uint256 i = 0; i < ids.length; i++) {
            if (lockedTotal[ids[i]] > 0 && from != address(this)) {
                revert Locked(ids[i]);
            }
        }
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
