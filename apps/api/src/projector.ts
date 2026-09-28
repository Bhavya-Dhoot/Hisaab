import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { db, toJson, fromJson } from './db.js';
import { RAW_DIR } from './config.js';
import { provider, contracts, addressOf, bytes3ToCcy } from './ledger.js';
import { publish } from './bus.js';
import { queuePayout } from './payouts.js';
import { issueEbrc } from './ebrc.js';

type DecodedLog = {
  name: string;
  args: Record<string, unknown>;
  blockNumber: number;
  transactionHash: string;
  index: number;
};

const ALL_ADDRESSES = [
  addressOf('HisabRoles'),
  addressOf('ShippingBillRegistry'),
  addressOf('ReceivableToken'),
  addressOf('RemittanceRegistry'),
  addressOf('RealisationEngine'),
  addressOf('EBRCIssuer'),
  addressOf('PayoutLedger'),
];

const IFACE_BY_ADDR = new Map<string, ethers.Interface>();
for (const c of [
  contracts.roles,
  contracts.registry,
  contracts.token,
  contracts.remittance,
  contracts.engine,
  contracts.ebrc,
  contracts.payoutLedger,
]) {
  IFACE_BY_ADDR.set(c.target as string, c.interface);
}

function decodeLog(log: ethers.Log): DecodedLog | null {
  const iface = IFACE_BY_ADDR.get(log.address);
  if (!iface) return null;
  try {
    const parsed = iface.parseLog(log);
    if (!parsed) return null;
    const args: Record<string, unknown> = {};
    for (const frag of parsed.fragment.inputs) {
      args[frag.name] = (parsed.args as unknown as Record<string, unknown>)[frag.name];
    }
    return {
      name: parsed.name,
      args,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      index: log.index,
    };
  } catch {
    return null;
  }
}

