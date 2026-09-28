import type { MT103Fields } from './types.js';

const TAG_RE = /^:([0-9]{2}[A-Z]?):(.*)$/;

function collectTags(raw: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  let current: string | null = null;
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // terminator / block markers from the {4: ... -} envelope
    if (line === '-}' || line === '-' || line === '}' || /^\{[124]:/.test(line)) {
      current = null;
      continue;
    }
    const m = TAG_RE.exec(line);
    if (m) {
      current = m[1];
      const rest = m[2].trim();
      if (!tags.has(current)) tags.set(current, []);
      if (rest) tags.get(current)!.push(rest);
      continue;
    }
    if (current) {
      tags.get(current)!.push(line);
    }
  }
  return tags;
}

function countryFromLastLine(lines: string[]): string {
  if (lines.length === 0) return '';
  const last = lines[lines.length - 1];
  const m = /\b([A-Z]{2})\s*$/.exec(last.trim());
  return m ? m[1] : '';
}

export function parseMT103(raw: string): MT103Fields {
  const tags = collectTags(raw);

  const senderRef = (tags.get('20')?.[0] ?? '').trim();

  let valueDate = '';
  let ccy = '';
  let amountMinor = 0;
  const f32 = tags.get('32A')?.[0] ?? '';
  const m32 = /^(\d{2})(\d{2})(\d{2})([A-Z]{3})([\d,.]+)$/.exec(f32);
  if (m32) {
    const [, yy, mm, dd, c, amt] = m32;
    const century = Number(yy) < 70 ? 2000 : 1900;
    valueDate = `${century + Number(yy)}-${mm}-${dd}`;
    ccy = c;
    const normalized = amt.replace(/,/g, '.');
    amountMinor = Math.round(parseFloat(normalized) * 100);
  }

  const f50 = tags.get('50K') ?? [];
  let orderingAccount = '';
  let orderingLines: string[] = [...f50];
  if (orderingLines[0]?.startsWith('/')) {
    orderingAccount = orderingLines[0].slice(1).trim();
    orderingLines = orderingLines.slice(1);
  }
  const orderingName = orderingLines[0] ?? '';
  const orderingCountry = countryFromLastLine(orderingLines);

  const f59 = tags.get('59') ?? [];
  let beneficiaryAccount = '';
  let beneficiaryLines: string[] = [...f59];
  if (beneficiaryLines[0]?.startsWith('/')) {
    beneficiaryAccount = beneficiaryLines[0].slice(1).trim();
    beneficiaryLines = beneficiaryLines.slice(1);
  }
  const beneficiaryName = beneficiaryLines.join(' ').trim();

  const remitInfo = (tags.get('70') ?? []).join(' ').trim();
  const charges = (tags.get('71A') ?? []).join(' ').trim();
  const senderToReceiverInfo = (tags.get('72') ?? []).join(' ').trim();

  return {
    senderRef,
    valueDate,
    ccy,
    amountMinor,
    orderingAccount,
    orderingName,
    orderingLines,
    orderingCountry,
    beneficiaryAccount,
    beneficiaryName,
    remitInfo,
    charges,
    senderToReceiverInfo,
  };
}
