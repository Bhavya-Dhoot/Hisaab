import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Card, SectionTitle, StateBadge, CopyHash, EmptyState, Spinner } from './Common';
import { formatInrMinor, formatUsdMinor } from '../format';
import type { MarketReceivable, BookRow, Alert } from '../types';

type FinancierPersona = 'citiTrade' | 'kotakNbfc';

export function FinancierView() {
  const session = useSession();
  const toast = useToast();
  const [persona, setPersona] = useState<FinancierPersona>('citiTrade');
  const orgName = persona === 'citiTrade' ? ORG_NAMES.citiTrade : ORG_NAMES.kotakNbfc;
  const token = session.tokenByOrgName[orgName];

  const [market, setMarket] = useState<MarketReceivable[]>([]);
  const [book, setBook] = useState<BookRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [waterfalls, setWaterfalls] = useState<Record<string, { financierDue: number; platformFee: number; exporterBalance: number; shortfall: number }>>({});
  const [selectedSb, setSelectedSb] = useState<string | null>(null);
  const [advancePct, setAdvancePct] = useState(85);
  const [rateBps, setRateBps] = useState(1200);
  const [fraudBanner, setFraudBanner] = useState<{ message: string; chainTx?: string } | null>(null);

  useEffect(() => {
    api
      .getMarketReceivables()
      .then((r) => {
        setMarket(r.receivables);
        setSelectedSb((cur) => cur ?? r.receivables[0]?.sb_hash ?? null);
      })
      .catch((e) => toast.push('error', `Failed to load market: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.refreshTick]);

  useEffect(() => {
    if (!token) return;
    api.getMyBook(token).then((r) => setBook(r.book)).catch(() => undefined);
    api.getMyAlerts(token).then((r) => setAlerts(r.alerts)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, session.refreshTick]);

  useEffect(() => {
    if (!token || book.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        book.map(async (b) => {
          try {
            const wf = await api.getWaterfall(token, b.sb_hash);
            return [b.sb_hash, wf] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const next: typeof waterfalls = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setWaterfalls(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, book]);

  async function submitOffer() {
    if (!token || !selectedSb) return;
    try {
      const validUntil = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
      await api.createOffer(token, { sbHash: selectedSb, advancePct, rateBps, validUntil });
      toast.push('success', `Offer submitted: ${advancePct}% advance @ ${(rateBps / 100).toFixed(2)}% rate.`);
      session.bumpRefresh();
    } catch (e) {
      toast.push('error', `Offer failed: ${(e as Error).message}`);
    }
  }

  async function triggerDoubleFinance() {
    // The fraud/double-finance beat: exporter (Sharma) tries to accept the Kotak NBFC
    // offer on SB 6674321 after it is already locked to Citi Trade. Offer acceptance is
    // an EXPORTER-only action (apps/api/src/routes/exporter.ts), so this uses Sharma's
    // token even though the button lives on the Financier tab, per the demo beat sheet.
    const exporterToken = session.tokenByOrgName[ORG_NAMES.exporter];
    if (!exporterToken) return toast.push('error', 'Exporter not logged in yet.');
    setFraudBanner(null);
    try {
      const { shippingBills } = await api.getMyShippingBills(exporterToken);
      const sbA = shippingBills.find((sb) => sb.sb_no === '6674321') ?? shippingBills[0];
      if (!sbA) return toast.push('error', 'SB 6674321 not found — seed the demo first.');
      const { offers } = await api.getOffersForSb(exporterToken, sbA.sb_hash);
      const kotakOrgId = session.orgByName[ORG_NAMES.kotakNbfc]?.id;
      const kotakOffer = offers.find((o) => o.financier_id === kotakOrgId);
      if (!kotakOffer) {
        toast.push('info', 'No open Kotak NBFC offer left on SB 6674321 (already rejected, or SB not yet financed by Citi).');
        return;
      }
      await api.acceptOffer(exporterToken, kotakOffer.id);
      toast.push('info', 'Kotak offer accepted without a prior lock — no double-finance to demonstrate right now.');
      session.bumpRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_LOCKED') {
        setFraudBanner({ message: e.message, chainTx: e.chainTx });
      } else {
        toast.push('error', `Double-finance check failed: ${(e as Error).message}`);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Acting as</span>
        <button
          onClick={() => setPersona('citiTrade')}
          className={`rounded-md px-3 py-1 text-xs font-semibold ${persona === 'citiTrade' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
        >
          Citi Trade
        </button>
        <button
          onClick={() => setPersona('kotakNbfc')}
          className={`rounded-md px-3 py-1 text-xs font-semibold ${persona === 'kotakNbfc' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
        >
          Kotak NBFC
        </button>
      </div>

      <Card className="border-rose-900/60">
        <SectionTitle>Fraud case: double-finance</SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          Accept the Kotak NBFC offer on SB 6674321 — after Citi Trade has already locked it. The chain should say no.
        </p>
        <button
          onClick={triggerDoubleFinance}
          className="rounded-md border border-rose-800 bg-rose-950/60 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/70"
        >
          Accept Kotak NBFC offer on SB 6674321
        </button>
        {fraudBanner && (
          <div className="animate-slide-in mt-3 rounded-lg border border-rose-700 bg-rose-950/80 p-3 text-sm text-rose-200">
            <div className="font-semibold">ALREADY_LOCKED — reverted on-chain</div>
            <div className="mt-1 text-xs text-rose-300">{fraudBanner.message}</div>
            {fraudBanner.chainTx && (
              <div className="mt-2 text-xs">
                Reverted tx <CopyHash hash={fraudBanner.chainTx} />
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <SectionTitle>Market — open receivables</SectionTitle>
          {market.length === 0 && <EmptyState>No open receivables right now.</EmptyState>}
          <div className="flex flex-col gap-2">
            {market.map((sb) => (
              <button key={sb.sb_hash} onClick={() => setSelectedSb(sb.sb_hash)} className="text-left">
                <div
                  className={`rounded-lg border p-3 transition ${
                    selectedSb === sb.sb_hash ? 'border-emerald-600 bg-emerald-950/20' : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-slate-200">SB {sb.sb_no}</span>
                    <StateBadge state={sb.state} />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="font-semibold text-slate-100">{formatInrMinor(sb.fob_inr_minor)}</span>
                    <span className="text-xs text-slate-500">{formatUsdMinor(sb.fob_minor)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Risk: {sb.risk.buyerCountry} · exporter has {sb.risk.exporterRealisedCount} prior realised shipment(s)
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Make offer</SectionTitle>
          {!selectedSb && <EmptyState>Pick a receivable from the market.</EmptyState>}
          {selectedSb && (
            <div className="flex flex-col gap-3">
              <label className="text-xs text-slate-400">
                Advance % <span className="font-semibold text-slate-200">{advancePct}%</span>
                <input
                  type="range"
                  min={50}
                  max={90}
                  value={advancePct}
                  onChange={(e) => setAdvancePct(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>
              <label className="text-xs text-slate-400">
                Rate (bps) <span className="font-semibold text-slate-200">{rateBps} ({(rateBps / 100).toFixed(2)}%)</span>
                <input
                  type="range"
                  min={800}
                  max={2000}
                  step={25}
                  value={rateBps}
                  onChange={(e) => setRateBps(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>
              <button
                onClick={submitOffer}
                className="mt-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Submit offer
              </button>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>My book</SectionTitle>
        {book.length === 0 && <EmptyState>No financed receivables yet.</EmptyState>}
        {book.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-1 font-medium">SB</th>
                <th className="pb-1 font-medium">State</th>
                <th className="pb-1 font-medium">Advance</th>
                <th className="pb-1 font-medium">Rate</th>
                <th className="pb-1 font-medium">Waterfall (due / fee / exporter / shortfall)</th>
              </tr>
            </thead>
            <tbody>
              {book.map((b) => {
                const wf = waterfalls[b.sb_hash];
                return (
                  <tr key={b.sb_hash} className="border-t border-slate-800/70">
                    <td className="py-1.5 font-mono text-slate-300">{b.sb_no}</td>
                    <td className="py-1.5">
                      <StateBadge state={b.state} />
                    </td>
                    <td className="py-1.5 text-slate-300">{formatInrMinor(b.advance_minor)}</td>
                    <td className="py-1.5 text-slate-300">{(b.rate_bps / 100).toFixed(2)}%</td>
                    <td className="py-1.5 text-slate-400">
                      {wf ? (
                        <>
                          {formatInrMinor(wf.financierDue)} / {formatInrMinor(wf.platformFee)} / {formatInrMinor(wf.exporterBalance)} / {formatInrMinor(wf.shortfall)}
                        </>
                      ) : (
                        <Spinner />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <SectionTitle>Alerts</SectionTitle>
        {alerts.length === 0 && <EmptyState>No alerts.</EmptyState>}
        <div className="flex flex-col gap-2">
          {alerts.map((a) => (
            <div key={a.id} className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-2.5 text-xs text-amber-200">
              <span className="mr-2 font-semibold uppercase">{a.type}</span>
              {a.message}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
