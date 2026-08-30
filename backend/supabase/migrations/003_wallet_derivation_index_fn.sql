-- ============================================================================
-- next_wallet_derivation_index() — atomic sequence read for HD wallet derivation
-- ============================================================================
-- wallets.derivation_index is what the backend's HD derivation math needs
-- *before* it can compute a deposit address, but the column's own DEFAULT
-- (nextval on wallet_derivation_index_seq) only fires at INSERT time — by
-- then the address would already need to exist. This function lets the
-- backend pull the next index first (one atomic, race-safe nextval call),
-- derive the address from it, then insert the row with that exact value.
-- No application code should call nextval('wallet_derivation_index_seq')
-- directly — this function is the one sanctioned way, same principle as
-- record_ledger_entry() being the only sanctioned ledger write path.
-- ============================================================================

create or replace function next_wallet_derivation_index()
returns bigint as $$
begin
  return nextval('wallet_derivation_index_seq');
end;
$$ language plpgsql;
