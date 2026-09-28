import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { WarningOctagon } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';
import { Panel } from '../ui/Panel';
import { Stamp } from '../ui/Stamp';
import { Money } from '../ui/Money';
import { Hash } from '../ui/Hash';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Slider } from '../ui/Slider';
import { Tabs } from '../ui/Tabs';
import { Empty } from '../ui/Empty';
import { Skeleton } from '../ui/Skeleton';
import { RuleRow } from '../ui/RuleRow';
import type { MarketReceivable, BookRow, Alert } from '../types';

type FinancierPersona = 'citiTrade' | 'kotakNbfc';
const PERSONAS: { id: FinancierPersona; label: string }[] = [
  { id: 'citiTrade', label: 'Citi Trade' },
  { id: 'kotakNbfc', label: 'Kotak NBFC' },
];

export function FinancierView() {
  const session = useSession();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [persona, setPersona] = useState<FinancierPersona>('citiTrade');
  const orgName = persona === 'citiTrade' ? ORG_NAMES.citiTrade : ORG_NAMES.kotakNbfc;
  const token = session.tokenByOrgName[orgName];

  const [market, setMarket] = useState<MarketReceivable[]>([]);
  const [book, setBook] = useState<BookRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [waterfalls, setWaterfalls] = useState<
    Record<string, { financierDue: number; platformFee: number; exporterBalance: number; shortfall: number }>
  >({});
  const [selectedSb, setSelectedSb] = useState<string | null>(null);
  const [advancePct, setAdvancePct] = useState(85);
  const [rateBps, setRateBps] = useState(1200);
  const [fraudBanner, setFraudBanner] = useState<{ message: string; chainTx?: string } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

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
    api
      .getMyBook(token)
      .then((r) => setBook(r.book))
      .catch(() => undefined);
    api
      .getMyAlerts(token)
      .then((r) => setAlerts(r.alerts))
      .catch(() => undefined);
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
      toast.push('success', `Offer submitted: ${advancePct}% advance at ${(rateBps / 100).toFixed(2)}% rate.`);
      session.bumpRefresh();
    } catch (e) {
      toast.push('error', `Offer failed: ${(e as Error).message}`);
    }
  }

  async function triggerDoubleFinance() {
    // Offer acceptance is an exporter-only action, so this uses Sharma's token even
    // though the button lives on the Financier tab, per the demo beat sheet.
    const exporterToken = session.tokenByOrgName[ORG_NAMES.exporter];
    if (!exporterToken) return toast.push('error', 'Exporter not logged in yet.');
    setFraudBanner(null);
    try {
      const { shippingBills } = await api.getMyShippingBills(exporterToken);
      const sbA = shippingBills.find((sb) => sb.sb_no === '6674321') ?? shippingBills[0];
      if (!sbA) return toast.push('error', 'SB 6674321 not found, seed the demo first.');
      const { offers } = await api.getOffersForSb(exporterToken, sbA.sb_hash);
      const kotakOrgId = session.orgByName[ORG_NAMES.kotakNbfc]?.id;
      const kotakOffer = offers.find((o) => o.financier_id === kotakOrgId);
      if (!kotakOffer) {
        toast.push('info', 'No open Kotak NBFC offer left on SB 6674321.');
        return;
      }
      await api.acceptOffer(exporterToken, kotakOffer.id);
      toast.push('info', 'Kotak offer accepted without a prior lock, no double-finance to demonstrate right now.');
      session.bumpRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_LOCKED') {
        setFraudBanner({ message: e.message, chainTx: e.chainTx });
        setShakeKey((k) => k + 1);
      } else {
        toast.push('error', `Double-finance check failed: ${(e as Error).message}`);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted">Acting as</span>
        <Tabs groupId="financier-persona" items={PERSONAS} value={persona} onChange={setPersona} />
      </div>

      <Panel title="Fraud case: double-finance">
        <p className="mb-3 text-sm text-muted">
          Accept the Kotak NBFC offer on SB 6674321 after Citi Trade has already locked it. The chain should refuse it.
        </p>
        <Button variant="danger" size="sm" onClick={triggerDoubleFinance}>
          Accept Kotak NBFC offer on SB 6674321
        </Button>
        {fraudBanner && (
          <motion.div
            key={shakeKey}
            animate={reduce ? {} : { x: [0, -6, 6, -6, 6, -3, 3, 0] }}
            transition={{ duration: 0.3 }}
            className="mt-3 flex items-start gap-2 rounded-[var(--radius-ui)] border border-danger bg-danger-soft p-3 text-sm"
          >
            <WarningOctagon size={18} className="mt-0.5 shrink-0 text-danger" />
            <div>
              <div className="font-mono tabular font-semibold text-danger">Already financed. The ledger refused a second lock.</div>
              <div className="mt-1 break-all font-mono text-[11px] text-danger/80">{fraudBanner.message}</div>
              {fraudBanner.chainTx && (
                <div className="mt-2 flex items-center gap-2 text-xs text-danger">
                  <span>Reverted tx</span>
                  <Hash value={fraudBanner.chainTx} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Market: open receivables">
          {market.length === 0 && <Empty message="No open receivables right now." />}
          <div className="flex flex-col">
            {market.map((sb) => (
              <button
                key={sb.sb_hash}
                onClick={() => setSelectedSb(sb.sb_hash)}
                className={`flex items-center justify-between gap-3 border-b border-line py-2.5 text-left transition-colors last:border-b-0 ${
                  selectedSb === sb.sb_hash ? 'bg-raised shadow-[inset_2px_0_0_var(--c-accent)]' : 'hover:bg-sunken'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-mono tabular text-sm text-text">SB {sb.sb_no}</div>
                  <div className="truncate text-xs text-muted">
                    {sb.risk.buyerCountry}, exporter has {sb.risk.exporterRealisedCount} prior realised shipment
                    {sb.risk.exporterRealisedCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Money minor={sb.fob_inr_minor} size="sm" />
                  <Stamp state={sb.state} size="sm" />
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Make offer">
          {!selectedSb && <Empty message="Pick a receivable from the market." />}
          {selectedSb && (
            <div className="flex flex-col gap-4">
              <Field label="Advance against FOB">
                <Slider value={advancePct} min={50} max={90} onChange={setAdvancePct} format={(v) => `${v}%`} />
              </Field>
              <Field label="Annual rate">
                <Slider value={rateBps} min={800} max={2000} step={25} onChange={setRateBps} format={(v) => `${(v / 100).toFixed(2)}%`} />
              </Field>
              <Button variant="primary" onClick={submitOffer}>
                Submit offer
              </Button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="My book">
        {book.length === 0 && <Empty message="No financed receivables yet." />}
        {book.length > 0 && (
          <div className="flex flex-col">
            {book.map((b) => {
              const wf = waterfalls[b.sb_hash];
              return (
                <div key={b.sb_hash} className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line py-2.5 text-sm last:border-b-0">
                  <span className="font-mono tabular text-text">SB {b.sb_no}</span>
                  <Stamp state={b.state} size="sm" />
                  <span className="font-mono tabular text-xs text-muted">
                    <Money minor={b.advance_minor} size="sm" /> advance
                  </span>
                  <span className="font-mono tabular text-xs text-muted">{(b.rate_bps / 100).toFixed(2)}% rate</span>
                  {wf ? (
                    <span className="font-mono tabular text-xs text-faint">
                      due <Money minor={wf.financierDue} size="sm" />, fee <Money minor={wf.platformFee} size="sm" />, exporter{' '}
                      <Money minor={wf.exporterBalance} size="sm" />
                      {wf.shortfall ? (
                        <span className="text-danger">
                          , shortfall <Money minor={wf.shortfall} size="sm" />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-40" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Alerts">
        {alerts.length === 0 && <Empty message="No alerts." />}
        <div className="flex flex-col">
          {alerts.map((a) => (
            <RuleRow key={a.id}>
              <span className="font-mono tabular text-xs uppercase text-accent-text">{a.type}</span>
              <span className="text-text">{a.message}</span>
            </RuleRow>
          ))}
        </div>
      </Panel>
    </div>
  );
}
