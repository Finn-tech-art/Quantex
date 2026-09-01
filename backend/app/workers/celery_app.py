import ssl
from urllib.parse import urlparse

from celery import Celery

from app.config import settings

celery_app = Celery("quantex", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.timezone = "UTC"
celery_app.conf.broker_connection_retry_on_startup = True

if urlparse(settings.redis_url).scheme == "rediss":
    # Upstash (and most managed Redis) requires TLS. Celery's redis transport
    # refuses to start on a rediss:// URL unless ssl_cert_reqs is spelled out
    # explicitly — CERT_REQUIRED is correct here since Upstash presents a
    # normal publicly-trusted certificate, not a self-signed one.
    _ssl_opts = {"ssl_cert_reqs": ssl.CERT_REQUIRED}
    celery_app.conf.broker_use_ssl = _ssl_opts
    celery_app.conf.redis_backend_use_ssl = _ssl_opts

celery_app.conf.beat_schedule = {
    "deposit-sweep": {
        "task": "app.workers.deposit_sweep.run_deposit_sweep",
        # Every 2 hours (was twice daily) — this is the unconditional
        # backstop for a deposit whose live 20-minute watch (see
        # live_deposit_watch.py) was never started or ran out, not the fast
        # path most deposits actually take. Tightened from a 12-hour worst
        # case down to a 2-hour one specifically for that gap, since it costs
        # almost nothing to run this often: since chain_watcher_service.
        # _scan_tron queries TronGrid per KNOWN ADDRESS (not per user active
        # right now), the cost of a tick scales with how many deposit
        # addresses exist total, not with deposit volume — at this project's
        # hobby-project address count, even a much shorter interval than
        # this would still be nowhere near TronGrid's rate limit or
        # Upstash's request budget. Revisit this number (or move to a
        # smarter push/webhook-based design) only if the total address count
        # ever grows into the hundreds+.
        "schedule": 2 * 60 * 60.0,
    },
    "bot-engine-sweep": {
        "task": "app.workers.bot_engine.run_bot_engine_sweep",
        # A plain number here (not crontab(...)) means "run every N
        # seconds" — Celery beat supports both styles. 15 seconds is a
        # DEMO-friendly interval, deliberately fast so you can actually
        # watch a paper Grid bot make trades in a reasonable amount of time
        # instead of waiting on bots.interval_seconds (the real, later,
        # per-bot configurable value). To slow this down, just change the
        # number below — nothing else needs to change.
        "schedule": 15.0,
    },
    "simulated-bot-engine-sweep": {
        "task": "app.workers.simulated_bot_engine.run_simulated_bot_engine_sweep",
        # A bot with a session actively revealing (see
        # simulated_bot_engine.py's module docstring for the two-phase
        # start/reveal design) inserts whatever fills are newly due EVERY
        # tick — so this interval is directly "how chunky the live fill
        # stream looks", not just a polling-cost tradeoff. 10s keeps fills
        # landing in reasonably small, frequent bursts across a session's
        # full length instead of a few big jumps. Most ticks for most bots
        # are still a cheap no-op (nothing due), so this can run this often
        # without meaningfully adding load. Lower it further for an even
        # smoother reveal; raise it if 10s ever proves too chatty.
        "schedule": 10.0,
    },
}

# autodiscover_tasks only looks for a `tasks.py` submodule per package by
# convention, which doesn't match this project's one-file-per-task-module
# layout — it was silently finding nothing. Explicit imports here are what
# actually register every task on this app, mirroring how main.py explicitly
# imports and includes each router rather than relying on discovery magic.
# Import at the bottom (not the top) because these modules import celery_app
# from this same file.
from app.workers import (  # noqa: E402,F401
    bot_engine,
    consolidate_deposits,
    deposit_sweep,
    live_deposit_watch,
    simulated_bot_engine,
)
