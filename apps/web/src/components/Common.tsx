import React, { useState } from 'react';
import { shortHash, copyToClipboard } from '../format';

const STATE_STYLES: Record<string, string> = {
  OPEN: 'bg-sky-950 text-sky-300 ring-sky-700',
  FINANCED: 'bg-amber-950 text-amber-300 ring-amber-700',
  PARTIAL: 'bg-violet-950 text-violet-300 ring-violet-700',
  REALISED: 'bg-emerald-950 text-emerald-300 ring-emerald-700',
  DISPUTED: 'bg-rose-950 text-rose-300 ring-rose-700',
  NONE: 'bg-slate-800 text-slate-400 ring-slate-700',
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span
      key={state}
      className={`animate-flip inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${
        STATE_STYLES[state] ?? STATE_STYLES.NONE
      }`}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {state}
    </span>
  );
}

export function CopyHash({ hash, label }: { hash: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return <span className="text-slate-600">—</span>;
  return (
    <button
      onClick={async () => {
        await copyToClipboard(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={hash}
      className="inline-flex items-center gap-1 rounded bg-slate-800/70 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 hover:bg-slate-700"
    >
      {label ?? shortHash(hash)}
      <span className="text-slate-500">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm ${className}`}>{children}</div>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{children}</h2>;
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.92 ? 'bg-emerald-500' : value >= 0.7 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-300">{pct}%</span>
    </div>
  );
}
