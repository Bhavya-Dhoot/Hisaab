import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { assertDeployed, takeSnapshot, ApiError } from './ledger.js';
import { startPolling } from './projector.js';
import authRoutes from './routes/auth.js';
import ingestRoutes from './routes/ingest.js';
import shippingBillRoutes from './routes/shippingbills.js';
import exporterRoutes from './routes/exporter.js';
import financierRoutes from './routes/financier.js';
import opsRoutes from './routes/ops.js';
import explorerRoutes from './routes/explorer.js';
import demoRoutes from './routes/demo.js';
import eventsRoutes from './routes/events.js';
import mockRoutes from './routes/mocks.js';

async function main(): Promise<void> {
  console.log('[api] verifying chain deployment...');
  await assertDeployed();
  await takeSnapshot();
  console.log('[api] chain OK, snapshot taken.');

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, { origin: true, exposedHeaders: ['Idempotency-Key'] });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      reply.code(err.status).send({ error: { code: err.code, message: err.message, chainTx: err.chainTx } });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(ingestRoutes);
  await app.register(shippingBillRoutes);
  await app.register(exporterRoutes);
  await app.register(financierRoutes);
  await app.register(opsRoutes);
  await app.register(explorerRoutes);
  await app.register(demoRoutes);
  await app.register(eventsRoutes);
  await app.register(mockRoutes);

  startPolling(1000);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[api] listening on :${config.port}`);
}

main().catch((err) => {
  console.error('[api] fatal startup error:', err);
  process.exit(1);
});
