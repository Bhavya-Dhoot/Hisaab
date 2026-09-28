import { useCallback, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { api } from './api';
import { SessionCtx, ORG_NAMES, type Session } from './session';
import { ToastProvider, useToast } from './components/Toasts';
import { Header, type Tab } from './components/Header';
import { ControlBar } from './components/ControlBar';
import { Phone, makeNotification, type PushNotification } from './components/Phone';
import { ExporterView } from './components/ExporterView';
import { FinancierView } from './components/FinancierView';
import { BankOpsView } from './components/BankOpsView';
import { ExplorerView } from './components/ExplorerView';
import { useEvents } from './useEvents';
import type { Org, DomainEventEnvelope } from './types';

const PERSONA_ORG_NAMES = Object.values(ORG_NAMES);

function AppInner() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('exporter');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [tokenByOrgName, setTokenByOrgName] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notifications, setNotifications] = useState<PushNotification[]>([]);

  const bumpRefresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const loginAll = useCallback(async () => {
    try {
      const { orgs: allOrgs } = await api.getOrgs();
      setOrgs(allOrgs);
      const byName: Record<string, Org> = {};
      for (const o of allOrgs) byName[o.name] = o;

      const tokens: Record<string, string> = {};
      await Promise.all(
        PERSONA_ORG_NAMES.map(async (name) => {
          const org = byName[name];
          if (!org) return; // not seeded yet, fine, views handle missing tokens gracefully
          try {
            const res = await api.login(org.id);
            tokens[name] = res.token;
          } catch {
            // ignore, org may not exist before first seed
          }
        })
      );
      setTokenByOrgName(tokens);
      setReady(true);
    } catch (e) {
      toast.push('error', `Failed to reach API: ${(e as Error).message}`);
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loginAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDomainEvent = useCallback((e: DomainEventEnvelope) => {
    if (e.text) {
      setNotifications((cur) => [makeNotification(e.text as string), ...cur].slice(0, 12));
    }
    setRefreshTick((t) => t + 1);
  }, []);

  useEvents(onDomainEvent, bumpRefresh);

  const orgByName: Record<string, Org> = {};
  for (const o of orgs) orgByName[o.name] = o;

  const session: Session = { orgs, orgByName, tokenByOrgName, ready, refreshTick, bumpRefresh, relogin: loginAll };

  return (
    <SessionCtx.Provider value={session}>
      <div className="min-h-screen bg-bg pb-24">
        <Header tab={tab} onTab={setTab} />
        <ControlBar />
        <main className="xl:pr-[288px]">
          {tab === 'exporter' && <ExporterView />}
          {tab === 'financier' && <FinancierView />}
          {tab === 'bankops' && <BankOpsView />}
          {tab === 'explorer' && <ExplorerView />}
        </main>
        <Phone notifications={notifications} />
      </div>
    </SessionCtx.Provider>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </MotionConfig>
  );
}
