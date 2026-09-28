import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { match, heuristicExtractor, anthropicExtractor } from '@hisab/matcher';
import type { Candidate, Extractor, MatchConfig } from '@hisab/matcher';
import { db, toJson, fromJson } from './db.js';
import { config, RAW_DIR } from './config.js';
import { sendTx, ACCOUNT_INDEX } from './ledger.js';
import { applyReceipt } from './projector.js';
import { publish } from './bus.js';

function buildExtractor(): Extractor {
  const heuristic = heuristicExtractor();
  if (!config.anthropicApiKey) return heuristic;
  const anthro = anthropicExtractor(config.anthropicApiKey);
  return async (input) => {
    try {
      return await anthro(input);
    } catch (err) {
      console.warn('[matching] anthropicExtractor failed, falling back to heuristic:', (err as Error)?.message);
      return heuristic(input);
    }
  };
}

function getOpsConfig(): MatchConfig {
  const row = db.prepare(`select auto, review, tolerance_pct from ops_config where id = 1`).get() as {
    auto: number;
    review: number;
    tolerance_pct: number;
  };
  return { auto: row.auto, review: row.review, tolerancePct: row.tolerance_pct };
}

function loadCandidates(iec: string): Candidate[] {
  const rows = db
    .prepare(
      `select sb_hash, sb_no, invoice_nos, fob_minor, ccy, fob_inr_minor, buyer_name, buyer_country, leo_ts, state
       from shipping_bills where iec = ? and state in ('OPEN','FINANCED','PARTIAL')`
    )
    .all(iec) as {
    sb_hash: string;
    sb_no: string;
    invoice_nos: string;
    fob_minor: number;
    ccy: string;
    fob_inr_minor: number;
    buyer_name: string;
    buyer_country: string;
    leo_ts: string;
    state: string;
  }[];
  return rows.map((r) => ({
    sbHash: r.sb_hash,
    sbNo: r.sb_no,
    invoiceNos: fromJson<string[]>(r.invoice_nos, []),
    fobMinor: r.fob_minor,
    ccy: r.ccy,
    fobInrMinor: r.fob_inr_minor,
    buyerName: r.buyer_name,
    buyerCountry: r.buyer_country,
    leoTs: r.leo_ts,
    state: r.state,
  }));
}

export async function runMatch(irmHash: string): Promise<void> {
  const remit = db.prepare(`select * from remittances where irm_hash = ?`).get(irmHash) as
    | {
        irm_hash: string;
        amount_minor: number;
        ccy: string;
        inr_minor: number;
        credit_ts: string;
        beneficiary_iec: string;
        charges_minor: number | null;
      }
    | undefined;
  if (!remit) return;

  const rawFile = JSON.parse(readFileSync(path.join(RAW_DIR, `irm-${irmHash}.json`), 'utf8')) as { raw: string };

  const candidates = loadCandidates(remit.beneficiary_iec);
  const cfg = getOpsConfig();
  const extractor = buildExtractor();

  const result = await match(
    { raw: rawFile.raw, creditedInrMinor: remit.inr_minor, chargesMinor: remit.charges_minor ?? undefined, creditTs: remit.credit_ts, beneficiaryIec: remit.beneficiary_iec },
    candidates,
    cfg,
    extractor
  );

  db.prepare(`insert into match_log (id, irm_hash, band, llm_used) values (?, ?, ?, ?)`).run(
    randomUUID(),
    irmHash,
    result.band,
    result.llmUsed ? 1 : 0
  );

  for (const c of result.topCandidates) {
    const alloc = result.allocations.find((a) => a.sbHash === c.sbHash);
    db.prepare(
      `insert into match_candidates (id, irm_hash, sb_hash, confidence, reasons, proposed_minor, source, status) values (?, ?, ?, ?, ?, ?, ?, 'PENDING')`
    ).run(randomUUID(), irmHash, c.sbHash, c.confidence, toJson(c.reasons), alloc?.allocInrMinor ?? 0, c.source);
  }

  publish(
    'match.proposed',
    { irmHash, band: result.band, candidates: result.topCandidates },
    `Remittance matched (${result.band.toLowerCase()}, ${(result.topCandidates[0]?.confidence ?? 0).toFixed(2)} confidence).`
  );

  if (result.band === 'AUTO') {
    for (const alloc of result.allocations) {
      const receipt = await sendTx('RealisationEngine', ACCOUNT_INDEX.adBank, 'realise', [
        alloc.sbHash,
        irmHash,
        BigInt(alloc.allocInrMinor),
        Math.round(alloc.confidence * 100),
      ]);
      applyReceipt(receipt);
    }
    db.prepare(`update remittances set state = 'MATCHED' where irm_hash = ?`).run(irmHash);
  } else if (result.band === 'REVIEW') {
    db.prepare(`insert into ops_queue (id, irm_hash, status) values (?, ?, 'PENDING')`).run(randomUUID(), irmHash);
  } else {
    db.prepare(`update remittances set state = 'UNMATCHED' where irm_hash = ?`).run(irmHash);
    const alertId = randomUUID();
    db.prepare(`insert into alerts (id, type, message, irm_hash) values (?, 'UNMATCHED_REMITTANCE', ?, ?)`).run(
      alertId,
      `Remittance ${irmHash.slice(0, 10)}... could not be matched with confidence. Routed to alert.`,
      irmHash
    );
    publish('alert', { irmHash, alerts: result.alerts }, `Remittance unmatched. Needs manual review.`);
  }
}
