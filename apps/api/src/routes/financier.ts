import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth, requireKind } from '../auth.js';
import { contracts } from '../ledger.js';

export default async function financierRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { minFob?: string; country?: string } }>('/v1/market/receivables', async (req) => {
    const rows = db.prepare(`select * from shipping_bills where state = 'OPEN' order by created_at desc`).all() as Record<
      string,
      unknown
    >[];
    const filtered = rows.filter((sb) => {
      if (req.query.minFob && (sb.fob_minor as number) < Number(req.query.minFob) * 100) return false;
      if (req.query.country && sb.buyer_country !== req.query.country) return false;
      return true;
    });
    const out = filtered.map((sb) => {
      const realisedCount = (
        db
          .prepare(
            `select count(*) as n from realisations r join shipping_bills s on s.sb_hash = r.sb_hash where s.iec = ?`
          )
          .get(sb.iec as string) as { n: number }
      ).n;
      return { ...sb, risk: { buyerCountry: sb.buyer_country, exporterRealisedCount: realisedCount } };
    });
    return { receivables: out };
  });

  app.post<{ Body: { sbHash: string; advancePct: number; rateBps: number; validUntil: string } }>(
    '/v1/offers',
    { preHandler: [requireAuth, requireKind('FINANCIER')] },
    async (req, reply) => {
      if (req.body.advancePct > 90) {
        reply.code(400);
        return { error: { code: 'ADVANCE_PCT_TOO_HIGH', message: 'advancePct must be <= 90' } };
      }
      const sb = db.prepare(`select sb_hash from shipping_bills where sb_hash = ?`).get(req.body.sbHash);
      if (!sb) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Unknown shipping bill' } };
      }
      const id = randomUUID();
      db.prepare(
        `insert into offers (id, sb_hash, financier_id, advance_pct, rate_bps, valid_until, status) values (?, ?, ?, ?, ?, ?, 'OPEN')`
      ).run(id, req.body.sbHash, req.org!.orgId, req.body.advancePct, req.body.rateBps, req.body.validUntil);
      reply.code(201);
      return { id };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/offers/:id',
    { preHandler: [requireAuth, requireKind('FINANCIER')] },
    async (req, reply) => {
      const offer = db.prepare(`select * from offers where id = ?`).get(req.params.id) as
        | { id: string; financier_id: string; status: string }
        | undefined;
      if (!offer || offer.financier_id !== req.org!.orgId) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Offer not found' } };
      }
      if (offer.status !== 'OPEN') {
        reply.code(409);
        return { error: { code: 'NOT_OPEN', message: 'Offer is not open' } };
      }
      db.prepare(`update offers set status = 'WITHDRAWN' where id = ?`).run(offer.id);
      return { status: 'WITHDRAWN' };
    }
  );

  app.get('/v1/me/book', { preHandler: [requireAuth, requireKind('FINANCIER')] }, async (req) => {
    const rows = db
      .prepare(
        `select f.*, s.sb_no, s.state, s.fob_inr_minor from financings f join shipping_bills s on s.sb_hash = f.sb_hash where f.financier_id = ?`
      )
      .all(req.org!.orgId);
    return { book: rows };
  });

  app.get<{ Params: { sbHash: string } }>(
    '/v1/me/book/:sbHash/waterfall',
    { preHandler: [requireAuth, requireKind('FINANCIER')] },
    async (req, reply) => {
      const sb = db.prepare(`select fob_inr_minor from shipping_bills where sb_hash = ?`).get(req.params.sbHash) as
        | { fob_inr_minor: number }
        | undefined;
      if (!sb) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Unknown shipping bill' } };
      }
      const wf = await contracts.engine.computeWaterfall(req.params.sbHash, BigInt(sb.fob_inr_minor));
      return {
        realisedInr: Number(wf.realisedInr),
        financierDue: Number(wf.financierDue),
        platformFee: Number(wf.platformFee),
        exporterBalance: Number(wf.exporterBalance),
        shortfall: Number(wf.shortfall),
      };
    }
  );

  app.get('/v1/me/alerts', { preHandler: [requireAuth, requireKind('FINANCIER')] }, async (req) => {
    const rows = db.prepare(`select * from alerts where org_id = ? order by created_at desc`).all(req.org!.orgId);
    return { alerts: rows };
  });
}
