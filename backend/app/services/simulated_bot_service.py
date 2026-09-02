# Creation + config bookkeeping for module-4 "simulated" bots — the
# persistent, scripted-win-rate counterpart to the one-shot FakeSessionPage
# demo. A simulated bot's `config` JSONB holds everything
# simulated_bot_engine.py needs between sweeps, under the "simulated" key
# (parallel to how grid.py keeps its own state under bot["config"]["grid"]).
#
# A session is a two-phase thing, not an instant one — see
# simulated_bot_engine.py's module comment for the full reasoning. This file
# owns the two pieces of that state that live in config.simulated:
#   - "pending_session": the session currently playing out in real time (its
#     full fill schedule was decided the moment it started — the win/loss
#     outcome is not decided fill-by-fill — but only REVEALED progressively;
#     see build_pending_session()). None when no session is in progress.
#   - sessions_completed / realized_pnl / next_session_due_at: the bot's
#     settled history, updated once a pending session finishes revealing and
#     gets settled — see advance_after_session().

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.services import bot_service, session_limit_service
from app.services.supabase_client import get_supabase

# Same "fetch once, cache in a plain dict" pattern used by every other small
# lookup table in this codebase (see bot_service.py's own comment for the
# full reasoning) — kept as its own private cache here rather than importing
# one of the other services' equivalents, matching how demo_profit_service.py
# and simulated_bot_ledger_service.py each keep their own copy too.
_asset_id_cache: dict[str, int] = {}


def _usdt_asset_id() -> int:
    if not _asset_id_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_id_cache.update({row["code"]: row["id"] for row in rows})
    return _asset_id_cache["USDT"]


def _usdt_balance(user_id: str) -> Decimal:
    """Same single-asset targeted query trading_service._balance() already
    uses rather than wallet_service.get_balances() (which returns every
    asset the user holds, only useful here after filtering down to one) —
    duplicated rather than imported since each of these services keeps its
    own small lookups, same reasoning as _usdt_asset_id() above. Returns 0
    for a user with no balances row at all, same "no row means zero, not an
    error" convention _usdt_asset_id()'s callers already rely on elsewhere
    (a brand-new account has genuinely never had a balances row written for
    it yet)."""
    rows = (
        get_supabase()
        .table("balances")
        .select("amount")
        .eq("user_id", user_id)
        .eq("asset_id", _usdt_asset_id())
        .limit(1)
        .execute()
        .data
    )
    return Decimal(str(rows[0]["amount"])) if rows else Decimal("0")

# App-level floor on top of the DB's own allocation_amount >= 50 CHECK — see
# quantex-schema.sql's comment on bots.allocation_amount for where that
# number comes from. Kept in sync here only so bot creation can return a
# clean 400 instead of a raw Postgres constraint error; change both places
# together if this number ever changes.
MIN_ALLOCATION_AMOUNT = Decimal("50")

# Floor on how often a new scripted session can start. Nothing technical
# requires this — it exists so a user can't accidentally spin a bot that
# hammers the sweep and the ledger every few seconds. Raise/lower this to
# change the fastest a bot can be configured to run.
MIN_INTERVAL_SECONDS = 60

DEFAULT_SESSION_LENGTH_MINUTES = 10
DEFAULT_INTERVAL_SECONDS = 15 * 60  # one scripted session every 15 minutes

# Floor on session_length_minutes — discovered live, not theoretical: a
# 1-minute session gives fake_trading_service.py's real-data trip generator
# too little real time to search in (its buy-offset floor of 15s plus a
# ~90s end buffer leaves almost no room, and the direction-matching search
# window shrinks with it), which can make EVERY trip in a session fail to
# find real price movement in its scripted direction. When that happens,
# generate_fake_trading_result's degenerate-case guard clamps scale to 0
# rather than risk flipping every trip's sign — so the whole session (every
# fill, and the total) shows exactly $0.00 instead of a real result. 5
# minutes gives the generator comfortable real room; raise this further if
# short sessions ever produce a $0.00 result again.
MIN_SESSION_LENGTH_MINUTES = 5

# Ceiling on session_length_minutes, matching CreateBotPage.jsx's
# SESSION_LENGTHS array (5, 10, 30, 60 only, per the product decision to
# drop the longer day/week/month options that used to be offered) — keep
# both this number and that array in sync. Enforced here too, not just in
# the dropdown, so a stale or hand-crafted request can never create a bot
# with a session length the UI no longer offers.
MAX_SESSION_LENGTH_MINUTES = 60

