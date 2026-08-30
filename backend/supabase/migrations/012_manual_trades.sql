-- ============================================================================
-- Manual Trade screen — real spot buys/sells against a user's real balance,
-- executed at whatever price is currently live in Redis (see
-- binance_market_service.py), but never actually placed on Binance — same
-- "simulated execution, real ledger effect" idea the bots already use.
-- ============================================================================
-- `trades` is the append-only execution log — the manual-trading twin of
-- `bot_fills`, minus the bot_id (a manual trade has no owning bot) and
-- reasoning_text (there's no strategy narrating a human's own click).
-- Deliberately NOT partitioned like bot_fills/ledger_entries are: those are
-- written by an automated engine ticking every 10-15 seconds indefinitely,
-- while a row here is only ever written by a real human clicking Buy/Sell —
-- orders of magnitude less volume, so the partition-maintenance overhead
-- isn't worth it at this scale. Revisit if that assumption ever stops
-- holding.
--
-- fee_amount is stored here for display/history (the Trade screen's own
-- feed can show "fee: $0.10" per row) but is NOT a separate ledger entry —
-- see trading_service.py's module comment for why a plain 2-leg debit/
-- credit (already net of fee) was chosen over withdrawal_service.py's
-- 3-entry principal+fee split: that split exists there so withdrawal fee
-- revenue is separately queryable in aggregate; nothing here asked for that
-- yet, and this table already makes every trade's fee fully visible.
create table trades (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references users(id),
  pair          text not null,                        -- e.g. 'BTC/USDT' — matches bots.pair's own format
  side          text not null check (side in ('BUY','SELL')),
  price         numeric(20,8) not null check (price > 0),
  quantity      numeric(20,8) not null check (quantity > 0),   -- base-asset amount (e.g. BTC)
  quote_amount  numeric(20,8) not null check (quote_amount > 0), -- USDT value BEFORE fee
  fee_amount    numeric(20,8) not null default 0 check (fee_amount >= 0), -- always in USDT
  created_at    timestamptz not null default now()
);

create index idx_trades_user_created on trades(user_id, created_at desc);

-- TRADE_BUY / TRADE_SELL cover both legs of their respective action (the
-- USDT-side entry and the base-asset-side entry alike) — same reuse-one-
-- code-across-both-legs convention SIMULATED_BOT_PROFIT/LOSS already use
-- for a settled session's single ledger entry. is_debit here is nominal
-- (both entry types write BOTH a debit and a credit leg, on different
-- assets, in the same trade) — see ledger_entry_types.is_debit's own
-- comment in quantex-schema.sql for why the column exists at all if it's
-- not load-bearing everywhere.
insert into ledger_entry_types (code, name, is_debit) values
  ('TRADE_BUY', 'Manual Trade — Buy', true),
  ('TRADE_SELL', 'Manual Trade — Sell', false);
