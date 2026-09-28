import { parseMT103 } from './parse.js';
import {
  filterCandidates,
  normalizeAlnum,
  scoreCandidate,
  checkAmount,
  type RuleScoreResult,
} from './rules.js';
import type {
  Allocation,
  Candidate,
  Extraction,
  Extractor,
  IRMInput,
  MatchConfig,
  MatchResult,
  MT103Fields,
  Reason,
} from './types.js';

/**
 * Hard sanity gate, not in the spec's weighted-sum model: a gross amount mismatch
 * (e.g. the `fraud` preset's 3x FOB) must never ride a strong ref/name match into
 * REVIEW. Anything beyond this deviation is capped low and flagged, documented in
 * the README alongside the other weight-calibration deviations.
 */
const FRAUD_HARD_DEVIATION = 0.3; // 30%
const FRAUD_CAPPED_SCORE = 0.41;

function refMatches(ref: string, candidateRef: string): boolean {
  const a = normalizeAlnum(ref);
  const b = normalizeAlnum(candidateRef);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function findMatchingCandidates(
  ref: string,
  candidates: Candidate[]
): { candidate: Candidate; type: 'SB' | 'INV' }[] {
  const hits: { candidate: Candidate; type: 'SB' | 'INV' }[] = [];
  for (const c of candidates) {
    if (refMatches(ref, c.sbNo)) hits.push({ candidate: c, type: 'SB' });
    if (c.invoiceNos.some((inv) => refMatches(ref, inv))) hits.push({ candidate: c, type: 'INV' });
  }
  return hits;
}

function deductionsMinorFor(extraction: Extraction, ccy: string): number {
  return extraction.deductions
    .filter((d) => !d.ccy || d.ccy.toUpperCase() === ccy.toUpperCase())
    .reduce((sum, d) => sum + Math.round(d.amount * 100), 0);
}

function applyFraudGate(
  score: number,
  reasons: Reason[],
  irmAmountMinor: number,
  candidate: Candidate,
  cfg: MatchConfig,
  deductionsMinor: number,
  alerts: string[]
): number {
  const amt = checkAmount(irmAmountMinor, candidate.fobMinor, cfg.tolerancePct, deductionsMinor);
  if (amt.deviationPct > FRAUD_HARD_DEVIATION) {
    const alert = `amount ${amt.irmAmountMinor} deviates ${(amt.deviationPct * 100).toFixed(0)}% from FOB ${candidate.fobMinor} on SB ${candidate.sbNo} — possible fraud, tolerance check failed`;
    if (!alerts.includes(alert)) alerts.push(alert);
    return Math.min(score, FRAUD_CAPPED_SCORE);
  }
  return score;
}

function allocateProRata(
  matches: { sbHash: string; fobInrMinor: number }[],
  totalInrMinor: number
): Map<string, number> {
  const totalFob = matches.reduce((s, m) => s + m.fobInrMinor, 0);
  const shares = matches.map((m) => ({
    sbHash: m.sbHash,
    inrMinor: totalFob === 0 ? 0 : Math.floor((totalInrMinor * m.fobInrMinor) / totalFob),
  }));
  const allocated = shares.reduce((s, x) => s + x.inrMinor, 0);
  const remainder = totalInrMinor - allocated;
  if (remainder !== 0 && shares.length > 0) {
    let largest = shares[0];
    for (const s of shares) if (s.inrMinor > largest.inrMinor) largest = s;
    largest.inrMinor += remainder;
  }
  return new Map(shares.map((s) => [s.sbHash, s.inrMinor]));
}

function bandFor(score: number, cfg: MatchConfig): 'AUTO' | 'REVIEW' | 'UNMATCHED' {
  if (score >= cfg.auto) return 'AUTO';
  if (score >= cfg.review) return 'REVIEW';
  return 'UNMATCHED';
}

function toTopCandidate(
  candidate: Candidate,
  result: RuleScoreResult,
  irm: IRMInput,
  source: 'RULES' | 'LLM'
): Allocation {
  return {
    sbHash: candidate.sbHash,
    confidence: Number(result.score.toFixed(4)),
    reasons: result.reasons,
    allocInrMinor: irm.creditedInrMinor,
    source,
  };
}

export async function match(
  irm: IRMInput,
  candidates: Candidate[],
  cfg: MatchConfig,
  llm?: Extractor
): Promise<MatchResult> {
  const fields: MT103Fields = parseMT103(irm.raw);
  const filtered = filterCandidates(candidates, irm.creditTs);

  const alerts: string[] = [];
  const hallucinationSuspects: string[] = [];

  // Stage A: rules pass over every filtered candidate.
  const stageA = filtered.map((c) => ({
    candidate: c,
    result: scoreCandidate(c, fields, fields.amountMinor, cfg, irm.creditTs),
  }));
  stageA.sort((a, b) => b.result.score - a.result.score);
  const bestStageA = stageA[0];
  const stageAMax = bestStageA?.result.score ?? 0;

  let llmUsed = false;
  let finalCandidates: { candidate: Candidate; result: RuleScoreResult; source: 'RULES' | 'LLM' }[] = [];
  let multiInvoice = false;

  if (stageAMax >= cfg.auto) {
    // Rules alone are decisive — no need to call the LLM.
    finalCandidates = [{ candidate: bestStageA.candidate, result: bestStageA.result, source: 'RULES' }];
  } else if (llm) {
    llmUsed = true;
    const extraction = await llm({
      remitInfo: fields.remitInfo,
      senderInfo: [fields.orderingName, ...fields.orderingLines].join(', '),
      bankInfo: fields.senderToReceiverInfo,
    });

    const allRefs = [...extraction.invoiceRefs, ...extraction.shippingBillRefs];
    const matchedByCandidate = new Map<string, { candidate: Candidate; sb: boolean; inv: boolean }>();
    for (const ref of allRefs) {
      const hits = findMatchingCandidates(ref, filtered);
      if (hits.length === 0) {
        hallucinationSuspects.push(ref);
        continue;
      }
      for (const hit of hits) {
        const entry = matchedByCandidate.get(hit.candidate.sbHash) ?? {
          candidate: hit.candidate,
          sb: false,
          inv: false,
        };
        if (hit.type === 'SB') entry.sb = true;
        else entry.inv = true;
        matchedByCandidate.set(hit.candidate.sbHash, entry);
      }
    }

    const deductionsMinor = deductionsMinorFor(extraction, fields.ccy);
    const matched = [...matchedByCandidate.values()];
    multiInvoice = extraction.multiInvoice && matched.length >= 2;

    if (matched.length === 0) {
      // Nothing verified — fall back to the best Stage A candidate (may still be
      // review-worthy on amount + name alone).
      finalCandidates = bestStageA ? [{ candidate: bestStageA.candidate, result: bestStageA.result, source: 'RULES' }] : [];
    } else {
      for (const m of matched) {
        const recomputed = scoreCandidate(m.candidate, fields, fields.amountMinor, cfg, irm.creditTs, {
          sbRefFound: m.sb,
          invoiceRefFound: m.inv,
          deductionsMinor,
        });
        const cap = multiInvoice ? 0.9 : recomputed.amountVerified ? 0.95 : 0.9;
        const capped = Math.min(recomputed.score, cap);
        finalCandidates.push({
          candidate: m.candidate,
          result: { ...recomputed, score: capped },
          source: 'LLM',
        });
      }
      finalCandidates.sort((a, b) => b.result.score - a.result.score);
      if (!multiInvoice) finalCandidates = [finalCandidates[0]];

      if (extraction.notes) {
        for (const fc of finalCandidates) {
          fc.result.reasons.push({ rule: 'llm', weight: 0, detail: extraction.notes });
        }
      }
    }
  } else {
    finalCandidates = bestStageA ? [{ candidate: bestStageA.candidate, result: bestStageA.result, source: 'RULES' }] : [];
  }

  // Hard fraud/tolerance gate. For a single candidate the IRM amount is compared
  // directly against its FOB; for a multi-invoice bundle the legitimate amount is
  // split across SBs, so the gate instead checks the IRM amount against the
  // combined FOB of every matched SB.
  if (multiInvoice && finalCandidates.length > 1) {
    const totalFob = finalCandidates.reduce((s, f) => s + f.candidate.fobMinor, 0);
    const combined: Candidate = { ...finalCandidates[0].candidate, fobMinor: totalFob };
    for (const fc of finalCandidates) {
      fc.result.score = applyFraudGate(fc.result.score, fc.result.reasons, fields.amountMinor, combined, cfg, 0, alerts);
    }
  } else {
    for (const fc of finalCandidates) {
      fc.result.score = applyFraudGate(fc.result.score, fc.result.reasons, fields.amountMinor, fc.candidate, cfg, 0, alerts);
    }
  }

  const maxFinalScore = finalCandidates.length ? Math.max(...finalCandidates.map((f) => f.result.score)) : 0;
  const band = bandFor(maxFinalScore, cfg);

  let allocations: Allocation[] = [];
  if (band !== 'UNMATCHED' && finalCandidates.length > 0) {
    if (multiInvoice && finalCandidates.length > 1) {
      const shareMap = allocateProRata(
        finalCandidates.map((f) => ({ sbHash: f.candidate.sbHash, fobInrMinor: f.candidate.fobInrMinor })),
        irm.creditedInrMinor
      );
      allocations = finalCandidates.map((f) => ({
        sbHash: f.candidate.sbHash,
        confidence: Number(f.result.score.toFixed(4)),
        reasons: f.result.reasons,
        allocInrMinor: shareMap.get(f.candidate.sbHash) ?? 0,
        source: f.source,
      }));
    } else {
      const f = finalCandidates[0];
      allocations = [
        {
          sbHash: f.candidate.sbHash,
          confidence: Number(f.result.score.toFixed(4)),
          reasons: f.result.reasons,
          allocInrMinor: irm.creditedInrMinor,
          source: f.source,
        },
      ];
    }
  }

  const topCandidates = stageA
    .slice(0, 3)
    .map(({ candidate, result }) => {
      const chosen = finalCandidates.find((f) => f.candidate.sbHash === candidate.sbHash);
      return chosen
        ? toTopCandidate(candidate, chosen.result, irm, chosen.source)
        : toTopCandidate(candidate, result, irm, 'RULES');
    })
    .sort((a, b) => b.confidence - a.confidence);

  return {
    fields,
    band,
    allocations,
    topCandidates,
    llmUsed,
    hallucinationSuspects,
    alerts,
  };
}
