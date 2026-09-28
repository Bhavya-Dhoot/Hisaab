import type { ReactNode } from 'react';

export function RuleRow({
  label,
  value,
  children,
  className = '',
}: {
  label?: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${className.includes('grid') ? '' : 'flex justify-between'} items-center gap-3 border-b border-line py-2 text-sm last:border-b-0 ${className}`}
    >
      {children ?? (
        <>
          <span className="text-muted">{label}</span>
          <span className="text-text">{value}</span>
        </>
      )}
    </div>
  );
}
