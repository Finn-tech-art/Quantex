-- ============================================================================
-- Withdrawal unlock fees — an admin-managed library of named, one-time fees
-- that gate withdrawals platform-wide.
-- ============================================================================
-- Distinct from withdrawal_fee_settings (014_withdrawal_fee_setting.sql),
-- which is a single flat fee auto-DEDUCTED from every withdrawal's amount.
-- This is a completely different mechanic: while a fee type here is active,
-- EVERY user must pay it — as a real, separate on-chain payment, once ever
-- — before ANY of their withdrawals can be requested at all. See
-- withdrawal_unlock_fee_service.py's module comment for the full design
-- this schema supports, in particular why a payment never touches
-- `balances`/`ledger_entries` (it's a pure platform fee, never part of the
-- user's withdrawable money) and how a same-address payment gets told apart
-- from an ordinary deposit.
--
-- Three tables:
--   withdrawal_unlock_fee_types    — the admin-managed library itself (name,
--                                     asset, amount, active/inactive).
--   withdrawal_unlock_fee_payments — one row per (user, fee type) once paid,
--                                     ever. Deactivating a fee type later
--                                     does not un-pay anyone; reactivating it
--                                     does not re-charge anyone who already
--                                     paid while it was previously active.
--   withdrawal_unlock_fee_intents  — a short-lived "this user is about to
--                                     pay this fee, on this network" marker
--                                     that chain_watcher_service.py checks
--                                     before crediting an incoming transfer
--                                     as ordinary spendable balance.
-- ============================================================================

create table withdrawal_unlock_fee_types (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,               -- admin-chosen label, e.g. "Bot token fee"
  asset_id              smallint not null references assets(id),
  amount                numeric(20,8) not null check (amount > 0),
  is_active             boolean not null default true,
  created_by_admin_id   uuid not null references admins(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_withdrawal_unlock_fee_types_updated_at
  before update on withdrawal_unlock_fee_types
  for each row execute function set_updated_at();

create table withdrawal_unlock_fee_payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  fee_type_id  uuid not null references withdrawal_unlock_fee_types(id),
  network_id   smallint not null references networks(id),
  tx_hash      text not null,
  amount_paid  numeric(20,8) not null,
  paid_at      timestamptz not null default now(),

  -- Pay once, ever, per fee type — see the header comment above for why
  -- toggling is_active never re-triggers or clears this.
  unique (user_id, fee_type_id),
  -- Same dedup shape as the global ledger_tx_dedup table, but scoped to
  -- this table specifically: a transaction claimed here as a fee payment
  -- can never also be claimed again as one (and chain_watcher_service.py
  -- separately claims the SAME tx_hash into ledger_tx_dedup itself when
  -- this happens, so it can never ALSO be credited as ordinary balance —
  -- see that module's comment on _credit_deposit for the exact ordering).
  unique (network_id, tx_hash)
);

create index idx_withdrawal_unlock_fee_payments_user on withdrawal_unlock_fee_payments(user_id);

create table withdrawal_unlock_fee_intents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  fee_type_id  uuid not null references withdrawal_unlock_fee_types(id),
  network_id   smallint not null references networks(id),
  created_at   timestamptz not null default now(),
  -- 24h — comfortably longer than the 12h backstop-sweep window already
  -- documented elsewhere in this app for an ordinary deposit (see
  -- deposit.watchingNotice in frontend/src/i18n.js), so a genuine payment
  -- always has time to confirm even if it isn't picked up by the live
  -- watcher. An intent past this is treated as stale and ignored by
  -- withdrawal_unlock_fee_service.try_claim_as_fee_payment — re-opening the
  -- "Pay now" screen just creates a fresh one (upsert on the unique key
  -- below), it's never a dead end.
  expires_at   timestamptz not null default (now() + interval '24 hours'),

  -- One open intent per (user, fee type) at a time — re-clicking "Pay now"
  -- (e.g. after switching which network to pay on) upserts this row rather
  -- than creating a second one.
  unique (user_id, fee_type_id)
);

alter table withdrawal_unlock_fee_types enable row level security;
alter table withdrawal_unlock_fee_payments enable row level security;
alter table withdrawal_unlock_fee_intents enable row level security;
-- Same reasoning as every other backend-only table in this schema (see
-- e.g. 011_sweeps.sql's closing comment) — only the backend's service_role
-- client ever touches these three tables, so zero RLS policies is correct.
