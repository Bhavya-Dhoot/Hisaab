import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { RAW_DIR } from '../config.js';
import { db } from '../db.js';
import { provider, revertToSnapshot } from '../ledger.js';
import { resetUpiStore } from '../upi.js';
import { setPollingPaused } from '../projector.js';

const RESETTABLE_TABLES = [
  'chain_events',
  'orgs',
  'shipping_bills',
  'offers',
  'financings',
  'remittances',
  'match_candidates',
  'realisations',
  'payouts',
  'ops_queue',
  'idempotency_keys',
  'webhooks',
  'alerts',
  'match_log',
];

export default async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { days: number } }>('/v1/demo/advance-time', async (req) => {
    const days = req.body?.days ?? 1;
    await provider.send('evm_increaseTime', [days * 86400]);
    await provider.send('evm_mine', []);
    return { ok: true, days };
  });

  app.post('/v1/demo/reset', async () => {
    setPollingPaused(true);
    try {
      const reverted = await revertToSnapshot();
      for (const t of RESETTABLE_TABLES) db.exec(`delete from ${t};`);
      db.prepare(`update projector_cursor set last_block = -1 where id = 1`).run();
      // VCs are keyed by sbHash, which is identical after a reseed; stale files would skip re-anchoring
      for (const f of fs.readdirSync(RAW_DIR)) if (f.startsWith('ebrc-')) fs.rmSync(path.join(RAW_DIR, f));
      resetUpiStore();
      return { ok: true, chainReverted: reverted };
    } finally {
      setPollingPaused(false);
    }
  });
}
