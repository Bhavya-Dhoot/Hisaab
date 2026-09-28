import type { ReactNode } from 'react';

export function Field({
  label,
  helper,
  error,
  children,
}: {
  label?: ReactNode;
  helper?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted">
      {label && <span className="font-medium text-text">{label}</span>}
      {children}
      {error ? <span className="text-danger">{error}</span> : helper ? <span className="text-faint">{helper}</span> : null}
    </label>
  );
}
