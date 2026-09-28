import type { FastifyInstance } from 'fastify';
import { PRESETS, type PresetSb } from '@hisab/matcher';
import { db } from '../db.js';
import { mockUpiPayout, setDebugForceFailCount } from '../upi.js';
import { ingestSb, ingestIrm } from '../ingest.js';
import { verifyEbrc } from '../ebrc.js';
import { getSimulatedNow } from '../ledger.js';

interface SbRow {
  sb_hash: string;
  sb_no: string;
  iec: string;
  invoice_nos: string;
  fob_minor: number;
  ccy: string;
  buyer_name: string;
  buyer_country: string;
  bundle_group: string | null;
}

const ICEGATE_PRESETS: Record<string, { hs: string[]; fobRange: [number, number]; buyer: { name: string; country: string } }> = {
  textile: { hs: ['6109.10'], fobRange: [15000, 60000], buyer: { name: 'ACME TEXTILES IMPORTS LLC', country: 'US' } },
  pharma: { hs: ['3004.90'], fobRange: [30000, 120000], buyer: { name: 'GLOBAL PHARMA DISTRIBUTORS BV', country: 'NL' } },
  auto: { hs: ['8708.99'], fobRange: [20000, 80000], buyer: { name: 'MERIDIAN AUTO PARTS GMBH', country: 'DE' } },
};

export default async function mockRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { idempotencyKey: string; vpa: string; amountMinor: number; note?: string }; Querystring: { fail?: string } }>(
    '/mock/upi/payout',
    async (req) => {
      const resp = await mockUpiPayout({ ...req.body, forceFail: req.query.fail === '1' });
      return resp;
    }
  );

  app.post<{ Body: { count?: number } }>('/mock/upi/debug-fail-next', async (req) => {
    setDebugForceFailCount(req.body?.count ?? 1);
    return { ok: true };
  });

  app.post<{ Querystring: { preset?: string; exporterIec?: string } }>('/mock/icegate/generate', async (req, reply) => {
    const preset = ICEGATE_PRESETS[req.query.preset ?? 'textile'] ?? ICEGATE_PRESETS.textile;
    const exporter = req.query.exporterIec
      ? (db.prepare(`select iec from orgs where iec = ?`).get(req.query.exporterIec) as { iec: string } | undefined)
      : (db.prepare(`select iec from orgs where kind = 'EXPORTER' order by random() limit 1`).get() as { iec: string } | undefined);
    if (!exporter) {
      reply.code(400);
      return { error: { code: 'NO_EXPORTER', message: 'No exporter org seeded' } };
    }
    const fob = preset.fobRange[0] + Math.round(Math.random() * (preset.fobRange[1] - preset.fobRange[0]));
    const sbNo = String(6600000 + Math.floor(Math.random() * 99999));
    const invoiceNo = `2024-25/${String(1000 + Math.floor(Math.random() * 8999))}`;
    const result = await ingestSb({
      sbNo,
      sbDate: new Date().toISOString().slice(0, 10),
      iec: exporter.iec,
      portCode: 'INNSA1',
      leoTs: new Date().toISOString(),
      invoices: [{ no: invoiceNo, fob, ccy: 'USD' }],
      buyer: preset.buyer,
      hsCodes: preset.hs,
    });
    return result;
  });

  app.post<{ Querystring: { preset: keyof typeof PRESETS; sbHash: string } }>('/mock/swift/generate', async (req, reply) => {
    const sb = db.prepare(`select * from shipping_bills where sb_hash = ?`).get(req.query.sbHash) as SbRow | undefined;
    if (!sb) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Unknown sbHash' } };
    }
    const presetFn = PRESETS[req.query.preset];
    if (!presetFn) {
      reply.code(400);
      return { error: { code: 'BAD_PRESET', message: `Unknown preset ${req.query.preset}` } };
    }
    const primary: PresetSb = {
      sbNo: sb.sb_no,
      invoiceNos: JSON.parse(sb.invoice_nos),
      fobMinor: sb.fob_minor,
      ccy: sb.ccy,
      buyerName: sb.buyer_name,
      buyerCountry: sb.buyer_country,
    };

    let second: PresetSb | undefined;
    let chargesMinor: number | undefined;
    if (req.query.preset === 'bundle') {
      if (!sb.bundle_group) {
        reply.code(400);
        return { error: { code: 'NO_BUNDLE_PARTNER', message: 'This SB has no bundle_group partner' } };
      }
      const partner = db
        .prepare(`select * from shipping_bills where bundle_group = ? and sb_hash != ? limit 1`)
        .get(sb.bundle_group, sb.sb_hash) as SbRow | undefined;
      if (!partner) {
        reply.code(400);
        return { error: { code: 'NO_BUNDLE_PARTNER', message: 'No open bundle partner found' } };
      }
      second = {
        sbNo: partner.sb_no,
        invoiceNos: JSON.parse(partner.invoice_nos),
        fobMinor: partner.fob_minor,
        ccy: partner.ccy,
        buyerName: partner.buyer_name,
        buyerCountry: partner.buyer_country,
      };
      chargesMinor = 4500;
    }

    const raw = presetFn(primary, second ? { second } : undefined);
    const result = await ingestIrm({
      bankRef: `SWIFT-${req.query.preset.toUpperCase()}-${Date.now()}`,
      msgType: 'MT103',
      raw,
      chargesMinor,
      creditTs: await getSimulatedNow(),
      beneficiaryIec: sb.iec,
    });
    return result;
  });

  app.get<{ Querystring: { vcHash: string; sbHash?: string } }>('/mock/dgft/ebrc/verify', async (req, reply) => {
    let sbHash = req.query.sbHash;
    if (!sbHash) {
      const row = db.prepare(`select sb_hash from realisations where ebrc_vc_hash = ?`).get(req.query.vcHash) as
        | { sb_hash: string }
        | undefined;
      sbHash = row?.sb_hash;
    }
    if (!sbHash) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'No eBRC for that vcHash' } };
    }
    const result = await verifyEbrc(sbHash, req.query.vcHash);
    return { ...result, message: result.valid ? 'DGFT ACCEPTED' : 'DGFT REJECTED' };
  });
}
