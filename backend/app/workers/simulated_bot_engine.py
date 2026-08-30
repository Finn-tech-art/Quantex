# The Celery task that runs every module-4 "simulated" bot's session — the
# persistent counterpart to bot_engine.py (which only ever handles real
# is_simulated=False Grid bots; see its own `if bot.get("is_simulated"):
# return` guard — this is a SEPARATE sweep so a simulated bot is never
# handed to grid.py's real tick engine, which expects a bot["config"]["grid"]
# shape this bot's config doesn't have).
#
# A session is a TWO-PHASE thing:
#   1. START — the moment a session becomes due, generate_fake_trading_result()
#      runs ONCE and decides everything: the win/loss outcome, every fill's
#      price/quantity/pnl. Nothing about that is revealed gradually — it's
#      all real, deterministic math finished up front, same as before this
#      module existed. What's saved is a "pending_session" (see
#      simulated_bot_service.build_pending_session) — a fill schedule, not
#      yet inserted anywhere.
#   2. REVEAL — every sweep tick after that, for as long as the pending
#      session's nominal session_length_minutes hasn't elapsed yet, whichever
#      of its fills have reached their scheduled offset_seconds get inserted
#      into bot_fills and pushed over this bot's WS channel — exactly the
#      real BUY/SELL fills a user watching FakeSessionPage.jsx's demo would
#      see stream in, except these are real fills on a real persistent bot,
#      arriving because real time actually passed, not a frontend-only
#      playback animation over an already-decided outcome.
# Once every fill has been revealed AND the session's nominal length has
# elapsed, the session settles (real ledger credit/debit, exactly once) and
# — per simulated_bot_service.MAX_SESSIONS — the bot is capped (status ->
# SESSION_CAPPED) rather than scheduling another one, for now.

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

from app.services import bot_fill_service, bot_service, simulated_bot_service, win_rate_service
from app.services.fake_trading_service import generate_fake_trading_result
from app.services.redis_client import get_redis_sync
from app.services.simulated_bot_ledger_service import settle_simulated_session
from app.services.strategies.grid import bot_channel
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _publish_fill(bot_id: str, side: str, price: Decimal, quantity: Decimal, reasoning_text: str) -> None:
    # Same channel/message shape as grid.py's own (private) _publish_fill —
    # duplicated here in full rather than importing that underscore-prefixed
    # helper across module boundaries; bot_channel() itself IS the shared,
    # public piece both engines are meant to agree on.
    get_redis_sync().publish(
        bot_channel(bot_id),
        json.dumps(
            {
                "side": side,
                "price": str(price),
                "quantity": str(quantity),
                "reasoning_text": reasoning_text,
            }
        ),
    )


def _publish_thinking(bot_id: str, reasoning_text: str) -> None:
    # Same channel/shape family as _publish_fill above, but with no
    # price/quantity — this never becomes a bot_fills row (see this
    # module's own docstring: THINKING is dropped before persisting), it's
    # purely a live WS push for whoever's watching right now. The
    # {"side": "THINKING", "reasoning_text": ...} shape is exactly what
    # ExecutionLogEntry (frontend/src/components/ExecutionLog.jsx) already
    # renders as an italic paragraph — that branch existed for the
    # FakeSessionPage.jsx demo and was otherwise unused by any real bot
    # until this function started calling it.
    get_redis_sync().publish(
        bot_channel(bot_id),
        json.dumps({"side": "THINKING", "reasoning_text": reasoning_text}),
    )


# How often (in seconds) an idle mid-session tick gets a "thinking" line —
# raise/lower this single number to make narration sparser/chattier. Kept
# stateless (no "last spoke at" persisted anywhere) by firing on whichever
# sweep tick's elapsed_seconds falls in the FIRST _sweep-interval-sized_
# slice of each interval window below — see _should_think_this_tick.
_THINKING_INTERVAL_SECONDS = 30

# Must be >= the real simulated-bot-engine-sweep schedule (10s — see
# celery_app.py's beat_schedule) so exactly one tick per
# _THINKING_INTERVAL_SECONDS window lands inside this slice, never zero and
# never two, regardless of small scheduling jitter between ticks.
_SWEEP_INTERVAL_SECONDS = 10


def _should_think_this_tick(elapsed_seconds: float) -> bool:
    return int(elapsed_seconds) % _THINKING_INTERVAL_SECONDS < _SWEEP_INTERVAL_SECONDS


# Rotates through a handful of session-state-aware lines rather than
# repeating the exact same sentence every _THINKING_INTERVAL_SECONDS — which
# template plays is picked deterministically from elapsed time (not random),
# so it varies tick-to-tick without needing its own persisted state either.
# Add more entries here for more variety; each is called with pair,
# remaining (fills left this session), minutes_left (float).
_THINKING_TEMPLATES = [
    "Still watching {pair} — {remaining} fill{plural} left to play out over the next {minutes_left:.0f} min.",
    "No new signal on {pair} yet. Holding position while the next few minutes unfold.",
    "{minutes_left:.0f} minutes left in this session, {remaining} fill{plural} still scheduled.",
    "Nothing has crossed the next threshold on {pair} yet — staying put for now.",
]


