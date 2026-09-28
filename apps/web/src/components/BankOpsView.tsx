import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Card, SectionTitle, EmptyState, ConfidenceBar, Spinner } from './Common';
import { formatInrMinor } from '../format';
import type { OpsQueueItem, OpsQueueDetail, OpsConfig, Reason } from '../types';

function parseReasons(raw: string): Reason[] {
  try {
    return JSON.parse(raw) as Reason[];
  } catch {
    return [];
  }
}

export function BankOpsView() {
  const session = useSession();
  const toast = useToast();
  const token = session.tokenByOrgName[ORG_NAMES.ops];

  const [queue, setQueue] = useState<OpsQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpsQueueDetail | null>(null);
  const [config, setConfig] = useState<OpsConfig | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .getOpsQueue(token, 'PENDING')
      .then((r) => {
        setQueue(r.queue);
        setSelectedId((cur) => cur ?? r.queue[0]?.id ?? null);
      })
      .catch((e) => toast.push('error', `Failed to load ops queue: ${(e as Error).message}`))
      .finally(() => setLoading(false));
    api.getOpsConfig(token).then(setConfig).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, session.refreshTick]);

  useEffect(() => {
    if (!token || !selectedId) {
      setDetail(null);
      return;
    }
    api
      .getOpsQueueItem(token, selectedId)
      .then(setDetail)
      .catch((e) => toast.push('error', `Failed to load queue item: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedId, session.refreshTick]);

  async function approve(sbHash: string) {
    if (!token || !selectedId) return;
    try {
      const res = await api.approveOpsQueue(token, selectedId, { sbHash });
      toast.push('success', `Approved — realisation tx ${res.chainTx.slice(0, 10)}…`);
      session.bumpRefresh();
    } catch (e) {
      toast.push('error', `Approve failed: ${(e as Error).message}`);
    }
  }

  async function reject() {
    if (!token || !selectedId) return;
    try {
      await api.rejectOpsQueue(token, selectedId, 'Rejected from Bank Ops console');
      toast.push('info', 'Queue item rejected — routed to suspense.');
      session.bumpRefresh();
    } catch (e) {
      toast.push('error', `Reject failed: ${(e as Error).message}`);
    }
  }

  async function saveConfig(next: OpsConfig) {
    if (!token) return;
    setConfig(next);
    try {
      await api.putOpsConfig(token, next);
    } catch (e) {
      toast.push('error', `Config save failed: ${(e as Error).message}`);
    }
  }

  const remit = detail?.remittance as Record<string, unknown> | null;

  return (
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <SectionTitle>Queue {loading && <Spinner />}</SectionTitle>
          {queue.length === 0 && !loading && <EmptyState>Nothing pending review.</EmptyState>}
          <div className="flex flex-col gap-2">
            {queue.map((q) => (
              <button key={q.id} onClick={() => setSelectedId(q.id)} className="text-left">
                <div
                  className={`rounded-lg border p-2.5 text-xs transition ${
                    selectedId === q.id ? 'border-emerald-600 bg-emerald-950/20' : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="font-mono text-slate-300">IRM {q.irm_hash.slice(0, 12)}…</div>
                  <div className="mt-1 text-slate-500">{q.candidates.length} candidate(s)</div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {config && (
          <Card>
            <SectionTitle>Thresholds</SectionTitle>
            <div className="flex flex-col gap-3 text-xs text-slate-400">
              <label>
                Auto <span className="font-semibold text-slate-200">{Math.round(config.auto * 100)}%</span>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={Math.round(config.auto * 100)}
                  onChange={(e) => saveConfig({ ...config, auto: Number(e.target.value) / 100 })}
                  className="mt-1 w-full"
                />
              </label>
              <label>
                Review <span className="font-semibold text-slate-200">{Math.round(config.review * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(config.review * 100)}
                  onChange={(e) => saveConfig({ ...config, review: Number(e.target.value) / 100 })}
                  className="mt-1 w-full"
                />
              </label>
              <label>
                Tolerance <span className="font-semibold text-slate-200">{config.tolerancePct}%</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={config.tolerancePct}
                  onChange={(e) => saveConfig({ ...config, tolerancePct: Number(e.target.value) })}
                  className="mt-1 w-full"
                />
              </label>
            </div>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {!detail && <EmptyState>Select a queue item.</EmptyState>}
        {detail && (
          <>
            <Card>
              <SectionTitle>Raw MT103</SectionTitle>
              <RawMt103 raw={detail.rawMt103} />
            </Card>

            {detail.parsed && (
              <Card>
                <SectionTitle>Parsed fields</SectionTitle>
                <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-300">
                  {JSON.stringify(detail.parsed, null, 2)}
                </pre>
              </Card>
            )}

            <Card>
              <SectionTitle>Matcher panel</SectionTitle>
              <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
                <Step label="rules" /> <Arrow /> <Step label="extractor" /> <Arrow /> <Step label="re-verify" /> <Arrow />
                <Step label="confidence" />
              </div>
              {remit && (
                <div className="mb-3 text-xs text-slate-400">
                  Amount {formatInrMinor(remit.inr_minor as number)} · state <span className="font-semibold text-slate-200">{String(remit.state)}</span>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {detail.candidates.length === 0 && <EmptyState>No candidates proposed.</EmptyState>}
                {detail.candidates.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-300">SB {c.sb_hash.slice(0, 12)}…</span>
                      <ConfidenceBar value={c.confidence} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Proposed: {formatInrMinor(c.proposed_minor)} · source {c.source}</div>
                    <ul className="mt-2 flex flex-col gap-1 text-[11px] text-slate-400">
                      {parseReasons(c.reasons).map((r, i) => (
                        <li key={i} className="flex items-center justify-between rounded bg-slate-950/60 px-2 py-1">
                          <span className="font-mono text-slate-500">{r.rule}</span>
                          <span className="flex-1 px-2 text-slate-300">{r.detail}</span>
                          <span className="text-slate-500">w={r.weight}</span>
                        </li>
                      ))}
                    </ul>
                    {c.proposed_minor > 0 && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => approve(c.sb_hash)}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={reject}
                className="mt-3 rounded-md border border-rose-800 bg-rose-950/50 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60"
              >
                Reject queue item
              </button>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Step({ label }: { label: string }) {
  return <span className="rounded bg-slate-800 px-2 py-0.5 uppercase tracking-wide">{label}</span>;
}
function Arrow() {
  return <span className="text-slate-600">→</span>;
}

function RawMt103({ raw }: { raw: string | null }) {
  if (!raw) return <EmptyState>No raw message.</EmptyState>;
  const highlightWords = [':70:', 'INV', '2O24', 'OO91'];
  const lines = raw.split('\n');
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
      {lines.map((line, i) => (
        <div key={i}>
          {highlightToken(line, highlightWords)}
          {'\n'}
        </div>
      ))}
    </pre>
  );
}

function highlightToken(line: string, words: string[]): React.ReactNode {
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts = line.split(pattern);
  return parts.map((part, i) =>
    words.includes(part) ? (
      <span key={i} className="rounded bg-rose-900/60 px-0.5 text-rose-200">
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}
