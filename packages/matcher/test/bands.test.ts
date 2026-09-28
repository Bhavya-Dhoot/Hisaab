import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match, PRESETS, heuristicExtractor, type Candidate, type IRMInput, type MatchConfig } from '../src/index.js';

const CFG: MatchConfig = { auto: 0.92, review: 0.7, tolerancePct: 2 };
const CREDIT_TS = '2026-12-13T10:05:00+05:30';
const LEO_TS = '2026-09-15T00:00:00Z'; // ~90 days before credit, within the 30-180d tenor window

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

test('clean preset: rules alone reach AUTO without calling the LLM', async () => {
  const sb = { sbNo: '6674321', invoiceNos: ['2024-25/0091'], fobMinor: 4870500, ccy: 'USD', ...BUYER };
  const raw = PRESETS.clean(sb);
  const cand = [candidate({})];
  const result = await match(irm(raw), cand, CFG, heuristicExtractor());
  assert.equal(result.band, 'AUTO');
  assert.equal(result.llmUsed, false);
  assert.equal(result.allocations[0]?.source, 'RULES');
  assert.ok(result.allocations[0]!.confidence >= 0.92, `expected >=0.92, got ${result.allocations[0]!.confidence}`);
});

test('typo preset: rules fail, heuristic extractor normalises O->0 and reaches AUTO', async () => {
  const sb = { sbNo: '6674321', invoiceNos: ['2024-25/0091'], fobMinor: 4870500, ccy: 'USD', ...BUYER };
  const raw = PRESETS.typo(sb);
  const cand = [candidate({})];
  const result = await match(irm(raw), cand, CFG, heuristicExtractor());
  assert.equal(result.band, 'AUTO');
  assert.equal(result.llmUsed, true);
  assert.equal(result.allocations[0]?.source, 'LLM');
  assert.ok(result.allocations[0]!.confidence >= 0.92, `expected >=0.92, got ${result.allocations[0]!.confidence}`);
  assert.ok(result.hallucinationSuspects.length === 0);
});

test('bundle preset: multi-invoice lands in REVIEW with two pro-rata allocations', async () => {
  const sb1 = { sbNo: '6674321', invoiceNos: ['2024-25/0091'], fobMinor: 3000000, ccy: 'USD', ...BUYER };
  const sb2 = { sbNo: '6674322', invoiceNos: ['2024-25/0092'], fobMinor: 2000000, ccy: 'USD', ...BUYER };
  const raw = PRESETS.bundle(sb1, { second: sb2 });
  const cand = [
    candidate({ sbHash: '0xsb1', sbNo: sb1.sbNo, invoiceNos: sb1.invoiceNos, fobMinor: sb1.fobMinor, fobInrMinor: 251500000 }),
    candidate({ sbHash: '0xsb2', sbNo: sb2.sbNo, invoiceNos: sb2.invoiceNos, fobMinor: sb2.fobMinor, fobInrMinor: 167666667 }),
  ];
  const creditedInrMinor = 419000001; // deliberately odd so the pro-rata split can't be even
  const result = await match(irm(raw, { creditedInrMinor }), cand, CFG, heuristicExtractor());
  assert.equal(result.band, 'REVIEW');
  assert.equal(result.llmUsed, true);
  assert.equal(result.allocations.length, 2);
  const sum = result.allocations.reduce((s, a) => s + a.allocInrMinor, 0);
  assert.equal(sum, creditedInrMinor);
  for (const a of result.allocations) {
    assert.ok(a.confidence >= CFG.review && a.confidence < CFG.auto, `alloc confidence ${a.confidence} out of REVIEW range`);
  }
});

test('noref preset: amount + name match only, lands in REVIEW', async () => {
  const sb = { sbNo: '6674321', invoiceNos: ['2024-25/0091'], fobMinor: 4870500, ccy: 'USD', ...BUYER };
  const raw = PRESETS.noref(sb);
  const cand = [candidate({})];
  const result = await match(irm(raw), cand, CFG, heuristicExtractor());
  assert.equal(result.band, 'REVIEW');
  assert.ok(result.llmUsed);
  const conf = result.allocations[0]!.confidence;
  assert.ok(conf >= 0.7 && conf < 0.92, `expected 0.70-0.92, got ${conf}`);
});

test('fraud preset: SB ref matches but amount is 3x FOB, lands UNMATCHED with an alert', async () => {
  const sb = { sbNo: '6674321', invoiceNos: ['2024-25/0091'], fobMinor: 4870500, ccy: 'USD', ...BUYER };
  const raw = PRESETS.fraud(sb);
  const cand = [candidate({})];
  const result = await match(irm(raw), cand, CFG, heuristicExtractor());
  assert.equal(result.band, 'UNMATCHED');
  assert.ok(result.alerts.length > 0, 'expected at least one fraud alert');
  assert.equal(result.allocations.length, 0);
});
