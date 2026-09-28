import { createHash } from 'node:crypto';

/**
 * Simplified canonical JSON (JCS-equivalent for our controlled data): sorts object keys
 * recursively and serializes with no extra whitespace. Sufficient because every hashed
 * document here contains only strings, integers, and arrays of strings (no floats, no
 * unicode-normalization edge cases) — the full RFC 8785 algorithm is overkill for that.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return '0x' + createHash('sha256').update(input, 'utf8').digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
