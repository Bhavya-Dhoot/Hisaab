import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth, requireKind } from '../auth.js';
import { verifyEbrc } from '../ebrc.js';

export default async function explorerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sbHash: string } }>(
    '/v1/explorer/shipping-bills/:sbHash',
    { preHandler: [requireAuth, requireKind('DGFT', 'HISAB_OPS')] },
    async (req, reply) => {
      const sb = db
        .prepare(`select sb_hash, state, ccy, fob_minor, fob_inr_minor, chain_tx, created_at from shipping_bills where sb_hash = ?`)
        .get(req.params.sbHash);
      if (!sb) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Unknown shipping bill' } };
      }
      const realisations = db
        .prepare(`select irm_hash, realised_minor, matched_by, confidence, ebrc_vc_hash, chain_tx, realised_ts from realisations where sb_hash = ?`)
        .all(req.params.sbHash);
      return { ...sb, realisations };
    }
  );

  app.get<{ Querystring: { sbHash: string; vcHash?: string } }>('/v1/explorer/ebrc/verify', async (req, reply) => {
    if (!req.query.sbHash) {
      reply.code(400);
      return { error: { code: 'BAD_REQUEST', message: 'sbHash is required' } };
    }
    const result = await verifyEbrc(req.query.sbHash, req.query.vcHash);
    return result;
  });

  app.get('/v1/explorer/stats', async () => {
    const volume = db.prepare(`select coalesce(sum(realised_minor),0) as v from realisations`).get() as { v: number };
    const times = db
      .prepare(`select realised_ts, ebrc_ts from realisations where ebrc_ts is not null`)
      .all() as { realised_ts: string; ebrc_ts: string }[];
    const diffsSec = times
      .map((t) => (new Date(t.ebrc_ts).getTime() - new Date(t.realised_ts).getTime()) / 1000)
      .sort((a, b) => a - b);
    const medianTimeToEbrcSec = diffsSec.length ? diffsSec[Math.floor(diffsSec.length / 2)] : null;
    const total = db.prepare(`select count(*) as n from match_log`).get() as { n: number };
    const autoCount = db.prepare(`select count(*) as n from match_log where band = 'AUTO'`).get() as { n: number };
    const llmCount = db.prepare(`select count(*) as n from match_log where llm_used = 1`).get() as { n: number };
    return {
      realisedVolumeInrMinor: volume.v,
      medianTimeToEbrcSec,
      autoMatchRate: total.n ? autoCount.n / total.n : null,
      llmCallRate: total.n ? llmCount.n / total.n : null,
      totalMatchAttempts: total.n,
    };
  });
}
