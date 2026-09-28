import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Panel } from '../ui/Panel';
import { Stamp } from '../ui/Stamp';
import { Money } from '../ui/Money';
import { Hash } from '../ui/Hash';
import { Button } from '../ui/Button';
import { Empty } from '../ui/Empty';
import { RuleRow } from '../ui/RuleRow';
import { fmtDate } from '../format';
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
  const [picks, setPicks] = useState<{ sb_hash: string; sb_no: string; state: string }[]>([]);
  const exporterToken = session.tokenByOrgName[ORG_NAMES.exporter];

  useEffect(() => {
    if (!exporterToken) return;
    api
      .getMyShippingBills(exporterToken)
      .then((r) => setPicks(r.shippingBills ?? []))
      .catch(() => undefined);
  }, [exporterToken, session.refreshTick]);

  useEffect(() => {
    api
      .getExplorerStats()
      .then(setStats)
      .catch(() => undefined);
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
      <Panel title="Shipping-bill lookup">
        <p className="mb-3 text-xs text-faint">Hash-only view, no exporter or buyer names, by design.</p>
        <div className="flex gap-2">
          <input
            value={sbHash}
            onChange={(e) => setSbHash(e.target.value)}
            placeholder="0x… shipping-bill hash"
            className="flex-1 rounded-[var(--radius-ui)] border border-line bg-sunken px-3 py-1.5 font-mono tabular text-xs text-text placeholder:text-faint"
          />
          <Button size="sm" variant="primary" onClick={lookup}>
            Lookup
          </Button>
        </div>
        {picks.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Demo bills</span>
            {picks.map((b) => (
              <Button key={b.sb_hash} size="sm" variant={sbHash === b.sb_hash ? "primary" : "secondary"} onClick={() => setSbHash(b.sb_hash)}>
                SB {b.sb_no}
              </Button>
            ))}
          </div>
        )}
        {sb && (
          <div className="mt-4 rounded-[var(--radius-ui)] border border-line p-3">
            <div className="flex items-center justify-between">
              <Hash value={sb.sb_hash} len={12} />
              <Stamp state={sb.state} />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <Money minor={sb.fob_inr_minor} size="sm" /> registered {fmtDate(sb.created_at)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-faint">
              <span>Registration tx</span>
              <Hash value={sb.chain_tx} />
            </div>
            {sb.realisations.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-muted">Realisations</div>
                {sb.realisations.map((r) => (
                  <RuleRow key={r.irm_hash}>
                    <Money minor={r.realised_minor} size="sm" />
                    <span className="text-xs text-faint">{r.matched_by}</span>
                    <Hash value={r.chain_tx} />
                  </RuleRow>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="eBRC verify">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={vcHash}
            onChange={(e) => setVcHash(e.target.value)}
            placeholder="vcHash, optional, verifies the anchored one if empty"
            className="flex-1 rounded-[var(--radius-ui)] border border-line bg-sunken px-3 py-1.5 font-mono tabular text-xs text-text placeholder:text-faint"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={verify}>
              Verify (ledger)
            </Button>
            <Button size="sm" onClick={dgftVerify}>
              DGFT verify
            </Button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <VerifyResultCard title="Explorer" result={verifyResult} />
          <VerifyResultCard title="DGFT mock" result={dgftResult} />
        </div>
      </Panel>

      <Panel title="Stats">
        {!stats && <Empty message="Loading stats." />}
        {stats && (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Stat label="Realised volume" value={<Money minor={stats.realisedVolumeInrMinor} size="lg" />} />
            <Stat label="Median time to eBRC" value={stats.medianTimeToEbrcSec !== null ? `${stats.medianTimeToEbrcSec.toFixed(1)}s` : 'n/a'} />
            <Stat label="Auto-match rate" value={stats.autoMatchRate !== null ? `${Math.round(stats.autoMatchRate * 100)}%` : 'n/a'} />
            <Stat label="LLM call rate" value={stats.llmCallRate !== null ? `${Math.round(stats.llmCallRate * 100)}%` : 'n/a'} />
            <Stat label="Total match attempts" value={String(stats.totalMatchAttempts)} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function VerifyResultCard({ title, result }: { title: string; result: EbrcVerifyResult | null }) {
  if (!result) return <div className="rounded-[var(--radius-ui)] border border-line p-3 text-xs text-faint">{title}: no check yet</div>;
  return (
    <div className="rounded-[var(--radius-ui)] border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{title}</span>
        <Stamp tone={result.valid ? 'solid' : 'danger'} label={result.valid ? 'VALID' : 'INVALID'} size="lg" />
      </div>
      {result.message && <div className="text-xs text-muted">{result.message}</div>}
      {result.issuer && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-faint">
          issuer <Hash value={result.issuer} />
        </div>
      )}
      {result.anchoredTx && (
        <div className="mt-1 flex items-center gap-2 text-xs text-faint">
          <span>anchored</span>
          <Hash value={result.anchoredTx} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="font-mono tabular text-2xl font-semibold text-text">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}
