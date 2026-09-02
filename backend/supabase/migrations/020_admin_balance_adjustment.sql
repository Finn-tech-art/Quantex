-- ============================================================================
-- Admin manual balance adjustment
-- ============================================================================
-- One new ledger_entry_types row so an admin can credit (or debit) a user's
-- balance directly — most commonly to hand a hobby-project test account a
-- starting USDT balance without needing a real on-chain deposit first, per
-- the product decision behind this. Written through record_ledger_entry()
-- like every other balance-affecting entry in this app (see that
-- function's own comment: it's the ONLY sanctioned way to write to
-- ledger_entries), NOT a direct UPDATE on balances — that keeps this
-- showing up in the user's own activity history exactly like a deposit or
-- bonus would, and keeps balances.amount's trigger-maintained total
-- correct automatically rather than needing its own bespoke update logic.
--
-- A single type covers both directions — is_debit is informational only
-- (see ledger_entry_types.is_debit's own column comment; the actual sign
-- always lives on ledger_entries.amount), so admin_balance_service.py can
-- pass either a positive or a negative amount through this same type.
-- ============================================================================

insert into ledger_entry_types (code, name, is_debit) values
  ('ADMIN_ADJUSTMENT', 'Admin Balance Adjustment', false);
