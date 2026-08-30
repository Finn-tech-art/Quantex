# Recent price history for a persistent bot's activity page — the
# non-streaming counterpart to fake_trading_service's demo chart. A demo
# session shows one 10-minute window at 1-second resolution because it's
# played back live; a real/simulated bot's page just needs "what has this
# pair's price actually been doing lately" at a glance, so this uses coarser
# 1-minute candles over a longer window instead (1-second candles for a
# multi-hour window would need thousands of klines per request — well past
# Binance's 1000-per-call limit).

import logging

from app.services.binance_market_service import fetch_klines

logger = logging.getLogger(__name__)

# How many minutes of 1-minute candles to show by default, and the hard cap
# on what a caller can ask for — 1000 is Binance's own per-call limit on
# klines, so this can never usefully go higher without paginating multiple
# calls (not needed yet). To change the default window a bot's chart shows,
# change DEFAULT_WINDOW_MINUTES; to allow a wider caller-requested window,
# raise MAX_WINDOW_MINUTES (still capped at 1000).
DEFAULT_WINDOW_MINUTES = 180  # 3 hours
MAX_WINDOW_MINUTES = 1000


def get_recent_candles(symbol: str, window_minutes: int = DEFAULT_WINDOW_MINUTES) -> list[dict] | None:
    """Returns up to `window_minutes` of real 1-minute OHLC candles for
    `symbol` (e.g. "BTCUSDT"), oldest first, each shaped
    {time, open, high, low, close, volume} — time is Unix seconds, matching
    what the frontend's LiveChart component (and lightweight-charts itself)
    expects. `volume` is real (Binance kline field index 5, the base-asset
    volume traded during that 1-minute candle) — unlike fake_trading_service's
    own candle dicts, which have no real volume concept behind their
    synthetic demo-session price path and so don't include this key at all;
    LiveChart.jsx treats volume as optional for exactly that reason, only
    drawing its volume pane when the field is actually present.

    Returns None (never raises) if the underlying fetch fails — callers
    should treat that as "no chart data available right now", not an error;
    see routers/bots.py's /chart endpoint for how it surfaces that."""
    window_minutes = max(1, min(window_minutes, MAX_WINDOW_MINUTES))
    raw_klines = fetch_klines(symbol, interval="1m", limit=window_minutes)
    if raw_klines is None:
        return None

    return [
        {
            # Binance's open_time is milliseconds; Unix-seconds is what
            # lightweight-charts (and fake_trading_service's candles) use.
            "time": int(k[0] / 1000),
            "open": round(float(k[1]), 2),
            "high": round(float(k[2]), 2),
            "low": round(float(k[3]), 2),
            "close": round(float(k[4]), 2),
            "volume": round(float(k[5]), 3),
        }
        for k in raw_klines
    ]
