import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle, Info, XCircle } from '@phosphor-icons/react';

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

const ICONS = { success: CheckCircle, error: XCircle, info: Info };
const TONE_CLS: Record<ToastItem['kind'], string> = {
  success: 'border-accent text-accent-text',
  error: 'border-danger text-danger',
  info: 'border-line text-muted',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduce = useReducedMotion();

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
      <div className="fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const IconCmp = ICONS[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className={`flex items-start gap-2 rounded-[var(--radius-ui)] border bg-raised px-3.5 py-2.5 text-sm shadow-lift ${TONE_CLS[t.kind]}`}
              >
                <IconCmp size={16} className="mt-0.5 shrink-0" />
                <span className="text-text">{t.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