# A simulated bot runs exactly one session and then stops (status flips to
# SESSION_CAPPED, an existing bot_statuses row that already meant exactly
# this). This is deliberate, not a placeholder to raise later: the "3
# sessions a day" free-tier limit is enforced by capping how many TIMES a
# user can create/configure a bot per day (see session_limit_service's
# has_session_budget_today/record_session_started, both called from
# create_simulated_bot below), not by letting one bot keep recurring on its
# own — a session ending is what sends the user back to the creation form to
# configure a new one, which is the step that's actually rate-limited. Raise
# this (or remove the cap entirely, letting next_session_due_at keep
# recurring forever) only if that product decision changes and a single bot
# should be allowed to run multiple sessions unattended again.
MAX_SESSIONS = 1


def build_initial_simulated_config(session_length_minutes: int) -> dict:
    """The starting `config` for a new simulated bot. next_session_due_at is
    set to right now — a freshly created bot starts its first scripted
    session on the very next simulated-bot-engine sweep, rather than waiting
    a full interval_seconds first."""
    return {
        "simulated": {
            "session_length_minutes": session_length_minutes,
            "next_session_due_at": datetime.now(tz=timezone.utc).isoformat(),
            "pending_session": None,
            "sessions_completed": 0,
            # Sum of pnl actually APPLIED to the real balance (see
            # simulated_bot_ledger_service.settle_simulated_session) — a
            # session whose debit was skipped for insufficient balance does
            # not change this, so it always matches what really happened to
            # the user's balance because of this bot.
            "realized_pnl": "0",
        }
    }


def create_simulated_bot(
    user_id: str,
    pair: str,
    allocation_amount: Decimal,
    session_length_minutes: int = DEFAULT_SESSION_LENGTH_MINUTES,
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
) -> str:
    """allocation_asset_id is deliberately not a parameter here — every
    simulated bot is funded in USDT (same asset the demo/ledger crediting
    already assumes throughout this codebase), so this resolves it itself
    rather than asking every caller (currently just routers/bots.py) to look
    it up."""
    if allocation_amount < MIN_ALLOCATION_AMOUNT:
        raise ValueError(f"allocation_amount must be >= {MIN_ALLOCATION_AMOUNT}")
    # A simulated bot's allocation_amount is never actually debited from the
    # user's real balance at creation time (unlike a withdrawal, there's no
    # BOT_ALLOCATION ledger entry written anywhere in this codebase yet — it
    # only ever functions as the notional base the session's scripted
    # return_pct is multiplied against, see fake_trading_service.
    # generate_fake_trading_result's target_total_pnl). Without this check a
    # bot could still be created with an allocation far larger than the user
    # actually has, which would go on to compute a plausible-looking but
    # fictitious P&L against money that was never really there — so balance
    # is still checked, even though it's never moved. Read fresh right here
    # rather than trusting anything the frontend sent, since balance can
    # change between page load and submit.
    current_balance = _usdt_balance(user_id)
    if allocation_amount > current_balance:
        raise ValueError(
            f"allocation_amount ({allocation_amount}) exceeds your available balance ({current_balance} USDT)"
        )
    if interval_seconds < MIN_INTERVAL_SECONDS:
        raise ValueError(f"interval_seconds must be >= {MIN_INTERVAL_SECONDS}")
    if session_length_minutes < MIN_SESSION_LENGTH_MINUTES:
        raise ValueError(f"session_length_minutes must be >= {MIN_SESSION_LENGTH_MINUTES}")
    if session_length_minutes > MAX_SESSION_LENGTH_MINUTES:
        raise ValueError(f"session_length_minutes must be <= {MAX_SESSION_LENGTH_MINUTES}")

    # Free-tier length cap — see session_limit_service's module comment for
    # why this and the daily-configuration-count cap right below it are both
    # driven by the same users.daily_session_limit column.
    daily_session_limit = session_limit_service.get_daily_session_limit(user_id)
    if (
        session_limit_service.is_free_tier(daily_session_limit)
        and session_length_minutes > session_limit_service.FREE_TIER_MAX_SESSION_LENGTH_MINUTES
    ):
        raise ValueError(
            f"session_length_minutes must be <= {session_limit_service.FREE_TIER_MAX_SESSION_LENGTH_MINUTES} "
            "for a free-tier account"
        )

    # Free-tier daily cap — checked HERE, at creation/configuration time, not
    # in simulated_bot_engine.py. Since MAX_SESSIONS above is 1, "create a
    # bot" and "start its one and only session" are effectively the same
    # event from the user's side — configuring a new bot IS how a user
    # starts another session once their last one's length has elapsed and
    # the previous bot capped. So this is the one and only place that needs
    # to gate the count; the engine doesn't need its own check.
    if not session_limit_service.has_session_budget_today(user_id, daily_session_limit):
        # hours_until_reset() gives the actual real-time gap to the next UTC
        # midnight, not a generic "tomorrow" — a user hitting this at 23:50
        # UTC sees "resets in 1 hour", one hitting it at 00:05 UTC sees
        # "resets in 24 hours", both accurate at the moment they're shown.
        hours_left = session_limit_service.hours_until_reset()
        raise ValueError(
            f"You've already configured {daily_session_limit} bot session(s) today. "
            f"Resets in {hours_left} hour{'s' if hours_left != 1 else ''} (midnight UTC)."
        )

    config = build_initial_simulated_config(session_length_minutes)

    bot_id = bot_service.create_bot(
        user_id=user_id,
        strategy_type_code="GRID",  # see migration 007's comment on why this stays GRID
        pair=pair,
        allocation_asset_id=_usdt_asset_id(),
        allocation_amount=float(allocation_amount),
        interval_seconds=interval_seconds,
        config=config,
        is_paper=False,
        is_simulated=True,
    )
    # Only consumed once the bot has actually, successfully been created —
    # an unrelated failure inside bot_service.create_bot above (a DB error,
    # say) must never cost the user a slot for a bot that doesn't exist.
    session_limit_service.record_session_started(user_id)
    return bot_id


