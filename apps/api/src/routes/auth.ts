import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { signToken } from '../auth.js';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { orgId: string } }>('/v1/auth/login', async (req, reply) => {
    const org = db.prepare(`select * from orgs where id = ?`).get(req.body.orgId) as
      | { id: string; kind: string; name: string; chain_addr: string }
      | undefined;
    if (!org) {
      reply.code(404);
      return { error: { code: 'ORG_NOT_FOUND', message: `No org ${req.body.orgId}` } };
    }
    const token = signToken({ orgId: org.id, orgKind: org.kind, chainAddr: org.chain_addr, roles: [org.kind] });
    return { token, org: { id: org.id, kind: org.kind, name: org.name } };
  });

  app.get('/v1/orgs', async () => {
    const orgs = db.prepare(`select id, kind, name, iec from orgs order by kind, name`).all();
    return { orgs };
  });
}
