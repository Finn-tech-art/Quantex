-- ============================================================================
-- Module 4 — user-created "simulated" bots
-- ============================================================================
-- A simulated bot is a persistent `bots` row (strategy_type stays 'GRID',
-- same as the existing one-shot fake-trading demo already labels itself)
-- that runs recurring SCRIPTED sessions instead of grid.py's real tick
-- engine — see app/workers/simulated_bot_engine.py. `is_simulated` is what
-- tells the bot engine sweep (bot_engine.py) and the simulated bot engine
-- sweep (simulated_bot_engine.py) which one of them owns a given bot, and
-- what tells routers/bots.py's list/detail endpoints which P&L source to
-- read (grid.compute_pnl vs. this bot's own config.simulated.realized_pnl).
--
-- Two new ledger_entry_types let a completed session's real P&L actually
-- move the user's real balance in EITHER direction (unlike the one-shot demo
-- session, which only ever credits on a win) — a losing session debits via
-- SIMULATED_BOT_LOSS, using the exact same record_ledger_entry() path and
-- the exact same balances.amount >= 0 overdraft protection every other debit
-- in this schema already gets for free.
-- ============================================================================

alter table public.bots
  add column is_simulated boolean not null default false;

insert into ledger_entry_types (code, name, is_debit) values
  ('SIMULATED_BOT_PROFIT', 'Simulated Bot Session Profit', false),
  ('SIMULATED_BOT_LOSS', 'Simulated Bot Session Loss', true);
