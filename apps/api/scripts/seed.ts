import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { assertDeployed, addressAt, ACCOUNT_INDEX } from '../src/ledger.js';
import { ingestSb } from '../src/ingest.js';

async function main(): Promise<void> {
  await assertDeployed();

  function insertOrg(kind: string, name: string, signerIndex: number, iec: string | null, vpa: string | null): string {
    const id = randomUUID();
    db.prepare(
      `insert into orgs (id, kind, name, chain_addr, signer_index, iec, vpa) values (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, kind, name, addressAt(signerIndex), signerIndex, iec, vpa);
    return id;
  }

  const customsId = insertOrg('CUSTOMS', 'Nhava Sheva Customs', ACCOUNT_INDEX.customs, null, null);
  const adBankId = insertOrg('AD_BANK', 'Citi', ACCOUNT_INDEX.adBank, null, null);
  const opsId = insertOrg('HISAB_OPS', 'Hisab Ops', ACCOUNT_INDEX.ops, null, 'hisab-ops@upi');
  const dgftId = insertOrg('DGFT', 'DGFT / Regulator', ACCOUNT_INDEX.regulator, null, null);

  const sharmaId = insertOrg('EXPORTER', 'Sharma Textiles', ACCOUNT_INDEX.exporters[0], '0512034567', 'sharma-textiles@upi');
  const exporter2Id = insertOrg('EXPORTER', 'Meridian Auto Components', ACCOUNT_INDEX.exporters[1], '1198765432', 'meridian-auto@upi');
  const exporter3Id = insertOrg('EXPORTER', 'Global Pharma Exports', ACCOUNT_INDEX.exporters[2], '2233445566', 'global-pharma@upi');

  const citiTradeId = insertOrg('FINANCIER', 'Citi Trade', ACCOUNT_INDEX.financiers[0], null, 'citi-trade@upi');
  const kotakNbfcId = insertOrg('FINANCIER', 'Kotak NBFC', ACCOUNT_INDEX.financiers[1], null, 'kotak-nbfc@upi');

  const leoTs = new Date().toISOString();
  const sbA = await ingestSb({
    sbNo: '6674321',
    sbDate: leoTs.slice(0, 10),
    iec: '0512034567',
    portCode: 'INNSA1',
    leoTs,
    invoices: [{ no: '2024-25/0091', fob: 48750.0, ccy: 'USD' }],
    buyer: { name: 'ACME TEXTILES IMPORTS LLC', country: 'US' },
    hsCodes: ['6109.10'],
    exporterVpaHint: 'sharma-textiles@upi',
  });

  const sbB = await ingestSb({
    sbNo: '6674322',
    sbDate: leoTs.slice(0, 10),
    iec: '0512034567',
    portCode: 'INNSA1',
    leoTs,
    invoices: [{ no: '2024-25/0092', fob: 32000.0, ccy: 'USD' }],
    buyer: { name: 'ACME TEXTILES IMPORTS LLC', country: 'US' },
    hsCodes: ['6109.10'],
    bundleGroup: 'sharma-bundle',
  });

  const sbC = await ingestSb({
    sbNo: '6674323',
    sbDate: leoTs.slice(0, 10),
    iec: '0512034567',
    portCode: 'INNSA1',
    leoTs,
    invoices: [{ no: '2024-25/0093', fob: 21000.0, ccy: 'USD' }],
    buyer: { name: 'ACME TEXTILES IMPORTS LLC', country: 'US' },
    hsCodes: ['6109.10'],
    bundleGroup: 'sharma-bundle',
  });

  const sbD = await ingestSb({
    sbNo: '7788001',
    sbDate: leoTs.slice(0, 10),
    iec: '1198765432',
    portCode: 'INNSA1',
    leoTs,
    invoices: [{ no: '2024-25/0201', fob: 60000.0, ccy: 'USD' }],
    buyer: { name: 'NORDIC AUTO GMBH', country: 'DE' },
    hsCodes: ['8708.99'],
  });

  const sbE = await ingestSb({
    sbNo: '7788002',
    sbDate: leoTs.slice(0, 10),
    iec: '2233445566',
    portCode: 'INNSA1',
    leoTs,
    invoices: [{ no: '2024-25/0301', fob: 90000.0, ccy: 'USD' }],
    buyer: { name: 'EURO PHARMA BV', country: 'NL' },
    hsCodes: ['3004.90'],
  });

  const validUntil = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  db.prepare(
    `insert into offers (id, sb_hash, financier_id, advance_pct, rate_bps, valid_until, status) values (?, ?, ?, ?, ?, ?, 'OPEN')`
  ).run(randomUUID(), sbA.sbHash, citiTradeId, 88, 1150, validUntil);
  db.prepare(
    `insert into offers (id, sb_hash, financier_id, advance_pct, rate_bps, valid_until, status) values (?, ?, ?, ?, ?, ?, 'OPEN')`
  ).run(randomUUID(), sbA.sbHash, kotakNbfcId, 85, 1300, validUntil);

  console.log('SEED_JSON_START');
  console.log(
    JSON.stringify({
      orgs: { customsId, adBankId, opsId, dgftId, sharmaId, exporter2Id, exporter3Id, citiTradeId, kotakNbfcId },
      shippingBills: { sbA: sbA.sbHash, sbB: sbB.sbHash, sbC: sbC.sbHash, sbD: sbD.sbHash, sbE: sbE.sbHash },
    })
  );
  console.log('SEED_JSON_END');
  console.log('[seed] done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