def build_pending_session(fake_result: dict) -> dict:
    """Turns one generate_fake_trading_result() call into a pending_session
    dict — called once, the moment a session STARTS. The win/loss outcome
    and every fill's price/quantity/pnl are already fully decided right
    here (same deterministic generation as before); what's NOT decided yet
    is when each fill becomes visible — that's simulated_bot_engine.py's
    job, revealing fills[i] once real elapsed time reaches its
    offset_seconds, same pacing the demo's frontend timer used to fake on
    its own.

    THINKING entries are dropped here (bot_fills.side's CHECK constraint
    only allows BUY/SELL — see quantex-schema.sql) — same behavior as the
    original instant-settle engine had."""
    detail = fake_result["detail"]
    fills = sorted(
        (
            {
                "side": f["side"],
                "price": f["price"],
                "quantity": f["quantity"],
                "reasoning_text": f["reasoning_text"],
                "trade_pnl": f["trade_pnl"],
                "offset_seconds": f["simulated_offset_seconds"],
            }
            for f in fake_result["fills"]
            if f["side"] in ("BUY", "SELL")
        ),
        key=lambda f: f["offset_seconds"],
    )
    return {
        "session_id": detail["id"],
        "total_pnl": detail["total_pnl"],
        "session_length_minutes": detail["_session_length_minutes"],
        "session_start": datetime.now(tz=timezone.utc).isoformat(),
        "fills": fills,
        # How many of `fills` (in order) have already been inserted into
        # bot_fills / published over the WS — simulated_bot_engine.py's
        # cursor into this list.
        "fills_revealed_count": 0,
    }


def start_pending_session(bot: dict, pending_session: dict) -> bool:
    """Persists a freshly-built pending_session onto the bot — called once,
    right when a session starts. next_session_due_at is cleared while a
    session is in progress (there's nothing to be "next due" — see
    simulated_bot_engine._is_session_due, which only ever looks at a bot
    with no pending_session).

    last_session_started_at/last_session_length_minutes are a small,
    separate copy of the same two values — UNLIKE pending_session, these are
    never cleared once the session finishes, so routers/bots.py can still
    render a "session complete" progress bar (100%, frozen) after the fact
    instead of the bar just vanishing the instant it settles. See
    BotDetailResponse.session_started_at's comment for how the frontend
    tells "in progress" from "complete" (bots.status, not these fields).

    Guarded (update_bot_config_if_active) because a user could click Stop in
    the narrow window between simulated_bot_engine.py deciding a new
    session's full result (generate_fake_trading_result — real, already-
    decided math) and this write persisting it. Returns True if the session
    actually got saved, False if a Stop won that race — the caller should
    treat False as "this session never really started," not retry it."""
    full_config = bot["config"]
    sim = full_config["simulated"]
    sim["pending_session"] = pending_session
    sim["next_session_due_at"] = None
    sim["last_session_started_at"] = pending_session["session_start"]
    sim["last_session_length_minutes"] = pending_session["session_length_minutes"]
    full_config["simulated"] = sim
    return bot_service.update_bot_config_if_active(bot["id"], full_config)


def save_reveal_progress(bot: dict, sim: dict) -> bool:
    """Persists sim["pending_session"]["fills_revealed_count"] after
    simulated_bot_engine.py has inserted some newly-due fills this tick, but
    the session isn't fully revealed/settled yet — a plain, no-side-effects
    config save, guarded the same way start_pending_session is above (a Stop
    click closing this exact session out from under this tick). Returns True
    if the write applied, False if a Stop won the race — the fills already
    inserted this tick stay in bot_fills either way (harmless, real money
    only ever moves via the explicit ledger settlement calls, not this)."""
    full_config = bot["config"]
    full_config["simulated"] = sim
    return bot_service.update_bot_config_if_active(bot["id"], full_config)


