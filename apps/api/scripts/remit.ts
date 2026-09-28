import { PRESETS, type PresetSb } from '@hisab/matcher';
import { db } from '../src/db.js';
import { assertDeployed, getSimulatedNow } from '../src/ledger.js';
import { ingestIrm } from '../src/ingest.js';

async function main(): Promise<void> {
  await assertDeployed();

  const sb = db.prepare(`select * from shipping_bills where sb_no = '6674321'`).get() as
    | { sb_hash: string; sb_no: string; iec: string; invoice_nos: string; fob_minor: number; ccy: string; buyer_name: string; buyer_country: string }
    | undefined;
  if (!sb) {
    console.error('[remit] SB 6674321 not found — run `pnpm demo:seed` first.');
    process.exit(1);
  }

  const presetSb: PresetSb = {
    sbNo: sb.sb_no,
    invoiceNos: JSON.parse(sb.invoice_nos),
    fobMinor: sb.fob_minor,
    ccy: sb.ccy,
    buyerName: sb.buyer_name,
    buyerCountry: sb.buyer_country,
  };
  const raw = PRESETS.typo(presetSb);
  const result = await ingestIrm({
    bankRef: `SWIFT-TYPO-${Date.now()}`,
    msgType: 'MT103',
    raw,
    creditTs: await getSimulatedNow(),
    beneficiaryIec: sb.iec,
  });

  console.log(JSON.stringify(result, null, 2));
  console.log('[remit] typo-preset remittance ingested for SB 6674321.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[remit] failed:', err);
    process.exit(1);
  });
