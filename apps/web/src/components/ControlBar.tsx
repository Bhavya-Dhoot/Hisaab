import { useState } from 'react';
import { api } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';

async function findSbHashByNo(token: string, sbNo: string): Promise<string | null> {
  const { shippingBills } = await api.getMyShippingBills(token);
  return shippingBills.find((sb) => sb.sb_no === sbNo)?.sb_hash ?? shippingBills[0]?.sb_hash ?? null;
}

function Btn({
  label,
  busyLabel,
  onClick,
  tone = 'default',
}: {
  label: string;
  busyLabel?: string;
  onClick: () => Promise<void>;
  tone?: 'default' | 'danger';
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${
        tone === 'danger'
          ? 'border-rose-800 bg-rose-950/60 text-rose-200 hover:bg-rose-900/70'
          : 'border-slate-700 bg-slate-800/70 text-slate-100 hover:bg-slate-700'
      }`}
    >
      {busy ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {busyLabel ?? 'Working…'}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

export function ControlBar() {
  const session = useSession();
  const toast = useToast();

  const exporterToken = session.tokenByOrgName[ORG_NAMES.exporter];
  const fraudExporterToken = session.tokenByOrgName[ORG_NAMES.fraudExporter];

  return (
    <div className="sticky top-[52px] z-30 flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Demo control</span>

      <Btn
        label="Seed demo"
        busyLabel="Seeding…"
        onClick={async () => {
          try {
            await api.seedDemo();
            toast.push('success', 'Demo data seeded: 5 shipping bills, Citi + Kotak offers on SB 6674321.');
            await session.relogin();
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Seed failed: ${(e as Error).message}`);
          }
        }}
      />

      <Btn
        label="Customs: LEO issued"
        busyLabel="Issuing LEO…"
        onClick={async () => {
          try {
            const res = await api.mockIcegateGenerate('textile', session.orgByName[ORG_NAMES.exporter]?.iec ?? undefined);
            toast.push('success', `LEO issued — shipping bill hashed on chain (tx ${res.chainTx.slice(0, 10)}…).`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Icegate mock failed: ${(e as Error).message}`);
          }
        }}
      />

      <Btn
        label="75 days later: SWIFT arrives"
        busyLabel="Advancing time…"
        onClick={async () => {
          if (!exporterToken) return toast.push('error', 'Exporter not logged in yet.');
          try {
            const sbHash = await findSbHashByNo(exporterToken, '6674321');
            if (!sbHash) return toast.push('error', 'SB 6674321 not found — seed the demo first.');
            await api.demoAdvanceTime(74);
            const res = await api.mockSwiftGenerate('typo', sbHash);
            toast.push('success', `Messy SWIFT MT103 ingested (IRM ${res.irmHash.slice(0, 10)}…) — matcher is working it.`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `SWIFT arrival failed: ${(e as Error).message}`);
          }
        }}
      />

      <Btn
        label="Bundle remittance"
        busyLabel="Sending bundle…"
        onClick={async () => {
          if (!exporterToken) return toast.push('error', 'Exporter not logged in yet.');
          try {
            const sbHash = await findSbHashByNo(exporterToken, '6674322');
            if (!sbHash) return toast.push('error', 'SB 6674322 not found — seed the demo first.');
            const res = await api.mockSwiftGenerate('bundle', sbHash);
            toast.push('success', `Bundled remittance ingested (IRM ${res.irmHash.slice(0, 10)}…) — 2 shipping bills, 1 payment.`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Bundle remittance failed: ${(e as Error).message}`);
          }
        }}
      />

      <Btn
        label="Fraud remittance"
        busyLabel="Sending fraud case…"
        onClick={async () => {
          if (!fraudExporterToken) return toast.push('error', 'Global Pharma Exports not logged in yet.');
          try {
            const sbHash = await findSbHashByNo(fraudExporterToken, '7788002');
            if (!sbHash) return toast.push('error', 'SB 7788002 not found — seed the demo first.');
            const res = await api.mockSwiftGenerate('fraud', sbHash);
            toast.push('success', `Fraud-shaped remittance ingested (IRM ${res.irmHash.slice(0, 10)}…) — should end up UNMATCHED.`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Fraud remittance failed: ${(e as Error).message}`);
          }
        }}
      />

      <Btn
        label="Reset"
        busyLabel="Resetting…"
        tone="danger"
        onClick={async () => {
          try {
            await api.demoReset();
            toast.push('info', 'Demo state reset — chain snapshot reverted, DB cleared.');
            await session.relogin();
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Reset failed: ${(e as Error).message}`);
          }
        }}
      />
    </div>
  );
}