def finish_session(bot: dict, sim: dict, applied_pnl: Decimal) -> tuple[bool, bool]:
    """Called once a pending session has fully revealed all its fills and
    its nominal session length has elapsed — clears pending_session and
    folds the settled result into sessions_completed/realized_pnl, same
    bookkeeping the old single-tick advance_after_session() used to do.

    Returns (applied, is_capped):
      - applied: False if a Stop click won the race and closed this exact
        session out from under this tick (see update_bot_config_if_active's
        docstring) — the caller should NOT also flip bots.status_id in that
        case, since Stop already did (to STOPPED, not SESSION_CAPPED).
      - is_capped: True if this bot has now hit MAX_SESSIONS and should be
        capped (caller, simulated_bot_engine.py, is what actually flips
        bots.status_id — this function only touches config) — False if
        another session should still be scheduled via next_session_due_at.
        Only meaningful when applied is True."""
    sim["sessions_completed"] = sim.get("sessions_completed", 0) + 1
    sim["realized_pnl"] = str(Decimal(sim.get("realized_pnl", "0")) + applied_pnl)
    sim["pending_session"] = None

    is_capped = sim["sessions_completed"] >= MAX_SESSIONS
    if is_capped:
        # No more sessions for this bot — see MAX_SESSIONS' comment. Leave
        # next_session_due_at as None; there's nothing next to schedule.
        sim["next_session_due_at"] = None
    else:
        next_due = datetime.now(tz=timezone.utc) + timedelta(seconds=bot["interval_seconds"])
        sim["next_session_due_at"] = next_due.isoformat()

    full_config = bot["config"]
    full_config["simulated"] = sim
    applied = bot_service.update_bot_config_if_active(bot["id"], full_config)
    return applied, is_capped


def partial_session_pnl(sim: dict) -> Decimal:
    """The REAL total for a pending_session's already-revealed fills only —
    what a user watching this bot's live screen actually saw happen so far.
    This is deliberately NOT pending_session["total_pnl"] (the full scripted
    outcome for every fill in the session, decided up front the moment it
    started — see build_pending_session's docstring), because that number
    includes fills that haven't been revealed yet and, if the session had
    kept running, might not have fired for several more minutes. Only a
    fill's own trade_pnl counts (set on SELLs, always None on a BUY — a buy
    alone never realizes anything), summed across fills[:fills_revealed_count].

    Called by routers/bots.py's POST /{id}/stop right before it settles the
    real ledger for an early stop, so a user who stops 30 seconds into a
    10-minute session is only credited/debited for the handful of fills that
    genuinely already happened, not the session's eventual full result."""
    pending = sim["pending_session"]
    revealed = pending["fills"][: pending["fills_revealed_count"]]
    return sum(
        (Decimal(f["trade_pnl"]) for f in revealed if f["trade_pnl"] is not None),
        Decimal("0"),
    )


def stop_pending_session(bot: dict, sim: dict, applied_pnl: Decimal) -> None:
    """The user-initiated-stop counterpart to finish_session() above — called
    by routers/bots.py's POST /{id}/stop when a session is actively
    revealing at the moment a user clicks Stop. `applied_pnl` is whatever the
    ledger settlement (using partial_session_pnl(), not the full scripted
    total) actually applied to the real balance — same "caller settles the
    ledger first, this function only updates bookkeeping" split finish_session
    uses.

    Unlike finish_session, this NEVER schedules a next session (next_session_
    due_at stays None) regardless of MAX_SESSIONS/sessions_completed — a
    user-initiated stop is always terminal for this bot. finish_session only
    stops scheduling once the cap is actually reached, so simply reusing it
    here would risk silently scheduling another session for a stopped bot the
    moment MAX_SESSIONS is ever raised above 1 (see that constant's own
    comment) — this function hard-codes "terminal" instead of deriving it
    from the cap, so that risk doesn't exist."""
    sim["sessions_completed"] = sim.get("sessions_completed", 0) + 1
    sim["realized_pnl"] = str(Decimal(sim.get("realized_pnl", "0")) + applied_pnl)
    sim["pending_session"] = None
    sim["next_session_due_at"] = None

    full_config = bot["config"]
    full_config["simulated"] = sim
    bot_service.update_bot_config(bot["id"], full_config)


def cancel_scheduled_session(bot: dict, sim: dict) -> None:
    """The user-initiated-stop counterpart for a bot that's ACTIVE but
    currently BETWEEN sessions (no pending_session — see start_pending_session's
    comment on when that's None) — there's nothing to settle since no fills
    have happened yet, just a future session waiting on next_session_due_at
    that should never fire now that the bot is being stopped. A plain config
    write, no ledger involvement, unlike stop_pending_session above."""
    sim["next_session_due_at"] = None
    full_config = bot["config"]
    full_config["simulated"] = sim
    bot_service.update_bot_config(bot["id"], full_config)
