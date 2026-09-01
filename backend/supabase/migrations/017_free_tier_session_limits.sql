-- ============================================================================
-- Free-tier session limits — module 4 add-on
-- ============================================================================
-- Two independent rules, both keyed off the SAME lever (users.daily_session_
-- limit), per the product decision this migration implements:
--   1. A user still on the default limit (3) can only create a simulated bot
--      with session_length_minutes <= 30 — enforced app-side in
--      simulated_bot_service.create_simulated_bot, not by a CHECK here (the
--      threshold and the "what counts as free-tier" comparison both belong
--      in Python, next to fake_trading_service's own SESSION_LENGTH_FULL_
--      SCALE_MINUTES=30, not duplicated into SQL).
--   2. A user can only successfully CREATE up to daily_session_limit
--      simulated bots per UTC calendar day, counted across every bot they
--      own — enforced app-side in simulated_bot_service.create_simulated_bot,
--      backed by the counting table below. A simulated bot runs exactly one
--      session and then caps (MAX_SESSIONS=1 in that same file), so
--      configuring a new bot is how a user starts another session once their
--      last one's length has elapsed — that configuration step is what's
--      actually rate-limited, not automatic recurrence within one bot.
-- An admin raises daily_session_limit for a specific user (via the new
-- /admin/session-limits endpoints) to lift BOTH rules for them at once —
-- there's deliberately no separate flag for "exempt from the length cap
-- only" or "exempt from the daily cap only"; this single column is what
-- "privileged" means in this app.
-- ============================================================================

alter table users
  add column daily_session_limit smallint not null default 3
    check (daily_session_limit >= 0);

-- One row per (user, UTC calendar day) actually SEEN — a user who never
-- starts a session on a given day simply has no row for that day, rather
-- than every user getting a zeroed row pre-created for every date. Reading
-- "how many sessions has this user started today" is therefore "0 if no row,
-- else that row's count" (see session_limit_service.sessions_started_today).
create table user_daily_session_counts (
  user_id       uuid not null references users(id) on delete cascade,
  session_date  date not null,
  count         smallint not null default 0,

  primary key (user_id, session_date)
);

alter table user_daily_session_counts enable row level security;
-- Same reasoning as daily_win_rate_settings in 006_admin_win_rate.sql — only
-- the backend's service_role client (bypasses RLS) ever touches this table,
-- so zero policies for anon/authenticated is exactly what's wanted.

-- ----------------------------------------------------------------------------
-- increment_daily_session_count() — the ONLY sanctioned way to bump a user's
-- today count. A plain "select then update" from Python has a race window
-- (two Celery sweep ticks reading the same starting count before either
-- writes back), so this does the read-modify-write as a single atomic
-- upsert instead, same reasoning as record_ledger_entry()/
-- next_wallet_derivation_index() above needing to be single SQL statements
-- rather than multi-step application logic. Returns the count AFTER this
-- increment, so the caller never needs a separate read to find out.
-- ----------------------------------------------------------------------------
create or replace function increment_daily_session_count(
  p_user_id uuid,
  p_session_date date
) returns smallint as $$
  insert into user_daily_session_counts (user_id, session_date, count)
  values (p_user_id, p_session_date, 1)
  on conflict (user_id, session_date)
  do update set count = user_daily_session_counts.count + 1
  returning count;
$$ language sql;
