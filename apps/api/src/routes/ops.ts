import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { parseMT103 } from '@hisab/matcher';
import { db } from '../db.js';
import { RAW_DIR } from '../config.js';
import { requireAuth, requireKind } from '../auth.js';
import { sendTx, ACCOUNT_INDEX } from '../ledger.js';
import { applyReceipt } from '../projector.js';

export default async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string } }>(
    '/v1/ops/queue',
    { preHandler: [requireAuth, requireKind('HISAB_OPS')] },
    async (req) => {
      const status = req.query.status ?? 'PENDING';
      const rows = db.prepare(`select * from ops_queue where status = ? order by created_at`).all(status) as {
        id: string;
        irm_hash: string;
      }[];
      const out = rows.map((row) => {
        const remit = db.prepare(`select * from remittances where irm_hash = ?`).get(row.irm_hash);
        const candidates = db
          .prepare(`select * from match_candidates where irm_hash = ? order by confidence desc limit 3`)
          .all(row.irm_hash);
        return { ...row, remittance: remit, candidates };
      });
      return { queue: out };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/v1/ops/queue/:id',
    { preHandler: [requireAuth, requireKind('HISAB_OPS')] },
    async (req, reply) => {
      const item = db.prepare(`select * from ops_queue where id = ?`).get(req.params.id) as
        | { id: string; irm_hash: string }
        | undefined;
      if (!item) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Ops queue item not found' } };
      }
      const remit = db.prepare(`select * from remittances where irm_hash = ?`).get(item.irm_hash) as
        | { irm_hash: string }
        | undefined;
      const rawPath = path.join(RAW_DIR, `irm-${item.irm_hash}.json`);
      const raw = fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : null;
      const parsed = raw?.raw ? parseMT103(raw.raw as string) : null;
      const candidates = db.prepare(`select * from match_candidates where irm_hash = ? order by confidence desc`).all(item.irm_hash);
      return { ...item, remittance: remit, rawMt103: raw?.raw ?? null, parsed, candidates };
    }
  );

  app.post<{ Params: { id: string }; Body: { sbHash: string; allocInrMinor?: number; note?: string } }>(
    '/v1/ops/queue/:id/approve',
    { preHandler: [requireAuth, requireKind('HISAB_OPS')] },
    async (req, reply) => {
      const item = db.prepare(`select * from ops_queue where id = ?`).get(req.params.id) as
        | { id: string; irm_hash: string; status: string }
        | undefined;
      if (!item) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Ops queue item not found' } };
      }
      const candidate = db
        .prepare(`select * from match_candidates where irm_hash = ? and sb_hash = ?`)
        .get(item.irm_hash, req.body.sbHash) as
        | { id: string; confidence: number; proposed_minor: number }
        | undefined;
      if (!candidate) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'No candidate for that sbHash on this queue item' } };
      }
      const allocInrMinor = req.body.allocInrMinor ?? candidate.proposed_minor;
      const confidencePct = Math.round(candidate.confidence * 100);

      const receipt = await sendTx('RealisationEngine', ACCOUNT_INDEX.ops, 'realise', [
        req.body.sbHash,
        item.irm_hash,
        BigInt(allocInrMinor),
        confidencePct,
      ]);
      applyReceipt(receipt);
      db.prepare(`update match_candidates set status = 'APPROVED' where id = ?`).run(candidate.id);

      const remaining = db
        .prepare(`select count(*) as n from match_candidates where irm_hash = ? and proposed_minor > 0 and status = 'PENDING'`)
        .get(item.irm_hash) as { n: number };
      if (remaining.n === 0) {
        db.prepare(
          `update ops_queue set status = 'APPROVED', decided_by = ?, decision_tx = ?, decided_at = datetime('now'), note = ? where id = ?`
        ).run(req.org!.orgId, receipt.hash, req.body.note ?? null, item.id);
        db.prepare(`update remittances set state = 'MATCHED' where irm_hash = ?`).run(item.irm_hash);
      }
      return { chainTx: receipt.hash };
    }
  );

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/v1/ops/queue/:id/reject',
    { preHandler: [requireAuth, requireKind('HISAB_OPS')] },
    async (req, reply) => {
      const item = db.prepare(`select * from ops_queue where id = ?`).get(req.params.id) as
        | { id: string; irm_hash: string }
        | undefined;
      if (!item) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Ops queue item not found' } };
      }
      db.prepare(
        `update ops_queue set status = 'REJECTED', decided_by = ?, decided_at = datetime('now'), note = ? where id = ?`
      ).run(req.org!.orgId, req.body.reason, item.id);
      db.prepare(`update remittances set state = 'SUSPENSE' where irm_hash = ?`).run(item.irm_hash);
      return { status: 'REJECTED' };
    }
  );

  app.get('/v1/ops/config', { preHandler: [requireAuth, requireKind('HISAB_OPS')] }, async () => {
    const row = db.prepare(`select auto, review, tolerance_pct as tolerancePct from ops_config where id = 1`).get();
    return row;
  });

  app.put<{ Body: { auto: number; review: number; tolerancePct: number } }>(
    '/v1/ops/config',
    { preHandler: [requireAuth, requireKind('HISAB_OPS')] },
    async (req) => {
      db.prepare(`update ops_config set auto = ?, review = ?, tolerance_pct = ? where id = 1`).run(
        req.body.auto,
        req.body.review,
        req.body.tolerancePct
      );
      return { ok: true };
    }
  );

  // Not in API_SPEC.md but a small, low-risk addition for ops-only debugging/e2e polling
  // of a remittance's read-model state (RECEIVED/MATCHED/UNMATCHED/SUSPENSE).
  app.get<{ Params: { irmHash: string } }>(
    '/v1/ops/remittances/:irmHash',
    { preHandler: [requireAuth, requireKind('HISAB_OPS')] },
    async (req, reply) => {
      const remit = db.prepare(`select * from remittances where irm_hash = ?`).get(req.params.irmHash);
      if (!remit) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Unknown IRM' } };
      }
      return remit;
    }
  );
}
