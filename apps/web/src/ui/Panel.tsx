import type { ReactNode } from 'react';

export function Panel({
  title,
  action,
  raised,
  className = '',
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-[var(--radius-ui)] border border-line ${raised ? 'bg-raised shadow-lift' : 'bg-surface'} ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
