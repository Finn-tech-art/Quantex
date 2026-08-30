# This service talks to Binance's PUBLIC market-data WebSocket — the feed of
# live prices anyone can read, with no API key, login, or money involved.
# That's deliberate: it lets us build and run the whole "read live prices"
# half of the bot engine before Binance API keys or trading capital exist.
# The PRIVATE half (placing real orders, which does need API keys) is a
# separate, later piece — this file only ever reads, never trades.

import asyncio
import json
import logging

import httpx
import websockets

from app.services.redis_client import get_redis, get_redis_sync

# Standard Python logger. When this runs as its own process
# (market_data_feed.py), logging.basicConfig there controls how these
# messages are actually printed (level, format, etc.).
logger = logging.getLogger(__name__)

# Base URL for Binance's public WebSocket API. Every individual price stream
# is a path appended to this, e.g. ".../ws/btcusdt@ticker" for BTC/USDT.
BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws"

# The Markets page's data source: Binance's REST "24hr ticker, all symbols"
# endpoint — one HTTP call returns the full 24hr ticker (price, %-change,
# high/low, volume, ...) for every symbol on the exchange at once. This was
# originally built on Binance's combined WebSocket stream (`!ticker@arr`,
# a single connection pushing the same data once a second) instead, but
# that stream pushes a large (~100KB+) payload every second forever, and in
# practice that sustained high-bandwidth push proved unreliable on a
# constrained connection — repeated multi-second stalls with no message
# ever arriving, while this same REST endpoint and the small per-symbol WS
# streams below both responded in under a second. Polling REST every
# ALL_MARKET_POLL_INTERVAL_SECONDS trades "pushed the instant it changes"
# for "reliably fresh within ~10s", which is more than enough for a display
# page (nothing here feeds bot trading decisions). Kept as a fully separate
# function from stream_price() below on purpose either way: the per-symbol
# streams feed live bot trading (bot_engine.py, trading_service.py) and
# must never be touched by Markets-page changes.
BINANCE_ALL_TICKERS_URL = "https://api.binance.com/api/v3/ticker/24hr"

# How often poll_all_tickers() below re-fetches the whole market from
# Binance. Lower this for a fresher Markets page at the cost of more
# requests to Binance's public REST API (no API key/auth involved, but
# Binance still rate-limits by IP — 10s comfortably avoids that for a
# single hobby deployment); raise it to poll less aggressively.
ALL_MARKET_POLL_INTERVAL_SECONDS = 10

# Only symbols quoted in USDT are shown on the Markets page — that's the
# standard "market list" convention (prices read directly as a USD figure)
# rather than also showing BTC-quoted, BNB-quoted, etc. pairs for the same
# coins. Change this suffix if a different quote asset is ever wanted.
MARKET_QUOTE_ASSET = "USDT"

# Binance's leveraged tokens (e.g. "BTCUPUSDT", "ETHDOWNUSDT") are technically
# USDT-quoted symbols but aren't real coins — they're 3x-leveraged wrapper
# products that would otherwise clutter a "how are coins performing" list
# with near-duplicate, extreme-looking entries for assets already listed
# normally. Any base asset ending in one of these suffixes is filtered out
# in stream_all_tickers() below.
_LEVERAGED_TOKEN_SUFFIXES = ("UP", "DOWN", "BULL", "BEAR")

# Redis key the whole filtered, all-market ticker array is cached under —
# one big JSON list rather than one key per symbol, since the Markets page
# always wants the full list at once (no scenario reads a single symbol's
# entry from this key in isolation).
_ALL_TICKERS_KEY = "tickers:all"

# Base URL for Binance's public REST klines (candlestick history) endpoint —
# same "no API key, read-only" trust level as the ticker stream above, just a
# one-shot history pull instead of a live subscription.
BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"


