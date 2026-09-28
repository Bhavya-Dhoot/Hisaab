import { useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, Database, FastForward, Package, SealCheck, Warning } from '@phosphor-icons/react';
import { Button } from '../ui/Button';
import { api } from '../api';
import { useSession, ORG_NAMES } from '../session';
import { useToast } from './Toasts';

async function findSbHashByNo(token: string, sbNo: string): Promise<string | null> {
  const { shippingBills } = await api.getMyShippingBills(token);
  return shippingBills.find((sb) => sb.sb_no === sbNo)?.sb_hash ?? shippingBills[0]?.sb_hash ?? null;
}

function ActionButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={danger ? 'danger' : 'secondary'}
      size="sm"
      icon={icon}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

export function ControlBar() {
  const session = useSession();
  const toast = useToast();

  const exporterToken = session.tokenByOrgName[ORG_NAMES.exporter];
  const fraudExporterToken = session.tokenByOrgName[ORG_NAMES.fraudExporter];

  return (
    <div className="sticky top-14 z-30 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
      <ActionButton
        icon={<Database size={14} />}
        label="Seed demo"
        onClick={async () => {
          try {
            await api.seedDemo();
            toast.push('success', 'Demo seeded: 5 shipping bills, Citi Trade and Kotak NBFC offers on SB 6674321.');
            await session.relogin();
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Seed failed: ${(e as Error).message}`);
          }
        }}
      />

      <ActionButton
        icon={<SealCheck size={14} />}
        label="Clear customs"
        onClick={async () => {
          try {
            const res = await api.mockIcegateGenerate('textile', session.orgByName[ORG_NAMES.exporter]?.iec ?? undefined);
            toast.push('success', `LEO issued, shipping bill hashed on chain (tx ${res.chainTx.slice(0, 10)}…).`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Customs clearance failed: ${(e as Error).message}`);
          }
        }}
      />

      <ActionButton
        icon={<FastForward size={14} />}
        label="Jump 75 days, SWIFT arrives"
        onClick={async () => {
          if (!exporterToken) return toast.push('error', 'Exporter not logged in yet.');
          try {
            const sbHash = await findSbHashByNo(exporterToken, '6674321');
            if (!sbHash) return toast.push('error', 'SB 6674321 not found, seed the demo first.');
            await api.demoAdvanceTime(74);
            const res = await api.mockSwiftGenerate('typo', sbHash);
            toast.push('success', `Messy SWIFT MT103 ingested (IRM ${res.irmHash.slice(0, 10)}…), matcher is working it.`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `SWIFT arrival failed: ${(e as Error).message}`);
          }
        }}
      />

      <ActionButton
        icon={<Package size={14} />}
        label="Bundle remittance"
        onClick={async () => {
          if (!exporterToken) return toast.push('error', 'Exporter not logged in yet.');
          try {
            const sbHash = await findSbHashByNo(exporterToken, '6674322');
            if (!sbHash) return toast.push('error', 'SB 6674322 not found, seed the demo first.');
            const res = await api.mockSwiftGenerate('bundle', sbHash);
            toast.push('success', `Bundled remittance ingested (IRM ${res.irmHash.slice(0, 10)}…), 2 shipping bills, 1 payment.`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Bundle remittance failed: ${(e as Error).message}`);
          }
        }}
      />

      <ActionButton
        icon={<Warning size={14} />}
        label="Fraud remittance"
        onClick={async () => {
          if (!fraudExporterToken) return toast.push('error', 'Global Pharma Exports not logged in yet.');
          try {
            const sbHash = await findSbHashByNo(fraudExporterToken, '7788002');
            if (!sbHash) return toast.push('error', 'SB 7788002 not found, seed the demo first.');
            const res = await api.mockSwiftGenerate('fraud', sbHash);
            toast.push('success', `Fraud-shaped remittance ingested (IRM ${res.irmHash.slice(0, 10)}…), should stay UNMATCHED.`);
            session.bumpRefresh();
          } catch (e) {
            toast.push('error', `Fraud remittance failed: ${(e as Error).message}`);
          }
        }}
      />

      <ActionButton
        icon={<ArrowCounterClockwise size={14} />}
        label="Reset"
        danger
        onClick={async () => {
          try {
            await api.demoReset();
            toast.push('info', 'Demo state reset: chain snapshot reverted, database cleared.');
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
