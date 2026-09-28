# Hisab — Export Receivable Liquidity & Auto-Realisation Ledger

**Hisab (हिसाब)** — "the account / the reckoning".

When an MSME exporter's goods clear customs, their Shipping Bill becomes a tokenized receivable they can discount on day one.
When the foreign payment lands 75 days later, Hisab matches the messy SWIFT message to the shipment, issues the eBRC,
repays the financier and pushes the balance to the exporter over UPI. Nobody reconciles anything by hand.

```
Day 0   Goods clear customs ─► Shipping Bill hashed on-chain ─► receivable token minted
Day 0   Financier discounts token ─► UPI payout: advance to exporter              [LIQUIDITY]
Day 75  USD lands at AD bank ─► messy MT103 ─► matcher ─► match to Shipping Bill
Day 75  Realised on-chain ─► eBRC anchored ─► financier repaid ─► balance to exporter [AUTO-REALISATION]
```

## What's in the box

| Path | What |
|---|---|
| `contracts/` | Solidity 0.8.24 + Hardhat. `ShippingBillRegistry`, `ReceivableToken` (ERC-1155 escrow lock, double-finance guard), `RemittanceRegistry`, `RealisationEngine` (waterfall), `EBRCIssuer`, `PayoutLedger`, `HisabRoles` |
| `packages/matcher/` | MT103 parser + rules/LLM hybrid matcher. The LLM only proposes references; rules re-verify; thresholds and humans decide |
| `apps/api/` | Fastify API: ingest, offers and on-chain lock, idempotent UPI payout adapter, ops queue, eBRC verifiable credentials, explorer, SSE, mocks for ICEGATE / SWIFT / UPI / DGFT |
| `apps/web/` | Vite + React console: Exporter, Financier, Bank Ops, Explorer tabs, demo control bar, phone notification mock |

## Quick start

Requires Node ≥ 22.13 and pnpm 10.

```bash
pnpm install
pnpm dev          # hardhat node + contract deploy + API (:4000) + web (:5173)
```

Open http://localhost:5173 and click **Seed demo** in the control bar (or run `pnpm demo:seed`).

Other commands:

```bash
pnpm test         # contract invariants + matcher presets
pnpm e2e          # full demo loop over HTTP against the running stack
pnpm demo:remit   # fire the messy "typo" MT103 at SB 6674321
```

Optional: set `ANTHROPIC_API_KEY` to use Claude for reference extraction. Without it, a deterministic heuristic extractor is used, so the demo runs fully offline.
Other env vars: `API_PORT`, `RPC_URL`, `JWT_SECRET`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEB_ORIGIN`.

## Demo walkthrough

1. **Exporter** tab. Seed, open SB 6674321 (USD 48,750). Accept the Citi Trade offer (88% @ 11.5%). The state flips to FINANCED and the phone shows "₹35,88,585 credited".
2. Accept the Kotak NBFC offer on the same SB. The chain reverts with `ALREADY_LOCKED`, so double financing is impossible.
3. **75 days later: SWIFT arrives**. The MT103 has `INV 2O24-25/OO91` (letter O for zero) and USD 45 short. Rules miss, the extractor normalises, rules re-verify, and confidence reaches 0.95, which auto-realises.
4. SB flips to REALISED. The waterfall shows ₹40,86,350 realised: ₹36,72,253 to the financier, ₹12,560 platform fee, ₹4,01,536 to the exporter. The eBRC is issued, and the phone buzzes twice.
5. **Bundle remittance**. One payment covers two invoices at 0.70 confidence, so it goes to the **Bank Ops** queue with reasons. Approve both candidates.
6. **Fraud remittance**. The amount is 3× the FOB, so it stays UNMATCHED and raises an alert.
7. **Explorer**. Verify the eBRC (signature plus on-chain anchor) and view the stats.

## Design notes

- **Money never moves on-chain.** Contracts record entitlements and emit events. The payout adapter moves INR over (mock) UPI and writes the UTR hash back. Every payout leg is idempotent on-chain (`DuplicateLeg`) and off-chain (UUIDv5 of sbHash + leg).
- **Hashes only on the ledger.** Raw Shipping Bill and MT103 documents stay off-chain. `sbHash` and `irmHash` are SHA-256 over RFC 8785 canonical JSON.
- **Integers for money.** Everything is in paise or cents. Interest uses basis points and a day count.
- **Read model is disposable.** The SQLite read model is rebuilt from chain events: `pnpm -F @hisab/api projector:rebuild`.
- **Hackathon-mode infra.** `node:sqlite` stands in for Postgres, an in-process event bus for NATS, local disk for S3, and SSE for WebSockets. Each one is a single module to swap for production.

## Tests

- `contracts`: 13 tests. They cover all 9 ledger invariants (re-register, double lock, locked transfer, IRM over-allocation, low-confidence auto-realise, waterfall conservation fuzzed over 400+ inputs, anchor before realisation, duplicate payout leg, dispute blocking realisation), plus the happy path, partial realisation and release.
- `packages/matcher`: the parser, all five demo presets landing in their confidence bands, the hallucination guard, exact pro-rata split and candidate filtering.
- `apps/api` e2e: 29 checks over the full loop, including payout retry with exactly-once confirmation.
