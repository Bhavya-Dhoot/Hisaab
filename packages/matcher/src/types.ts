export interface MT103Fields {
  senderRef: string;
  valueDate: string; // YYYY-MM-DD
  ccy: string;
  amountMinor: number;
  orderingAccount: string;
  orderingName: string;
  orderingLines: string[];
  orderingCountry: string;
  beneficiaryAccount: string;
  beneficiaryName: string;
  remitInfo: string;
  charges: string;
  senderToReceiverInfo: string;
}

export interface IRMInput {
  raw: string;
  creditedInrMinor: number;
  chargesMinor?: number;
  creditTs: string;
  beneficiaryIec: string;
}

export interface Candidate {
  sbHash: string;
  sbNo: string;
  invoiceNos: string[];
  fobMinor: number;
  ccy: string;
  fobInrMinor: number;
  buyerName: string;
  buyerCountry: string;
  leoTs: string;
  state: string;
}

export interface Reason {
  rule: string;
  weight: number;
  detail: string;
}

export interface Allocation {
  sbHash: string;
  confidence: number;
  reasons: Reason[];
  allocInrMinor: number;
  source: 'RULES' | 'LLM';
}

export interface MatchResult {
  fields: MT103Fields;
  band: 'AUTO' | 'REVIEW' | 'UNMATCHED';
  allocations: Allocation[];
  topCandidates: Allocation[];
  llmUsed: boolean;
  hallucinationSuspects: string[];
  alerts: string[];
}

export interface MatchConfig {
  auto: number;
  review: number;
  tolerancePct: number;
}

export interface Deduction {
  type: 'BANK_CHARGES' | 'DISCOUNT' | 'SHORT_SHIP' | 'OTHER';
  amount: number;
  ccy: string;
}

export interface Extraction {
  invoiceRefs: string[];
  shippingBillRefs: string[];
  poRefs: string[];
  deductions: Deduction[];
  multiInvoice: boolean;
  notes: string;
}

export type Extractor = (input: {
  remitInfo: string;
  senderInfo: string;
  bankInfo: string;
}) => Promise<Extraction>;
