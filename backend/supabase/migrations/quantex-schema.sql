-- ============================================================================
-- QUANTEX — POSTGRES SCHEMA (Supabase)
-- ============================================================================
-- Design decisions this schema encodes (see quantex-schema-design-decisions.md
-- for the full reasoning behind each one):
--   • UUID PKs on user-facing/security tables, BIGINT identity on high-volume
--     append-only tables (bot_fills, ledger_entries).
--   • NUMERIC(20,8) for all monetary/token amounts.
--   • Row Level Security enabled on every table; the FastAPI backend connects
--     with the Supabase service_role key, which bypasses RLS entirely — RLS
--     here exists as a defense-in-depth backstop against a backend bug or a
--     misused anon/authenticated key, not as the backend's only gate.
--   • Fixed-value fields (statuses, networks, strategy types) are lookup
--     tables with FKs, not native ENUMs — chosen for flexibility (can attach
--     metadata like is_terminal or sort_order) at the cost of a JOIN.
--     Exception: bot_fills.side (BUY/SELL) uses a plain CHECK constraint —
--     see the note directly above that table for why this one case deviates.
--   • Bot strategy parameters live in one JSONB config column, not per-
--     strategy normalized columns.
--   • created_at + updated_at on every table; deleted_at (soft delete) only
--     where the app actually needs to hide-not-erase (users, bots).
--   • Balances are materialized via an AFTER INSERT trigger on ledger_entries,
--     using an atomic UPDATE ... SET amount = amount + delta pattern — this
--     is what makes plain READ COMMITTED safe with no explicit row locking.
--   • Single-entry ledger (one row per movement, signed amount), not double-
--     entry bookkeeping.
--   • ledger_entries and bot_fills are RANGE-partitioned by created_at
--     (monthly) from day one.
--   • Idempotency for ledger writes is enforced via small, UNPARTITIONED
--     dedup tables (ledger_tx_dedup, ledger_idempotency_dedup) rather than a
--     unique constraint directly on the partitioned ledger_entries table —
--     Postgres requires any unique constraint on a partitioned table to
--     include the partition key, which would make (network_id, tx_hash)
--     alone unenforceable. See the design-decisions doc for the full
--     explanation.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- SHARED TRIGGER FUNCTION: auto-maintain updated_at
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- LOOKUP / REFERENCE TABLES
-- ============================================================================
-- Each carries a short `code` (what the app logic checks against) plus a
-- human `name`, and room for metadata (is_terminal, sort_order) — this extra
-- flexibility is the entire point of choosing lookup tables over ENUMs.

create table networks (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'TRC20' | 'BASE' | 'POLYGON'
  name          text not null,
  is_active     boolean not null default true,
  sort_order    smallint not null default 0
);

create table assets (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'USDT' | 'USDC' | 'BTC' | 'ETH' | 'SOL'
  name          text not null,
  decimals      smallint not null,           -- for display formatting only; storage is always NUMERIC(20,8)
  is_active     boolean not null default true
);

create table bot_strategy_types (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'GRID' | 'DCA' | 'MOMENTUM' | 'CUSTOM'
  name          text not null,
  is_active     boolean not null default true
);

create table bot_statuses (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'SESSION_CAPPED' | 'ERROR'
  name          text not null,
  is_terminal   boolean not null default false  -- STOPPED is terminal; ACTIVE/PAUSED/SESSION_CAPPED are not
);

create table withdrawal_statuses (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'PENDING' | 'APPROVED' | 'BROADCAST' | 'COMPLETED' | 'FAILED' | 'REJECTED'
  name          text not null,
  is_terminal   boolean not null default false  -- COMPLETED/FAILED/REJECTED are terminal
);

create table kyc_statuses (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'UNSUBMITTED' | 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
  name          text not null,
  is_terminal   boolean not null default false
);

create table ledger_entry_types (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'DEPOSIT' | 'WITHDRAWAL' | 'BOT_ALLOCATION' | 'BOT_DEALLOCATION'
                                              -- | 'FEE_BOT_CREATION' | 'FEE_SESSION_UNLOCK' | 'FEE_WITHDRAWAL'
                                              -- | 'BONUS' | 'REFERRAL_CREDIT'
  name          text not null,
  is_debit      boolean not null             -- true if this type normally reduces balance (informational only;
                                              -- the actual sign lives on ledger_entries.amount itself)
);

