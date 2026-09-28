import type { Deduction, Extractor } from './types.js';

/** Swaps letters commonly mistaken for digits (O->0, I/l->1) inside a ref token. */
function deOcr(token: string): string {
  return token.replace(/[OIl]/g, (ch) => (ch === 'O' ? '0' : '1'));
}

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.,;:]+$/, '');
}

function extractDeductions(remitInfo: string, bankInfo: string): Deduction[] {
  const deductions: Deduction[] = [];
  const chgMatch = /\/ACC\/CHGS\s+([A-Z]{3})\s+([\d.]+)/i.exec(bankInfo);
  if (chgMatch) {
    deductions.push({ type: 'BANK_CHARGES', amount: parseFloat(chgMatch[2]), ccy: chgMatch[1].toUpperCase() });
  } else if (/LESS\s+BANK\s+CHGS/i.test(remitInfo)) {
    deductions.push({ type: 'BANK_CHARGES', amount: 0, ccy: '' });
  }
  return deductions;
}

/** Offline, deterministic fallback extractor — no network calls. */
export function heuristicExtractor(): Extractor {
  return async ({ remitInfo, bankInfo }) => {
    const notes: string[] = [];
    const invoiceRefs = new Set<string>();
    const shippingBillRefs = new Set<string>();

    const note = (raw: string, normalized: string) => {
      if (normalized.toUpperCase() !== raw.toUpperCase()) notes.push(`normalised '${raw}'->'${normalized}'`);
    };

    // 1. Explicitly tagged refs, e.g. "/INV/2024-25/0091" or "/SB/6674321".
    for (const m of remitInfo.matchAll(/\/(SB|INV)\/(\S+)/gi)) {
      const raw = stripTrailingPunctuation(m[2]);
      const normalized = deOcr(raw);
      note(raw, normalized);
      if (m[1].toUpperCase() === 'SB') shippingBillRefs.add(normalized);
      else invoiceRefs.add(normalized);
    }

    // 2. Bare "INV <ref>" (no slash tag) — covers OCR'd typos like "INV 2O24-25/OO91".
    for (const m of remitInfo.matchAll(/\bINV\b\.?\s+(\S+)/gi)) {
      const raw = stripTrailingPunctuation(m[1]);
      const normalized = deOcr(raw);
      note(raw, normalized);
      invoiceRefs.add(normalized);
    }

    // 3. "<ref> AND <ref>" continuations, e.g. "INV 2024-25/0091 AND 0092" or bare
    // "0091 AND 0092". When the preceding ref has a directory (e.g. "2024-25/"),
    // the bare suffix is expanded against it (-> "2024-25/0092").
    for (const m of remitInfo.matchAll(/\bAND\s+(\S+)/gi)) {
      const raw = stripTrailingPunctuation(m[1]);
      const normalized = deOcr(raw);
      const prevWithDir = [...invoiceRefs].reverse().find((r) => r.includes('/'));
      if (prevWithDir) {
        const dir = prevWithDir.slice(0, prevWithDir.lastIndexOf('/'));
        const expanded = `${dir}/${normalized}`;
        invoiceRefs.add(expanded);
        notes.push(`expanded continuation ref -> '${expanded}'`);
      } else {
        invoiceRefs.add(normalized);
        note(raw, normalized);
      }
    }

    const deductions = extractDeductions(remitInfo, bankInfo);
    const multiInvoice = invoiceRefs.size > 1 || /\bAND\b/i.test(remitInfo);

    return {
      invoiceRefs: [...invoiceRefs],
      shippingBillRefs: [...shippingBillRefs],
      poRefs: [],
      deductions,
      multiInvoice,
      notes: notes.join('; '),
    };
  };
}
