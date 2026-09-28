export interface Org {
  id: string;
  kind: string;
  name: string;
  iec: string | null;
}

export interface ShippingBillSummary {
  sb_hash: string;
  sb_no: string;
  iec: string;
  exporter_id: string;
  fob_minor: number;
  ccy: string;
  fob_inr_minor: number;
  leo_ts: string;
  buyer_name: string;
  buyer_country: string;
  state: string;
  chain_tx: string;
  financeableInrMinor: number;
  offersCount: number;
}

export interface Offer {
  id: string;
  sb_hash: string;
  financier_id: string;
  advance_pct: number;
  rate_bps: number;
  valid_until: string;
  status: string;
  created_at: string;
}

export interface Payout {
  id: string;
  sb_hash: string;
  leg: string;
  to_org: string;
  amount_minor: number;
  status: string;
  utr: string | null;
  attempts: number;
  chain_tx: string | null;
  created_at: string;
}

export interface Realisation {
  sb_hash: string;
  irm_hash: string;
  realised_minor: number;
  matched_by: string;
  confidence: number | null;
  ebrc_vc_hash: string | null;
  financier_due: number | null;
  platform_fee: number | null;
  exporter_balance: number | null;
  shortfall: number | null;
  chain_tx: string;
  realised_ts: string;
  ebrc_ts: string | null;
}

export interface ChainEvent {
  block_no: number;
  tx_hash: string;
  name: string;
  args: string;
  ts: string;
}

export interface SbTimeline {
  sbHash: string;
  sbNo: string;
  iec: string;
  state: string;
  fobMinor: number;
  ccy: string;
  fobInrMinor: number;
  buyerName: string;
  buyerCountry: string;
  invoiceNos: string[];
  chainTx: string;
  offers: Offer[];
  financing: Record<string, unknown> | null;
  realisations: Realisation[];
  payouts: Payout[];
  ebrc: Record<string, unknown> | null;
  events: ChainEvent[];
}

export interface MarketReceivable extends ShippingBillSummary {
  risk: { buyerCountry: string; exporterRealisedCount: number };
}

export interface BookRow {
  sb_hash: string;
  offer_id: string;
  financier_id: string;
  advance_minor: number;
  rate_bps: number;
  locked_ts: string;
  chain_tx: string;
  sb_no: string;
  state: string;
  fob_inr_minor: number;
}

export interface Alert {
  id: string;
  type: string;
  message: string;
  sb_hash: string | null;
  irm_hash: string | null;
  org_id: string | null;
  created_at: string;
}

export interface Reason {
  rule: string;
  weight: number;
  detail: string;
}

export interface MatchCandidate {
  id: string;
  irm_hash: string;
  sb_hash: string;
  confidence: number;
  reasons: string;
  proposed_minor: number;
  source: string;
  status: string;
}

export interface OpsQueueItem {
  id: string;
  irm_hash: string;
  status: string;
  remittance: Record<string, unknown> | null;
  candidates: MatchCandidate[];
}

export interface OpsQueueDetail extends OpsQueueItem {
  rawMt103: string | null;
  parsed: Record<string, unknown> | null;
}

export interface OpsConfig {
  auto: number;
  review: number;
  tolerancePct: number;
}

export interface ExplorerSb {
  sb_hash: string;
  state: string;
  ccy: string;
  fob_minor: number;
  fob_inr_minor: number;
  chain_tx: string;
  created_at: string;
  realisations: Realisation[];
}

export interface EbrcVerifyResult {
  valid: boolean;
  issuer?: string;
  anchoredTx?: string;
  signatureValid?: boolean;
  onChainValid?: boolean;
  message?: string;
}

export interface ExplorerStats {
  realisedVolumeInrMinor: number;
  medianTimeToEbrcSec: number | null;
  autoMatchRate: number | null;
  llmCallRate: number | null;
  totalMatchAttempts: number;
}

export interface DomainEventEnvelope {
  event: string;
  payload: Record<string, unknown>;
  text?: string;
  ts: string;
}
