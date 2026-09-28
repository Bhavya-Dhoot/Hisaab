import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DeviceMobile, X } from '@phosphor-icons/react';

export interface PushNotification {
  id: number;
  title: string;
  body: string;
  ts: string;
}

let counter = 0;
export function makeNotification(body: string): PushNotification {
  return { id: ++counter, title: 'Hisab', body, ts: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
}

export function Phone({ notifications }: { notifications: PushNotification[] }) {
  const reduce = useReducedMotion();
  const [buzzId, setBuzzId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280);
  const lastId = notifications[0]?.id;

  useEffect(() => {
    if (lastId === undefined || reduce) return;
    setBuzzId(lastId);
    const t = setTimeout(() => setBuzzId(null), 500);
    return () => clearTimeout(t);
  }, [lastId, reduce]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Show phone"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-[var(--radius-ui)] border border-line bg-raised px-3 py-2 text-xs text-muted shadow-lift active:translate-y-px"
      >
        <DeviceMobile size={16} />
        {notifications.length > 0 && <span className="font-mono tabular text-accent-text">{notifications.length}</span>}
      </button>
    );
  }

  return (
    <motion.div
      animate={buzzId !== null ? { x: [0, -3, 3, -3, 3, -2, 2, 0] } : { x: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed bottom-4 right-4 z-40 w-64 select-none rounded-[2rem] border border-line bg-raised p-2 shadow-lift"
    >
      <div className="relative flex items-center justify-center px-1 pb-1">
        <div className="h-1.5 w-16 rounded-full bg-line" />
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Hide phone"
          className="absolute right-0 top-0 rounded p-1 text-faint hover:text-text"
        >
          <X size={12} />
        </button>
      </div>
      <div className="h-[22rem] overflow-hidden rounded-[1.25rem] bg-sunken p-2">
        <div className="mb-2 flex items-center justify-between px-1 pt-1 font-mono tabular text-[10px] text-muted">
          <span>Hisab</span>
          <span>{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto px-1" style={{ maxHeight: '19rem' }}>
          {notifications.length === 0 && <div className="mt-16 text-center text-xs text-faint">No notifications yet</div>}
          <AnimatePresence initial={false}>
            {notifications.map((n) => (
              <motion.div
                key={n.id}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                className="rounded-[var(--radius-ui)] border border-line bg-raised p-2 text-xs shadow-lift"
              >
                <div className="mb-0.5 flex items-center justify-between font-mono tabular text-[10px] text-muted">
                  <span className="font-semibold text-accent-text">{n.title}</span>
                  <span>{n.ts}</span>
                </div>
                <div className="text-text">{n.body}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
