import { createContext, useContext } from 'react';
import type { Org } from './types';

export interface Session {
  orgs: Org[];
  orgByName: Record<string, Org>;
  tokenByOrgName: Record<string, string>;
  ready: boolean;
  refreshTick: number;
  bumpRefresh: () => void;
  relogin: () => Promise<void>;
}

export const SessionCtx = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

// Canonical demo org names this UI knows how to log in as. Seed data (apps/api/scripts/seed.ts)
// always creates orgs with these exact names.
export const ORG_NAMES = {
  exporter: 'Sharma Textiles',
  fraudExporter: 'Global Pharma Exports',
  citiTrade: 'Citi Trade',
  kotakNbfc: 'Kotak NBFC',
  ops: 'Hisab Ops',
  dgft: 'DGFT / Regulator',
} as const;
