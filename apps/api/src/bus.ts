import { EventEmitter } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { db, toJson } from './db.js';
import { config } from './config.js';

export const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const sseClients = new Set<FastifyReply>();

export function registerSse(reply: FastifyReply): void {
  sseClients.add(reply);
  reply.raw.on('close', () => sseClients.delete(reply));
}

/** Domain events per API_SPEC.md §6 + §10 (SSE for the UI's phone-buzz notifications). */
export type DomainEvent =
  | 'sb.registered'
  | 'token.locked'
  | 'payout.confirmed'
  | 'match.proposed'
  | 'sb.realised'
  | 'ebrc.issued'
  | 'alert';

const WEBHOOK_EVENTS: DomainEvent[] = [
  'sb.registered',
  'token.locked',
  'payout.confirmed',
  'match.proposed',
  'sb.realised',
  'ebrc.issued',
];

export function publish(event: DomainEvent, payload: Record<string, unknown>, humanText?: string): void {
  const envelope = { event, payload, text: humanText, ts: new Date().toISOString() };
  emitter.emit(event, envelope);
  const data = `event: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`;
  for (const client of sseClients) {
    try {
      client.raw.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
  if (WEBHOOK_EVENTS.includes(event)) {
    void deliverWebhook(event, payload);
  }
}

async function deliverWebhook(event: DomainEvent, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ event, payload });
  const signature = createHmac('sha256', config.webhookSecret).update(body).digest('hex');
  let responseCode: number | null = null;
  let delivered = 0;
  if (config.webhookUrl) {
    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Hisab-Signature': signature },
        body,
      });
      responseCode = res.status;
      delivered = res.ok ? 1 : 0;
    } catch {
      responseCode = null;
      delivered = 0;
    }
  }
  db.prepare(
    `insert into webhooks (id, event, payload, signature, delivered, response_code) values (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), event, toJson(payload), signature, delivered, responseCode);
}
