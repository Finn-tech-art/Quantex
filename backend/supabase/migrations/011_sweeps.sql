-- ============================================================================
-- Module 2 — Deposit consolidation sweeps (Tron path)
-- ============================================================================
-- Records every attempt to move a credited deposit out of its per-user
-- address and into the configured Bybit consolidation address (see
-- consolidation_addresses, migration 010). This table exists purely for
-- custody bookkeeping and reconciliation — it is never read by, and never
-- writes to, ledger_entries or balances. A sweep's status has no bearing on
-- what a user's balance shows; record_ledger_entry() already settled that
-- at deposit-detection time. See the architecture doc's "Deposit
-- consolidation" section and its "Invariant — sweeping never affects a
-- user's balance" note for why that separation is load-bearing, not
-- incidental.
--
-- Same status-lookup-table convention as withdrawal_statuses/kyc_statuses
-- above, for the same reason: PENDING/BROADCAST/CONFIRMED/FAILED, with
-- CONFIRMED/FAILED terminal.
-- ============================================================================

create table sweep_statuses (
  id            smallint primary key generated always as identity,
  code          text not null unique,        -- 'PENDING' | 'BROADCAST' | 'CONFIRMED' | 'FAILED'
  name          text not null,
  is_terminal   boolean not null default false  -- CONFIRMED/FAILED are terminal
);

insert into sweep_statuses (code, name, is_terminal) values
  ('PENDING',   'Pending',   false),
  ('BROADCAST', 'Broadcast', false),
  ('CONFIRMED', 'Confirmed', true),
  ('FAILED',    'Failed',    true);

create table sweeps (
  id                    uuid primary key default gen_random_uuid(),
  wallet_id             uuid not null references wallets(id),
  network_id            smallint not null references networks(id),
  asset_id              smallint not null references assets(id),
  status_id             smallint not null references sweep_statuses(id),
  amount                numeric(20,8) not null check (amount > 0),
  destination_address   text not null,
  -- Tron path: the delegate_resource tx that funded this sweep's Energy.
  -- EVM/EIP-3009 path (Module 3): left null — the relayer pays its own gas
  -- directly, there's no separate funding transaction to record here.
  resource_tx_hash      text,
  sweep_tx_hash         text,          -- the actual token-transfer tx
  error_message         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  confirmed_at          timestamptz
);

create index idx_sweeps_wallet on sweeps(wallet_id);
create index idx_sweeps_status on sweeps(status_id);
-- Powers the "does this wallet already have a sweep in flight" check that
-- custody_service.py runs before starting a new one — see its docstring on
-- why this has to be an on-chain-balance check too, not just this index,
-- but this is what makes that check cheap to run per sweep attempt.

create trigger trg_sweeps_updated_at
  before update on sweeps
  for each row execute function set_updated_at();

alter table sweep_statuses enable row level security;
alter table sweeps enable row level security;
-- Same reasoning as every other backend-only table in this schema — only
-- the service_role client touches these, so zero RLS policies is correct.
