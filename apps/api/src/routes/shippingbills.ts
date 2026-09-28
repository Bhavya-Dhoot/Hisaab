import type { FastifyInstance } from 'fastify';
import { db, fromJson } from '../db.js';
import { requireAuth } from '../auth.js';
import { loadVc } from '../ebrc.js';

export function getSbTimeline(sbHash: string) {
  const sb = db.prepare(`select * from shipping_bills where sb_hash = ?`).get(sbHash) as
    | Record<string, unknown>
    | undefined;
  if (!sb) return null;

  const offers = db.prepare(`select * from offers where sb_hash = ? order by created_at`).all(sbHash);
  const financing = db.prepare(`select * from financings where sb_hash = ?`).get(sbHash);
  const realisations = db.prepare(`select * from realisations where sb_hash = ?`).all(sbHash);
  const payouts = db.prepare(`select * from payouts where sb_hash = ? order by created_at`).all(sbHash);
  const events = db
    .prepare(`select block_no, tx_hash, name, args, ts from chain_events where args like ? order by block_no`)
    .all(`%${sbHash}%`);
  const vc = loadVc(sbHash);

  return {
    sbHash,
    sbNo: sb.sb_no,
    iec: sb.iec,
    state: sb.state,
    fobMinor: sb.fob_minor,
    ccy: sb.ccy,
    fobInrMinor: sb.fob_inr_minor,
    buyerName: sb.buyer_name,
    buyerCountry: sb.buyer_country,
    invoiceNos: fromJson<string[]>(sb.invoice_nos as string, []),
    chainTx: sb.chain_tx,
    offers,
    financing: financing ?? null,
    realisations,
    payouts,
    ebrc: vc,
    events,
  };
}

export default async function shippingBillRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sbHash: string } }>(
    '/v1/shipping-bills/:sbHash',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const t = getSbTimeline(req.params.sbHash);
      if (!t) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Unknown shipping bill' } };
      }
      return t;
    }
  );

  app.get<{ Params: { sbHash: string } }>(
    '/v1/shipping-bills/:sbHash/offers',
    { preHandler: [requireAuth] },
    async (req) => {
      const offers = db
        .prepare(`select * from offers where sb_hash = ? and status = 'OPEN' order by created_at`)
        .all(req.params.sbHash);
      return { offers };
    }
  );

  app.get<{ Params: { sbHash: string } }>(
    '/v1/shipping-bills/:sbHash/ebrc',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const vc = loadVc(req.params.sbHash);
      if (!vc) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'eBRC not yet issued' } };
      }
      return { vc, uri: `file://raw/ebrc-${req.params.sbHash}.json` };
    }
  );
}
