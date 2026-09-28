import type {
  Org,
  ShippingBillSummary,
  Offer,
  Payout,
  SbTimeline,
  MarketReceivable,
  BookRow,
  Alert,
  OpsQueueItem,
  OpsQueueDetail,
  OpsConfig,
  ExplorerSb,
  EbrcVerifyResult,
  ExplorerStats,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  chainTx?: string;
  constructor(status: number, code: string, message: string, chainTx?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.chainTx = chainTx;
  }
}

async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
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
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; chainTx?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? res.statusText, err?.chainTx);
  }
  return json as T;
}

export const api = {
  // auth
  login: (orgId: string) => req<{ token: string; org: { id: string; kind: string; name: string } }>('POST', '/v1/auth/login', { orgId }),
  getOrgs: () => req<{ orgs: Org[] }>('GET', '/v1/orgs'),

  // exporter
  getMyShippingBills: (token: string, state?: string) =>
    req<{ shippingBills: ShippingBillSummary[] }>('GET', `/v1/me/shipping-bills${state ? `?state=${state}` : ''}`, undefined, token),
  getShippingBill: (token: string, sbHash: string) => req<SbTimeline>('GET', `/v1/shipping-bills/${sbHash}`, undefined, token),
  getOffersForSb: (token: string, sbHash: string) => req<{ offers: Offer[] }>('GET', `/v1/shipping-bills/${sbHash}/offers`, undefined, token),
  acceptOffer: (token: string, offerId: string) =>
    req<{ chainTx: string; advanceInrMinor: number; payoutId: string }>('POST', `/v1/offers/${offerId}/accept`, {}, token),
  getMyPayouts: (token: string) => req<{ payouts: Payout[] }>('GET', '/v1/me/payouts', undefined, token),
  getEbrc: (token: string, sbHash: string) => req<{ vc: Record<string, unknown>; uri: string }>('GET', `/v1/shipping-bills/${sbHash}/ebrc`, undefined, token),

  // financier
  getMarketReceivables: () => req<{ receivables: MarketReceivable[] }>('GET', '/v1/market/receivables'),
  createOffer: (token: string, body: { sbHash: string; advancePct: number; rateBps: number; validUntil: string }) =>
    req<{ id: string }>('POST', '/v1/offers', body, token),
  deleteOffer: (token: string, id: string) => req<{ status: string }>('DELETE', `/v1/offers/${id}`, undefined, token),
  getMyBook: (token: string) => req<{ book: BookRow[] }>('GET', '/v1/me/book', undefined, token),
  getWaterfall: (token: string, sbHash: string) =>
    req<{ realisedInr: number; financierDue: number; platformFee: number; exporterBalance: number; shortfall: number }>(
      'GET',
      `/v1/me/book/${sbHash}/waterfall`,
      undefined,
      token
    ),
  getMyAlerts: (token: string) => req<{ alerts: Alert[] }>('GET', '/v1/me/alerts', undefined, token),

  // ops
  getOpsQueue: (token: string, status = 'PENDING') => req<{ queue: OpsQueueItem[] }>('GET', `/v1/ops/queue?status=${status}`, undefined, token),
  getOpsQueueItem: (token: string, id: string) => req<OpsQueueDetail>('GET', `/v1/ops/queue/${id}`, undefined, token),
  approveOpsQueue: (token: string, id: string, body: { sbHash: string; allocInrMinor?: number; note?: string }) =>
    req<{ chainTx: string }>('POST', `/v1/ops/queue/${id}/approve`, body, token),
  rejectOpsQueue: (token: string, id: string, reason: string) =>
    req<{ status: string }>('POST', `/v1/ops/queue/${id}/reject`, { reason }, token),
  getOpsConfig: (token: string) => req<OpsConfig>('GET', '/v1/ops/config', undefined, token),
  putOpsConfig: (token: string, body: OpsConfig) => req<{ ok: boolean }>('PUT', '/v1/ops/config', body, token),
  getOpsRemittance: (token: string, irmHash: string) => req<Record<string, unknown>>('GET', `/v1/ops/remittances/${irmHash}`, undefined, token),

  // explorer
  getExplorerSb: (token: string, sbHash: string) => req<ExplorerSb>('GET', `/v1/explorer/shipping-bills/${sbHash}`, undefined, token),
  verifyEbrc: (sbHash: string, vcHash?: string) =>
    req<EbrcVerifyResult>('GET', `/v1/explorer/ebrc/verify?sbHash=${sbHash}${vcHash ? `&vcHash=${vcHash}` : ''}`),
  getExplorerStats: () => req<ExplorerStats>('GET', '/v1/explorer/stats'),
  dgftVerify: (vcHash: string, sbHash?: string) =>
    req<EbrcVerifyResult>('GET', `/mock/dgft/ebrc/verify?vcHash=${vcHash}${sbHash ? `&sbHash=${sbHash}` : ''}`),

  // demo control
  demoReset: () => req<{ ok: boolean }>('POST', '/v1/demo/reset'),
  demoAdvanceTime: (days: number) => req<{ ok: boolean; days: number }>('POST', '/v1/demo/advance-time', { days }),
  mockIcegateGenerate: (preset: string, exporterIec?: string) =>
    req<{ sbHash: string; state: string; chainTx: string; tokenId: string }>(
      'POST',
      `/mock/icegate/generate?preset=${preset}${exporterIec ? `&exporterIec=${exporterIec}` : ''}`
    ),
  mockSwiftGenerate: (preset: string, sbHash: string) =>
    req<{ irmHash: string; state: string; matchJobId: string }>('POST', `/mock/swift/generate?preset=${preset}&sbHash=${sbHash}`),
  mockUpiDebugFailNext: (count = 1) => req<{ ok: boolean }>('POST', '/mock/upi/debug-fail-next', { count }),
  seedDemo: () =>
    req<{ orgs: Record<string, string>; shippingBills: Record<string, string> }>('POST', '/__seed'),
};
