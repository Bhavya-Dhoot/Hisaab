import React, { useEffect, useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { api } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Panel } from '../ui/Panel';
import { Money } from '../ui/Money';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Slider } from '../ui/Slider';
import { Empty } from '../ui/Empty';
import { Skeleton } from '../ui/Skeleton';
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
    api
      .getOpsConfig(token)
      .then(setConfig)
      .catch(() => undefined);
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
      toast.push('success', `Approved, realisation tx ${res.chainTx.slice(0, 10)}…`);
      session.bumpRefresh();
    } catch (e) {
      toast.push('error', `Approve failed: ${(e as Error).message}`);
    }
  }

  async function reject() {
    if (!token || !selectedId) return;
    try {
      await api.rejectOpsQueue(token, selectedId, 'Rejected from Bank Ops console');
      toast.push('info', 'Queue item rejected, routed to suspense.');
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
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-[112px] lg:self-start">
        <Panel title="Review queue">
          {loading && queue.length === 0 && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}
          {!loading && queue.length === 0 && <Empty message="Nothing waiting for a human. Fire a bundle remittance to fill it." />}
          <div className="flex flex-col">
            {queue.map((q) => (
              <button
                key={q.id}
                onClick={() => setSelectedId(q.id)}
                className={`-mx-2 flex items-center justify-between gap-2 border-b border-line px-2 py-2.5 text-left text-xs transition-colors last:border-b-0 ${
                  selectedId === q.id ? 'bg-raised shadow-[inset_2px_0_0_var(--c-accent)]' : 'hover:bg-sunken'
                }`}
              >
                <span className="font-mono tabular text-text">IRM {q.irm_hash.slice(0, 12)}…</span>
                <span className="text-muted">
                  {q.candidates.length} candidate{q.candidates.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        {config && (
          <Panel title="Thresholds">
            <div className="flex flex-col gap-4">
              <Field label="Auto-realise at or above">
                <Slider
                  value={Math.round(config.auto * 100)}
                  min={50}
                  max={100}
                  onChange={(v) => saveConfig({ ...config, auto: v / 100 })}
                  format={(v) => `${v}%`}
                />
              </Field>
              <Field label="Send to review at or above">
                <Slider
                  value={Math.round(config.review * 100)}
                  min={0}
                  max={100}
                  onChange={(v) => saveConfig({ ...config, review: v / 100 })}
                  format={(v) => `${v}%`}
                />
              </Field>
              <Field label="Amount tolerance">
                <Slider
                  value={config.tolerancePct}
                  min={0}
                  max={10}
                  step={0.5}
                  onChange={(v) => saveConfig({ ...config, tolerancePct: v })}
                  format={(v) => `${v}%`}
                />
              </Field>
            </div>
          </Panel>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {!detail && (
          <Panel>
            <Empty message="Select a remittance from the queue to see why the matcher was unsure." />
          </Panel>
        )}
        {detail && (
          <>
            <Panel
              raised
              title="Match decision"
              action={
                <Button size="sm" variant="danger" onClick={reject}>
                  Reject to suspense
                </Button>
              }
            >
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                {remit ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-muted">Credited</span>
                    <Money minor={remit.inr_minor as number} size="lg" />
                  </div>
                ) : (
                  <span />
                )}
                <ol className="flex items-center gap-1.5 text-xs text-muted">
                  <Step label="Rules" /> <ArrowRight size={12} /> <Step label="Extractor" /> <ArrowRight size={12} />
                  <Step label="Re-verify" /> <ArrowRight size={12} /> <Step label="Confidence" />
                </ol>
              </div>
              <div className="flex flex-col">
                {detail.candidates.length === 0 && <Empty message="No candidates proposed." />}
                {detail.candidates.map((c) => (
                  <div key={c.id} className="grid grid-cols-1 gap-3 border-t border-line py-4 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono tabular text-sm text-text">SB {c.sb_hash.slice(0, 12)}…</span>
                        <span className="text-xs text-muted">
                          allocate <Money minor={c.proposed_minor} size="sm" className="text-text" /> via {c.source.toLowerCase()}
                        </span>
                      </div>
                      <ul className="mt-2 flex flex-col gap-1">
                        {parseReasons(c.reasons).map((r, i) => (
                          <li key={i} className="grid grid-cols-[2.5rem_1fr_3rem] items-baseline gap-2 text-xs">
                            <span className="font-mono tabular text-faint">{r.rule}</span>
                            <span className="text-muted">{r.detail}</span>
                            <span className="text-right font-mono tabular text-faint">{r.weight > 0 ? `+${r.weight}` : r.weight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-start gap-4 sm:flex-col sm:items-end">
                      <ConfidenceMeter value={c.confidence} />
                      {c.proposed_minor > 0 && (
                        <Button size="sm" variant="primary" onClick={() => approve(c.sb_hash)}>
                          Approve
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="Raw MT103">
                <RawMt103 raw={detail.rawMt103} />
              </Panel>
              {detail.parsed && (
                <Panel title="What the parser read">
                  <ParsedFields parsed={detail.parsed as Record<string, unknown>} />
                </Panel>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Step({ label }: { label: string }) {
  return <li className="rounded-[var(--radius-ui)] border border-line px-2 py-0.5">{label}</li>;
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.92 ? 'text-accent-text' : value >= 0.7 ? 'text-text' : 'text-danger';
  const barTone = value >= 0.92 ? 'bg-accent' : value >= 0.7 ? 'bg-line-strong' : 'bg-danger';
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className={`font-display tabular text-3xl font-semibold leading-none ${tone}`}>{pct}%</span>
      <div className={`h-1 ${barTone}`} style={{ width: `${Math.max(pct * 0.8, 4)}px` }} />
    </div>
  );
}

const FIELD_LABELS: [string, string][] = [
  ['senderRef', 'Sender reference'],
  ['valueDate', 'Value date'],
  ['orderingName', 'Ordering customer'],
  ['orderingCountry', 'Country'],
  ['beneficiaryName', 'Beneficiary'],
  ['beneficiaryAccount', 'Beneficiary account'],
  ['remitInfo', 'Remittance info (:70:)'],
  ['senderToReceiverInfo', 'Bank info (:72:)'],
  ['charges', 'Charges'],
];

function ParsedFields({ parsed }: { parsed: Record<string, unknown> }) {
  const amount =
    typeof parsed.amountMinor === 'number' ? <Money minor={parsed.amountMinor} ccy={parsed.ccy === 'INR' ? 'INR' : 'USD'} size="sm" /> : null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {amount && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Amount</dt>
          <dd className="text-text">{amount}</dd>
        </div>
      )}
      {FIELD_LABELS.filter(([k]) => parsed[k] !== undefined && parsed[k] !== '').map(([k, label]) => (
        <div key={k} className={k === 'remitInfo' || k === 'senderToReceiverInfo' ? 'sm:col-span-2' : ''}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="break-words font-mono tabular text-sm text-text">{String(parsed[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

// Digit-like tokens that contain a letter O, I or l: the classic "O for zero" typo.
const TYPO_TOKEN = /\b(?=[0-9OIl/-]*[0-9])(?=[0-9OIl/-]*[OIl])[0-9OIl/-]{3,}\b/g;

function RawMt103({ raw }: { raw: string | null }) {
  if (!raw) return <Empty message="No raw message." />;
  return (
    <pre className="whitespace-pre-wrap break-all rounded-[var(--radius-ui)] bg-sunken p-3 font-mono tabular text-[12px] leading-relaxed text-muted">
      {raw.split('\n').map((line, i) => {
        const keyLine = line.startsWith(':70:') || line.startsWith(':72:');
        return (
          <div key={i} className={keyLine ? '-mx-3 bg-accent-soft/60 px-3 text-text' : ''}>
            {markTypos(line) || ' '}
          </div>
        );
      })}
    </pre>
  );
}

function markTypos(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TYPO_TOKEN)) {
    const at = m.index ?? 0;
    out.push(line.slice(last, at));
    out.push(
      <mark key={at} className="rounded-[2px] bg-accent px-0.5 text-accent-ink">
        {m[0]}
      </mark>
    );
    last = at + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}
