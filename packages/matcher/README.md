# @hisab/matcher

Pure TypeScript IRM ↔ Shipping-Bill matcher from `docs/MATCHING_ENGINE.md`:
`parseMT103` → Stage A rules → (if below `auto`) Stage B extraction
(`heuristicExtractor`, fully offline) → Stage C re-verify → band. No
fuzzy-match dep — `nameSimilarity` is a small normalised-token Levenshtein ratio.

## Deviations from the spec's raw weights (documented per task instructions)

Spec's f1–f7 weights (.45/.35/.15/.08/.10/.05/.04, sum 1.22) can't separate `noref`
(target REVIEW 0.70–0.92) from an amount+name-only match (ceiling 0.34). Kept rule
ids/ordering and f1/f2 dominance, but merged f3/f4 into one amount-tolerance term
(tightest band wins, not summed; .40/.15) and raised f5 (name) to .20. `clean`/`typo`
now clip to 1.0/0.95 rather than ~0.98/0.93 — same AUTO band, different point value.
- **Multi-invoice cap**: `bundle` LLM scores always cap at 0.90 — per-SB amount can't
  be verified against an aggregate wire amount, stricter than the spec's blanket cap.
- **Fraud gate**: a hard, non-weighted gate (`applyFraudGate` in `src/match.ts`) caps
  any candidate whose amount deviates >30% from FOB at 0.41 + alert, so a strong
  ref/name match can't out-vote a grossly wrong amount into REVIEW.

## Preset scores (heuristicExtractor, `{auto:0.92, review:0.70, tolerancePct:2}`)

`clean` 1.00 AUTO · `typo` 0.95 AUTO (LLM) · `bundle` 0.70/0.70 REVIEW (2 allocations) ·
`noref` 0.75 REVIEW · `fraud` 0.41 UNMATCHED (alert).
## Usage
```ts
import { match, heuristicExtractor } from '@hisab/matcher';
const result = await match(irm, candidates, { auto: 0.92, review: 0.70, tolerancePct: 2 }, heuristicExtractor());
```
