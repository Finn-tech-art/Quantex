-- ============================================================================
-- Module 1 + 2 — Admin auth hardening + daily win-rate setting
-- ============================================================================
-- Part 1: `admins` and `admin_audit_log` were created in the base schema but
-- never actually had "alter table ... enable row level security" run on
-- them, unlike every other table (see quantex-schema.sql's own header
-- comment, which states RLS-on-every-table as a design rule). Practically,
-- that means Supabase's default anon/authenticated PostgREST grants could
-- read admins.password_hash directly over the API — RLS with zero policies
-- closes that (service_role, which the FastAPI backend always uses, bypasses
-- RLS entirely, so this doesn't break anything the backend already does).
--
-- Part 2: a new table holding the win rate an admin has set for a given
-- calendar date, read by fake_trading_service.py (via win_rate_service.py)
-- instead of the hardcoded 90% default it used before. One row per date —
-- if no row exists for a date, the application falls back to a hardcoded
-- default (see win_rate_service.DEFAULT_WIN_RATE) rather than erroring, so
-- an admin never has to pre-populate every future day.
-- ============================================================================

alter table admins enable row level security;
alter table admin_audit_log enable row level security;
-- Deliberately no policies — the backend only ever touches these two tables
-- via the service_role client (which bypasses RLS), so zero policies means
-- zero access for anon/authenticated, which is exactly what's wanted here.

create table daily_win_rate_settings (
  win_date           date primary key,
  win_rate           numeric(4,3) not null check (win_rate >= 0 and win_rate <= 1),
  target_min_return  numeric(6,3) not null check (target_min_return >= 0),
  set_by_admin_id    uuid not null references admins(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_daily_win_rate_settings_updated_at
  before update on daily_win_rate_settings
  for each row execute function set_updated_at();

alter table daily_win_rate_settings enable row level security;
-- Same reasoning as admins/admin_audit_log above — only the backend's
-- service_role client ever reads or writes this table.
