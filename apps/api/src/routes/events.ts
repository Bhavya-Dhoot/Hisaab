import type { FastifyInstance } from 'fastify';
import { registerSse } from '../bus.js';

export default async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    registerSse(reply);
    req.raw.on('close', () => reply.raw.end());
    // keep the handler alive; fastify won't finish the response until the socket closes
    await new Promise<void>((resolve) => {
      req.raw.on('close', () => resolve());
    });
  });
}
