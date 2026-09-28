# Hisab — Export Receivable Liquidity & Auto-Realisation Ledger

> **DRUNIX Hackathon 2026 · NPCI × Citi · Global Fintech Fest**
> Track: Real Asset Tokenization × Cross-Border × Innovative Fintech

**One line:** An MSME exporter's customs-cleared Shipping Bill becomes a tokenized receivable they can discount on Day 1; when the foreign payment lands, Hisab auto-matches it to the shipment, mints the eBRC, repays the financier, and pushes the balance to the exporter over UPI.

**Hisab (हिसाब)** = "the account / the reckoning". The product closes the account automatically.

---

## Document map

| File | What it is | Read it when |
|---|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product Requirements — problem, users, scope, success metrics, requirements | You're deciding *what* to build and *why* |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design — layers, trade-offs, failure modes, scale path | You're deciding *how* it fits together |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Entities, on-chain vs off-chain split, state machines | You're writing schema or chaincode |
| [`docs/SMART_CONTRACTS.md`](docs/SMART_CONTRACTS.md) | Contract interfaces, invariants, settlement math | You're writing Solidity / chaincode |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | REST + webhook contracts, mock external endpoints | You're wiring frontend ↔ backend ↔ mocks |
| [`docs/MATCHING_ENGINE.md`](docs/MATCHING_ENGINE.md) | AI/rules hybrid for IRM ↔ Shipping Bill matching | You're building the reconciliation core |
| [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md) | 48-hour build plan, team split, cut list | It's hackathon weekend |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | 4-minute pitch + 60-second live demo beat sheet | You're presenting |
| [`docs/RISKS_AND_COMPLIANCE.md`](docs/RISKS_AND_COMPLIANCE.md) | Regulatory map (FEMA, EDPMS, Factoring Act), risk register, claims to verify | A judge asks "is this legal?" |
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | eBRC, IRM, EDPMS, ICEGATE, AD bank, etc. | You forgot what an acronym means |

---

## The 30-second story

```
Day 0    Goods clear customs  ──►  Shipping Bill hashed on-chain  ──►  Receivable token minted
Day 0    Financier discounts token  ──►  UPI payout: 90% to exporter        [LIQUIDITY]
Day 75   USD lands at AD bank  ──►  messy MT103  ──►  AI parser  ──►  match to Shipping Bill
Day 75   Match confirmed  ──►  eBRC minted  ──►  financier repaid  ──►  balance to exporter via UPI
                                                                          [AUTO-REALISATION]
```

## Why it wins (the thesis)

- **Real pain, verifiable:** eBRC/EDPMS reconciliation delays trap working capital; export-realisation friction appeared independently across every research pass.
- **Citi fit:** Citi is an AD bank, trade financier, and correspondent bank — every actor in this flow is a Citi desk.
- **NPCI fit:** UPI payout for disbursement, AA for KYC/GST checks, hook into cross-border UPI rails for inbound remittance.
- **Blockchain is load-bearing, not decorative:** multi-party shared state (customs, AD bank, DGFT, financier) + double-financing prevention across mutually distrusting parties.
- **One coherent loop:** finance the 90-day wait, then close it automatically. Two products, one ledger, one demo.

## Quick start (once code exists)

```bash
pnpm install
pnpm dev            # web (Next.js) + api (Fastify) + hardhat node + mocks
pnpm demo:seed      # loads 3 exporters, 5 shipping bills, 1 financier
pnpm demo:remit     # fires a messy MT103 at the ingest endpoint
```

## Status

- [x] Idea selected & scored (see research summary in PRD §2)
- [x] PRD, architecture, contracts, API, demo drafted
- [ ] Register team on DRUNIX portal (**deadline 30 Sep 2026**)
- [ ] Verify regulatory claims flagged in RISKS §5
- [ ] Build MVP (see MVP_PLAN)
