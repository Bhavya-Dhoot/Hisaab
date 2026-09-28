import React, { createContext, useCallback, useContext, useState } from 'react';

export interface ToastItem {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface ToastCtx {
  push: (kind: ToastItem['kind'], message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = ++counter;
    setItems((cur) => [...cur, { id, kind, message }]);
    setTimeout(() => {
      setItems((cur) => cur.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-in rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              t.kind === 'success'
                ? 'border-emerald-700 bg-emerald-950/90 text-emerald-200'
                : t.kind === 'error'
                  ? 'border-rose-700 bg-rose-950/90 text-rose-200'
                  : 'border-slate-700 bg-slate-900/90 text-slate-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
