# This service talks to Binance's PUBLIC market-data WebSocket — the feed of
# live prices anyone can read, with no API key, login, or money involved.
# That's deliberate: it lets us build and run the whole "read live prices"
# half of the bot engine before Binance API keys or trading capital exist.
# The PRIVATE half (placing real orders, which does need API keys) is a
# separate, later piece — this file only ever reads, never trades.

import asyncio
import json
import logging
import random

import httpx
import websockets

from app.services import bot_service
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

# How often poll_all_tickers() below fetches the REAL market snapshot from
# Binance and writes it into both _latest_real_tickers (in-process memory)
# and Redis. Lower this for fresher real prices at the cost of more
# requests to Binance's public REST API (no API key/auth involved, but
# Binance still rate-limits by IP) AND more Redis writes (Upstash bills per
# command) — this key is one big ~683-symbol JSON blob rewritten wholesale
# every tick, so this constant directly sets that write's frequency. 300s
# (5 minutes) trades "the underlying real price can be up to 5 minutes
# stale" for a big cut in both Binance requests and Redis writes — the
# jitter_all_tickers() loop just below fills the gap between real fetches
# by making the displayed numbers wobble every MARKET_JITTER_INTERVAL_SECONDS
# so the Markets page (and anything reading this same cache, like the
# Wallet/Home USDT-equivalent balance figure) still looks alive between
# real refreshes rather than sitting frozen for 5 minutes. Nothing here
# feeds bot trading decisions (see this function's own docstring) — bots
# always read the separate, never-jittered price:{SYMBOL} keys stream_price()
# writes below. Lower this back toward 10s if 5-minute-stale real prices
# ever feels wrong; raise it further for even fewer Binance/Redis calls.
ALL_MARKET_POLL_INTERVAL_SECONDS = 300

# How often jitter_all_tickers() below recomputes a fake "still moving"
# snapshot from the last REAL fetch and writes it into the same Redis key
# the real poll uses — purely cosmetic, so the Markets page (and the
# Wallet/Home balance total, which reads this same cache) never sits
# perfectly still for the full 5-minute gap between real Binance fetches.
# Lower this for a livelier-feeling tick rate; raising it saves Redis writes
# at the cost of a less "alive" looking feed.
MARKET_JITTER_INTERVAL_SECONDS = 10

# The maximum fraction jitter_all_tickers() nudges each price up or down,
# per tick, e.g. 0.0015 = up to ±0.15%. Every jitter tick is computed fresh
# from the last REAL price (never from the previous jittered value), so
# this is how far a displayed price can ever drift from the real one — it
# can't run away over time, it just wobbles within this band until the next
# real fetch replaces the baseline. Raise this for a more dramatic-looking
# wobble; lower it for a subtler one.
MARKET_JITTER_MAX_PCT = 0.0015

# The last REAL (non-jittered) ticker snapshot poll_all_tickers() fetched,
# kept in this process's own memory so jitter_all_tickers() always has a
# real baseline to wobble around — never read back from Redis itself (that
# key holds whatever the last WRITE was, real or jittered, so it can't be
# trusted as "the real value" once jittering has run at least once).
# Starts as None until the very first real poll completes.
_latest_real_tickers: list[dict] | None = None

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


# Shared prefix for every symbol's real-price key (e.g. "price:BTCUSDT") —
# pulled out as its own constant (rather than just inlined in _price_key()
# below) so get_all_real_prices() can also use it to pattern-match every
# such key in one Redis KEYS call, without hardcoding the "price:" string a
# second time somewhere else.
_PRICE_KEY_PREFIX = "price:"


def _price_key(symbol: str) -> str:
    """Builds the Redis key a symbol's latest price is stored under, e.g.
    "price:BTCUSDT". Centralized here (instead of repeating the f-string
    everywhere) so the writer (stream_price) and the reader (get_latest_price)
    can never drift out of sync on the naming scheme."""
    # .upper() so "btcusdt", "BTCUSDT", and "BtcUsdt" all hit the same key —
    # the key format itself is otherwise an arbitrary choice, change it here
    # (and nowhere else) if you ever want a different naming scheme.
    return f"{_PRICE_KEY_PREFIX}{symbol.upper()}"


