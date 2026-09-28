const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function formatInrMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  return inr.format(minor / 100);
}

export function formatUsdMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  return usd.format(minor / 100);
}

export function shortHash(hash: string | null | undefined, len = 6): string {
  if (!hash) return '—';
  const h = hash.startsWith('0x') ? hash : `0x${hash}`;
  return `${h.slice(0, len + 2)}…${h.slice(-4)}`;
}

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore — clipboard API may be unavailable (e.g. non-secure context)
  }
}