def fetch_klines(symbol: str, interval: str, limit: int) -> list[list] | None:
    """One-shot pull of Binance's public kline (candlestick) history — the
    single shared REST call both fake_trading_service.py (per-second closes
    for a 10-minute demo window) and bot_chart_service.py (per-minute
    candles for a bot's recent price chart) build on top of, each parsing
    the raw rows differently for its own purpose. This function itself does
    no parsing beyond the JSON decode — see each caller for how it turns
    these rows into what it actually needs.

    Returns Binance's raw kline rows — each one
    [open_time_ms, open, high, low, close, volume, close_time_ms, ...] — or
    None (deliberately NEVER raises) on any failure: bad network, Binance
    down/rate-limited, unexpected response shape. Callers always get a clean
    "did this work?" check this way instead of needing their own try/except
    around every call site.

    interval: any Binance kline interval string, e.g. "1s", "1m", "1h".
    limit: how many candles to request — Binance caps this at 1000 per call."""
    try:
        resp = httpx.get(
            BINANCE_KLINES_URL,
            params={"symbol": symbol, "interval": interval, "limit": limit},
            timeout=5.0,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        logger.warning(
            "Failed to fetch klines (interval=%s, limit=%d) for %s",
            interval, limit, symbol, exc_info=True,
        )
        return None


def _price_key(symbol: str) -> str:
    """Builds the Redis key a symbol's latest price is stored under, e.g.
    "price:BTCUSDT". Centralized here (instead of repeating the f-string
    everywhere) so the writer (stream_price) and the reader (get_latest_price)
    can never drift out of sync on the naming scheme."""
    # .upper() so "btcusdt", "BTCUSDT", and "BtcUsdt" all hit the same key —
    # the key format itself is otherwise an arbitrary choice, change it here
    # (and nowhere else) if you ever want a different naming scheme.
    return f"price:{symbol.upper()}"


async def get_latest_price(symbol: str) -> str | None:
    """Reads the most recent price written by stream_price() below, for
    whichever symbol you ask for (e.g. "BTCUSDT"). Returns None if nothing
    has ever been written for that symbol yet (feed not running, or this
    symbol isn't in TRACKED_SYMBOLS in market_data_feed.py). Async version —
    for use from FastAPI routes (which are async)."""
    r = get_redis()
    return await r.get(_price_key(symbol))


def get_latest_price_sync(symbol: str) -> str | None:
    """Same as get_latest_price() above, but non-async — for use from Celery
    tasks (bot_engine.py), which run synchronously and can't easily `await`
    anything. See redis_client.get_redis_sync()'s docstring for why a
    separate sync Redis client is needed at all rather than reusing the
    async one everywhere."""
    return get_redis_sync().get(_price_key(symbol))


async def stream_price(symbol: str) -> None:
    """Connects to Binance's public 24hr-ticker stream for one trading pair
    (e.g. "BTCUSDT") and keeps writing its latest price into Redis forever,
    once per tick. This is the single source every part of the app (Grid
    strategy, live price display, etc.) should read prices from — nothing
    else should call Binance directly for prices, so there's only one
    connection per symbol no matter how many things need the price.

    Runs as an infinite loop and never returns normally: if the connection
    drops (network blip, Binance restarting, etc.) it logs the error, waits
    5 seconds, and reconnects automatically rather than crashing the whole
    process. To track a different or additional symbol, don't edit this
    function — add/change entries in TRACKED_SYMBOLS in market_data_feed.py,
    which calls this once per symbol."""

    # Binance's stream-name convention is always lowercase, e.g.
    # "btcusdt@ticker" — "@ticker" specifically means "24hr rolling ticker
    # stats", which includes the current price. Other suffixes exist for
    # different data (e.g. "@kline_1m" for 1-minute candles) if this project
    # later needs candlestick charts instead of just a live price.
    stream_name = f"{symbol.lower()}@ticker"
    uri = f"{BINANCE_WS_BASE}/{stream_name}"
    r = get_redis()

    # This outer `while True` is the reconnect loop — it wraps the entire
    # connection attempt, so ANY failure inside (dropped connection, DNS
    # hiccup, Binance-side restart) is caught below and simply retried,
    # rather than needing separate handling for each failure type.
    while True:
        try:
            # `async with websockets.connect(uri)` opens the connection and
            # guarantees it gets cleanly closed afterward (even on error) —
            # same idea as a normal Python `with open(file)` block.
            async with websockets.connect(uri) as ws:
                logger.info("Connected to Binance ticker stream: %s", stream_name)

                # `async for message in ws` waits for each new message
                # Binance pushes down the socket and processes it as it
                # arrives — this loop runs once per tick, roughly once a
                # second for the @ticker stream, for as long as the
                # connection stays open.
                async for message in ws:
                    # Binance sends each tick as a JSON text message. See
                    # binance_market_service's docstring history / the live
                    # test that confirmed this shape: it's a dict with many
                    # fields, of which "c" ("close price" — i.e. the current
                    # last-traded price) is the one we actually care about.
                    data = json.loads(message)

                    # Overwrite the same Redis key every tick — we only ever
                    # care about the LATEST price, not a history of every
                    # tick (that history already exists on Binance itself if
                    # ever needed). `r.set` with no `ex=` here means the key
                    # never expires on its own; it just keeps getting
                    # overwritten as long as this loop keeps running.
                    await r.set(_price_key(symbol), data["c"])
        except Exception:
            # Broad `except Exception` is intentional here: literally any
            # failure while connected (network drop, malformed message,
            # Binance closing the socket, etc.) should trigger the same
            # "log it and reconnect" behavior rather than crashing this
            # symbol's feed permanently. Adjust the sleep below if you want
            # a faster/slower retry pace.
            logger.exception("Binance WS connection dropped for %s, reconnecting in 5s", symbol)
            await asyncio.sleep(5)


def _is_leveraged_token(base_asset: str) -> bool:
    """True for wrapper products like "BTCUP"/"ETHDOWN" — see
    _LEVERAGED_TOKEN_SUFFIXES's comment above for why these get excluded
    from the Markets page rather than listed as if they were real coins."""
    return any(base_asset.endswith(suffix) for suffix in _LEVERAGED_TOKEN_SUFFIXES)


async def get_all_tickers() -> list[dict] | None:
    """Reads the whole cached Markets-page ticker list written by
    poll_all_tickers() below. Returns None if nothing has been written yet
    (the feed process isn't running, or hasn't completed its first poll) —
    the /market/tickers route turns that into a 503 rather than a confusing
    empty list, same pattern as get_latest_price() upstream in trading.py."""
    r = get_redis()
    raw = await r.get(_ALL_TICKERS_KEY)
    return json.loads(raw) if raw is not None else None


async def poll_all_tickers() -> None:
    """Fetches Binance's REST "24hr ticker, all symbols" endpoint on a
    repeating timer and keeps the filtered Markets-page list refreshed in
    Redis, forever. This is the ONLY thing that powers the Markets page —
    nothing here touches the per-symbol price:{SYMBOL} keys stream_price()
    above writes, so bot trading is completely unaffected by anything in
    this function.

    Uses an async httpx client rather than the plain httpx.get() fetch_klines()
    uses above — this runs concurrently with the per-symbol WebSocket
    streams inside the same asyncio event loop (see market_data_feed.py's
    main()), so a blocking synchronous HTTP call here would stall those
    bot-trading-critical streams for as long as the request takes. The
    async client awaits instead, letting the other streams keep running
    during the request.

    Any failure (network blip, Binance rate-limit, bad response) is logged
    and simply retried on the next timer tick rather than crashing the
    whole market_data_feed process — same "log it and keep going" shape as
    stream_price()'s reconnect loop above, just on a fixed timer instead of
    a persistent connection.

    To track a different quote asset or stop excluding leveraged tokens,
    edit MARKET_QUOTE_ASSET / _LEVERAGED_TOKEN_SUFFIXES above — nothing in
    this function needs to change for either of those adjustments."""
    r = get_redis()

    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                resp = await client.get(BINANCE_ALL_TICKERS_URL)
                resp.raise_for_status()
                # One object per symbol on the whole exchange (spot +
                # every quote asset) — full field names here (this is
                # Binance's REST shape), unlike the abbreviated single-
                # letter keys the WebSocket @ticker stream stream_price()
                # reads from above uses for the same underlying values.
                raw_tickers = resp.json()

                filtered = []
                for entry in raw_tickers:
                    symbol = entry["symbol"]  # e.g. "BTCUSDT"
                    if not symbol.endswith(MARKET_QUOTE_ASSET):
                        continue
                    base_asset = symbol[: -len(MARKET_QUOTE_ASSET)]
                    if not base_asset or _is_leveraged_token(base_asset):
                        continue
                    filtered.append({
                        "symbol": symbol,
                        "base": base_asset,
                        "price": entry["lastPrice"],
                        "change_percent": entry["priceChangePercent"],
                        "high": entry["highPrice"],
                        "low": entry["lowPrice"],
                        "volume": entry["volume"],              # 24hr base-asset volume
                        "quote_volume": entry["quoteVolume"],   # 24hr quote-asset (USDT) volume — used to sort by "most traded"
                    })

                # Overwrite the whole cached list every poll, same
                # "latest snapshot only" approach as stream_price()'s
                # price:{SYMBOL} keys — no history is kept here either.
                await r.set(_ALL_TICKERS_KEY, json.dumps(filtered))
                logger.info("Refreshed Markets-page ticker cache (%d symbols)", len(filtered))
            except Exception:
                logger.exception("Failed to refresh Markets-page tickers, retrying in %ds", ALL_MARKET_POLL_INTERVAL_SECONDS)

            await asyncio.sleep(ALL_MARKET_POLL_INTERVAL_SECONDS)
