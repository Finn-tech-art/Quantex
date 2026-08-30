# The Celery task that actually "runs" every active bot, on a timer. Right
# now this is deliberately simple: one sweep, on a fixed schedule (see
# celery_app.py's beat_schedule), that walks every ACTIVE bot and hands each
# one to whichever strategy module understands its strategy_type. Only Grid
# is implemented so far (see app/services/strategies/grid.py) — DCA and
# Momentum bots (build-plan modules 3.5/3.6) would each get their own
# strategies/*.py file and an extra `elif` branch below, once they exist.

import logging
from decimal import Decimal

from app.services import bot_service
from app.services.binance_market_service import get_latest_price_sync
from app.services.strategies import grid
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _binance_symbol(pair: str) -> str:
    """bots.pair is stored human-readably, e.g. "BTC/USDT" (see the schema's
    own comment on that column) — but Binance's API, and this project's
    price feed (binance_market_service.py), key everything by the slash-free
    form "BTCUSDT". This is the one place that conversion happens, so if the
    stored format ever changes, only this function needs updating."""
    return pair.replace("/", "")


@celery_app.task(name="app.workers.bot_engine.run_bot_engine_sweep")
def run_bot_engine_sweep() -> None:
    for bot in bot_service.list_active_bots():
        try:
            _evaluate_one_bot(bot)
        except Exception:
            # One bot's bug (bad config, a strategy module raising, etc.)
            # must never stop every OTHER active bot from being checked this
            # tick — same "isolate failures per item" principle as
            # chain_watcher_service.sweep_all_networks().
            logger.exception("Bot engine sweep failed for bot %s", bot["id"])


def _evaluate_one_bot(bot: dict) -> None:
    if bot.get("is_simulated"):
        # Owned by simulated_bot_engine.py's own sweep instead — a simulated
        # bot is also strategy_type GRID (see migration 007's comment on why)
        # but its config is shaped for that engine, not this one, and has no
        # config["grid"] key grid.evaluate_grid() below would need.
        return

    strategy_code = bot_service.strategy_type_code(bot["strategy_type_id"])

    if strategy_code != "GRID":
        # DCA/Momentum bots exist in the schema (bot_strategy_types already
        # has rows for them) but have no strategy module yet — silently
        # skipping them here (rather than erroring) means creating one
        # early just won't do anything yet, instead of crashing the sweep.
        return

    symbol = _binance_symbol(bot["pair"])
    price_str = get_latest_price_sync(symbol)
    if price_str is None:
        # No price yet almost always means market_data_feed.py either isn't
        # running, or hasn't been told to track this symbol in its
        # TRACKED_SYMBOLS list — nothing this bot can do about that itself,
        # so just wait for the next sweep rather than erroring.
        logger.warning("No live price yet for %s — skipping bot %s this tick", symbol, bot["id"])
        return

    grid.evaluate_grid(bot, Decimal(price_str))
