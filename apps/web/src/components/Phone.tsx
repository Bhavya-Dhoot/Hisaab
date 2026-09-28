import React, { useState } from 'react';

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
  const [buzzId, setBuzzId] = useState<number | null>(null);
  const lastId = notifications[0]?.id;

  React.useEffect(() => {
    if (lastId === undefined) return;
    setBuzzId(lastId);
    const t = setTimeout(() => setBuzzId(null), 650);
    return () => clearTimeout(t);
  }, [lastId]);

  return (
    <div className="fixed bottom-4 right-4 z-40 select-none">
      <div
        className={`w-64 rounded-[2rem] border-4 border-slate-700 bg-slate-950 p-2 shadow-2xl ${
          buzzId !== null ? 'animate-buzz' : ''
        }`}
      >
        <div className="mx-auto mb-1 h-1.5 w-16 rounded-full bg-slate-700" />
        <div className="h-[22rem] overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 p-2">
          <div className="mb-2 flex items-center justify-between px-1 pt-1 text-[10px] text-slate-400">
            <span>Hisab</span>
            <span>{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto px-1" style={{ maxHeight: '19rem' }}>
            {notifications.length === 0 && (
              <div className="mt-16 text-center text-xs text-slate-600">No notifications yet</div>
            )}
            {notifications.map((n) => (
              <div
                key={n.id}
                className="animate-slide-in rounded-xl border border-slate-800 bg-slate-800/80 p-2 text-xs shadow"
              >
                <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="font-semibold text-emerald-400">{n.title}</span>
                  <span>{n.ts}</span>
                </div>
                <div className="text-slate-200">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
