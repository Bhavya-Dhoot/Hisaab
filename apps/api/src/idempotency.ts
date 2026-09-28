import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';

/** Wraps a POST handler so a repeated `Idempotency-Key` header replays the original
 * response instead of re-executing (and re-hitting the chain). */
export async function withIdempotency<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<{ status: number; body: T }>
): Promise<T> {
  const key = req.headers['idempotency-key'] as string | undefined;
  if (key) {
    const cached = db.prepare(`select status_code, response from idempotency_keys where key = ?`).get(key) as
      | { status_code: number; response: string }
      | undefined;
    if (cached) {
      reply.code(cached.status_code);
      return JSON.parse(cached.response) as T;
    }
  }
  const { status, body } = await fn();
  reply.code(status);
  if (key) {
    db.prepare(
      `insert or ignore into idempotency_keys (key, method, path, status_code, response) values (?, ?, ?, ?, ?)`
    ).run(key, req.method, req.url, status, JSON.stringify(body));
  }
  return body;
}
