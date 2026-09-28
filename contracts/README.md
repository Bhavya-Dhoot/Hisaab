# @hisab/contracts

Hardhat 2.x / Solidity 0.8.24 smart contracts for the Hisab receivable-finance MVP.

## Contracts

- `HisabRoles` — shared `AccessControl` registry (7 roles + internal `INTERNAL_ROLE`).
- `ShippingBillRegistry` — shipping bill state machine (NONE/OPEN/FINANCED/PARTIAL/REALISED/DISPUTED).
- `ReceivableToken` — ERC1155 receivable, id = `uint256(sbHash)`, self-escrowed on lock.
- `RemittanceRegistry` — IRM records, allocation consumed by the engine.
- `RealisationEngine` — realise() + computeWaterfall() (35bps fee, 200bps tolerance).
- `EBRCIssuer` — anchor/revoke/verify eBRC verifiable-credential hashes.
- `PayoutLedger` — off-chain payout receipts, one per (sbHash, leg).

## Roles

`CUSTOMS`, `AD_BANK`, `FINANCIER`, `EXPORTER`, `HISAB_OPS`, `PAYOUT_ADAPTER`, `REGULATOR`, plus
internal `INTERNAL_ROLE` granted to `ReceivableToken` and `RealisationEngine` so they can call
gated setters on `ShippingBillRegistry` / `RemittanceRegistry`.

## Local account map (`scripts/deploy.ts`)

| # | Role |
|---|---|
| 0 | admin + regulator |
| 1 | customs |
| 2 | AD bank |
| 3 | ops |
| 4 | payout adapter |
| 5–7 | exporters |
| 8–9 | financiers |

## Run

```bash
pnpm install                       # from workspace root
pnpm -F @hisab/contracts build     # compile
pnpm -F @hisab/contracts test      # 13 tests, 9 invariants + happy/partial/release paths
pnpm -F @hisab/contracts node      # local chain (separate terminal)
pnpm -F @hisab/contracts deploy:local
```

Deploy writes `deployments/localhost.json` (`{ chainId, addresses }`) and per-contract ABIs to
`deployments/abi/<Name>.json`, consumed by the API without importing Hardhat.
