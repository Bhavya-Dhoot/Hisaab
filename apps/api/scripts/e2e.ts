import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;

let failed = 0;
function pass(msg: string): void {
  console.log(`PASS  ${msg}`);
}
function fail(msg: string, detail?: unknown): void {
  failed++;
  console.log(`FAIL  ${msg}`);
  if (detail !== undefined) console.log('      ', typeof detail === 'string' ? detail : JSON.stringify(detail));
}
function assert(cond: unknown, msg: string, detail?: unknown): void {
  if (cond) pass(msg);
  else fail(msg, detail);
}

interface HttpResult<T = any> {
  status: number;
  body: T;
}

async function http<T = any>(method: string, p: string, body?: unknown, token?: string): Promise<HttpResult<T>> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json as T };
}

async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 30000, intervalMs = 500): Promise<T> {
  const start = Date.now();
  let last: T;
  do {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() - start < timeoutMs);
  return last!;
}

async function main(): Promise<void> {
  console.log(`[e2e] target ${BASE}`);

  // --- setup ---
  await http('POST', '/v1/demo/reset').catch(() => null);
  console.log('[e2e] seeding...');
  const seedOutput = execSync('pnpm -F @hisab/api demo:seed', { cwd: REPO_ROOT, encoding: 'utf8' });
  console.log(seedOutput);
  const seedJson = /SEED_JSON_START\s*([\s\S]*?)\s*SEED_JSON_END/.exec(seedOutput);
  assert(!!seedJson, 'seed printed its org/SB summary');
  const seedData = JSON.parse(seedJson![1]) as {
    orgs: Record<string, string>;
    shippingBills: { sbA: string; sbB: string; sbC: string; sbD: string; sbE: string };
  };
  pass('seed');

  const orgsRes = await http<{ orgs: { id: string; kind: string; name: string; iec: string | null }[] }>('GET', '/v1/orgs');
  const orgs = orgsRes.body.orgs;
  const sharma = orgs.find((o) => o.name === 'Sharma Textiles')!;
  const ops = orgs.find((o) => o.kind === 'HISAB_OPS')!;
  const citiTrade = orgs.find((o) => o.name === 'Citi Trade')!;
  const kotakNbfc = orgs.find((o) => o.name === 'Kotak NBFC')!;

  const exporterLogin = await http<{ token: string }>('POST', '/v1/auth/login', { orgId: sharma.id });
  const exporterToken = exporterLogin.body.token;
  const opsLogin = await http<{ token: string }>('POST', '/v1/auth/login', { orgId: ops.id });
  const opsToken = opsLogin.body.token;

  const sbA = { sb_hash: seedData.shippingBills.sbA, sb_no: '6674321' };
  const sbB = { sb_hash: seedData.shippingBills.sbB, sb_no: '6674322' };
  const sbC = { sb_hash: seedData.shippingBills.sbC, sb_no: '6674323' };
  const sbE = { sb_hash: seedData.shippingBills.sbE, sb_no: '7788002' };
  assert(!!sbA.sb_hash && !!sbB.sb_hash && !!sbC.sb_hash, 'seed produced SB 6674321 (A), 6674322 (B, bundle), 6674323 (C, bundle)');

  const offersRes = await http<{ offers: { id: string; financier_id: string; advance_pct: number }[] }>(
    'GET',
    `/v1/shipping-bills/${sbA.sb_hash}/offers`,
    undefined,
    exporterToken
  );
  const citiOffer = offersRes.body.offers.find((o) => o.financier_id === citiTrade.id)!;
  const nbfcOffer = offersRes.body.offers.find((o) => o.financier_id === kotakNbfc.id)!;
  assert(citiOffer && nbfcOffer, 'seed produced Citi Trade + Kotak NBFC offers on SB 6674321');

  // --- accept Citi offer ---
  const acceptCiti = await http('POST', `/v1/offers/${citiOffer.id}/accept`, {}, exporterToken);
  assert(acceptCiti.status === 200 && acceptCiti.body.chainTx, 'accept Citi Trade offer -> 200 with chainTx', acceptCiti.body);
  assert(acceptCiti.body.advanceInrMinor > 0, 'advanceInrMinor computed', acceptCiti.body);

  // --- ADVANCE payout confirmed ---
  const payoutsAfterAdvance = await pollUntil(
    () => http<{ payouts: { sb_hash: string; leg: string; status: string; utr: string | null }[] }>('GET', '/v1/me/payouts', undefined, exporterToken),
    (r) => r.body.payouts.some((p) => p.sb_hash === sbA.sb_hash && p.leg === 'ADVANCE' && p.status === 'CONFIRMED')
  );
  const advancePayout = payoutsAfterAdvance.body.payouts.find((p) => p.sb_hash === sbA.sb_hash && p.leg === 'ADVANCE');
  assert(advancePayout?.status === 'CONFIRMED' && !!advancePayout?.utr, 'ADVANCE payout CONFIRMED with UTR', advancePayout);

  // --- double-finance: accept NBFC offer on same (now-locked) SB ---
  const acceptNbfc = await http('POST', `/v1/offers/${nbfcOffer.id}/accept`, {}, exporterToken);
  assert(
    acceptNbfc.status === 409 && acceptNbfc.body?.error?.code === 'ALREADY_LOCKED',
    '409 ALREADY_LOCKED on second accept (on-chain revert)',
    acceptNbfc.body
  );

  // --- 75 days later ---
  await http('POST', '/v1/demo/advance-time', { days: 74 });
  pass('advance-time 74 days');

  // --- messy SWIFT arrives (typo preset) ---
  const swiftTypo = await http('POST', `/mock/swift/generate?preset=typo&sbHash=${sbA.sb_hash}`);
  assert(swiftTypo.status === 200 && swiftTypo.body.irmHash, 'swift typo preset ingested', swiftTypo.body);

  // --- poll until REALISED ---
  const realisedA = await pollUntil(
    () => http('GET', `/v1/shipping-bills/${sbA.sb_hash}`, undefined, exporterToken),
    (r) => r.body.state === 'REALISED',
    40000
  );
  assert(realisedA.body.state === 'REALISED', 'SB 6674321 reached REALISED', realisedA.body.state);

  // --- eBRC ---
  const ebrcRes = await http('GET', `/v1/shipping-bills/${sbA.sb_hash}/ebrc`, undefined, exporterToken);
  assert(ebrcRes.status === 200 && ebrcRes.body.vc, 'eBRC VC issued', ebrcRes.body);

  const verifyRes = await http('GET', `/v1/explorer/ebrc/verify?sbHash=${sbA.sb_hash}`, undefined, opsToken);
  assert(verifyRes.body?.valid === true, 'explorer eBRC verify -> valid', verifyRes.body);

  // --- payout legs + waterfall arithmetic ---
  // Payouts settle asynchronously after REALISED flips, so poll for all three legs
  // rather than trusting the single snapshot that caught the state transition.
  const legs = ['FINANCIER_REPAY', 'EXPORTER_BALANCE', 'PLATFORM_FEE'];
  const sbAWithPayouts = await pollUntil(
    () => http(`GET`, `/v1/shipping-bills/${sbA.sb_hash}`, undefined, exporterToken),
    (r) => legs.every((leg) => r.body.payouts.find((x: { leg: string; status: string }) => x.leg === leg)?.status === 'CONFIRMED'),
    20000
  );
  for (const leg of legs) {
    const p = sbAWithPayouts.body.payouts.find((x: { leg: string }) => x.leg === leg);
    assert(p?.status === 'CONFIRMED', `${leg} payout CONFIRMED`, p);
  }
  const wf = sbAWithPayouts.body.realisations?.[0];
  if (wf) {
    const sum = (wf.financier_due ?? 0) + (wf.platform_fee ?? 0) + (wf.exporter_balance ?? 0) + (wf.shortfall ?? 0);
    assert(sum === wf.realised_minor, 'waterfall legs + shortfall == realised INR', { sum, realised: wf.realised_minor, wf });
  } else {
    fail('waterfall row present on realisation');
  }

  // --- bundle preset -> ops queue with 2 candidates -> approve both -> REALISED ---
  const swiftBundle = await http('POST', `/mock/swift/generate?preset=bundle&sbHash=${sbB.sb_hash}`);
  assert(swiftBundle.status === 200 && swiftBundle.body.irmHash, 'swift bundle preset ingested', swiftBundle.body);

  const queueAfterBundle = await pollUntil(
    () => http<{ queue: { id: string; irm_hash: string; candidates: { sb_hash: string }[] }[] }>('GET', '/v1/ops/queue?status=PENDING', undefined, opsToken),
    (r) => r.body.queue.some((q) => q.irm_hash === swiftBundle.body.irmHash)
  );
  const bundleItem = queueAfterBundle.body.queue.find((q) => q.irm_hash === swiftBundle.body.irmHash)!;
  const itemDetail = await http<{ candidates: { sb_hash: string; proposed_minor: number }[] }>(
    'GET',
    `/v1/ops/queue/${bundleItem.id}`,
    undefined,
    opsToken
  );
  const actionable = itemDetail.body.candidates.filter((c) => c.proposed_minor > 0);
  assert(actionable.length === 2, 'ops queue item has 2 actionable candidates (bundle)', itemDetail.body.candidates);

  const candB = actionable.find((c) => c.sb_hash === sbB.sb_hash);
  const candC = actionable.find((c) => c.sb_hash === sbC.sb_hash);
  assert(!!candB && !!candC, 'candidates cover SB B and SB C', actionable);

  // force one UPI failure to exercise the retry path on B's payout leg
  await http('POST', '/mock/upi/debug-fail-next', { count: 1 });
  const approveB = await http('POST', `/v1/ops/queue/${bundleItem.id}/approve`, { sbHash: sbB.sb_hash }, opsToken);
  assert(approveB.status === 200 && approveB.body.chainTx, 'ops approve SB B', approveB.body);

  const approveC = await http('POST', `/v1/ops/queue/${bundleItem.id}/approve`, { sbHash: sbC.sb_hash }, opsToken);
  assert(approveC.status === 200 && approveC.body.chainTx, 'ops approve SB C', approveC.body);

  const realisedB = await pollUntil(
    () => http('GET', `/v1/shipping-bills/${sbB.sb_hash}`, undefined, exporterToken),
    (r) => r.body.state === 'REALISED',
    40000
  );
  const realisedC = await pollUntil(
    () => http('GET', `/v1/shipping-bills/${sbC.sb_hash}`, undefined, exporterToken),
    (r) => r.body.state === 'REALISED',
    40000
  );
  assert(realisedB.body.state === 'REALISED', 'SB 6674322 (B) reached REALISED via bundle approval', realisedB.body.state);
  assert(realisedC.body.state === 'REALISED', 'SB 6674323 (C) reached REALISED via bundle approval', realisedC.body.state);

  // --- retry path: B's EXPORTER_BALANCE payout confirmed exactly once, after a forced failure ---
  const bPayoutRow = await pollUntil(
    () => http('GET', `/v1/shipping-bills/${sbB.sb_hash}`, undefined, exporterToken),
    (r) => r.body.payouts?.some((p: { leg: string; status: string }) => p.leg === 'EXPORTER_BALANCE' && p.status === 'CONFIRMED'),
    20000
  );
  const ebPayouts = bPayoutRow.body.payouts.filter((p: { leg: string }) => p.leg === 'EXPORTER_BALANCE');
  assert(ebPayouts.length === 1 && ebPayouts[0].status === 'CONFIRMED', 'exactly one CONFIRMED EXPORTER_BALANCE payout for B', ebPayouts);
  assert(ebPayouts[0].attempts >= 2, 'retry path exercised (attempts >= 2 after forced ?fail=1)', ebPayouts[0]);

  // --- fraud preset -> UNMATCHED + alert ---
  if (sbE.sb_hash) {
    const swiftFraud = await http('POST', `/mock/swift/generate?preset=fraud&sbHash=${sbE.sb_hash}`);
    assert(swiftFraud.status === 200 && swiftFraud.body.irmHash, 'swift fraud preset ingested', swiftFraud.body);
    const remitState = await pollUntil(
      () => http('GET', `/v1/ops/remittances/${swiftFraud.body.irmHash}`, undefined, opsToken),
      (r) => r.body.state === 'UNMATCHED',
      20000
    );
    assert(remitState.body.state === 'UNMATCHED', 'fraud preset -> remittance UNMATCHED', remitState.body.state);
  } else {
    fail('SB 7788002 (E) present for fraud test');
  }

  console.log('');
  console.log(failed === 0 ? `[e2e] ALL PASS` : `[e2e] ${failed} FAILURE(S)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] uncaught error:', err);
  process.exit(1);
});
