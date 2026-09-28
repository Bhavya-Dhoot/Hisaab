import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { parseMT103 } from '@hisab/matcher';
import { db } from './db.js';
import { RAW_DIR, config } from './config.js';
import { canonicalHash } from './hashing.js';
import { sendTx, ccyToBytes3, ACCOUNT_INDEX, ApiError } from './ledger.js';
import { applyReceipt } from './projector.js';
import { runMatch } from './matching.js';

export interface SbIngestBody {
  sbNo: string;
  sbDate: string;
  iec: string;
  portCode: string;
  leoTs: string;
  invoices: { no: string; fob: number; ccy: string }[];
  buyer: { name: string; country: string };
  hsCodes?: string[];
  exporterVpaHint?: string;
  bundleGroup?: string;
}

export interface SbIngestResult {
  sbHash: string;
  state: string;
  chainTx: string;
  tokenId: string;
}

export async function ingestSb(body: SbIngestBody): Promise<SbIngestResult> {
  const existing = db.prepare(`select sb_hash, state, chain_tx from shipping_bills where sb_no = ? and iec = ?`).get(
    body.sbNo,
    body.iec
  ) as { sb_hash: string; state: string; chain_tx: string } | undefined;
  if (existing) {
    return {
      sbHash: existing.sb_hash,
      state: existing.state,
      chainTx: existing.chain_tx,
      tokenId: BigInt(existing.sb_hash).toString(),
    };
  }

  const org = db.prepare(`select id, chain_addr from orgs where iec = ?`).get(body.iec) as
    | { id: string; chain_addr: string }
    | undefined;
  if (!org) throw new ApiError('UNKNOWN_EXPORTER', `No exporter org seeded for IEC ${body.iec}`, 400);

  const fobMinor = Math.round(body.invoices.reduce((sum, inv) => sum + inv.fob, 0) * 100);
  const ccy = body.invoices[0]?.ccy ?? 'USD';
  const invoiceNos = body.invoices.map((i) => i.no).sort();
  const leoDate = body.leoTs.slice(0, 10);

  const sbHash = canonicalHash({ sbNo: body.sbNo, iec: body.iec, leoDate, fobMinor, ccy, invoiceNos, portCode: body.portCode });
  const fobInrMinor = Math.round(fobMinor * config.leoRate);

  fs.writeFileSync(
    path.join(RAW_DIR, `sb-${sbHash}.json`),
    JSON.stringify({ ...body, exporterOrgId: org.id, bundleGroup: body.bundleGroup ?? null }, null, 2)
  );

  const iecHash = ethers.keccak256(ethers.toUtf8Bytes(body.iec));
  const leoTsSec = Math.floor(new Date(body.leoTs).getTime() / 1000);

  const receipt = await sendTx('ShippingBillRegistry', ACCOUNT_INDEX.customs, 'registerShippingBill', [
    sbHash,
    iecHash,
    org.chain_addr,
    BigInt(fobMinor),
    ccyToBytes3(ccy),
    BigInt(leoTsSec),
    BigInt(fobInrMinor),
  ]);
  applyReceipt(receipt);

  return { sbHash, state: 'OPEN', chainTx: receipt.hash, tokenId: BigInt(sbHash).toString() };
}

export interface IrmIngestBody {
  bankRef: string;
  msgType: string;
  raw: string;
  creditedInrMinor?: number;
  chargesMinor?: number;
  creditTs: string;
  beneficiaryIec: string;
}

export interface IrmIngestResult {
  irmHash: string;
  state: string;
  matchJobId: string;
}

export async function ingestIrm(body: IrmIngestBody): Promise<IrmIngestResult> {
  const fields = parseMT103(body.raw);
  const irmHash = canonicalHash({
    bankRef: body.bankRef,
    msgType: body.msgType,
    valueDate: fields.valueDate,
    amountMinor: fields.amountMinor,
    ccy: fields.ccy,
    senderRef: fields.senderRef,
  });

  const existing = db.prepare(`select irm_hash, state from remittances where irm_hash = ?`).get(irmHash) as
    | { irm_hash: string; state: string }
    | undefined;
  if (existing) {
    return { irmHash: existing.irm_hash, state: existing.state, matchJobId: existing.irm_hash };
  }

  const creditedInrMinor = body.creditedInrMinor ?? Math.round(fields.amountMinor * config.creditRate);
  const creditTsSec = Math.floor(new Date(body.creditTs).getTime() / 1000);

  fs.writeFileSync(
    path.join(RAW_DIR, `irm-${irmHash}.json`),
    JSON.stringify(
      {
        ...body,
        creditedInrMinor,
        senderName: fields.orderingName,
        senderCountry: fields.orderingCountry,
        remitInfo: fields.remitInfo,
      },
      null,
      2
    )
  );

  const receipt = await sendTx('RemittanceRegistry', ACCOUNT_INDEX.adBank, 'registerIRM', [
    irmHash,
    BigInt(fields.amountMinor),
    ccyToBytes3(fields.ccy),
    BigInt(creditedInrMinor),
    BigInt(creditTsSec),
  ]);
  applyReceipt(receipt);

  setImmediate(() => {
    runMatch(irmHash).catch((err) => console.error(`[matching] runMatch(${irmHash}) failed:`, err));
  });

  return { irmHash, state: 'RECEIVED', matchJobId: irmHash };
}
