-- ============================================================================
-- Add public.bot_fills.trade_pnl
-- ============================================================================
-- Per-round-trip P&L for a SELL fill — NULL for every BUY fill (a buy alone
-- never realizes a profit/loss) and NULL for any strategy that doesn't
-- track it. Populated by:
--   - strategies/grid.py's evaluate_grid() on every real/paper Grid SELL —
--     it already computed this value (the `profit` local) and previously
--     just discarded it after folding it into the bot's own realized_pnl.
--   - workers/simulated_bot_engine.py on every simulated-bot SELL — passed
--     straight through from fake_trading_service's own per-trip trade_pnl.
--
-- This is what lets the bot-activity UI show a colored win/loss badge per
-- trade (matching FakeSessionPage's execution log) instead of only a
-- running total — see components/ExecutionLog.jsx.
-- ============================================================================

alter table public.bot_fills
  add column trade_pnl numeric(20,8);
