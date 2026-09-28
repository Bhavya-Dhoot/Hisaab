import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Card, SectionTitle, StateBadge, CopyHash, Spinner, EmptyState } from './Common';
import { formatInrMinor, formatUsdMinor, fmtDate } from '../format';
import type { ShippingBillSummary, SbTimeline } from '../types';

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
      toast.push('success', `Offer accepted — advance ${formatInrMinor(res.advanceInrMinor)} on the way (tx ${res.chainTx.slice(0, 10)}…).`);
      session.bumpRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_LOCKED') {
        toast.push('error', `ALREADY_LOCKED: ${e.message}`);
      } else {
        toast.push('error', `Accept failed: ${(e as Error).message}`);
      }
    }
  }

  if (!token) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-3">
        <SectionTitle>Shipping bills {loading && <Spinner />}</SectionTitle>
        {bills.length === 0 && !loading && <EmptyState>No shipping bills yet — click "Seed demo" or "Customs: LEO issued".</EmptyState>}
        {bills.map((sb) => (
          <button key={sb.sb_hash} onClick={() => setSelected(sb.sb_hash)} className="text-left">
            <Card className={`transition ${selected === sb.sb_hash ? 'ring-1 ring-emerald-600' : 'hover:border-slate-700'}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-slate-200">SB {sb.sb_no}</span>
                <StateBadge state={sb.state} />
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-lg font-semibold text-slate-100">{formatInrMinor(sb.fob_inr_minor)}</span>
                <span className="text-xs text-slate-500">{formatUsdMinor(sb.fob_minor)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                <span>{sb.buyer_name}</span>
                <span>{sb.offersCount} open offer{sb.offersCount === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-2">
                <CopyHash hash={sb.chain_tx} />
              </div>
            </Card>
          </button>
        ))}
      </div>

      <div>{timeline ? <SbDetail timeline={timeline} onAccept={acceptOffer} /> : <EmptyState>Select a shipping bill.</EmptyState>}</div>
    </div>
  );
}

function SbDetail({ timeline: t, onAccept }: { timeline: SbTimeline; onAccept: (offerId: string) => void }) {
  const [showVc, setShowVc] = useState(false);
  const realisation = t.realisations[0];
  const openOffers = t.offers.filter((o) => o.status === 'OPEN');

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-lg text-slate-100">SB {t.sbNo}</div>
            <div className="text-xs text-slate-500">{t.buyerName} · {t.buyerCountry}</div>
          </div>
          <StateBadge state={t.state} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">FOB (USD)</div>
            <div className="font-semibold text-slate-100">{formatUsdMinor(t.fobMinor)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">FOB (₹)</div>
            <div className="font-semibold text-slate-100">{formatInrMinor(t.fobInrMinor)}</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Registration tx <CopyHash hash={t.chainTx} />
        </div>
      </Card>

      {openOffers.length > 0 && (
        <Card>
          <SectionTitle>Open offers</SectionTitle>
          <div className="flex flex-col gap-2">
            {openOffers.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div>
                  <div className="text-sm text-slate-200">
                    Advance <span className="font-semibold">{o.advance_pct}%</span> @ <span className="font-semibold">{(o.rate_bps / 100).toFixed(2)}%</span> rate
                  </div>
                  <div className="text-xs text-slate-500">valid until {fmtDate(o.valid_until)}</div>
                </div>
                <button
                  onClick={() => onAccept(o.id)}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>Timeline</SectionTitle>
        <ol className="flex flex-col gap-2 text-sm">
          {t.events.length === 0 && <li className="text-slate-600">No on-chain events yet.</li>}
          {t.events.map((e) => (
            <li key={`${e.tx_hash}-${e.name}`} className="flex items-center justify-between rounded border border-slate-800/70 px-3 py-1.5">
              <span className="text-slate-300">{e.name}</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {fmtDate(e.ts)} <CopyHash hash={e.tx_hash} />
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {realisation && (
        <Card>
          <SectionTitle>Waterfall</SectionTitle>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Row label="Realised" value={formatInrMinor(realisation.realised_minor)} />
            <Row label="Financier due" value={formatInrMinor(realisation.financier_due)} />
            <Row label="Platform fee" value={formatInrMinor(realisation.platform_fee)} />
            <Row label="Exporter balance" value={formatInrMinor(realisation.exporter_balance)} highlight />
            {!!realisation.shortfall && <Row label="Shortfall" value={formatInrMinor(realisation.shortfall)} />}
          </div>
        </Card>
      )}

      {t.ebrc && (
        <Card>
          <div className="flex items-center justify-between">
            <SectionTitle>eBRC</SectionTitle>
            <span className="mb-3 rounded-full bg-emerald-950 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-300 ring-1 ring-emerald-700">
              Issued
            </span>
          </div>
          <button onClick={() => setShowVc((v) => !v)} className="text-xs text-emerald-400 hover:underline">
            {showVc ? 'Hide' : 'View'} verifiable credential JSON
          </button>
          {showVc && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-300">
              {JSON.stringify(t.ebrc, null, 2)}
            </pre>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle>Payouts</SectionTitle>
        {t.payouts.length === 0 && <EmptyState>No payouts yet.</EmptyState>}
        {t.payouts.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-1 font-medium">Leg</th>
                <th className="pb-1 font-medium">Amount</th>
                <th className="pb-1 font-medium">Status</th>
                <th className="pb-1 font-medium">UTR</th>
              </tr>
            </thead>
            <tbody>
              {t.payouts.map((p) => (
                <tr key={p.id} className="border-t border-slate-800/70">
                  <td className="py-1.5 text-slate-300">{p.leg}</td>
                  <td className="py-1.5 text-slate-300">{formatInrMinor(p.amount_minor)}</td>
                  <td className="py-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        p.status === 'CONFIRMED'
                          ? 'bg-emerald-950 text-emerald-300'
                          : p.status === 'FAILED'
                            ? 'bg-rose-950 text-rose-300'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-1.5 font-mono text-slate-400">{p.utr ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold ${highlight ? 'text-emerald-400' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}
