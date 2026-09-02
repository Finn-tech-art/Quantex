"""Standalone entrypoint — run as its own long-lived process, separate from
the FastAPI server (app.main) and the Celery worker (app.workers.celery_app),
since a persistent WebSocket connection needs to just sit open forever,
which doesn't fit Celery's model of short, discrete, one-off tasks.

To run it:

    cd backend
    .venv\\Scripts\\python -m app.workers.market_data_feed

It has no HTTP port and no API — it just connects to Binance, writes prices
into Redis, and logs to the console. Leave it running in its own terminal
alongside uvicorn and celery while developing.
"""

import asyncio
import logging

from app.services.binance_market_service import (
    jitter_all_tickers,
    manage_bot_symbol_streams,
    poll_all_tickers,
    stream_price,
)

# Prints INFO-level log lines (connects/reconnects, etc.) to this terminal
# window so you can see the feed is alive. Change to logging.DEBUG for more
# detail, or logging.WARNING to quiet it down to errors only.
logging.basicConfig(level=logging.INFO)

# Every symbol listed here gets its own PERMANENT Binance connection and its
# own continuously-updated Redis key (see binance_market_service._price_key)
# — streamed all the time, regardless of whether any bot is currently active
# on it. These three stay hardcoded (rather than dynamically managed like
# every other symbol, see manage_bot_symbol_streams() below) specifically
# because the manual Trade screen (trading_service.py's SUPPORTED_PAIRS)
# lets a user buy/sell any of them against their real USDT balance at any
# time, bot or no bot — that screen would otherwise randomly lose its live
# price the moment no bot happened to be running on a given pair. Binance
# symbol format is the two assets concatenated with no separator and no
# slash, e.g. "ETHUSDT" for ETH/USDT. Add a symbol here only if it should
# ALSO always be tradeable manually regardless of bot activity; a symbol
# only ever used by a bot doesn't need adding anywhere — see
# manage_bot_symbol_streams()'s own docstring for how those start/stop
# automatically.
ALWAYS_STREAMED_SYMBOLS = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}


async def main() -> None:
    # asyncio.gather runs all of these concurrently in the same process
    # rather than one after another — adding more symbols to
    # ALWAYS_STREAMED_SYMBOLS above, or more bots trading new symbols,
    # doesn't slow anything down; each symbol's connection is fully
    # independent of the others.
    #
    # poll_all_tickers() is the Markets page's REST polling loop, and
    # jitter_all_tickers() is its cosmetic "keep it looking alive between
    # real 5-minute fetches" companion (see both docstrings in
    # binance_market_service.py) — both entirely separate from the
    # per-symbol streams above and cover every USDT pair on the exchange,
    # not just ALWAYS_STREAMED_SYMBOLS.
    #
    # manage_bot_symbol_streams() is what starts/stops EXTRA per-symbol
    # streams (beyond the always-on three above) for whatever symbol some
    # active, non-simulated bot is currently trading — see its own
    # docstring in binance_market_service.py for exactly how that works.
    await asyncio.gather(
        *(stream_price(symbol) for symbol in ALWAYS_STREAMED_SYMBOLS),
        poll_all_tickers(),
        jitter_all_tickers(),
        manage_bot_symbol_streams(ALWAYS_STREAMED_SYMBOLS),
    )


# This guard means "only run main() if this file is executed directly (via
# `python -m app.workers.market_data_feed`), not if something else imports
# it" — standard Python pattern, so this module could later be imported
# elsewhere (e.g. for a test) without immediately trying to connect to
# Binance as a side effect of the import.
if __name__ == "__main__":
    asyncio.run(main())
