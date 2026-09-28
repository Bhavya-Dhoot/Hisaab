import { Moon, Sun } from '@phosphor-icons/react';
import { Tabs } from '../ui/Tabs';
import { useTheme } from '../theme';

export type Tab = 'exporter' | 'financier' | 'bankops' | 'explorer';

const TABS: { id: Tab; label: string }[] = [
  { id: 'exporter', label: 'Exporter' },
  { id: 'financier', label: 'Financier' },
  { id: 'bankops', label: 'Bank Ops' },
  { id: 'explorer', label: 'Explorer' },
];

export function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const [theme, toggleTheme] = useTheme();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-line bg-surface/95 px-4 backdrop-blur">
      <div className="flex shrink-0 items-baseline gap-1.5 font-display text-lg font-semibold tracking-tight text-text">
        Hisab <span className="font-deva text-base text-muted">हिसाब</span>
      </div>
      <nav className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        <Tabs groupId="persona-tabs" items={TABS} value={tab} onChange={onTab} />
      </nav>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="shrink-0 rounded-[var(--radius-ui)] border border-line p-1.5 text-muted transition-colors hover:text-text active:translate-y-px"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}
