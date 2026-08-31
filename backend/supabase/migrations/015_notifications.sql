-- ============================================================================
-- Module — Notification bell (in-app notifications)
-- ============================================================================
-- Backs the bell icon in the app's top corner (frontend/src/components/
-- NotificationBell.jsx). Every row here is a single message shown to ONE
-- user — there is no "broadcast to everyone" concept in this table; an
-- announcement-to-all-users feature, if ever built, would be a different
-- table, not a NULL user_id on this one.
--
-- Same status/type-lookup-table convention already used everywhere else in
-- this schema (see kyc_statuses, withdrawal_statuses, bot_statuses,
-- sweep_statuses, ledger_entry_types, ...): a small table of allowed codes
-- referenced by a smallint foreign key, rather than a bare text column with
-- a CHECK constraint. This is what lets the four services below (kyc,
-- withdrawal, deposit, bot) each write a plain human-readable notification
-- row without any of them needing to agree on shared string constants, and
-- lets a future admin dashboard group/report on notification volume by
-- type via a normal join, exactly like every other categorical column here.
--
-- To add a brand-new notification type later (e.g. "REFERRAL_CREDITED"):
-- add one row to the notification_types seed data below via a new
-- migration, then call notification_service.create_notification(user_id,
-- "REFERRAL_CREDITED", title, body) from wherever that event happens — see
-- notification_service.py's module comment for the full list of call sites
-- this first version wires up.
-- ============================================================================

create table notification_types (
  id    smallint primary key generated always as identity,
  code  text not null unique,   -- e.g. 'KYC_APPROVED' — matches notification_service.py's TYPE_* constants exactly
  name  text not null           -- human label, e.g. 'KYC approved' — not read by the API today, kept for an
                                 -- eventual admin "notification volume by type" report, same as every other
                                 -- lookup table's unused-for-now `name` column in this schema
);

insert into notification_types (code, name) values
  ('KYC_APPROVED',          'KYC approved'),
  ('KYC_REJECTED',          'KYC rejected'),
  ('WITHDRAWAL_APPROVED',   'Withdrawal approved'),
  ('WITHDRAWAL_REJECTED',   'Withdrawal rejected'),
  ('DEPOSIT_CONFIRMED',     'Deposit confirmed'),
  ('BOT_STARTED',           'Bot started'),
  ('BOT_STOPPED',           'Bot stopped');

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  type_id     smallint not null references notification_types(id),
  -- title/body are plain, already-formatted text written once at insert
  -- time (e.g. "Your withdrawal of 98 USDT was approved") — NOT a template
  -- + params pair re-rendered on every read. This keeps the read path a
  -- single flat SELECT with no i18n/formatting logic on the backend, at
  -- the cost of a notification's wording being frozen to whatever it said
  -- the moment it was created (acceptable: nothing here is ever edited
  -- after the fact, same as an email that already went out).
  title       text not null,
  body        text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Powers both queries the bell ever runs: "my unread count" and "my recent
-- notifications, newest first" — see notification_service.py's
-- list_for_user()/unread_count(). Composite on (user_id, is_read) covers
-- the unread-count filter; created_at desc as the third column lets the
-- list query satisfy its ORDER BY straight from this index too, with no
-- separate sort step.
create index idx_notifications_user_unread on notifications(user_id, is_read, created_at desc);

alter table notification_types enable row level security;
alter table notifications enable row level security;
-- Same reasoning as every other backend-only table in this schema (see
-- e.g. 011_sweeps.sql's closing comment) — only the service_role client
-- (notification_service.py, via get_supabase()) ever touches these tables;
-- the frontend never queries Supabase directly for notifications, always
-- through the /notifications API, so zero RLS policies is correct here.
