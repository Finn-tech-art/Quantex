# The manual Trade screen's backend — lets a user buy/sell BTC, ETH, or SOL
# against their real USDT balance, at whatever price is currently live in
# Redis (see binance_market_service.py — the same feed the bots read from).
# No order is ever actually placed on Binance; this is "simulated
# execution, real ledger effect", the exact same idea the simulated bots
# already use (see simulated_bot_ledger_service.py), just triggered by a
# user's own click instead of a scheduled sweep.
#
# Fee model: FEE_RATE below (0.1%) is charged on every trade, taken out of
# what you receive rather than added on top of what you pay — a $100 buy
# always debits exactly $100 USDT, and the fee just means slightly less
# than $100-worth of the asset lands in your balance. To change the fee,
# edit FEE_RATE — nothing else needs to change, since it's read fresh on
# every call rather than baked into anything stored. To remove fees
# entirely, set it to Decimal("0").
#
# Ledger shape: unlike withdrawal_service.py's 3-entry principal+fee split
# (kept separate there so fee revenue is independently reportable), a trade
# here writes exactly 2 ledger entries — one on each side of the swap, each
# already net of the fee. The fee itself isn't lost, just not a separate
# ledger row: every trade's fee_amount is stored on its own `trades` row
# (see migration 012), which is already the natural place to look for a
# trade's own history/fee, the same way BotDetailPage's Feed tab is the
# natural place to look for a bot's fills rather than the ledger directly.

import logging
from decimal import Decimal

from postgrest.exceptions import APIError

from app.services.binance_market_service import get_latest_price
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# 0.1% — see this module's header comment for what changing this does and
# doesn't affect. A real spot exchange's default taker fee is usually in
# this neighborhood.
FEE_RATE = Decimal("0.001")

# Every pair the Trade screen offers has to have a live price — i.e. its
# Binance symbol must also be in market_data_feed.py's
# ALWAYS_STREAMED_SYMBOLS, or get_current_price() below will 503 forever for
# it (the dynamic active-bot streams in manage_bot_symbol_streams() aren't
# enough on their own, since manual trading needs a price even when no bot
# is running). Keep these two lists in sync; add a pair here AND there
# together, never just one.
SUPPORTED_PAIRS = {"BTC/USDT", "ETH/USDT", "SOL/USDT"}


class InsufficientBalanceError(Exception):
    """Raised when a buy/sell can't proceed because the user doesn't have
    enough of the asset being spent — checked proactively before writing
    anything, so this is the normal, expected way a bad request is
    rejected (the router turns it into a 400), not a rare edge case like
    the check-constraint race the except block below still guards
    defensively against."""

    pass


def _binance_symbol(pair: str) -> str:
    """Same conversion as routers/bots.py's own _binance_symbol — see that
    file's comment for why pair ("BTC/USDT") and the price-feed's Redis key
    ("BTCUSDT") use different formats. Duplicated rather than shared for
    the same reason it's duplicated there: a one-line, self-contained
    conversion isn't worth an import."""
    return pair.replace("/", "")


def _base_asset(pair: str) -> str:
    """"BTC/USDT" -> "BTC" — the asset actually being bought/sold. Every
    supported pair is assumed to be quoted in USDT (see SUPPORTED_PAIRS) —
    this only ever needs the base half."""
    return pair.split("/")[0]


_asset_id_cache: dict[str, int] = {}
_entry_type_id_cache: dict[str, int] = {}


def _asset_id(code: str) -> int:
    if not _asset_id_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_id_cache.update({row["code"]: row["id"] for row in rows})
    return _asset_id_cache[code]


def _entry_type_id(code: str) -> int:
    if code not in _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({row["code"]: row["id"] for row in rows})
    return _entry_type_id_cache[code]


def _balance(user_id: str, asset_code: str) -> Decimal:
    rows = (
        get_supabase()
        .table("balances")
        .select("amount")
        .eq("user_id", user_id)
        .eq("asset_id", _asset_id(asset_code))
        .limit(1)
        .execute()
        .data
    )
    return Decimal(str(rows[0]["amount"])) if rows else Decimal("0")


async def get_current_price(pair: str) -> Decimal:
    """Returns None (via a 503 raised by the router, not here — see
    routers/trading.py) when the feed has nothing yet, matching every
    other price-dependent bots.py route's own "not ready" handling rather
    than inventing a different convention just for this screen."""
    price_str = await get_latest_price(_binance_symbol(pair))
    return Decimal(price_str) if price_str is not None else None


def _insert_trade(user_id: str, pair: str, side: str, price: Decimal, quantity: Decimal, quote_amount: Decimal, fee_amount: Decimal) -> int:
    row = (
        get_supabase()
        .table("trades")
        .insert(
            {
                "user_id": user_id,
                "pair": pair,
                "side": side,
                "price": str(price),
                "quantity": str(quantity),
                "quote_amount": str(quote_amount),
                "fee_amount": str(fee_amount),
            }
        )
        .execute()
    )
    return row.data[0]["id"]


