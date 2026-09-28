export type Tab = 'exporter' | 'financier' | 'bankops' | 'explorer';

const TABS: { id: Tab; label: string; sub: string }[] = [
  { id: 'exporter', label: 'Exporter', sub: 'Sharma Textiles' },
  { id: 'financier', label: 'Financier', sub: 'Citi Trade / Kotak NBFC' },
  { id: 'bankops', label: 'Bank Ops', sub: 'Hisab Ops' },
  { id: 'explorer', label: 'Explorer', sub: 'DGFT / Regulator' },
];

export function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center gap-4 border-b border-slate-800 bg-slate-950/95 px-4 backdrop-blur">
      <div className="text-lg font-bold tracking-tight text-slate-100">
        Hisab <span className="text-slate-400">· हिसाब</span>
      </div>
      <nav className="flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`flex flex-col items-start rounded-md px-3 py-1 text-left transition ${
              tab === t.id ? 'bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-700' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <span className="text-sm font-semibold leading-tight">{t.label}</span>
            <span className="text-[10px] leading-tight text-slate-500">{t.sub}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