async def get_latest_price(symbol: str) -> str | None:
    """Reads the most recent price written by stream_price() below, for
    whichever symbol you ask for (e.g. "BTCUSDT"). Returns None if nothing
    has ever been written for that symbol yet — feed not running, or this
    symbol is neither always-streamed (market_data_feed.py's
    ALWAYS_STREAMED_SYMBOLS) nor currently used by an active bot
    (manage_bot_symbol_streams() above only starts a stream once it sees
    one, and that can take up to DYNAMIC_STREAM_CHECK_INTERVAL_SECONDS after
    the bot goes active). Async version — for use from FastAPI routes (which
    are async)."""
    r = get_redis()
    return await r.get(_price_key(symbol))


def get_latest_price_sync(symbol: str) -> str | None:
    """Same as get_latest_price() above, but non-async — for use from Celery
    tasks (bot_engine.py), which run synchronously and can't easily `await`
    anything. See redis_client.get_redis_sync()'s docstring for why a
    separate sync Redis client is needed at all rather than reusing the
    async one everywhere."""
    return get_redis_sync().get(_price_key(symbol))


async def get_all_real_prices() -> dict[str, str]:
    """Returns every symbol currently being live-streamed by stream_price()
    (the always-on BTCUSDT/ETHUSDT/SOLUSDT plus whatever extra symbols
    manage_bot_symbol_streams() has started for an active bot) as a
    {BASE_ASSET: price} map, e.g. {"BTC": "68000.12000000"} — keyed by base
    asset to match useAssetPrices.js's existing {BTC: ..., ETH: ...} shape
    on the frontend.

    This is the REAL counterpart to get_all_tickers()/_ALL_TICKERS_KEY:
    that cache is deliberately jittered every MARKET_JITTER_INTERVAL_SECONDS
    (see jitter_all_tickers() above) so the Markets page feels alive between
    real 5-minute fetches — fine for a browsing list, but wrong for a real
    balance figure. This function instead reads straight from the
    price:{SYMBOL} keys stream_price() writes, which jitter_all_tickers()
    never touches, so it's always the true last-seen Binance price. The
    Wallet/Home balance total's main figure should be computed from THIS,
    not from get_all_tickers() — only the small "≈ X USDT" equivalency
    caption underneath it is meant to visibly wobble with fake movement.

    Uses Redis KEYS (not SCAN) to find every "price:*" key at once — normally
    KEYS is avoided on a large keyspace since it blocks the whole server
    while it scans everything, but this app only ever has a handful of
    tracked symbols (3 always-on plus however many bots are active) at once,
    so the cost here is negligible."""
    r = get_redis()
    keys = await r.keys(f"{_PRICE_KEY_PREFIX}*")
    if not keys:
        return {}

    prices = await r.mget(keys)
    result: dict[str, str] = {}
    for key, price in zip(keys, prices):
        if price is None:
            continue
        symbol = key[len(_PRICE_KEY_PREFIX):]  # "price:BTCUSDT" -> "BTCUSDT"
        # Same "strip the quote asset off the end" convention
        # poll_all_tickers() uses for the Markets-page cache — every symbol
        # tracked here is always USDT-quoted (see ALWAYS_STREAMED_SYMBOLS
        # and trading_service.py's SUPPORTED_PAIRS), so this is safe without
        # re-deriving MARKET_QUOTE_ASSET's stripping logic more generally.
        base_asset = symbol[: -len(MARKET_QUOTE_ASSET)] if symbol.endswith(MARKET_QUOTE_ASSET) else symbol
        result[base_asset] = price
    return result


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
    process — UNLESS it's cancelled from outside (asyncio.Task.cancel()),
    which is how manage_bot_symbol_streams() above stops a stream once no
    active bot needs it anymore; CancelledError isn't an Exception so it
    isn't caught by this reconnect logic, it just propagates and ends the
    task. To track a different permanently-on symbol, edit
    ALWAYS_STREAMED_SYMBOLS in market_data_feed.py; a symbol only needed
    while a bot is active on it doesn't need editing anywhere — see
    manage_bot_symbol_streams() above for how those start/stop on their
    own."""

    # Binance's stream-name convention is always lowercase, e.g.
    # "btcusdt@ticker" — "@ticker" specifically means "24hr rolling ticker
    # stats", which includes the current price. Other suffixes exist for
    # different data (e.g. "@kline_1m" for 1-minute candles) if this project
    # later needs candlestick charts instead of just a live price.
    stream_name = f"{symbol.lower()}@ticker"
    uri = f"{BINANCE_WS_BASE}/{stream_name}"
    r = get_redis()

    # Tracks the last price actually WRITTEN to Redis, purely in this
    # process's own memory — never read back from Redis itself, since a
    # round-trip GET-before-SET would just trade "one write" for "one read
    # plus sometimes a write," which doesn't reduce Redis usage at all.
    # Binance's @ticker stream pushes a message roughly once a second
    # whether or not the price actually moved; on Upstash's request-based
    # free tier, unconditionally writing every one of those (3 symbols,
    # ~1/sec, forever) burns through the monthly request quota in a couple
    # of days even when the market is flat. Skipping the write whenever the
    # price hasn't changed since our last write cuts that volume down to
    # roughly "one write per real price movement" instead. Deliberately
    # kept as a local variable (not a module-level one) — each symbol gets
    # its own stream_price() call/task, so each needs its own independent
    # "last written" tracker rather than sharing one across symbols.
    last_written_price: str | None = None

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
                    price = data["c"]

                    # Skip the Redis write entirely when the price hasn't
                    # moved since we last wrote it — see last_written_price's
                    # comment above for why. When it HAS moved, this still
                    # overwrites the same key rather than appending: we only
                    # ever care about the LATEST price, not a history of
                    # every tick (that history already exists on Binance
                    # itself if ever needed). `r.set` with no `ex=` here
                    # means the key never expires on its own; it just keeps
                    # getting overwritten as prices actually change.
                    if price != last_written_price:
                        await r.set(_price_key(symbol), price)
                        last_written_price = price
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

                # Keep this REAL snapshot in memory too (not just Redis) —
                # jitter_all_tickers() below reads it as the baseline to
                # wobble around. `global` is needed here because this
                # assigns to the module-level name rather than reading it;
                # without it Python would treat `_latest_real_tickers` as a
                # new local variable instead of updating the shared one.
                global _latest_real_tickers
                _latest_real_tickers = filtered

                # Overwrite the whole cached list every poll, same
                # "latest snapshot only" approach as stream_price()'s
                # price:{SYMBOL} keys — no history is kept here either.
                # This is deliberately still written even though
                # jitter_all_tickers() will likely overwrite it again within
                # MARKET_JITTER_INTERVAL_SECONDS — it means the REAL price is
                # visible immediately after every real fetch rather than
                # waiting on the next jitter tick to show anything at all.
                await r.set(_ALL_TICKERS_KEY, json.dumps(filtered))
                logger.info("Refreshed Markets-page ticker cache (%d symbols)", len(filtered))
            except Exception:
                logger.exception("Failed to refresh Markets-page tickers, retrying in %ds", ALL_MARKET_POLL_INTERVAL_SECONDS)

            await asyncio.sleep(ALL_MARKET_POLL_INTERVAL_SECONDS)


async def jitter_all_tickers() -> None:
    """Runs forever alongside poll_all_tickers() above, on its own much
    faster timer (MARKET_JITTER_INTERVAL_SECONDS), and makes the Markets-page
    cache look like it's continuously moving between poll_all_tickers()'s
    real 5-minute fetches — purely cosmetic, so a human glancing at the
    Markets page (or the Wallet/Home balance total, which reads this exact
    same cache — see currency.js on the frontend) sees numbers that tick
    every few seconds instead of sitting frozen for up to 5 minutes at a
    stretch.

    Every tick is computed fresh from _latest_real_tickers (the last REAL
    fetch), never from the previous jittered write — that's what keeps this
    a bounded wobble around a real number instead of a random walk that
    could drift arbitrarily far from reality over many ticks. The real
    price is always at most MARKET_JITTER_MAX_PCT away from whatever's
    displayed at any moment.

    Only the "price" field is jittered. "change_percent"/"high"/"low" are
    left as Binance's real values — recomputing them to match a fake price
    would need the real 24h-ago open price, which this cache doesn't keep,
    so they can very occasionally look very slightly inconsistent with a
    jittered price (e.g. price nudged a hair above "high"). That's an
    acceptable cosmetic quirk here, not a bug worth the extra complexity of
    tracking open prices just to fix it.

    Does nothing on ticks before the very first real poll has landed
    (_latest_real_tickers still None) — there's nothing to wobble around
    yet, and get_all_tickers() already handles "no data yet" as a 503 for
    that brief startup window."""
    r = get_redis()
    while True:
        await asyncio.sleep(MARKET_JITTER_INTERVAL_SECONDS)
        if _latest_real_tickers is None:
            continue

        try:
            jittered = []
            for entry in _latest_real_tickers:
                real_price = float(entry["price"])
                # random.uniform(-MAX, MAX) picks a fraction anywhere in
                # that band, e.g. -0.0015 to +0.0015 — multiplying the real
                # price by (1 + that fraction) is what actually moves it up
                # or down. `:.8f` matches the decimal precision Binance's
                # own price strings already use, so the frontend (which
                # just displays this string) sees nothing unusual.
                wobble = 1 + random.uniform(-MARKET_JITTER_MAX_PCT, MARKET_JITTER_MAX_PCT)
                jittered.append({**entry, "price": f"{real_price * wobble:.8f}"})

            await r.set(_ALL_TICKERS_KEY, json.dumps(jittered))
        except Exception:
            # Same "log and keep going" shape as everywhere else in this
            # file — a single bad tick here (e.g. a malformed price string)
            # should never take down the whole feed process, and the next
            # tick 10s later will just try again.
            logger.exception("Failed to jitter Markets-page tickers")


# How often manage_bot_symbol_streams() below re-checks which symbols have
# an active bot on them. A newly-active bot on a new symbol has to wait up
# to this long before its price stream actually starts (bot_engine.py just
# logs "no live price yet" and skips that bot's evaluation each tick until
# then, exactly like a brief market_data_feed restart would) — lower this
# for that gap to close faster, at the cost of one extra Supabase query per
# tick either way (cheap; Supabase, not Redis, so it doesn't affect the
# Upstash request count this whole exercise is about).
DYNAMIC_STREAM_CHECK_INTERVAL_SECONDS = 60


async def manage_bot_symbol_streams(always_streamed: set[str]) -> None:
    """Keeps exactly one live stream_price() task running for every symbol
    that currently has at least one ACTIVE, non-simulated bot on it, beyond
    the `always_streamed` set (BTCUSDT/ETHUSDT/SOLUSDT — market_data_feed.py
    starts those permanently on its own, since the manual Trade screen needs
    them live regardless of whether any bot happens to be running).

    Simulated bots are deliberately excluded from "wanted" — they get their
    price data from fetch_klines() one-shot REST pulls
    (fake_trading_service.py), never from this live stream, so a symbol used
    only by a simulated bot shouldn't cost a WebSocket connection here.

    Every DYNAMIC_STREAM_CHECK_INTERVAL_SECONDS this re-reads the active-bot
    list from Supabase (via asyncio.to_thread — bot_service's Supabase calls
    are synchronous, and running one directly here would stall every other
    coroutine in this process, including the always-on BTC/ETH/SOL streams,
    for however long that query takes) and diffs the currently-wanted symbol
    set against whichever symbols already have a running task: starts a new
    stream_price() task for anything newly wanted, and cancels the task for
    anything no longer wanted. asyncio.Task.cancel() raises CancelledError
    inside stream_price()'s loop, which is a BaseException (not Exception),
    so it passes straight through that function's `except Exception:`
    reconnect handler instead of being caught and retried — the stream just
    stops cleanly, as intended.

    If the Supabase lookup itself fails (network blip, etc.), this leaves
    whatever streams are already running untouched rather than tearing them
    all down over one failed check — same "a transient failure shouldn't
    cause a worse outcome than doing nothing" principle used everywhere else
    in this file."""
    running: dict[str, asyncio.Task] = {}

    while True:
        try:
            active_bots = await asyncio.to_thread(bot_service.list_active_bots)
            wanted = {
                bot["pair"].replace("/", "")  # "BTC/USDT" -> "BTCUSDT", same conversion used throughout the routers/services layer
                for bot in active_bots
                if not bot.get("is_simulated")
            } - always_streamed
        except Exception:
            logger.exception("Failed to look up active bots for dynamic price streams, leaving existing streams as-is")
            wanted = set(running.keys())

        for symbol in wanted - running.keys():
            running[symbol] = asyncio.create_task(stream_price(symbol))
            logger.info("Started dynamic price stream for %s (active bot detected)", symbol)

        for symbol in running.keys() - wanted:
            running.pop(symbol).cancel()
            logger.info("Stopped dynamic price stream for %s (no active bot uses it anymore)", symbol)

        await asyncio.sleep(DYNAMIC_STREAM_CHECK_INTERVAL_SECONDS)
