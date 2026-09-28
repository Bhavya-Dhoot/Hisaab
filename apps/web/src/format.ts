export function shortHash(hash: string | null | undefined, len = 6): string {
  if (!hash) return 'n/a';
  const h = hash.startsWith('0x') ? hash : `0x${hash}`;
  return `${h.slice(0, len + 2)}…${h.slice(-4)}`;
}

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return 'n/a';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore, clipboard API may be unavailable (e.g. non-secure context)
  }
}
