-- ============================================================================
-- Add public.bots.is_paper
-- ============================================================================
-- Marks a bot as paper-trading (simulated): it evaluates real live market
-- data and writes real bot_fills rows with real reasoning_text, but never
-- places an order on Binance and never calls record_ledger_entry() — no real
-- capital or Binance API access required. Lets the whole strategy/execution
-- loop be built and demoed before Binance API keys or trading capital exist.
-- Its P&L is notional, derived only from bot_fills, and must always be
-- labeled as paper/simulated wherever shown — never mixed with real
-- balances or presented as real performance.
-- ============================================================================

alter table public.bots
  add column is_paper boolean not null default false;
