-- Migration 005 — add DEMO_SESSION_PROFIT to ledger_entry_types
--
-- This entry type is used when a winning fake-trading demo session is saved
-- by an authenticated user. The profit is credited to their real USDT balance
-- via the existing record_ledger_entry() function, identical to any other
-- credit (DEPOSIT, BONUS, etc.).
--
-- Losing demo sessions do NOT debit the balance — a user cannot lose real
-- funds from a simulated session. Only positive (winning) session P&L is
-- written to ledger_entries.
--
-- is_debit = false because this is always a positive credit to the balance.

insert into ledger_entry_types (code, name, is_debit) values
  ('DEMO_SESSION_PROFIT', 'Demo Session Profit', false);
