import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { db } from './db.js';
import { RAW_DIR } from './config.js';
import { canonicalHash } from './hashing.js';
import { sendTx, signerAt, addressAt, ACCOUNT_INDEX, contracts, ApiError } from './ledger.js';

const AD_BANK_DID = 'did:web:adbank.hisab.local';
const PURPOSE_CODE = 'P0102';
const AD_BANK_CODE = 'CITI0000001';

function vcPath(sbHash: string): string {
  return path.join(RAW_DIR, `ebrc-${sbHash}.json`);
}

export function loadVc(sbHash: string): Record<string, unknown> | null {
  const p = vcPath(sbHash);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const inFlight = new Set<string>();

/** Builds, signs, stores, and anchors the eBRC verifiable credential for a fully
 * REALISED shipping bill. Idempotent: skipped if already anchored for this sbHash. The
 * `inFlight` guard makes this safe even if the projector's synchronous (route-triggered)
 * and background-poller paths both end up calling it for the same sbHash — without it,
 * two concurrent calls could both pass the file-existence check before either writes,
 * producing two different `validFrom`-timestamped VCs (and hashes) racing to anchor. */
export async function issueEbrc(sbHash: string, irmHash: string): Promise<void> {
  if (inFlight.has(sbHash)) return;
  const existing = db.prepare(`select ebrc_vc_hash from realisations where sb_hash = ? and ebrc_vc_hash is not null`).get(sbHash);
  if (existing) return;
  if (loadVc(sbHash)) return; // file already written; anchor tx likely in flight or done

  inFlight.add(sbHash);
  try {
    await issueEbrcInner(sbHash, irmHash);
  } finally {
    inFlight.delete(sbHash);
  }
}

async function issueEbrcInner(sbHash: string, irmHash: string): Promise<void> {
  const sb = db.prepare(`select iec, sb_no, leo_ts from shipping_bills where sb_hash = ?`).get(sbHash) as
    | { iec: string; sb_no: string; leo_ts: string }
    | undefined;
  const remit = db.prepare(`select amount_minor, ccy from remittances where irm_hash = ?`).get(irmHash) as
    | { amount_minor: number; ccy: string }
    | undefined;
  const realisedRow = db.prepare(`select coalesce(sum(realised_minor),0) as total, chain_tx from realisations where sb_hash = ?`).get(sbHash) as
    | { total: number; chain_tx: string }
    | undefined;
  if (!sb || !remit || !realisedRow) return;

  const vcWithoutProof = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://hisab.in/ctx/ebrc/v1'],
    type: ['VerifiableCredential', 'ExportRealisationCertificate'],
    issuer: AD_BANK_DID,
    validFrom: new Date().toISOString(),
    credentialSubject: {
      iec: sb.iec,
      shippingBillNo: sb.sb_no,
      shippingBillDate: sb.leo_ts.slice(0, 10),
      sbHash,
      irmHash,
      realisedAmount: { value: (remit.amount_minor / 100).toFixed(2), currency: remit.ccy },
      realisedINR: { value: (realisedRow.total / 100).toFixed(2), currency: 'INR' },
      realisationDate: new Date().toISOString().slice(0, 10),
      purposeCode: PURPOSE_CODE,
      adBankCode: AD_BANK_CODE,
      ledgerAnchor: { chain: 'hisab-hardhat', tx: realisedRow.chain_tx },
    },
  };

  const vcHash = canonicalHash(vcWithoutProof);
  const adBankSigner = signerAt(ACCOUNT_INDEX.adBank);
  const signature = await adBankSigner.signMessage(ethers.getBytes(vcHash));

  const vc = {
    ...vcWithoutProof,
    proof: {
      type: 'EcdsaSecp256k1Signature2019',
      verificationMethod: addressAt(ACCOUNT_INDEX.adBank),
      created: new Date().toISOString(),
      jws: signature,
    },
  };

  fs.writeFileSync(vcPath(sbHash), JSON.stringify(vc, null, 2));
  db.prepare(`update realisations set ebrc_uri = ? where sb_hash = ? and irm_hash = ?`).run(
    `file://raw/ebrc-${sbHash}.json`,
    sbHash,
    irmHash
  );

  try {
    await sendTx('EBRCIssuer', ACCOUNT_INDEX.adBank, 'anchor', [sbHash, vcHash]);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ALREADY_ANCHORED') {
      // fine — another path already anchored it
    } else {
      console.error(`[ebrc] anchor failed for ${sbHash}:`, err);
    }
  }
}

export interface VerifyResult {
  valid: boolean;
  issuer?: string;
  anchoredTx?: string;
  signatureValid?: boolean;
  onChainValid?: boolean;
}

export async function verifyEbrc(sbHash: string, vcHashInput?: string): Promise<VerifyResult> {
  const vc = loadVc(sbHash);
  if (!vc) return { valid: false };
  const proof = vc.proof as { jws: string; verificationMethod: string };
  const vcWithoutProof = { ...vc };
  delete (vcWithoutProof as Record<string, unknown>).proof;
  const recomputedHash = canonicalHash(vcWithoutProof);
  if (vcHashInput && vcHashInput.toLowerCase() !== recomputedHash.toLowerCase()) {
    return { valid: false };
  }

  let signatureValid = false;
  try {
    const recovered = ethers.verifyMessage(ethers.getBytes(recomputedHash), proof.jws);
    signatureValid = recovered.toLowerCase() === proof.verificationMethod.toLowerCase();
  } catch {
    signatureValid = false;
  }

  const onChainValid: boolean = await contracts.ebrc.verify(sbHash, recomputedHash);
  const ebrcRow = db.prepare(`select chain_tx from realisations where sb_hash = ?`).get(sbHash) as
    | { chain_tx: string }
    | undefined;

  return {
    valid: signatureValid && onChainValid,
    issuer: proof.verificationMethod,
    anchoredTx: ebrcRow?.chain_tx,
    signatureValid,
    onChainValid,
  };
}
