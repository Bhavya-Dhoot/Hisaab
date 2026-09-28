const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

type MoneySize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLS: Record<MoneySize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-xl',
  xl: 'text-[28px]',
};

export function Money({
  minor,
  ccy = 'INR',
  size = 'md',
  className = '',
}: {
  minor: number | null | undefined;
  ccy?: 'INR' | 'USD';
  size?: MoneySize;
  className?: string;
}) {
  if (minor === null || minor === undefined) {
    return <span className={`font-mono tabular text-faint ${SIZE_CLS[size]} ${className}`}>n/a</span>;
  }
  const value = minor / 100;
  const formatted = ccy === 'USD' ? usdFmt.format(value) : inrFmt.format(value);
  const symbol = ccy === 'USD' ? '$' : '₹';
  return (
    <span className={`font-mono tabular ${SIZE_CLS[size]} ${className}`}>
      {symbol}
      {formatted}
    </span>
  );
}