function readRawJson(file: string): Record<string, unknown> | null {
  const p = path.join(RAW_DIR, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function u(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}
function s(v: unknown): string {
  return String(v);
}

/**
 * Applies effects for one decoded log. `ctx` correlates events within the same
 * transaction (e.g. WaterfallComputed needs the irmHash that Realised, earlier in the
 * same tx, carried). Idempotent: chain_events is the dedup gate — a log already
 * recorded there is skipped so re-polling or a synchronous route-triggered apply never
 * double-applies (double-pays, double-issues eBRC, etc.).
 */
export function applyLog(log: DecodedLog, ctx: { lastIrmHashForSb: Map<string, string> }): void {
  const already = db.prepare(`select 1 from chain_events where tx_hash = ? and log_index = ?`).get(log.transactionHash, log.index);
  if (already) return;

  db.prepare(
    `insert into chain_events (block_no, tx_hash, log_index, name, args, ts) values (?, ?, ?, ?, ?, datetime('now'))`
  ).run(log.blockNumber, log.transactionHash, log.index, log.name, toJson(serializeArgs(log.args)));

  switch (log.name) {
    case 'SBRegistered': {
      const sbHash = s(log.args.sbHash);
      const raw = readRawJson(`sb-${sbHash}.json`) as
        | {
            sbNo: string;
            iec: string;
            portCode?: string;
            invoices: { no: string; fob: number; ccy: string }[];
            buyer?: { name: string; country: string };
            hsCodes?: string[];
            exporterOrgId?: string;
            bundleGroup?: string;
          }
        | null;
      const invoiceNos = raw?.invoices?.map((i) => i.no) ?? [];
      const exporter = db.prepare(`select id from orgs where chain_addr = ?`).get(s(log.args.exporter).toLowerCase()) as
        | { id: string }
        | undefined;
      db.prepare(
        `insert into shipping_bills (sb_hash, sb_no, iec, exporter_id, fob_minor, ccy, fob_inr_minor, leo_ts, port_code, buyer_name, buyer_country, invoice_nos, hs_codes, bundle_group, state, raw_uri, chain_tx)
         values (@sb_hash, @sb_no, @iec, @exporter_id, @fob_minor, @ccy, @fob_inr_minor, @leo_ts, @port_code, @buyer_name, @buyer_country, @invoice_nos, @hs_codes, @bundle_group, 'OPEN', @raw_uri, @chain_tx)
         on conflict(sb_hash) do update set fob_minor=excluded.fob_minor, fob_inr_minor=excluded.fob_inr_minor, chain_tx=excluded.chain_tx`
      ).run({
        sb_hash: sbHash,
        sb_no: raw?.sbNo ?? '',
        iec: raw?.iec ?? '',
        exporter_id: exporter?.id ?? null,
        fob_minor: u(log.args.fobMinor),
        ccy: bytes3ToCcy(s(log.args.ccy)),
        fob_inr_minor: u(log.args.fobInrMinor),
        leo_ts: new Date(u(log.args.leoTs) * 1000).toISOString(),
        port_code: raw?.portCode ?? null,
        buyer_name: raw?.buyer?.name ?? null,
        buyer_country: raw?.buyer?.country ?? null,
        invoice_nos: toJson(invoiceNos),
        hs_codes: toJson(raw?.hsCodes ?? []),
        bundle_group: raw?.bundleGroup ?? null,
        raw_uri: `file://raw/sb-${sbHash}.json`,
        chain_tx: log.transactionHash,
      });
      publish('sb.registered', { sbHash, sbNo: raw?.sbNo, iec: raw?.iec, fob: u(log.args.fobMinor) / 100 }, `Shipping bill ${raw?.sbNo} registered on chain.`);
      break;
    }
    case 'SBStateChanged': {
      db.prepare(`update shipping_bills set state = @state where sb_hash = @sb_hash`).run({
        sb_hash: s(log.args.sbHash),
        state: stateName(u(log.args.newState)),
      });
      break;
    }
    case 'TokenLocked': {
      const sbHash = ethers.toBeHex(BigInt(s(log.args.id)), 32);
      const financierOrg = db.prepare(`select id from orgs where chain_addr = ?`).get(s(log.args.financier).toLowerCase()) as
        | { id: string }
        | undefined;
      const offer = db.prepare(`select id from offers where sb_hash = ? and financier_id = ? and status = 'OPEN'`).get(
        sbHash,
        financierOrg?.id ?? ''
      ) as { id: string } | undefined;
      db.prepare(
        `insert into financings (sb_hash, offer_id, financier_id, advance_minor, rate_bps, locked_ts, chain_tx)
         values (@sb_hash, @offer_id, @financier_id, @advance_minor, @rate_bps, datetime('now'), @chain_tx)
         on conflict(sb_hash) do nothing`
      ).run({
        sb_hash: sbHash,
        offer_id: offer?.id ?? null,
        financier_id: financierOrg?.id ?? null,
        advance_minor: u(log.args.advanceInrMinor),
        rate_bps: u(log.args.rateBps),
        chain_tx: log.transactionHash,
      });
      if (offer) db.prepare(`update offers set status = 'ACCEPTED' where id = ?`).run(offer.id);
      const sb = db.prepare(`select exporter_id, sb_no from shipping_bills where sb_hash = ?`).get(sbHash) as
        | { exporter_id: string; sb_no: string }
        | undefined;
      if (sb?.exporter_id) queuePayout(sbHash, 'ADVANCE', sb.exporter_id, u(log.args.advanceInrMinor));
      publish(
        'token.locked',
        { sbHash, financier: financierOrg?.id, advanceInrMinor: u(log.args.advanceInrMinor), rateBps: u(log.args.rateBps) },
        `₹${(u(log.args.advanceInrMinor) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} advance locked in. Hisab financing SB ${sb?.sb_no ?? ''}`
      );
      break;
    }
    case 'IRMRegistered': {
      const irmHash = s(log.args.irmHash);
      const raw = readRawJson(`irm-${irmHash}.json`) as
        | { bankRef: string; raw: string; chargesMinor?: number; creditTs: string; beneficiaryIec: string; senderName?: string; senderCountry?: string; remitInfo?: string }
        | null;
      const bank = db.prepare(`select id from orgs where chain_addr = ?`).get(s(log.args.bank).toLowerCase()) as { id: string } | undefined;
      db.prepare(
        `insert into remittances (irm_hash, bank_id, msg_type, amount_minor, ccy, inr_minor, credit_ts, sender_name, sender_country, remit_info, raw_uri, beneficiary_iec, charges_minor, state, chain_tx)
         values (@irm_hash, @bank_id, 'MT103', @amount_minor, @ccy, @inr_minor, @credit_ts, @sender_name, @sender_country, @remit_info, @raw_uri, @beneficiary_iec, @charges_minor, 'RECEIVED', @chain_tx)
         on conflict(irm_hash) do update set inr_minor=excluded.inr_minor, chain_tx=excluded.chain_tx`
      ).run({
        irm_hash: irmHash,
        bank_id: bank?.id ?? null,
        amount_minor: u(log.args.amountMinor),
        ccy: bytes3ToCcy(s(log.args.ccy)),
        inr_minor: u(log.args.inrMinor),
        credit_ts: new Date(u(log.args.creditTs) * 1000).toISOString(),
        sender_name: raw?.senderName ?? null,
        sender_country: raw?.senderCountry ?? null,
        remit_info: raw?.remitInfo ?? null,
        raw_uri: `file://raw/irm-${irmHash}.json`,
        beneficiary_iec: raw?.beneficiaryIec ?? null,
        charges_minor: raw?.chargesMinor ?? null,
        chain_tx: log.transactionHash,
      });
      break;
    }
    case 'Realised': {
      const sbHash = s(log.args.sbHash);
      const irmHash = s(log.args.irmHash);
      ctx.lastIrmHashForSb.set(sbHash, irmHash);
      db.prepare(
        `insert into realisations (sb_hash, irm_hash, realised_minor, matched_by, confidence, chain_tx, realised_ts)
         values (@sb_hash, @irm_hash, @realised_minor, @matched_by, @confidence, @chain_tx, datetime('now'))
         on conflict(sb_hash, irm_hash) do update set realised_minor = realised_minor + excluded.realised_minor, chain_tx = excluded.chain_tx`
      ).run({
        sb_hash: sbHash,
        irm_hash: irmHash,
        realised_minor: u(log.args.allocInr),
        matched_by: s(log.args.by),
        confidence: u(log.args.confidencePct) / 100,
        chain_tx: log.transactionHash,
      });
      break;
    }
    case 'WaterfallComputed': {
      const sbHash = s(log.args.sbHash);
      const irmHash = ctx.lastIrmHashForSb.get(sbHash) ?? (db.prepare(`select irm_hash from realisations where sb_hash = ? order by realised_ts desc limit 1`).get(sbHash) as { irm_hash: string } | undefined)?.irm_hash;
      if (!irmHash) break;
      db.prepare(
        `update realisations set financier_due=@fd, platform_fee=@pf, exporter_balance=@eb, shortfall=@sf where sb_hash=@sb_hash and irm_hash=@irm_hash`
      ).run({
        fd: u(log.args.financierDue),
        pf: u(log.args.platformFee),
        eb: u(log.args.exporterBalance),
        sf: u(log.args.shortfall),
        sb_hash: sbHash,
        irm_hash: irmHash,
      });
      const sb = db.prepare(`select exporter_id, sb_no from shipping_bills where sb_hash = ?`).get(sbHash) as
        | { exporter_id: string; sb_no: string }
        | undefined;
      const financing = db.prepare(`select financier_id from financings where sb_hash = ?`).get(sbHash) as
        | { financier_id: string }
        | undefined;
      const opsOrg = db.prepare(`select id from orgs where kind = 'HISAB_OPS' limit 1`).get() as { id: string } | undefined;
      if (financing?.financier_id) queuePayout(sbHash, 'FINANCIER_REPAY', financing.financier_id, u(log.args.financierDue));
      if (sb?.exporter_id) queuePayout(sbHash, 'EXPORTER_BALANCE', sb.exporter_id, u(log.args.exporterBalance));
      if (opsOrg?.id) queuePayout(sbHash, 'PLATFORM_FEE', opsOrg.id, u(log.args.platformFee));
      publish(
        'sb.realised',
        { sbHash, irmHash, realisedInr: u(log.args.realisedInr) },
        `SB ${sb?.sb_no ?? ''} realised on chain. Waterfall computed.`
      );
      void issueEbrc(sbHash, irmHash);
      break;
    }
    case 'EBRCAnchored': {
      const sbHash = s(log.args.sbHash);
      db.prepare(`update realisations set ebrc_vc_hash=@vc, ebrc_ts=datetime('now') where sb_hash=@sb_hash`).run({
        vc: s(log.args.vcHash),
        sb_hash: sbHash,
      });
      publish('ebrc.issued', { sbHash, vcHash: s(log.args.vcHash) }, `eBRC issued. Verifiable credential anchored.`);
      break;
    }
    case 'PayoutRecorded': {
      // Payout rows are updated synchronously by payouts.ts right after this tx confirms;
      // this branch exists so a rebuild replay still has the fact on record.
      break;
    }
    default:
      break;
  }
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'bigint' ? v.toString() : v;
  return out;
}

function stateName(n: number): string {
  return ['NONE', 'OPEN', 'FINANCED', 'PARTIAL', 'REALISED', 'DISPUTED'][n] ?? 'NONE';
}

export function applyReceipt(receipt: ethers.TransactionReceipt): void {
  const ctx = { lastIrmHashForSb: new Map<string, string>() };
  const decoded = receipt.logs.map(decodeLog).filter((d): d is DecodedLog => d !== null);
  decoded.sort((a, b) => a.index - b.index);
  for (const log of decoded) applyLog(log, ctx);
}

async function pollRange(fromBlock: number, toBlock: number): Promise<void> {
  if (fromBlock > toBlock) return;
  const logs = await provider.getLogs({ address: ALL_ADDRESSES, fromBlock, toBlock });
  const byTx = new Map<string, ethers.Log[]>();
  for (const log of logs) {
    const arr = byTx.get(log.transactionHash) ?? [];
    arr.push(log);
    byTx.set(log.transactionHash, arr);
  }
  for (const [, txLogs] of byTx) {
    const ctx = { lastIrmHashForSb: new Map<string, string>() };
    const decoded = txLogs.map(decodeLog).filter((d): d is DecodedLog => d !== null);
    decoded.sort((a, b) => a.index - b.index);
    for (const log of decoded) applyLog(log, ctx);
  }
  db.prepare(`update projector_cursor set last_block = ? where id = 1`).run(toBlock);
}

let polling = false;
let pollingPaused = false;
/** Pauses the background poller so a `demo/reset` (which clears off-chain tables like
 * `orgs` before a reseed repopulates them) can't race a poll cycle into reprocessing
 * old chain events against a still-empty orgs table. */
export function setPollingPaused(paused: boolean): void {
  pollingPaused = paused;
}

export function startPolling(intervalMs = 1000): NodeJS.Timeout {
  return setInterval(async () => {
    if (polling || pollingPaused) return;
    polling = true;
    try {
      const cursor = db.prepare(`select last_block from projector_cursor where id = 1`).get() as { last_block: number };
      const latest = await provider.getBlockNumber();
      const from = cursor.last_block + 1;
      if (from <= latest) await pollRange(from, latest);
    } catch (err) {
      console.error('[projector] poll error', err);
    } finally {
      polling = false;
    }
  }, intervalMs);
}

export async function rebuildProjector(): Promise<void> {
  console.log('[projector] rebuilding read model from chain events + raw store...');
  for (const t of ['chain_events', 'shipping_bills', 'financings', 'remittances', 'realisations', 'payouts']) {
    db.exec(`delete from ${t};`);
  }
  db.prepare(`update projector_cursor set last_block = -1 where id = 1`).run();
  const latest = await provider.getBlockNumber();
  await pollRange(0, latest);
  console.log(`[projector] rebuilt through block ${latest}.`);
}

export { readRawJson };

// CLI entry: `tsx src/projector.ts --rebuild`
if (process.argv[1] && process.argv[1].endsWith('projector.ts') && process.argv.includes('--rebuild')) {
  const { assertDeployed } = await import('./ledger.js');
  await assertDeployed();
  await rebuildProjector();
  process.exit(0);
}

