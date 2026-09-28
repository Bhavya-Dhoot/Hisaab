import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink border border-accent hover:brightness-95',
  secondary: 'bg-surface text-text border border-line hover:border-line-strong',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-sunken hover:text-text',
  danger: 'bg-transparent text-danger border border-danger hover:bg-danger-soft',
};

const SIZE_CLS: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius-ui)] font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="font-mono tabular">···</span>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