def _generate_thinking_text(bot: dict, pending: dict, elapsed_seconds: float) -> str:
    remaining = len(pending["fills"]) - pending["fills_revealed_count"]
    minutes_left = max(0.0, (pending["session_length_minutes"] * 60 - elapsed_seconds) / 60)
    template_index = int(elapsed_seconds // _THINKING_INTERVAL_SECONDS) % len(_THINKING_TEMPLATES)
    return _THINKING_TEMPLATES[template_index].format(
        pair=bot["pair"],
        remaining=remaining,
        plural="" if remaining == 1 else "s",
        minutes_left=minutes_left,
    )


def _publish_session_started(bot_id: str) -> None:
    """A session STARTING publishes nothing on its own otherwise — only
    individual fills do, via _publish_fill above — so a bot-detail screen
    open at the moment a fresh session starts had no signal to react to
    until its first fill landed, which can be up to ~90s in (see
    simulated_bot_service.MIN_SESSION_LENGTH_MINUTES's comment on
    fake_trading_service's buy-offset floor). Until then, session_started_at
    stayed None in the API response, so BotDetailPage.jsx's progress bar
    guard (`detail.session_started_at && ...`) never rendered — which is
    exactly what looked like "the timer isn't working" for a freshly
    created bot. BotDetailPage.jsx's ws.onmessage just calls refresh() on
    ANY message regardless of its content, so this only needs to exist —
    the payload shape doesn't matter, unlike _publish_fill's."""
    get_redis_sync().publish(bot_channel(bot_id), json.dumps({"event": "session_started"}))


@celery_app.task(name="app.workers.simulated_bot_engine.run_simulated_bot_engine_sweep")
def run_simulated_bot_engine_sweep() -> None:
    for bot in bot_service.list_active_bots():
        if not bot.get("is_simulated"):
            continue
        try:
            _evaluate_one_simulated_bot(bot)
        except Exception:
            # Same "isolate failures per item" principle as
            # bot_engine.run_bot_engine_sweep — one bot's bad config or a
            # transient Binance/Supabase error must never stop every OTHER
            # simulated bot from being checked this tick.
            logger.exception("Simulated bot engine sweep failed for bot %s", bot["id"])


def _is_session_due(bot: dict) -> bool:
    sim = bot["config"].get("simulated")
    if not sim:
        logger.warning("Simulated bot %s has is_simulated=True but no config.simulated — skipping", bot["id"])
        return False
    next_due_raw = sim.get("next_session_due_at")
    if next_due_raw is None:
        # Either mid-session (pending_session owns this tick instead — see
        # _evaluate_one_simulated_bot) or capped (MAX_SESSIONS reached, no
        # next session was ever scheduled) — either way, not due.
        return False
    return datetime.now(tz=timezone.utc) >= datetime.fromisoformat(next_due_raw)


def _evaluate_one_simulated_bot(bot: dict) -> None:
    sim = bot["config"].get("simulated")
    if not sim:
        logger.warning("Simulated bot %s has is_simulated=True but no config.simulated — skipping", bot["id"])
        return

    if sim.get("pending_session") is not None:
        _advance_pending_session(bot, sim)
    elif _is_session_due(bot):
        _start_new_session(bot, sim)


def _start_new_session(bot: dict, sim: dict) -> None:
    today_rate = win_rate_service.get_today_win_rate()
    result = generate_fake_trading_result(
        target_min_return=today_rate["target_min_return"],
        win_rate=today_rate["win_rate"],
        session_length_minutes=sim["session_length_minutes"],
        allocation_amount=float(bot["allocation_amount"]),
        pair=bot["pair"],
    )
    pending_session = simulated_bot_service.build_pending_session(result)
    applied = simulated_bot_service.start_pending_session(bot, pending_session)
    if not applied:
        # A Stop click landed between this tick reading the bot as ACTIVE
        # and this write — see update_bot_config_if_active's docstring.
        # Nothing was persisted, so there's nothing to log as "started".
        logger.info("Simulated bot %s stopped before its new session could be saved — dropped", bot["id"])
        return
    _publish_session_started(bot["id"])
    logger.info(
        "Simulated bot %s started session %s — %d fills scheduled over %d minutes",
        bot["id"], pending_session["session_id"], len(pending_session["fills"]), pending_session["session_length_minutes"],
    )


def _advance_pending_session(bot: dict, sim: dict) -> None:
    pending = sim["pending_session"]
    session_start = datetime.fromisoformat(pending["session_start"])
    elapsed_seconds = (datetime.now(tz=timezone.utc) - session_start).total_seconds()

    fills = pending["fills"]
    revealed_count = pending["fills_revealed_count"]

    # Reveal every fill whose scheduled moment has arrived since the last
    # tick — usually 0 or 1 on a tight sweep interval, but a slow tick (or
    # the engine having been down for a bit) can legitimately owe several at
    # once; a plain loop catches up correctly either way rather than only
    # ever revealing one fill per tick.
    newly_revealed = 0
    while revealed_count < len(fills) and fills[revealed_count]["offset_seconds"] <= elapsed_seconds:
        fill = fills[revealed_count]
        price = Decimal(fill["price"])
        quantity = Decimal(fill["quantity"])
        trade_pnl = Decimal(fill["trade_pnl"]) if fill["trade_pnl"] is not None else None

        # Defensive floor: `quantity` is UNITS TRADED, not P&L — it must
        # always be strictly positive regardless of whether the trade made
        # or lost money (a loss is a real quantity at a trade_pnl < 0, which
        # is untouched by this check and stays fully allowed). A quantity of
        # exactly zero means fake_trading_service.generate_fake_trading_result
        # hit its documented degenerate edge case (its own `scale` variable
        # clamped to 0.0 — see that module's "v5" comment) and produced a
        # fill that never actually traded anything. bot_fills.quantity has a
        # `> 0` CHECK constraint that correctly rejects such a row, but
        # without this guard the exception happens before revealed_count
        # advances, so the SAME zero-quantity fill gets retried forever,
        # every sweep tick, rather than the session ever completing. Skip
        # persisting/publishing it as a trade, but still count it as
        # revealed so the session can move on to its next real fill (or
        # finish and settle, in the all-zero case this was first observed
        # in — that session simply settles as a $0.00 wash, same total_pnl
        # the generator had already committed to).
        if quantity <= 0:
            logger.warning(
                "Simulated bot %s: skipping zero-quantity %s fill at offset %ss (generator's scale "
                "clamped to 0 for this session — see fake_trading_service's degenerate-case comment)",
                bot["id"], fill["side"], fill["offset_seconds"],
            )
            revealed_count += 1
            newly_revealed += 1
            continue

        bot_fill_service.record_fill(
            bot_id=bot["id"],
            side=fill["side"],
            price=price,
            quantity=quantity,
            reasoning_text=fill["reasoning_text"],
            binance_order_id=None,  # None = simulated fill, same convention as grid.py's paper mode
            trade_pnl=trade_pnl,
        )
        _publish_fill(bot["id"], fill["side"], price, quantity, fill["reasoning_text"])
        revealed_count += 1
        newly_revealed += 1

    session_length_seconds = pending["session_length_minutes"] * 60
    fully_revealed = revealed_count >= len(fills)
    nominal_time_elapsed = elapsed_seconds >= session_length_seconds

    if fully_revealed and nominal_time_elapsed:
        # Session's done — settle exactly once, then either schedule the
        # next one or cap the bot. See simulated_bot_service.finish_session.
        total_pnl = Decimal(pending["total_pnl"])
        settlement = settle_simulated_session(
            user_id=bot["user_id"],
            bot_id=bot["id"],
            session_id=pending["session_id"],
            total_pnl=total_pnl,
        )
        applied_pnl = settlement["amount"] if settlement["applied"] else Decimal("0")
        config_applied, is_capped = simulated_bot_service.finish_session(bot, sim, applied_pnl)
        if not config_applied:
            # A Stop click already closed this exact session out from under
            # this tick (see update_bot_config_if_active's docstring) — it
            # already set bots.status_id to STOPPED itself, so this tick must
            # NOT also set SESSION_CAPPED over that. The ledger settlement
            # call above is safe either way: settle_simulated_session is
            # idempotent per (bot_id, session_id), so whichever of this tick
            # or the Stop's own settlement actually landed first is the only
            # one that applied real money — the other was a harmless no-op.
            logger.info(
                "Simulated bot %s was stopped before session %s could be marked finished — skipped",
                bot["id"], pending["session_id"],
            )
            return
        if is_capped:
            bot_service.set_bot_status(bot["id"], "SESSION_CAPPED")
        logger.info(
            "Simulated bot %s finished session %s — applied_pnl=%s capped=%s",
            bot["id"], pending["session_id"], applied_pnl, is_capped,
        )
    elif newly_revealed > 0:
        # Mid-session, but at least one fill was newly revealed this tick —
        # persist the advanced cursor so the next tick doesn't re-insert it.
        # If this doesn't apply (Stop won the race), there's nothing more to
        # do — the fills already inserted above just stay as a harmless
        # extra couple of rows; no money moved from this branch either way.
        pending["fills_revealed_count"] = revealed_count
        sim["pending_session"] = pending
        simulated_bot_service.save_reveal_progress(bot, sim)
    elif _should_think_this_tick(elapsed_seconds):
        # Mid-session, nothing new due yet, but it's this window's turn to
        # narrate — nothing to persist (see _publish_thinking's docstring),
        # just a live WS push for anyone watching this bot's page right now.
        _publish_thinking(bot["id"], _generate_thinking_text(bot, pending, elapsed_seconds))
    # else: mid-session, nothing new due and not this tick's thinking window
    # either — nothing to do.
