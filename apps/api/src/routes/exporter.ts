import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth, requireKind, orgById } from '../auth.js';
import { sendTx, ApiError } from '../ledger.js';
import { applyReceipt } from '../projector.js';
import { payoutId } from '../payouts.js';

export default async function exporterRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { state?: string } }>(
    '/v1/me/shipping-bills',
    { preHandler: [requireAuth, requireKind('EXPORTER')] },
    async (req) => {
      const state = req.query.state;
      const rows = db
        .prepare(
          state
            ? `select * from shipping_bills where exporter_id = ? and state = ? order by created_at desc`
            : `select * from shipping_bills where exporter_id = ? order by created_at desc`
        )
        .all(...(state ? [req.org!.orgId, state] : [req.org!.orgId])) as Record<string, unknown>[];
      const out = rows.map((sb) => {
        const offersCount = (
          db.prepare(`select count(*) as n from offers where sb_hash = ? and status = 'OPEN'`).get(sb.sb_hash as string) as {
            n: number;
          }
        ).n;
        return {
          ...sb,
          financeableInrMinor: sb.state === 'OPEN' ? sb.fob_inr_minor : 0,
          offersCount,
        };
      });
      return { shippingBills: out };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/v1/offers/:id/accept',
    { preHandler: [requireAuth, requireKind('EXPORTER')] },
    async (req, reply) => {
      const offer = db.prepare(`select * from offers where id = ?`).get(req.params.id) as
        | { id: string; sb_hash: string; financier_id: string; advance_pct: number; rate_bps: number; status: string }
        | undefined;
      if (!offer) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Offer not found' } };
      }
      const sb = db.prepare(`select * from shipping_bills where sb_hash = ?`).get(offer.sb_hash) as
        | { sb_hash: string; exporter_id: string; fob_minor: number; fob_inr_minor: number }
        | undefined;
      if (!sb) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Shipping bill not found' } };
      }
      if (sb.exporter_id !== req.org!.orgId) {
        reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Not your shipping bill' } };
      }
      const exporterOrg = orgById(req.org!.orgId)!;
      const financierOrg = orgById(offer.financier_id);
      if (!financierOrg) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Financier org not found' } };
      }
      const advanceInrMinor = Math.round((sb.fob_inr_minor * offer.advance_pct) / 100);

      try {
        const receipt = await sendTx('ReceivableToken', exporterOrg.signer_index, 'lock', [
          BigInt(sb.sb_hash),
          financierOrg.chain_addr,
          BigInt(sb.fob_minor),
          BigInt(advanceInrMinor),
          offer.rate_bps,
        ]);
        applyReceipt(receipt);
        return {
          chainTx: receipt.hash,
          advanceInrMinor,
          payoutId: payoutId(sb.sb_hash, 'ADVANCE'),
        };
      } catch (err) {
        if (err instanceof ApiError && err.code === 'ALREADY_LOCKED') {
          db.prepare(`update offers set status = 'REJECTED_LOCKED' where id = ?`).run(offer.id);
          db.prepare(`insert into alerts (id, type, message, sb_hash, org_id) values (?, 'DOUBLE_FINANCE_ATTEMPT', ?, ?, ?)`).run(
            randomUUID(),
            `Offer ${offer.id} rejected. SB ${sb.sb_hash} is already locked by another financier.`,
            sb.sb_hash,
            offer.financier_id
          );
          reply.code(409);
          return { error: { code: 'ALREADY_LOCKED', message: err.message, chainTx: err.chainTx } };
        }
        throw err;
      }
    }
  );

  app.get('/v1/me/payouts', { preHandler: [requireAuth, requireKind('EXPORTER')] }, async (req) => {
    const rows = db.prepare(`select * from payouts where to_org = ? order by created_at desc`).all(req.org!.orgId);
    return { payouts: rows };
  });
}
