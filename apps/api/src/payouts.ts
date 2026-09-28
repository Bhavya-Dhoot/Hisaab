import { v5 as uuidv5 } from 'uuid';
import { ethers } from 'ethers';
import { db, toJson } from './db.js';
import { sendTx, ACCOUNT_INDEX, ApiError } from './ledger.js';
import { mockUpiPayout } from './upi.js';
import { publish } from './bus.js';

const PAYOUT_NAMESPACE = '2f9d9c1a-6a3e-4b0e-9b1a-3c8f6a9d1e2b';
const LEG_ENUM: Record<string, number> = { ADVANCE: 0, FINANCIER_REPAY: 1, EXPORTER_BALANCE: 2, PLATFORM_FEE: 3 };

export function payoutId(sbHash: string, leg: string): string {
  return uuidv5(`${sbHash}:${leg}`, PAYOUT_NAMESPACE);
}

const inFlight = new Set<string>();

/** Queues (or resumes) a payout leg. Amounts <= 0 are skipped per the waterfall spec
 * ("skip zero amounts") — e.g. a never-financed SB has no FINANCIER_REPAY leg. */
export function queuePayout(sbHash: string, leg: string, toOrgId: string, amountMinor: number): void {
  if (amountMinor <= 0) return;
  const id = payoutId(sbHash, leg);
  const existing = db.prepare(`select status from payouts where id = ?`).get(id) as { status: string } | undefined;
  if (!existing) {
    db.prepare(
      `insert into payouts (id, sb_hash, leg, to_org, amount_minor, status) values (?, ?, ?, ?, ?, 'PENDING')`
    ).run(id, sbHash, leg, toOrgId, amountMinor);
  } else if (existing.status === 'CONFIRMED') {
    return; // never double-pay
  }
  void attemptPayout(id);
}

async function attemptPayout(id: string): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    await runAttempts(id);
  } finally {
    inFlight.delete(id);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAttempts(id: string): Promise<void> {
  const row = db
    .prepare(`select id, sb_hash, leg, to_org, amount_minor, status, attempts from payouts where id = ?`)
    .get(id) as
    | { id: string; sb_hash: string; leg: string; to_org: string; amount_minor: number; status: string; attempts: number }
    | undefined;
  if (!row || row.status === 'CONFIRMED') return;

  const org = db.prepare(`select chain_addr, vpa, name from orgs where id = ?`).get(row.to_org) as
    | { chain_addr: string; vpa: string; name: string }
    | undefined;
  if (!org) {
    console.error(`[payouts] unknown target org for payout ${id}`);
    return;
  }
  const sb = db.prepare(`select sb_no from shipping_bills where sb_hash = ?`).get(row.sb_hash) as { sb_no: string } | undefined;

  let attempts = row.attempts;
  while (attempts < 5) {
    attempts++;
    db.prepare(`update payouts set attempts = ?, status = 'SENT', updated_at = datetime('now') where id = ?`).run(attempts, id);

    let resp;
    try {
      resp = await mockUpiPayout({
        idempotencyKey: id,
        vpa: org.vpa,
        amountMinor: row.amount_minor,
        note: `Hisab ${row.leg} SB ${sb?.sb_no ?? ''}`,
      });
    } catch (err) {
      resp = { utr: null, status: 'FAILED' as const };
      console.error(`[payouts] UPI call error for ${id}:`, err);
    }

    if (resp.status === 'SUCCESS' && resp.utr) {
      const confirmed = await recordOnChain(row.sb_hash, row.leg, org.chain_addr, row.amount_minor, resp.utr, id);
      if (confirmed) {
        db.prepare(
          `update payouts set status = 'CONFIRMED', utr = ?, provider_resp = ?, chain_tx = ?, updated_at = datetime('now') where id = ?`
        ).run(resp.utr, toJson(resp), confirmed, id);
        publish(
          'payout.confirmed',
          { sbHash: row.sb_hash, leg: row.leg, inrMinor: row.amount_minor, utr: resp.utr },
          `₹${(row.amount_minor / 100).toLocaleString('en-IN')} credited — Hisab ${legLabel(row.leg)} on SB ${sb?.sb_no ?? ''}`
        );
        return;
      }
      // on-chain call failed even though UPI succeeded — retry the on-chain leg only.
      db.prepare(`update payouts set status = 'FAILED', provider_resp = ? where id = ?`).run(toJson(resp), id);
    } else {
      db.prepare(`update payouts set status = 'FAILED', provider_resp = ? where id = ?`).run(toJson(resp), id);
    }
    await sleep(Math.min(200 * 2 ** attempts, 3000));
  }
  console.error(`[payouts] payout ${id} exhausted retries without confirming`);
}

async function recordOnChain(
  sbHash: string,
  leg: string,
  toAddr: string,
  amountMinor: number,
  utr: string,
  id: string
): Promise<string | null> {
  const utrHash = ethers.keccak256(ethers.toUtf8Bytes(utr));
  try {
    const receipt = await sendTx('PayoutLedger', ACCOUNT_INDEX.payoutAdapter, 'recordPayout', [
      sbHash,
      LEG_ENUM[leg],
      toAddr,
      BigInt(amountMinor),
      utrHash,
    ]);
    return receipt.hash;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'DUPLICATE_LEG') {
      // Already recorded on a previous attempt (e.g. UPI succeeded, tx receipt lost).
      return `already-recorded:${id}`;
    }
    console.error(`[payouts] recordPayout failed for ${id}:`, err);
    return null;
  }
}

function legLabel(leg: string): string {
  switch (leg) {
    case 'ADVANCE':
      return 'advance';
    case 'FINANCIER_REPAY':
      return 'financier repayment';
    case 'EXPORTER_BALANCE':
      return 'export balance';
    case 'PLATFORM_FEE':
      return 'platform fee';
    default:
      return leg;
  }
}
