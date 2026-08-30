# Writes rows to `bot_fills` — the log of every buy/sell a bot has made
# (real or, for a paper bot, simulated). Unlike ledger_entries, this table
# has no dedicated "only sanctioned write path" DB function (see
# quantex-schema-design-decisions.md section 6f for why ledger_entries needs
# one and this doesn't: bot_fills isn't money moving between accounts, it's
# just an append-only trade log, so there's no overdraft/dedup risk that
# needs a wrapping function) — a plain insert is enough.

from decimal import Decimal

from app.services.supabase_client import get_supabase


def record_fill(
    bot_id: str,
    side: str,
    price: Decimal,
    quantity: Decimal,
    reasoning_text: str,
    binance_order_id: str | None = None,
    trade_pnl: Decimal | None = None,
) -> None:
    """Logs one simulated or real fill for a bot.

    side: must be "BUY" or "SELL" — matches the CHECK constraint on
    bot_fills.side directly (see the schema comment there for why this one
    column uses a plain CHECK instead of the usual lookup-table pattern).

    binance_order_id: leave this None for a paper-trading fill — its
    NULL-ness is precisely what marks a fill as simulated rather than a real
    Binance order, so don't invent a fake order id here even for a demo.

    trade_pnl: this round trip's realized profit/loss, e.g. grid.py passes
    its `profit` local on a SELL. Leave None for a BUY (a buy alone never
    realizes P&L) or for a strategy that doesn't track per-trip P&L — see
    migration 008's comment for what reads this back.

    quote_amount (price * quantity, i.e. how much USDT this fill was worth)
    is computed here rather than asked for as a parameter, since it must
    always equal price*quantity exactly — passing it in separately would
    open the door to the two silently disagreeing."""
    quote_amount = price * quantity

    get_supabase().table("bot_fills").insert(
        {
            "bot_id": bot_id,
            "side": side,
            "price": str(price),
            "quantity": str(quantity),
            "quote_amount": str(quote_amount),
            "binance_order_id": binance_order_id,
            "reasoning_text": reasoning_text,
            "trade_pnl": str(trade_pnl) if trade_pnl is not None else None,
        }
    ).execute()


def get_fills(bot_id: str, limit: int = 50) -> list[dict]:
    """Most recent fills first — this is what a future bot-detail screen's
    live fill feed would page through."""
    return (
        get_supabase()
        .table("bot_fills")
        .select("*")
        .eq("bot_id", bot_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
