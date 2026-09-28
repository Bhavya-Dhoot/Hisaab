import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMT103 } from '../src/index.js';

// Sample from docs/API_SPEC.md §8 ("clean" demo `typo` preset raw MT103).
const SAMPLE = `{1:F01CITIINBBAXXX0000000000}{2:I103CITIUS33AXXXN}{4:
:20:ACME20261213001
:23B:CRED
:32A:261213USD48705,00
:50K:/9876543210
ACME TEXTILES IMPORTS LLC
120 COMMERCE DR
NEWARK NJ US
:59:/00123456789
SHARMA TEXTILES PVT LTD
TIRUPUR IN
:70:PAYMNT FOR GOODS INV 2O24-25/OO91
LESS BANK CHGS
:71A:SHA
:72:/ACC/CHGS USD 45.00
-}`;

test('parseMT103 extracts fields from the API_SPEC §8 sample', () => {
  const fields = parseMT103(SAMPLE);
  assert.equal(fields.senderRef, 'ACME20261213001');
  assert.equal(fields.valueDate, '2026-12-13');
  assert.equal(fields.ccy, 'USD');
  assert.equal(fields.amountMinor, 4870500);
  assert.equal(fields.orderingAccount, '9876543210');
  assert.equal(fields.orderingName, 'ACME TEXTILES IMPORTS LLC');
  assert.equal(fields.orderingCountry, 'US');
  assert.equal(fields.beneficiaryAccount, '00123456789');
  assert.match(fields.beneficiaryName, /SHARMA TEXTILES PVT LTD/);
  assert.match(fields.remitInfo, /PAYMNT FOR GOODS INV 2O24-25\/OO91/);
  assert.match(fields.remitInfo, /LESS BANK CHGS/);
  assert.equal(fields.charges, 'SHA');
  assert.equal(fields.senderToReceiverInfo, '/ACC/CHGS USD 45.00');
});
