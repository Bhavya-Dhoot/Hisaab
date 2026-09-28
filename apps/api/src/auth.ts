import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';
import { config } from './config.js';

export interface OrgClaims {
  orgId: string;
  orgKind: string;
  chainAddr: string;
  roles: string[];
}

export function signToken(org: OrgClaims): string {
  return jwt.sign(org, config.jwtSecret, { expiresIn: '12h' });
}

export function verifyToken(token: string): OrgClaims {
  return jwt.verify(token, config.jwtSecret) as OrgClaims;
}

declare module 'fastify' {
  interface FastifyRequest {
    org?: OrgClaims;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
    return reply as unknown as void;
  }
  try {
    req.org = verifyToken(header.slice(7));
  } catch {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return reply as unknown as void;
  }
}

export function requireKind(...kinds: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.org) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
      return reply as unknown as void;
    }
    if (!kinds.includes(req.org.orgKind)) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: `Requires org kind one of ${kinds.join(',')}` } });
      return reply as unknown as void;
    }
  };
}

export function orgById(id: string): { id: string; kind: string; name: string; chain_addr: string; iec: string | null; vpa: string | null; signer_index: number } | undefined {
  return db.prepare(`select * from orgs where id = ?`).get(id) as
    | { id: string; kind: string; name: string; chain_addr: string; iec: string | null; vpa: string | null; signer_index: number }
    | undefined;
}