create table referral_credit_statuses (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'PENDING' | 'CREDITED' | 'REJECTED'
  name          text not null
);

-- ============================================================================
-- ADMINS (operationally separate from regular platform users)
-- ============================================================================
-- Admins are not rows in `users` / not part of the Supabase Auth user pool
-- used by the public app — this is deliberate: admin access is a small,
-- manually-provisioned set of accounts, not something that should ever be
-- reachable through the regular signup/OAuth flow. v1 is a single superadmin
-- per the architecture doc; this table exists as-is so role-based admin
-- access can be added later (an admin_roles table + FK) without a schema
-- rewrite.

create table admins (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_admins_updated_at
  before update on admins
  for each row execute function set_updated_at();

-- ============================================================================
-- USERS
-- ============================================================================
-- This table extends Supabase's own auth.users (id is a matching FK) — it
-- does NOT store passwords or OAuth tokens itself. Supabase Auth already
-- handles that in the auth schema; this is the public-facing profile row.

create table users (
  id                          uuid primary key references auth.users(id) on delete cascade,
  email                       text not null unique,
  referral_code               text not null unique,
  referred_by                 uuid references users(id),
  kyc_status_id               smallint not null references kyc_statuses(id),
  current_kyc_submission_id   uuid,  -- FK added after kyc_submissions exists, see below
  is_suspended                boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);

create index idx_users_referred_by on users(referred_by) where referred_by is not null;

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============================================================================
-- WALLETS (HD-derived deposit addresses, one per user per network)
-- ============================================================================

create sequence wallet_derivation_index_seq;

create table wallets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  network_id        smallint not null references networks(id),
  deposit_address   text not null,
  derivation_index  bigint not null default nextval('wallet_derivation_index_seq'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (user_id, network_id),           -- one address per user per network
  unique (network_id, deposit_address),   -- no address collisions within a network
  unique (network_id, derivation_index)   -- derivation indices never reused within a network
);

create index idx_wallets_user on wallets(user_id);

create trigger trg_wallets_updated_at
  before update on wallets
  for each row execute function set_updated_at();

-- ============================================================================
-- BALANCES (materialized, trigger-maintained — see ledger_entries below)
-- ============================================================================

create table balances (
  user_id        uuid not null references users(id) on delete cascade,
  asset_id       smallint not null references assets(id),
  amount         numeric(20,8) not null default 0,
  locked_amount  numeric(20,8) not null default 0,  -- portion allocated to active bots
  updated_at     timestamptz not null default now(),

  primary key (user_id, asset_id),
  check (amount >= 0),
  check (locked_amount >= 0),
  check (locked_amount <= amount)
);

-- Note: no separate updated_at trigger here — the ledger-maintenance trigger
-- below sets updated_at itself as part of the same UPDATE.

-- ============================================================================
-- IDEMPOTENCY DEDUP TABLES (small, unpartitioned — see header note)
-- ============================================================================

create table ledger_tx_dedup (
  network_id  smallint not null references networks(id),
  tx_hash     text not null,
  created_at  timestamptz not null default now(),
  primary key (network_id, tx_hash)
);

create table ledger_idempotency_dedup (
  idempotency_key  text primary key,
  created_at       timestamptz not null default now()
);

-- ============================================================================
-- LEDGER_ENTRIES — the source of truth, partitioned monthly by created_at
-- ============================================================================
-- Single-entry, signed amount: positive = credit, negative = debit.
-- Every write to this table MUST go through a single DB function
-- (record_ledger_entry, defined below) which handles the dedup-table insert
-- and the balance update in one transaction — never insert into this table
-- directly from application code.

create table ledger_entries (
  id                     bigint generated always as identity,
  user_id                uuid not null references users(id),
  asset_id               smallint not null references assets(id),
  entry_type_id          smallint not null references ledger_entry_types(id),
  amount                 numeric(20,8) not null check (amount <> 0),
  network_id             smallint references networks(id),        -- null for internal-only entries (fees, bonuses)
  tx_hash                text,                                     -- null for internal-only entries
  related_bot_id         uuid,                                     -- null unless entry_type relates to a bot
  related_withdrawal_id  uuid,                                     -- null unless entry_type is WITHDRAWAL
  idempotency_key        text,                                     -- null for on-chain entries (tx_hash covers those)
  metadata               jsonb not null default '{}',
  created_at             timestamptz not null default now(),

  primary key (id, created_at)   -- partition key must be part of the PK
) partition by range (created_at);

create index idx_ledger_user_created on ledger_entries(user_id, created_at desc);
create index idx_ledger_bot on ledger_entries(related_bot_id) where related_bot_id is not null;
create index idx_ledger_withdrawal on ledger_entries(related_withdrawal_id) where related_withdrawal_id is not null;

-- Monthly partitions. Create a rolling window of these via a scheduled job
-- (pg_cron or an app-level maintenance task) well before the current month
-- runs out — see the design-decisions doc for the operational reminder.
create table ledger_entries_2026_01 partition of ledger_entries
  for values from ('2026-01-01') to ('2026-02-01');
create table ledger_entries_2026_02 partition of ledger_entries
  for values from ('2026-02-01') to ('2026-03-01');
create table ledger_entries_2026_03 partition of ledger_entries
  for values from ('2026-03-01') to ('2026-04-01');
create table ledger_entries_2026_04 partition of ledger_entries
  for values from ('2026-04-01') to ('2026-05-01');
create table ledger_entries_2026_05 partition of ledger_entries
  for values from ('2026-05-01') to ('2026-06-01');
create table ledger_entries_2026_06 partition of ledger_entries
  for values from ('2026-06-01') to ('2026-07-01');
create table ledger_entries_2026_07 partition of ledger_entries
  for values from ('2026-07-01') to ('2026-08-01');
create table ledger_entries_2026_08 partition of ledger_entries
  for values from ('2026-08-01') to ('2026-09-01');
create table ledger_entries_2026_09 partition of ledger_entries
  for values from ('2026-09-01') to ('2026-10-01');
create table ledger_entries_2026_10 partition of ledger_entries
  for values from ('2026-10-01') to ('2026-11-01');
create table ledger_entries_2026_11 partition of ledger_entries
  for values from ('2026-11-01') to ('2026-12-01');
create table ledger_entries_2026_12 partition of ledger_entries
  for values from ('2026-12-01') to ('2027-01-01');
create table ledger_entries_2027_01 partition of ledger_entries
  for values from ('2027-01-01') to ('2027-02-01');
create table ledger_entries_2027_02 partition of ledger_entries
  for values from ('2027-02-01') to ('2027-03-01');
create table ledger_entries_2027_03 partition of ledger_entries
  for values from ('2027-03-01') to ('2027-04-01');
create table ledger_entries_2027_04 partition of ledger_entries
  for values from ('2027-04-01') to ('2027-05-01');
create table ledger_entries_2027_05 partition of ledger_entries
  for values from ('2027-05-01') to ('2027-06-01');
create table ledger_entries_2027_06 partition of ledger_entries
  for values from ('2027-06-01') to ('2027-07-01');
create table ledger_entries_2027_07 partition of ledger_entries
  for values from ('2027-07-01') to ('2027-08-01');
create table ledger_entries_2027_08 partition of ledger_entries
  for values from ('2027-08-01') to ('2027-09-01');
create table ledger_entries_2027_09 partition of ledger_entries
  for values from ('2027-09-01') to ('2027-10-01');
create table ledger_entries_2027_10 partition of ledger_entries
  for values from ('2027-10-01') to ('2027-11-01');
create table ledger_entries_2027_11 partition of ledger_entries
  for values from ('2027-11-01') to ('2027-12-01');
create table ledger_entries_2027_12 partition of ledger_entries
  for values from ('2027-12-01') to ('2028-01-01');
create table ledger_entries_2028_01 partition of ledger_entries
  for values from ('2028-01-01') to ('2028-02-01');
create table ledger_entries_2028_02 partition of ledger_entries
  for values from ('2028-02-01') to ('2028-03-01');
create table ledger_entries_2028_03 partition of ledger_entries
  for values from ('2028-03-01') to ('2028-04-01');
-- DEFAULT partition — a required safety net. Without this, an insert whose
-- created_at falls outside every declared range simply errors out. Rows
-- landing here are a signal the monthly-partition job has fallen behind.
create table ledger_entries_default partition of ledger_entries default;

-- ----------------------------------------------------------------------------
-- Balance-maintenance trigger function.
-- Runs AFTER INSERT on ledger_entries. Uses an atomic relative UPDATE (or
-- INSERT ... ON CONFLICT DO UPDATE for a brand-new user/asset pair), which is
-- what makes this safe under plain READ COMMITTED with zero explicit locking:
-- Postgres serializes concurrent UPDATEs to the same row on its own.
-- The balances.amount >= 0 CHECK constraint means an overdraw attempt fails
-- the whole transaction automatically — it is not possible to insert a
-- ledger_entries row that would take a balance negative.
-- ----------------------------------------------------------------------------
create or replace function maintain_balance()
returns trigger as $$
begin
  insert into balances (user_id, asset_id, amount, updated_at)
  values (new.user_id, new.asset_id, new.amount, now())
  on conflict (user_id, asset_id)
  do update set
    amount = balances.amount + new.amount,
    updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_ledger_maintain_balance
  after insert on ledger_entries
  for each row execute function maintain_balance();

-- ----------------------------------------------------------------------------
-- record_ledger_entry() — the ONLY sanctioned way to write to ledger_entries.
-- Wraps the dedup check + the actual insert in one function so application
-- code (or Celery workers) can never accidentally skip the dedup step.
-- Returns the new ledger_entries.id, or NULL if this was a duplicate write
-- that got safely ignored.
-- ----------------------------------------------------------------------------
create or replace function record_ledger_entry(
  p_user_id uuid,
  p_asset_id smallint,
  p_entry_type_id smallint,
  p_amount numeric,
  p_network_id smallint default null,
  p_tx_hash text default null,
  p_related_bot_id uuid default null,
  p_related_withdrawal_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'
) returns bigint as $$
declare
  v_id bigint;
begin
  -- On-chain dedup
  if p_tx_hash is not null and p_network_id is not null then
    begin
      insert into ledger_tx_dedup (network_id, tx_hash) values (p_network_id, p_tx_hash);
    exception when unique_violation then
      return null;  -- already processed, safely no-op
    end;
  end if;

  -- Internal-only dedup
  if p_idempotency_key is not null then
    begin
      insert into ledger_idempotency_dedup (idempotency_key) values (p_idempotency_key);
    exception when unique_violation then
      return null;
    end;
  end if;

  insert into ledger_entries (
    user_id, asset_id, entry_type_id, amount,
    network_id, tx_hash, related_bot_id, related_withdrawal_id,
    idempotency_key, metadata
  ) values (
    p_user_id, p_asset_id, p_entry_type_id, p_amount,
    p_network_id, p_tx_hash, p_related_bot_id, p_related_withdrawal_id,
    p_idempotency_key, p_metadata
  ) returning id into v_id;

  return v_id;
end;
$$ language plpgsql;

-- ============================================================================
-- BOTS
-- ============================================================================

create table bots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  strategy_type_id    smallint not null references bot_strategy_types(id),
  status_id           smallint not null references bot_statuses(id),
  pair                text not null,                       -- e.g. 'BTC/USDT'
  allocation_asset_id smallint not null references assets(id),
  allocation_amount   numeric(20,8) not null check (allocation_amount >= 50),
    -- Product rule confirmed directly: bots require a minimum $50 allocation
    -- (roughly the practical floor for a Grid bot's individual orders to
    -- clear Binance's own ~$5-10 minimum order size across 8-10 levels).
    -- CAVEAT: this check assumes allocation_asset_id is always a stablecoin
    -- (USDT/USDC) where 1 unit ≈ $1 USD. If Quantex ever allows allocating
    -- directly in a volatile asset (BTC/ETH/SOL), a raw amount >= 50 check
    -- stops being meaningful — a CHECK constraint has no access to live
    -- price data, so that scenario would need to move this validation into
    -- the application layer (FastAPI, at bot-creation time) instead.
  interval_seconds    integer not null check (interval_seconds > 0),
  config              jsonb not null default '{}',          -- strategy-specific params (grid levels, DCA interval, etc.)
  profit_reinvest     boolean not null default false,
  profit_target_pct   numeric(6,3),
  stop_loss_pct       numeric(6,3),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz

  -- NOTE: sessions_used_today deliberately does NOT live here. Per the
  -- architecture doc, session counting is a Redis key
  -- (sessions:{bot_id}:{date}) maintained by the Celery worker for speed —
  -- keeping it out of Postgres avoids two systems disagreeing about the
  -- same counter. If you need historical session-count reporting later,
  -- derive it from bot_fills counts per day rather than trusting a stored
  -- counter that could drift from Redis.
);

create index idx_bots_user on bots(user_id) where deleted_at is null;
create index idx_bots_status on bots(status_id) where deleted_at is null;

create trigger trg_bots_updated_at
  before update on bots
  for each row execute function set_updated_at();

-- ============================================================================
-- BOT_FILLS — partitioned monthly by created_at
-- ============================================================================
-- side uses a plain CHECK instead of a lookup table — the one deliberate
-- exception to the lookup-table convention. BUY/SELL is a universal,
-- permanent binary distinction with no metadata need (no is_terminal,
-- no sort_order, nothing to ever attach to it) — a lookup table here would
-- add a JOIN to the highest-volume table in the schema for zero benefit.

create table bot_fills (
  id                bigint generated always as identity,
  bot_id            uuid not null,
  side              text not null check (side in ('BUY','SELL')),
  price             numeric(20,8) not null check (price > 0),
  quantity          numeric(20,8) not null check (quantity > 0),
  quote_amount      numeric(20,8) not null check (quote_amount > 0),
  binance_order_id  text,
  reasoning_text    text not null,
  created_at        timestamptz not null default now(),

  primary key (id, created_at)
) partition by range (created_at);

create index idx_bot_fills_bot_created on bot_fills(bot_id, created_at desc);

create table bot_fills_2026_01 partition of bot_fills
  for values from ('2026-01-01') to ('2026-02-01');
create table bot_fills_2026_02 partition of bot_fills
  for values from ('2026-02-01') to ('2026-03-01');
create table bot_fills_2026_03 partition of bot_fills
  for values from ('2026-03-01') to ('2026-04-01');
create table bot_fills_2026_04 partition of bot_fills
  for values from ('2026-04-01') to ('2026-05-01');
create table bot_fills_2026_05 partition of bot_fills
  for values from ('2026-05-01') to ('2026-06-01');
create table bot_fills_2026_06 partition of bot_fills
  for values from ('2026-06-01') to ('2026-07-01');
create table bot_fills_2026_07 partition of bot_fills
  for values from ('2026-07-01') to ('2026-08-01');
create table bot_fills_2026_08 partition of bot_fills
  for values from ('2026-08-01') to ('2026-09-01');
create table bot_fills_2026_09 partition of bot_fills
  for values from ('2026-09-01') to ('2026-10-01');
create table bot_fills_2026_10 partition of bot_fills
  for values from ('2026-10-01') to ('2026-11-01');
create table bot_fills_2026_11 partition of bot_fills
  for values from ('2026-11-01') to ('2026-12-01');
create table bot_fills_2026_12 partition of bot_fills
  for values from ('2026-12-01') to ('2027-01-01');
create table bot_fills_2027_01 partition of bot_fills
  for values from ('2027-01-01') to ('2027-02-01');
create table bot_fills_2027_02 partition of bot_fills
  for values from ('2027-02-01') to ('2027-03-01');
create table bot_fills_2027_03 partition of bot_fills
  for values from ('2027-03-01') to ('2027-04-01');
create table bot_fills_2027_04 partition of bot_fills
  for values from ('2027-04-01') to ('2027-05-01');
create table bot_fills_2027_05 partition of bot_fills
  for values from ('2027-05-01') to ('2027-06-01');
create table bot_fills_2027_06 partition of bot_fills
  for values from ('2027-06-01') to ('2027-07-01');
create table bot_fills_2027_07 partition of bot_fills
  for values from ('2027-07-01') to ('2027-08-01');
create table bot_fills_2027_08 partition of bot_fills
  for values from ('2027-08-01') to ('2027-09-01');
create table bot_fills_2027_09 partition of bot_fills
  for values from ('2027-09-01') to ('2027-10-01');
create table bot_fills_2027_10 partition of bot_fills
  for values from ('2027-10-01') to ('2027-11-01');
create table bot_fills_2027_11 partition of bot_fills
  for values from ('2027-11-01') to ('2027-12-01');
create table bot_fills_2027_12 partition of bot_fills
  for values from ('2027-12-01') to ('2028-01-01');
create table bot_fills_2028_01 partition of bot_fills
  for values from ('2028-01-01') to ('2028-02-01');
create table bot_fills_2028_02 partition of bot_fills
  for values from ('2028-02-01') to ('2028-03-01');
create table bot_fills_2028_03 partition of bot_fills
  for values from ('2028-03-01') to ('2028-04-01');
create table bot_fills_default partition of bot_fills default;

-- ============================================================================
-- WITHDRAWALS
-- ============================================================================

create table withdrawals (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id),
  status_id             smallint not null references withdrawal_statuses(id),
  asset_id              smallint not null references assets(id),
  network_id            smallint not null references networks(id),
  amount                numeric(20,8) not null check (amount > 0),
  fee_amount            numeric(20,8) not null default 0 check (fee_amount >= 0),
  destination_address   text not null,
  tx_hash               text,
  admin_approved_by     uuid references admins(id),
  admin_approved_at     timestamptz,
  rejection_reason      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_withdrawals_user on withdrawals(user_id);
create index idx_withdrawals_status on withdrawals(status_id);

create trigger trg_withdrawals_updated_at
  before update on withdrawals
  for each row execute function set_updated_at();

-- ============================================================================
-- KYC_SUBMISSIONS
-- ============================================================================
-- A user can have multiple submissions over time (rejected → resubmit).
-- users.current_kyc_submission_id points at whichever one is "live" so the
-- app doesn't need an ORDER BY submitted_at DESC LIMIT 1 on every check.

create table kyc_submissions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id),
  status_id         smallint not null references kyc_statuses(id),
  id_front_url      text not null,
  id_back_url       text not null,
  selfie_url        text not null,
  submitted_at      timestamptz not null default now(),
  reviewed_by       uuid references admins(id),
  reviewed_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_kyc_user on kyc_submissions(user_id);
