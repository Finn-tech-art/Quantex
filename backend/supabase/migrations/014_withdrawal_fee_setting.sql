-- ============================================================================
-- Admin-configurable withdrawal fee
-- ============================================================================
-- Single-row ("singleton") settings table replacing withdrawal_service.py's
-- old hardcoded WITHDRAWAL_FLAT_FEE constant. id is pinned to 1 by the check
-- constraint — there is deliberately never more than one row, since there's
-- only ever one "current" fee, not one per date the way daily_win_rate_settings
-- has one row per day. An admin changes it with PUT /admin/withdrawal-fee,
-- which upserts this same row (see withdrawal_fee_service.set_fee).
--
-- No row is seeded here on purpose — same "no row yet = fall back to a
-- hardcoded default" convention daily_win_rate_settings already established
-- (see win_rate_service.DEFAULT_WIN_RATE). withdrawal_fee_service.py's own
-- DEFAULT_WITHDRAWAL_FEE constant (= 2, the same value WITHDRAWAL_FLAT_FEE
-- used to be) is what every withdrawal charges until an admin visits the
-- panel and sets one explicitly, so this migration changes nothing about
-- live behavior the moment it runs.
--
-- fee_amount is applied at withdrawal REQUEST time (see
-- withdrawal_service.create_request) and then frozen into that withdrawal's
-- own fee_amount column forever — so changing this setting only ever affects
-- withdrawals requested after the change, never ones already in flight or
-- already completed. That's "future withdrawals" in the product sense
-- without needing any extra effective-dating logic here.
-- ============================================================================

create table withdrawal_fee_settings (
  id               smallint primary key default 1 check (id = 1),
  fee_amount       numeric(20,8) not null check (fee_amount >= 0),
  set_by_admin_id  uuid not null references admins(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_withdrawal_fee_settings_updated_at
  before update on withdrawal_fee_settings
  for each row execute function set_updated_at();

alter table withdrawal_fee_settings enable row level security;
-- Same reasoning as daily_win_rate_settings/consolidation_addresses — only
-- the backend's service_role client ever reads or writes this table, so
-- zero policies means zero access for anon/authenticated.
