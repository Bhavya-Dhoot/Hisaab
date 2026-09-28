import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match, PRESETS, type Candidate, type IRMInput, type MatchConfig, type Extractor } from '../src/index.js';

const CFG: MatchConfig = { auto: 0.92, review: 0.7, tolerancePct: 2 };
const CREDIT_TS = '2026-12-13T10:05:00+05:30';
const LEO_TS = '2026-09-15T00:00:00Z';
const BUYER = { buyerName: 'ACME TEXTILES IMPORTS LLC', buyerCountry: 'US' };

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    sbHash: '0xsb1',
    sbNo: '6674321',
    invoiceNos: ['2024-25/0091'],
    fobMinor: 4870500,
    ccy: 'USD',
    fobInrMinor: 408693000,
    buyerName: BUYER.buyerName,
    buyerCountry: BUYER.buyerCountry,
    leoTs: LEO_TS,
    state: 'OPEN',
    ...overrides,
  };
}

function irm(raw: string, overrides: Partial<IRMInput> = {}): IRMInput {
  return {
    raw,
    creditedInrMinor: 408693000,
    creditTs: CREDIT_TS,
    beneficiaryIec: '0512034567',
    ...overrides,
  };
}

test('a fabricated ref from the extractor is discarded as a hallucination suspect, not used for scoring', async () => {
  const sb = { sbNo: '6674321', invoiceNos: ['2024-25/0091'], fobMinor: 4870500, ccy: 'USD', ...BUYER };
  const raw = PRESETS.noref(sb); // no real ref in the wire text
  const cand = [candidate({})];

  const fakeExtractor: Extractor = async () => ({
    invoiceRefs: ['FAKE-9999'],
    shippingBillRefs: [],
    poRefs: [],
    deductions: [],
    multiInvoice: false,
    notes: '',
  });

  const result = await match(irm(raw), cand, CFG, fakeExtractor);
  assert.deepEqual(result.hallucinationSuspects, ['FAKE-9999']);
  // Falls back to the Stage A rules score (amount + name only) rather than crediting
  // the fake ref's f2 weight — same band as the plain noref case.
  assert.equal(result.band, 'REVIEW');
  assert.equal(result.allocations[0]?.source, 'RULES');
  for (const reason of result.allocations[0]!.reasons) {
    assert.notEqual(reason.rule, 'f2');
  }
});