create index idx_kyc_status on kyc_submissions(status_id);

create trigger trg_kyc_updated_at
  before update on kyc_submissions
  for each row execute function set_updated_at();

alter table users
  add constraint fk_users_current_kyc_submission
  foreign key (current_kyc_submission_id) references kyc_submissions(id);

-- ============================================================================
-- SESSION_UNLOCKS ($20 flat unlock, per bot per day)
-- ============================================================================

create table session_unlocks (
  id           uuid primary key default gen_random_uuid(),
  bot_id       uuid not null references bots(id),
  user_id      uuid not null references users(id),
  fee_charged  numeric(20,8) not null,
  unlocked_at  timestamptz not null default now(),
  valid_until  timestamptz not null    -- end of day UTC at time of unlock
);

create index idx_session_unlocks_bot_day on session_unlocks(bot_id, unlocked_at);

-- ============================================================================
-- REFERRAL_CREDITS
-- ============================================================================

create table referral_credits (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null references users(id),
  referred_id   uuid not null references users(id) unique,  -- one credit per referred user, ever
  amount        numeric(20,8) not null,
  asset_id      smallint not null references assets(id),
  status_id     smallint not null references referral_credit_statuses(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_referral_referrer on referral_credits(referrer_id);

create trigger trg_referral_updated_at
  before update on referral_credits
  for each row execute function set_updated_at();

-- ============================================================================
-- ADMIN_AUDIT_LOG — single polymorphic table
-- ============================================================================
-- target_id is TEXT rather than UUID because target tables mix PK types
-- (UUID for withdrawals/kyc_submissions, BIGINT for ledger_entries/bot_fills
-- if ever audited directly) — this table is inherently a reporting/read
-- surface, not something transactionally joined, so the loosened typing is
-- a deliberate, contained tradeoff rather than an oversight.

create table admin_audit_log (
  id           bigint primary key generated always as identity,
  admin_id     uuid not null references admins(id),
  action       text not null,        -- e.g. 'KYC_APPROVED', 'WITHDRAWAL_REJECTED', 'USER_SUSPENDED'
  target_type  text not null,        -- e.g. 'kyc_submissions', 'withdrawals', 'users'
  target_id    text not null,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index idx_audit_admin on admin_audit_log(admin_id);
create index idx_audit_target on admin_audit_log(target_type, target_id);
create index idx_audit_created on admin_audit_log(created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- The FastAPI backend connects using the Supabase service_role key, which
-- bypasses RLS entirely — these policies are NOT the backend's authorization
-- mechanism (that's handled in FastAPI). They exist as a defense-in-depth
-- backstop: if a bug ever exposes the anon/authenticated key to the browser
-- in a way that lets it query Postgres directly (e.g. via Supabase client-
-- side realtime subscriptions for live fill streaming), a user still
-- physically cannot see another user's rows.

alter table users enable row level security;
alter table wallets enable row level security;
alter table balances enable row level security;
alter table ledger_entries enable row level security;
alter table bots enable row level security;
alter table bot_fills enable row level security;
alter table withdrawals enable row level security;
alter table kyc_submissions enable row level security;
alter table session_unlocks enable row level security;
alter table referral_credits enable row level security;

create policy users_select_own on users
  for select using (id = auth.uid());

create policy wallets_select_own on wallets
  for select using (user_id = auth.uid());

create policy balances_select_own on balances
  for select using (user_id = auth.uid());

create policy ledger_select_own on ledger_entries
  for select using (user_id = auth.uid());

create policy bots_select_own on bots
  for select using (user_id = auth.uid());

-- bot_fills has no user_id column directly — the policy joins through bots.
create policy bot_fills_select_own on bot_fills
  for select using (
    bot_id in (select id from bots where user_id = auth.uid())
  );

create policy withdrawals_select_own on withdrawals
  for select using (user_id = auth.uid());

create policy kyc_select_own on kyc_submissions
  for select using (user_id = auth.uid());

create policy session_unlocks_select_own on session_unlocks
  for select using (user_id = auth.uid());

create policy referral_credits_select_own on referral_credits
  for select using (referrer_id = auth.uid() or referred_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies are defined for the authenticated role on
-- any of these tables — by default that means those operations are denied
-- for anyone connecting as a regular user. All writes happen through the
-- backend's service_role connection, which ignores RLS regardless.

-- ============================================================================
-- SEED DATA — lookup table values
-- ============================================================================

insert into networks (code, name, sort_order) values
  ('TRC20', 'Tron (TRC-20)', 1),
  ('BASE', 'Base', 2),
  ('POLYGON', 'Polygon', 3);

insert into assets (code, name, decimals) values
  ('USDT', 'Tether USD', 6),
  ('USDC', 'USD Coin', 6),
  ('BTC', 'Bitcoin', 8),
  ('ETH', 'Ethereum', 18),
  ('SOL', 'Solana', 9);

insert into bot_strategy_types (code, name) values
  ('GRID', 'Grid Trading'),
  ('DCA', 'Dollar-Cost Averaging'),
  ('MOMENTUM', 'Momentum'),
  ('CUSTOM', 'Custom (API)');

insert into bot_statuses (code, name, is_terminal) values
  ('ACTIVE', 'Active', false),
  ('PAUSED', 'Paused', false),
  ('SESSION_CAPPED', 'Session Capped', false),
  ('STOPPED', 'Stopped', true),
  ('ERROR', 'Error', false);

insert into withdrawal_statuses (code, name, is_terminal) values
  ('PENDING', 'Pending Admin Approval', false),
  ('APPROVED', 'Approved', false),
  ('BROADCAST', 'Broadcast to Network', false),
  ('COMPLETED', 'Completed', true),
  ('FAILED', 'Failed', true),
  ('REJECTED', 'Rejected', true);

insert into kyc_statuses (code, name, is_terminal) values
  ('UNSUBMITTED', 'Not Submitted', false),
  ('PENDING', 'Pending Submission', false),
  ('UNDER_REVIEW', 'Under Review', false),
  ('APPROVED', 'Approved', true),
  ('REJECTED', 'Rejected', false);  -- not terminal: user can resubmit

insert into ledger_entry_types (code, name, is_debit) values
  ('DEPOSIT', 'Deposit', false),
  ('WITHDRAWAL', 'Withdrawal', true),
  ('BOT_ALLOCATION', 'Bot Allocation', true),
  ('BOT_DEALLOCATION', 'Bot Deallocation', false),
  ('FEE_BOT_CREATION', 'Bot Creation Fee', true),
  ('FEE_SESSION_UNLOCK', 'Session Unlock Fee', true),
  ('FEE_WITHDRAWAL', 'Withdrawal Fee', true),
  ('BONUS', 'Bonus', false),
  ('REFERRAL_CREDIT', 'Referral Credit', false);

insert into referral_credit_statuses (code, name) values
  ('PENDING', 'Pending'),
  ('CREDITED', 'Credited'),
  ('REJECTED', 'Rejected');