async def buy(user_id: str, pair: str, quote_amount: Decimal) -> dict:
    """Spends exactly `quote_amount` USDT — that's the full debit,
    regardless of fee — and credits (quote_amount * (1 - FEE_RATE)) / price
    worth of the base asset. Returns the trade's own row shape, matching
    what routers/trading.py hands back to the frontend.

    Raises InsufficientBalanceError if the user's USDT balance is below
    quote_amount — checked BEFORE any write, so a rejected buy never
    creates a trades row at all."""
    price = await get_current_price(pair)
    if price is None:
        raise RuntimeError(f"No live price available for {pair} yet")

    usdt_balance = _balance(user_id, "USDT")
    if usdt_balance < quote_amount:
        raise InsufficientBalanceError(f"Available USDT balance ({usdt_balance}) is less than {quote_amount}")

    fee_amount = quote_amount * FEE_RATE
    quantity = (quote_amount - fee_amount) / price
    base_asset = _base_asset(pair)

    trade_id = _insert_trade(user_id, pair, "BUY", price, quantity, quote_amount, fee_amount)

    try:
        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": user_id,
                "p_asset_id": _asset_id("USDT"),
                "p_entry_type_id": _entry_type_id("TRADE_BUY"),
                "p_amount": str(-quote_amount),
                "p_idempotency_key": f"trade:{trade_id}:usdt",
                "p_metadata": {"source": "manual_trade", "trade_id": trade_id, "pair": pair},
            },
        ).execute()
        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": user_id,
                "p_asset_id": _asset_id(base_asset),
                "p_entry_type_id": _entry_type_id("TRADE_BUY"),
                "p_amount": str(quantity),
                "p_idempotency_key": f"trade:{trade_id}:{base_asset.lower()}",
                "p_metadata": {"source": "manual_trade", "trade_id": trade_id, "pair": pair},
            },
        ).execute()
    except APIError as exc:
        if exc.code == "23514":  # check_violation — balances.amount >= 0
            # Only realistically reachable via a genuine race (two rapid
            # concurrent buys) since the proactive check above already
            # confirmed sufficient balance moments earlier — see this
            # module's header comment / simulated_bot_ledger_service.py's
            # identical catch for the same defense-in-depth reasoning.
            logger.warning("Trade %s buy debit rejected by balance check at write time (race)", trade_id)
            raise InsufficientBalanceError("Balance changed before this trade could be written — try again") from exc
        raise

    return {
        "trade_id": trade_id,
        "pair": pair,
        "side": "BUY",
        "price": price,
        "quantity": quantity,
        "quote_amount": quote_amount,
        "fee_amount": fee_amount,
    }


async def sell(user_id: str, pair: str, quantity: Decimal) -> dict:
    """Sells exactly `quantity` of the base asset — that's the full debit
    from that asset's balance — and credits (quantity * price) * (1 -
    FEE_RATE) worth of USDT. Mirrors buy()'s structure; see its docstring
    for the shared reasoning."""
    price = await get_current_price(pair)
    if price is None:
        raise RuntimeError(f"No live price available for {pair} yet")

    base_asset = _base_asset(pair)
    base_balance = _balance(user_id, base_asset)
    if base_balance < quantity:
        raise InsufficientBalanceError(f"Available {base_asset} balance ({base_balance}) is less than {quantity}")

    gross_quote = quantity * price
    fee_amount = gross_quote * FEE_RATE
    net_quote = gross_quote - fee_amount

    trade_id = _insert_trade(user_id, pair, "SELL", price, quantity, gross_quote, fee_amount)

    try:
        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": user_id,
                "p_asset_id": _asset_id(base_asset),
                "p_entry_type_id": _entry_type_id("TRADE_SELL"),
                "p_amount": str(-quantity),
                "p_idempotency_key": f"trade:{trade_id}:{base_asset.lower()}",
                "p_metadata": {"source": "manual_trade", "trade_id": trade_id, "pair": pair},
            },
        ).execute()
        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": user_id,
                "p_asset_id": _asset_id("USDT"),
                "p_entry_type_id": _entry_type_id("TRADE_SELL"),
                "p_amount": str(net_quote),
                "p_idempotency_key": f"trade:{trade_id}:usdt",
                "p_metadata": {"source": "manual_trade", "trade_id": trade_id, "pair": pair},
            },
        ).execute()
    except APIError as exc:
        if exc.code == "23514":
            logger.warning("Trade %s sell debit rejected by balance check at write time (race)", trade_id)
            raise InsufficientBalanceError("Balance changed before this trade could be written — try again") from exc
        raise

    return {
        "trade_id": trade_id,
        "pair": pair,
        "side": "SELL",
        "price": price,
        "quantity": quantity,
        "quote_amount": net_quote,
        "fee_amount": fee_amount,
    }


def get_history(user_id: str, pair: str | None = None, limit: int = 50) -> list[dict]:
    query = get_supabase().table("trades").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit)
    if pair:
        query = query.eq("pair", pair)
    return query.execute().data
