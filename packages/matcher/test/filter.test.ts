import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates } from '../src/rules.js';
import type { Candidate } from '../src/index.js';

const CREDIT_TS = '2026-12-13T10:05:00+05:30';

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    sbHash: '0xsb1',
    sbNo: '6674321',
    invoiceNos: ['2024-25/0091'],
    fobMinor: 4870500,
    ccy: 'USD',
    fobInrMinor: 408693000,
    buyerName: 'ACME TEXTILES IMPORTS LLC',
    buyerCountry: 'US',
    leoTs: '2026-09-15T00:00:00Z',
    state: 'OPEN',
    ...overrides,
  };
}

test('filterCandidates keeps only OPEN|FINANCED|PARTIAL states within the 15-month LEO window', () => {
  const open = candidate({ sbHash: 'open', state: 'OPEN' });
  const financed = candidate({ sbHash: 'financed', state: 'FINANCED' });
  const partial = candidate({ sbHash: 'partial', state: 'PARTIAL' });
  const realised = candidate({ sbHash: 'realised', state: 'REALISED' });
  const tooOld = candidate({ sbHash: 'too-old', state: 'OPEN', leoTs: '2024-06-01T00:00:00Z' }); // >15mo before credit
  const future = candidate({ sbHash: 'future', state: 'OPEN', leoTs: '2027-06-01T00:00:00Z' }); // LEO after credit

  const result = filterCandidates([open, financed, partial, realised, tooOld, future], CREDIT_TS);
  const hashes = result.map((c) => c.sbHash).sort();
  assert.deepEqual(hashes, ['financed', 'open', 'partial']);
});
