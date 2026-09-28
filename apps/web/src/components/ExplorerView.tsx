import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Card, SectionTitle, StateBadge, CopyHash, EmptyState } from './Common';
import { formatInrMinor, fmtDate } from '../format';
import type { ExplorerSb, ExplorerStats, EbrcVerifyResult } from '../types';

export function ExplorerView() {
  const session = useSession();
  const toast = useToast();
  const token = session.tokenByOrgName[ORG_NAMES.dgft];

  const [sbHash, setSbHash] = useState('');
  const [sb, setSb] = useState<ExplorerSb | null>(null);
  const [vcHash, setVcHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<EbrcVerifyResult | null>(null);
  const [dgftResult, setDgftResult] = useState<EbrcVerifyResult | null>(null);
  const [stats, setStats] = useState<ExplorerStats | null>(null);

  useEffect(() => {
    api.getExplorerStats().then(setStats).catch(() => undefined);
  }, [session.refreshTick]);

  async function lookup() {
    if (!token || !sbHash.trim()) return;
    try {
      const res = await api.getExplorerSb(token, sbHash.trim());
      setSb(res);
    } catch (e) {
      setSb(null);
      toast.push('error', `Lookup failed: ${(e as Error).message}`);
    }
  }

  async function verify() {
    if (!sbHash.trim()) return toast.push('error', 'Enter a shipping-bill hash first.');
    try {
      const res = await api.verifyEbrc(sbHash.trim(), vcHash.trim() || undefined);
      setVerifyResult(res);
    } catch (e) {
      toast.push('error', `Verify failed: ${(e as Error).message}`);
    }
  }

  async function dgftVerify() {
    if (!vcHash.trim() && !sbHash.trim()) return toast.push('error', 'Enter a vcHash or sbHash first.');
    try {
      const res = await api.dgftVerify(vcHash.trim(), sbHash.trim() || undefined);
      setDgftResult(res);
    } catch (e) {
      toast.push('error', `DGFT verify failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <SectionTitle>Shipping-bill lookup</SectionTitle>
        <p className="mb-2 text-xs text-slate-500">Hash-only view — no exporter or buyer names, per the privacy-by-design principle.</p>
        <div className="flex gap-2">
          <input
            value={sbHash}
            onChange={(e) => setSbHash(e.target.value)}
            placeholder="0x… shipping-bill hash"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
          />
          <button onClick={lookup} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
            Lookup
          </button>
        </div>
        {sb && (
          <div className="mt-3 rounded-lg border border-slate-800 p-3 text-sm">
            <div className="flex items-center justify-between">
              <CopyHash hash={sb.sb_hash} label={sb.sb_hash.slice(0, 14) + '…'} />
              <StateBadge state={sb.state} />
            </div>
            <div className="mt-2 text-xs text-slate-400">FOB {formatInrMinor(sb.fob_inr_minor)} · registered {fmtDate(sb.created_at)}</div>
            <div className="mt-1 text-xs">
              Registration tx <CopyHash hash={sb.chain_tx} />
            </div>
            {sb.realisations.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold text-slate-400">Realisations</div>
                {sb.realisations.map((r) => (
                  <div key={r.irm_hash} className="flex items-center justify-between rounded bg-slate-950/60 px-2 py-1 text-xs">
                    <span>{formatInrMinor(r.realised_minor)}</span>
                    <span className="text-slate-500">{r.matched_by}</span>
                    <CopyHash hash={r.chain_tx} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>eBRC verify</SectionTitle>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={vcHash}
            onChange={(e) => setVcHash(e.target.value)}
            placeholder="vcHash (optional — verifies against the anchored one if empty)"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
          />
          <div className="flex gap-2">
            <button onClick={verify} className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700">
              Verify (ledger)
            </button>
            <button onClick={dgftVerify} className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700">
              DGFT verify
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VerifyResultCard title="Explorer" result={verifyResult} />
          <VerifyResultCard title="DGFT mock" result={dgftResult} />
        </div>
      </Card>

      <Card>
        <SectionTitle>Stats</SectionTitle>
        {!stats && <EmptyState>Loading…</EmptyState>}
        {stats && (
          <div className="flex flex-col gap-4">
            <Stat label="Realised volume" value={formatInrMinor(stats.realisedVolumeInrMinor)} />
            <Stat label="Median time-to-eBRC" value={stats.medianTimeToEbrcSec !== null ? `${stats.medianTimeToEbrcSec.toFixed(1)}s` : '—'} />
            <Bar label="Auto-match rate" value={stats.autoMatchRate} />
            <Bar label="LLM call rate" value={stats.llmCallRate} />
            <Stat label="Total match attempts" value={String(stats.totalMatchAttempts)} />
          </div>
        )}
      </Card>
    </div>
  );
}

function VerifyResultCard({ title, result }: { title: string; result: EbrcVerifyResult | null }) {
  if (!result) return <div className="rounded-lg border border-slate-800 p-3 text-xs text-slate-600">{title}: no check yet</div>;
  return (
    <div className={`rounded-lg border p-3 text-xs ${result.valid ? 'border-emerald-700 bg-emerald-950/30' : 'border-rose-700 bg-rose-950/30'}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-300">{title}</span>
        <span className={result.valid ? 'text-emerald-400' : 'text-rose-400'}>{result.valid ? '✓ valid' : '✗ invalid'}</span>
      </div>
      {result.message && <div className="mt-1 text-slate-400">{result.message}</div>}
      {result.issuer && <div className="mt-1 text-slate-500">issuer {result.issuer.slice(0, 10)}…</div>}
      {result.anchoredTx && (
        <div className="mt-1">
          anchored <CopyHash hash={result.anchoredTx} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-100">{value}</span>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number | null }) {
  const pct = value !== null ? Math.round(value * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span className="text-slate-300">{value !== null ? `${pct}%` : '—'}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
