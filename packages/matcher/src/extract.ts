import type { Deduction, Extraction, Extractor } from './types.js';

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

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const EXTRACTION_TOOL_SCHEMA = {
  name: 'extract_remittance_refs',
  description: 'Extract structured references from SWIFT MT103 remittance text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      invoiceRefs: { type: 'array', items: { type: 'string' } },
      shippingBillRefs: { type: 'array', items: { type: 'string' } },
      poRefs: { type: 'array', items: { type: 'string' } },
      deductions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['BANK_CHARGES', 'DISCOUNT', 'SHORT_SHIP', 'OTHER'] },
            amount: { type: 'number' },
            ccy: { type: 'string' },
          },
          required: ['type', 'amount', 'ccy'],
        },
      },
      multiInvoice: { type: 'boolean' },
      notes: { type: 'string' },
    },
    required: ['invoiceRefs', 'shippingBillRefs', 'poRefs', 'deductions', 'multiInvoice', 'notes'],
  },
};

const SYSTEM_PROMPT = `You extract structured references from SWIFT MT103 remittance text for Indian export
reconciliation. Output JSON matching the schema. Do not invent references. If unsure, leave arrays empty
and set notes.`;

const FEW_SHOT = [
  {
    input: ':70: /INV/2024-25/0091 /SB/6674321',
    output: {
      invoiceRefs: ['2024-25/0091'],
      shippingBillRefs: ['6674321'],
      poRefs: [],
      deductions: [],
      multiInvoice: false,
      notes: '',
    },
  },
  {
    input:
      ':70: PAYMNT FOR GOODS INV 2024-25/0091 AND 0092 LESS BANK CHGS\n:72: /ACC/CHGS USD 45.00\n:50K: ACME TEXTILES IMPORTS LLC, NEW JERSEY US',
    output: {
      invoiceRefs: ['2024-25/0091', '2024-25/0092'],
      shippingBillRefs: [],
      poRefs: [],
      deductions: [{ type: 'BANK_CHARGES', amount: 45.0, ccy: 'USD' }],
      multiInvoice: true,
      notes: "expanded continuation ref -> '2024-25/0092'",
    },
  },
  {
    input: ':70: PAYMENT FOR GOODS',
    output: {
      invoiceRefs: [],
      shippingBillRefs: [],
      poRefs: [],
      deductions: [],
      multiInvoice: false,
      notes: 'no references found in free text',
    },
  },
];

/** LLM-backed extractor. Never called in tests — network access is not mocked. */
export function anthropicExtractor(apiKey: string, model = DEFAULT_MODEL): Extractor {
  return async ({ remitInfo, senderInfo, bankInfo }) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, timeout: 3000 });

    const fewShotBlurb = FEW_SHOT.map(
      (ex, i) => `Example ${i + 1}:\nInput:\n${ex.input}\nOutput:\n${JSON.stringify(ex.output)}`
    ).join('\n\n');

    const userMessage = `${fewShotBlurb}\n\nNow extract from:\n:70: ${remitInfo}\n:50K: ${senderInfo}\n:72: ${bankInfo}`;

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL_SCHEMA.name },
      messages: [{ role: 'user', content: userMessage }],
    });

    const toolUse = response.content.find((b: { type: string }) => b.type === 'tool_use') as
      | { type: 'tool_use'; input: unknown }
      | undefined;
    if (!toolUse) {
      return {
        invoiceRefs: [],
        shippingBillRefs: [],
        poRefs: [],
        deductions: [],
        multiInvoice: false,
        notes: 'no tool_use returned',
      };
    }
    return toolUse.input as Extraction;
  };
}
