import type { FastifyInstance } from 'fastify';
import { requireAuth, requireKind } from '../auth.js';
import { withIdempotency } from '../idempotency.js';
import { ingestSb, ingestIrm, type SbIngestBody, type IrmIngestBody } from '../ingest.js';

export default async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SbIngestBody }>(
    '/v1/ingest/sb',
    { preHandler: [requireAuth, requireKind('CUSTOMS')] },
    async (req, reply) => {
      return withIdempotency(req, reply, async () => {
        const result = await ingestSb(req.body);
        return { status: 202, body: result };
      });
    }
  );

  app.post<{ Body: IrmIngestBody }>(
    '/v1/ingest/irm',
    { preHandler: [requireAuth, requireKind('AD_BANK')] },
    async (req, reply) => {
      return withIdempotency(req, reply, async () => {
        const result = await ingestIrm(req.body);
        return { status: 202, body: result };
      });
    }
  );
}
