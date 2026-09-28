import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { DATA_DIR, RAW_DIR, DB_PATH } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
create table if not exists orgs (
  id            text primary key,
  kind          text not null check (kind in ('EXPORTER','FINANCIER','AD_BANK','CUSTOMS','DGFT','HISAB_OPS')),
  name          text not null,
  chain_addr    text not null unique,
  signer_index  integer not null,
  iec           text,
  vpa           text,
  created_at    text default (datetime('now'))
);

create table if not exists shipping_bills (
  sb_hash       text primary key,
  sb_no         text not null,
  iec           text not null,
  exporter_id   text references orgs(id),
  fob_minor     integer not null,
  ccy           text not null,
  fob_inr_minor integer,
  leo_ts        text not null,
  port_code     text,
  buyer_name    text,
  buyer_country text,
  invoice_nos   text not null, -- JSON array
  hs_codes      text,          -- JSON array
  bundle_group  text,
  state         text not null default 'OPEN',
  raw_uri       text not null,
  chain_tx      text,
  created_at    text default (datetime('now')),
  unique (sb_no, iec)
);

create table if not exists offers (
  id            text primary key,
  sb_hash       text references shipping_bills(sb_hash),
  financier_id  text references orgs(id),
  advance_pct   real not null,
  rate_bps      integer not null,
  valid_until   text not null,
  status        text not null default 'OPEN',
  created_at    text default (datetime('now'))
);

create table if not exists financings (
  sb_hash       text primary key references shipping_bills(sb_hash),
  offer_id      text references offers(id),
  financier_id  text references orgs(id),
  advance_minor integer not null,
  rate_bps      integer not null,
  locked_ts     text not null,
  chain_tx      text not null
);

create table if not exists remittances (
  irm_hash      text primary key,
  bank_id       text references orgs(id),
  msg_type      text not null,
  amount_minor  integer not null,
  ccy           text not null,
  inr_minor     integer,
  credit_ts     text not null,
  sender_name   text,
  sender_country text,
  remit_info    text,
  parsed        text, -- JSON
  raw_uri       text not null,
  beneficiary_iec text,
  charges_minor integer,
  state         text not null default 'RECEIVED',
  chain_tx      text
);

create table if not exists match_candidates (
  id            text primary key,
  irm_hash      text references remittances(irm_hash),
  sb_hash       text references shipping_bills(sb_hash),
  confidence    real not null,
  reasons       text not null, -- JSON
  proposed_minor integer not null,
  source        text not null,
  status        text not null default 'PENDING', -- PENDING|APPROVED|REJECTED (for ops candidates)
  created_at    text default (datetime('now'))
);

create table if not exists realisations (
  sb_hash        text not null references shipping_bills(sb_hash),
  irm_hash       text not null references remittances(irm_hash),
  realised_minor integer not null,
  matched_by     text not null,
  confidence     real,
  ebrc_vc_hash   text,
  ebrc_uri       text,
  financier_due  integer,
  platform_fee   integer,
  exporter_balance integer,
  shortfall      integer,
  chain_tx       text not null,
  realised_ts    text default (datetime('now')),
  ebrc_ts        text,
  primary key (sb_hash, irm_hash)
);

create table if not exists payouts (
  id            text primary key,
  sb_hash       text references shipping_bills(sb_hash),
  leg           text not null,
  to_org        text references orgs(id),
  amount_minor  integer not null,
  status        text not null default 'PENDING',
  utr           text,
  provider_resp text,
  attempts      integer default 0,
  chain_tx      text,
  created_at    text default (datetime('now')),
  updated_at    text
);

create table if not exists ops_queue (
  id            text primary key,
  irm_hash      text references remittances(irm_hash),
  status        text not null default 'PENDING',
  decided_by    text references orgs(id),
  decision_tx   text,
  note          text,
  created_at    text default (datetime('now')),
  decided_at    text
);

create table if not exists chain_events (
  block_no      integer,
  tx_hash       text,
  log_index     integer,
  name          text,
  args          text,
  ts            text,
  primary key (tx_hash, log_index)
);

create table if not exists projector_cursor (
  id integer primary key check (id = 1),
  last_block integer not null
);

create table if not exists idempotency_keys (
  key           text primary key,
  method        text not null,
  path          text not null,
  status_code   integer not null,
  response      text not null,
  created_at    text default (datetime('now'))
);

create table if not exists webhooks (
  id            text primary key,
  event         text not null,
  payload       text not null,
  signature     text not null,
  delivered     integer default 0,
  response_code integer,
  created_at    text default (datetime('now'))
);

create table if not exists ops_config (
  id integer primary key check (id = 1),
  auto real not null default 0.92,
  review real not null default 0.70,
  tolerance_pct real not null default 2
);

create table if not exists alerts (
  id            text primary key,
  type          text not null,
  message       text not null,
  sb_hash       text,
  irm_hash      text,
  org_id        text references orgs(id),
  created_at    text default (datetime('now'))
);

create table if not exists match_log (
  id            text primary key,
  irm_hash      text not null,
  band          text not null,
  llm_used      integer not null,
  created_at    text default (datetime('now'))
);

create index if not exists idx_sb_iec_state on shipping_bills(iec, state);
create index if not exists idx_remit_state on remittances(state, credit_ts);
create index if not exists idx_payouts_status on payouts(status);
create index if not exists idx_match_cand_irm on match_candidates(irm_hash);
create index if not exists idx_offers_sb on offers(sb_hash);
`);

db.exec(`insert or ignore into ops_config (id, auto, review, tolerance_pct) values (1, 0.92, 0.70, 2);`);
db.exec(`insert or ignore into projector_cursor (id, last_block) values (1, -1);`);

export function nowIso(): string {
  return new Date().toISOString();
}

/** JSON helpers for TEXT columns. */
export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}
export function fromJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
