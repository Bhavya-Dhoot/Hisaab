import { motion } from 'motion/react';

interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  groupId,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  groupId: string;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          className={`relative whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-colors active:translate-y-px ${
            value === it.id ? 'text-text' : 'text-muted hover:text-text'
          }`}
        >
          {it.label}
          {value === it.id && (
            <motion.span
              layoutId={`${groupId}-underline`}
              className="absolute inset-x-2 -bottom-px h-0.5 bg-accent"
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
