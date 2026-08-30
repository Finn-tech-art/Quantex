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

from app.services.binance_market_service import poll_all_tickers, stream_price

# Prints INFO-level log lines (connects/reconnects, etc.) to this terminal
# window so you can see the feed is alive. Change to logging.DEBUG for more
# detail, or logging.WARNING to quiet it down to errors only.
logging.basicConfig(level=logging.INFO)

# Every symbol listed here gets its own persistent Binance connection and its
# own continuously-updated Redis key (see binance_market_service._price_key).
# To track another pair later (e.g. for a DCA or Momentum bot on a different
# symbol), just add its Binance symbol here — no other code changes needed.
# Binance symbol format is the two assets concatenated with no separator and
# no slash, e.g. "ETHUSDT" for ETH/USDT.
#
# ETHUSDT and SOLUSDT were added alongside the manual Trade screen
# (trading_service.py), which lets a user buy/sell any of these three pairs
# against their real USDT balance at whatever price is live here.
TRACKED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]


async def main() -> None:
    # asyncio.gather runs all of these concurrently in the same process (one
    # asyncio task per symbol, plus one more task below) rather than one
    # after another — with only 3 symbols right now this doesn't matter
    # much, but it means adding more symbols to TRACKED_SYMBOLS above
    # doesn't slow anything down; each symbol's connection is fully
    # independent of the others.
    #
    # poll_all_tickers() is the Markets page's REST polling loop (see its
    # docstring in binance_market_service.py) — it's entirely separate from
    # the per-symbol streams above and covers every USDT pair on the
    # exchange, not just TRACKED_SYMBOLS.
    await asyncio.gather(
        *(stream_price(symbol) for symbol in TRACKED_SYMBOLS),
        poll_all_tickers(),
    )


# This guard means "only run main() if this file is executed directly (via
# `python -m app.workers.market_data_feed`), not if something else imports
# it" — standard Python pattern, so this module could later be imported
# elsewhere (e.g. for a test) without immediately trying to connect to
# Binance as a side effect of the import.
if __name__ == "__main__":
    asyncio.run(main())
