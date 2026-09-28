import { randomInt } from 'node:crypto';

/** In-memory mock UPI provider: same idempotencyKey always returns the same UTR. */
const utrStore = new Map<string, string>();

/** Consumed one-at-a-time by the next mockUpiPayout call regardless of key — lets the
 * e2e script force a deterministic retry without needing per-key wiring. */
export let debugForceFailCount = 0;
export function setDebugForceFailCount(n: number): void {
  debugForceFailCount = n;
}

export interface UpiPayoutReq {
  idempotencyKey: string;
  vpa: string;
  amountMinor: number;
  note?: string;
  forceFail?: boolean;
}
export interface UpiPayoutResp {
  utr: string | null;
  status: 'SUCCESS' | 'FAILED';
}

export function resetUpiStore(): void {
  utrStore.clear();
  debugForceFailCount = 0;
}

export async function mockUpiPayout(req: UpiPayoutReq): Promise<UpiPayoutResp> {
  const existing = utrStore.get(req.idempotencyKey);
  if (existing) return { utr: existing, status: 'SUCCESS' };

  let shouldFail = !!req.forceFail;
  if (!shouldFail && debugForceFailCount > 0) {
    debugForceFailCount--;
    shouldFail = true;
  }
  if (shouldFail) return { utr: null, status: 'FAILED' };

  const utr = String(randomInt(100000000000, 999999999999));
  utrStore.set(req.idempotencyKey, utr);
  return { utr, status: 'SUCCESS' };
}
