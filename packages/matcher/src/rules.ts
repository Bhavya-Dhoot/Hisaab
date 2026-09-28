import type { Candidate, MT103Fields, MatchConfig, Reason } from './types.js';

/** Strip everything but letters/digits and uppercase — used for exact (non-fuzzy) ref matching. */
export function normalizeAlnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function refInText(ref: string, text: string): boolean {
  const nref = normalizeAlnum(ref);
  if (!nref) return false;
  return normalizeAlnum(text).includes(nref);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** Normalised token similarity in [0,1]; 1 = identical after normalisation. */
export function nameSimilarity(a: string, b: string): number {
  const na = a.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nb = b.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return (b - a) / (1000 * 60 * 60 * 24 * 30.4375);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return (b - a) / (1000 * 60 * 60 * 24);
}

export const CANDIDATE_STATES = ['OPEN', 'FINANCED', 'PARTIAL'];
export const LEO_WINDOW_MONTHS = 15;

export function filterCandidates(candidates: Candidate[], creditTs: string): Candidate[] {
  return candidates.filter((c) => {
    if (!CANDIDATE_STATES.includes(c.state)) return false;
    const months = monthsBetween(c.leoTs, creditTs);
    return months >= 0 && months <= LEO_WINDOW_MONTHS;
  });
}

/**
 * Deviation from `H:\Hisaab\hisab\docs\MATCHING_ENGINE.md` §2 (documented in README):
 * the spec's raw weights (f1 .45, f2 .35, f3 .15, f4 .08, f5 .10, f6 .05, f7 .04) sum
 * to 1.22 and can never separate "noref" (0.70-0.92 target) from a bare amount+name
 * match using only f3/f5/f6/f7 (max 0.34 under the spec weights). We keep the same
 * f1/f2 dominance and rule ids/ordering but rebalance so the non-ref features alone
 * can clear the review floor, and fold f3/f4 into a single amount-tolerance term
 * (tightest applicable band wins, they are not summed).
 */
export const WEIGHTS = {
  f1: 0.45, // exact SB no in :70:
  f2: 0.35, // exact invoice no in :70:
  amount2pct: 0.4, // f3: amount within +/-2% of FOB
  amount5pct: 0.15, // f4: amount within +/-5% (charges/FX)
  f5: 0.2, // sender name ~ buyer name (fuzzy)
  f6: 0.1, // sender country == buyer country
  f7: 0.05, // tenor plausible (30-180d)
};

export interface AmountCheck {
  ok2pct: boolean;
  ok5pct: boolean;
  deviationPct: number;
  irmAmountMinor: number;
  effectiveDeviationPct: number;
}

/** Compares the IRM amount (in candidate ccy minor units) against the candidate FOB. */
export function checkAmount(
  irmAmountMinor: number,
  fobMinor: number,
  tolerancePct: number,
  deductionsMinor = 0
): AmountCheck {
  const adjusted = irmAmountMinor + deductionsMinor; // add back stated deductions
  const deviationPct = fobMinor === 0 ? 1 : Math.abs(adjusted - fobMinor) / fobMinor;
  // tolerancePct follows the ops-config convention (a whole percent, e.g. 2 == 2%).
  const tolFrac = tolerancePct / 100;
  return {
    ok2pct: deviationPct <= tolFrac,
    ok5pct: deviationPct <= tolFrac * 2.5,
    deviationPct,
    irmAmountMinor: adjusted,
    effectiveDeviationPct: deviationPct,
  };
}

export interface RuleScoreResult {
  score: number;
  reasons: Reason[];
  refFound: boolean;
  amountVerified: boolean;
}

export interface RuleScoreOptions {
  sbRefFound?: boolean;
  invoiceRefFound?: boolean;
  deductionsMinor?: number;
}

export function scoreCandidate(
  candidate: Candidate,
  fields: MT103Fields,
  irmAmountMinor: number,
  cfg: MatchConfig,
  creditTs: string,
  opts: RuleScoreOptions = {}
): RuleScoreResult {
  const reasons: Reason[] = [];
  let score = 0;

  const sbHit = opts.sbRefFound ?? refInText(candidate.sbNo, fields.remitInfo);
  if (sbHit) {
    score += WEIGHTS.f1;
    reasons.push({ rule: 'f1', weight: WEIGHTS.f1, detail: `SB no ${candidate.sbNo} found in :70:` });
  }

  const invHit =
    opts.invoiceRefFound ?? candidate.invoiceNos.some((inv) => refInText(inv, fields.remitInfo));
  if (invHit) {
    const matched = candidate.invoiceNos.find((inv) => refInText(inv, fields.remitInfo));
    score += WEIGHTS.f2;
    reasons.push({
      rule: 'f2',
      weight: WEIGHTS.f2,
      detail: `invoice ${matched ?? candidate.invoiceNos[0]} found in :70:`,
    });
  }

  const amt = checkAmount(irmAmountMinor, candidate.fobMinor, cfg.tolerancePct, opts.deductionsMinor ?? 0);
  let amountVerified = false;
  if (amt.ok2pct) {
    score += WEIGHTS.amount2pct;
    amountVerified = true;
    reasons.push({
      rule: 'f3',
      weight: WEIGHTS.amount2pct,
      detail: `amount ${amt.irmAmountMinor} within 2% of FOB ${candidate.fobMinor}`,
    });
  } else if (amt.ok5pct) {
    score += WEIGHTS.amount5pct;
    amountVerified = true;
    reasons.push({
      rule: 'f4',
      weight: WEIGHTS.amount5pct,
      detail: `amount ${amt.irmAmountMinor} within 5% of FOB ${candidate.fobMinor} (charges considered)`,
    });
  }

  const nameSim = nameSimilarity(fields.orderingName, candidate.buyerName);
  if (nameSim > 0) {
    const w = WEIGHTS.f5 * nameSim;
    score += w;
    reasons.push({
      rule: 'f5',
      weight: Number(w.toFixed(4)),
      detail: `sender name '${fields.orderingName}' ~ buyer '${candidate.buyerName}' (sim ${nameSim.toFixed(2)})`,
    });
  }

  if (fields.orderingCountry && fields.orderingCountry === candidate.buyerCountry) {
    score += WEIGHTS.f6;
    reasons.push({
      rule: 'f6',
      weight: WEIGHTS.f6,
      detail: `sender country ${fields.orderingCountry} == buyer country ${candidate.buyerCountry}`,
    });
  }

  const tenorDays = daysBetween(candidate.leoTs, creditTs);
  if (tenorDays >= 30 && tenorDays <= 180) {
    score += WEIGHTS.f7;
    reasons.push({
      rule: 'f7',
      weight: WEIGHTS.f7,
      detail: `tenor ${Math.round(tenorDays)}d plausible (30-180d)`,
    });
  }

  return { score: Math.min(1, score), reasons, refFound: sbHit || invHit, amountVerified };
}
