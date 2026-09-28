import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Panel } from '../ui/Panel';
import { Stamp } from '../ui/Stamp';
import { Money } from '../ui/Money';
import { Hash } from '../ui/Hash';
import { Button } from '../ui/Button';
import { Empty } from '../ui/Empty';
import { Skeleton } from '../ui/Skeleton';
import { RuleRow } from '../ui/RuleRow';
import { fmtDate } from '../format';
import type { ShippingBillSummary, SbTimeline, Realisation } from '../types';

export function ExporterView() {
  const session = useSession();
  const toast = useToast();
  const token = session.tokenByOrgName[ORG_NAMES.exporter];

  const [bills, setBills] = useState<ShippingBillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<SbTimeline | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    api
      .getMyShippingBills(token)
      .then((r) => {
        if (cancelled) return;
        setBills(r.shippingBills);
        setSelected((cur) => cur ?? r.shippingBills[0]?.sb_hash ?? null);
      })
      .catch((e) => toast.push('error', `Failed to load shipping bills: ${(e as Error).message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, session.refreshTick]);

  useEffect(() => {
    if (!token || !selected) {
      setTimeline(null);
      return;
    }
    let cancelled = false;
    api
      .getShippingBill(token, selected)
      .then((t) => !cancelled && setTimeline(t))
      .catch((e) => toast.push('error', `Failed to load SB detail: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selected, session.refreshTick]);

  async function acceptOffer(offerId: string) {
    if (!token) return;
    try {
      const res = await api.acceptOffer(token, offerId);
      toast.push('success', `Offer accepted, advance on the way (tx ${res.chainTx.slice(0, 10)}…).`);
      session.bumpRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_LOCKED') {
        toast.push('error', 'Already financed. The ledger reverted a second lock on this bill.');
      } else {
        toast.push('error', `Accept failed: ${(e as Error).message}`);
      }
    }
  }

  async function seed() {
    try {
      await api.seedDemo();
      toast.push('success', 'Demo seeded.');
      await session.relogin();
      session.bumpRefresh();
    } catch (e) {
      toast.push('error', `Seed failed: ${(e as Error).message}`);
    }
  }

  if (!token) {
    return (
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[380px_1fr]">
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[380px_1fr]">
      <Panel title="Shipping bills" className="self-start md:sticky md:top-[112px]">
        {loading && bills.length === 0 && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {!loading && bills.length === 0 && (
          <Empty
            message="No shipping bills yet."
            action={
              <Button size="sm" variant="primary" onClick={seed}>
                Seed demo
              </Button>
            }
          />
        )}
        <div className="flex flex-col">
          {bills.map((sb) => (
            <button
              key={sb.sb_hash}
              onClick={() => setSelected(sb.sb_hash)}
              className={`-mx-2 flex items-center justify-between gap-3 border-b border-line px-2 py-2.5 text-left transition-colors last:border-b-0 ${
                selected === sb.sb_hash ? 'bg-raised shadow-[inset_2px_0_0_var(--c-accent)]' : 'hover:bg-sunken'
              }`}
            >
              <div className="min-w-0">
                <div className="font-mono tabular text-sm text-text">SB {sb.sb_no}</div>
                <div className="truncate text-xs text-muted">{sb.buyer_name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Money minor={sb.fob_inr_minor} size="sm" />
                <Stamp state={sb.state} size="sm" />
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <div>
        {timeline ? (
          <SbDetail timeline={timeline} onAccept={acceptOffer} />
        ) : (
          <Panel>
            <Empty message="Select a shipping bill to open its document." />
          </Panel>
        )}
      </div>
    </div>
  );
}

function SbDetail({ timeline: t, onAccept }: { timeline: SbTimeline; onAccept: (offerId: string) => void }) {
  const [showVc, setShowVc] = useState(false);
  const realisation = t.realisations[0];
  const openOffers = t.offers.filter((o) => o.status === 'OPEN');

  return (
    <div className="flex flex-col gap-4">
      <Panel raised>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-[28px] font-semibold leading-none text-text">SB {t.sbNo}</div>
            <div className="mt-1.5 text-xs text-muted">
              {t.buyerName}, {t.buyerCountry}
            </div>
          </div>
          <Stamp state={t.state} />
        </div>
        <div className="mt-4 flex items-baseline gap-4">
          <Money minor={t.fobMinor} ccy="USD" size="lg" />
          <Money minor={t.fobInrMinor} size="lg" className="text-muted" />
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-faint">
          <span>Registration tx</span>
          <Hash value={t.chainTx} />
        </div>
      </Panel>

      {openOffers.length > 0 && (
        <Panel title="Open offers">
          <div className="flex flex-col">
            {openOffers.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
                <div className="text-sm text-text">
                  <span className="font-mono tabular font-semibold">{o.advance_pct}%</span> advance at{' '}
                  <span className="font-mono tabular font-semibold">{(o.rate_bps / 100).toFixed(2)}%</span> rate
                  <div className="text-xs text-faint">valid until {fmtDate(o.valid_until)}</div>
                </div>
                <Button size="sm" variant="primary" onClick={() => onAccept(o.id)}>
                  Accept
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Timeline">
        {t.events.length === 0 && <Empty message="No on-chain events yet." />}
        {t.events.length > 0 && (
          <ol className="ledger-spine flex flex-col gap-2.5 pl-7">
            {t.events.map((e) => (
              <li key={`${e.tx_hash}-${e.name}`} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-text">{eventLabel(e.name, e.args)}</span>
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-faint">
                  {fmtDate(e.ts)} <Hash value={e.tx_hash} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {realisation && (
        <Panel title="Waterfall">
          <Waterfall r={realisation} />
        </Panel>
      )}

      {t.ebrc && (
        <Panel title="eBRC">
          <div className="flex items-center justify-between">
            <Stamp tone="solid" label="Issued" />
            <Button size="sm" variant="ghost" onClick={() => setShowVc((v) => !v)}>
              {showVc ? 'Hide' : 'View'} credential JSON
            </Button>
          </div>
          {showVc && (
            <pre className="mt-3 max-h-64 overflow-auto rounded-[var(--radius-ui)] bg-sunken p-3 font-mono tabular text-[11px] leading-relaxed text-muted">
              {JSON.stringify(t.ebrc, null, 2)}
            </pre>
          )}
        </Panel>
      )}

      <Panel title="Payouts">
        {t.payouts.length === 0 && <Empty message="No payouts yet." />}
        {t.payouts.length > 0 && (
          <div className="flex flex-col">
            {t.payouts.map((p) => (
              <RuleRow key={p.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_9rem_6.5rem_9rem] [&>*:nth-child(3)]:justify-self-start">
                <span className="text-text">{LEG_LABEL[p.leg] ?? p.leg}</span>
                <Money minor={p.amount_minor} size="sm" className="text-right" />
                <Stamp tone={p.status === 'CONFIRMED' ? 'solid' : p.status === 'FAILED' ? 'danger' : 'plain'} label={p.status} size="sm" />
                <Hash value={p.utr} />
              </RuleRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const LEG_LABEL: Record<string, string> = {
  ADVANCE: 'Advance to exporter',
  FINANCIER_REPAY: 'Financier repaid',
  EXPORTER_BALANCE: 'Balance to exporter',
  PLATFORM_FEE: 'Platform fee',
};
const LEG_BY_INDEX = ['ADVANCE', 'FINANCIER_REPAY', 'EXPORTER_BALANCE', 'PLATFORM_FEE'];
const STATE_BY_INDEX = ['NONE', 'Open', 'Financed', 'Partially realised', 'Realised', 'Disputed'];

function eventLabel(name: string, rawArgs: string): string {
  let a: Record<string, unknown> = {};
  try {
    a = JSON.parse(rawArgs) ?? {};
  } catch {
    // args are best-effort context only
  }
  switch (name) {
    case 'SBRegistered':
      return 'Registered by customs, receivable minted';
    case 'SBStateChanged':
      return `State set to ${STATE_BY_INDEX[Number(a.newState)] ?? 'updated'}`;
    case 'TokenLocked':
      return 'Receivable locked to financier';
    case 'TokenReleased':
      return 'Lock released';
    case 'Realised':
      return `Remittance matched at ${Number(a.confidencePct ?? 0)}% confidence`;
    case 'WaterfallComputed':
      return 'Waterfall computed';
    case 'EBRCAnchored':
      return 'eBRC anchored on ledger';
    case 'PayoutRecorded':
      return `Paid: ${LEG_LABEL[LEG_BY_INDEX[Number(a.leg)]] ?? 'payout'}`;
    case 'SBDisputed':
      return 'Disputed after customs amendment';
    case 'SBAmended':
      return 'Amended by customs';
    default:
      return name;
  }
}

function Waterfall({ r }: { r: Realisation }) {
  const total = r.realised_minor || 1;
  const segments: { key: string; label: string; value: number; cls: string }[] = [
    { key: 'financier', label: 'Financier repaid', value: r.financier_due ?? 0, cls: 'bg-line-strong' },
    { key: 'fee', label: 'Platform fee', value: r.platform_fee ?? 0, cls: 'bg-faint' },
    { key: 'exporter', label: 'Balance to exporter', value: r.exporter_balance ?? 0, cls: 'bg-accent' },
  ];
  if (r.shortfall) segments.push({ key: 'shortfall', label: 'Shortfall', value: r.shortfall, cls: 'bg-danger' });

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-sm text-muted">Realised</span>
        <Money minor={r.realised_minor} size="lg" />
      </div>
      <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-[var(--radius-ui)]">
        {segments.map((s) =>
          s.value > 0 ? (
            <div key={s.key} className={s.cls} style={{ flexGrow: s.value, flexBasis: 0, minWidth: 4 }} title={s.label} />
          ) : null
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.key} className="flex flex-col gap-0.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`inline-block size-2.5 rounded-[2px] ${s.cls}`} />
              {s.label}
              <span className="font-mono tabular text-faint">{((s.value / total) * 100).toFixed(1)}%</span>
            </dt>
            <dd className={s.key === 'shortfall' ? 'text-danger' : 'text-text'}>
              <Money minor={s.value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
