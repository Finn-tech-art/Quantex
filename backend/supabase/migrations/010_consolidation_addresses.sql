-- ============================================================================
-- Module 1 — Deposit consolidation address config
-- ============================================================================
-- One row per network, holding the Bybit deposit address that network's
-- consolidation sweep (Module 2/3, not yet built) should send swept funds
-- to. network_id is the primary key directly (not a separate id + unique
-- constraint) since this is naturally exactly one row per network, never
-- more. Admin-editable via PUT /admin/consolidation-addresses/{network}
-- rather than a Railway env var, specifically so it can change without a
-- redeploy — see the architecture doc's "Deposit consolidation" section.
-- ============================================================================

create table consolidation_addresses (
  network_id           smallint primary key references networks(id),
  destination_address  text not null,
  updated_by_admin_id  uuid not null references admins(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_consolidation_addresses_updated_at
  before update on consolidation_addresses
  for each row execute function set_updated_at();

alter table consolidation_addresses enable row level security;
-- Same reasoning as daily_win_rate_settings/admins/admin_audit_log — only
-- the backend's service_role client ever reads or writes this table, so
-- zero policies means zero access for anon/authenticated, which is exactly
-- what's wanted here.
