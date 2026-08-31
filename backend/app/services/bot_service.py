# Small helpers for creating/reading `bots` rows. This is deliberately thin —
# it does NOT yet include the real bot-creation wizard's validation (fee
# charging, the $50-minimum UI gate, etc. — that's module 3.7, later). Right
# now it exists just so the Grid strategy engine (grid.py) and the demo
# script that seeds a paper bot have a real, shared way to create/read a bot
# row, instead of each writing its own raw Supabase calls.

from app.services import notification_service
from app.services.supabase_client import get_supabase

# Same "fetch the whole small lookup table once, cache it in a plain dict"
# pattern used in auth_service.py and wallet_service.py — see either of
# those files for the full reasoning (short version: a plain dict, not
# lru_cache, so a transient failure doesn't get permanently remembered).
_strategy_type_cache: dict[str, int] = {}
_bot_status_cache: dict[str, int] = {}


def _strategy_type_id(code: str) -> int:
    # code is one of 'GRID' | 'DCA' | 'MOMENTUM' | 'CUSTOM' — see the
    # bot_strategy_types seed data in quantex-schema.sql.
    if not _strategy_type_cache:
        rows = get_supabase().table("bot_strategy_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'bot_strategy_types' returned no rows")
        _strategy_type_cache.update({row["code"]: row["id"] for row in rows})
    return _strategy_type_cache[code]


def _bot_status_id(code: str) -> int:
    # code is one of 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'SESSION_CAPPED' | 'ERROR'.
    if not _bot_status_cache:
        rows = get_supabase().table("bot_statuses").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'bot_statuses' returned no rows")
        _bot_status_cache.update({row["code"]: row["id"] for row in rows})
    return _bot_status_cache[code]


# The reverse direction of _strategy_type_cache (id -> code instead of code ->
# id). The engine sweep (bot_engine.py) reads bots by row, which only has
# strategy_type_id (a number) — it needs the code back to decide which
# strategy module (grid.py, dca.py, ...) to hand the bot to.
_strategy_type_code_cache: dict[int, str] = {}


def strategy_type_code(strategy_type_id: int) -> str:
    if not _strategy_type_code_cache:
        rows = get_supabase().table("bot_strategy_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'bot_strategy_types' returned no rows")
        _strategy_type_code_cache.update({row["id"]: row["code"] for row in rows})
    return _strategy_type_code_cache[strategy_type_id]


def create_bot(
    user_id: str,
    strategy_type_code: str,
    pair: str,
    allocation_asset_id: int,
    allocation_amount: float,
    interval_seconds: int,
    config: dict,
    is_paper: bool,
    is_simulated: bool = False,
) -> str:
    """Inserts a new bots row and returns its id. Starts life ACTIVE — there's
    no draft/pending state in this schema, a bot is either running or it
    isn't. `config` is a plain dict here; it gets stored as-is into the
    `config JSONB` column, so whatever the strategy engine (e.g. grid.py)
    needs to remember between ticks (grid lines, per-level holding state,
    running P&L, ...) belongs in here — see grid.py's own comments for
    exactly what it expects to find/write in this dict.

    is_simulated: True for a module-4 scripted bot (see
    simulated_bot_service.py / simulated_bot_engine.py) — mutually exclusive
    with is_paper in practice (is_paper means "real grid engine, notional
    P&L, never touches the ledger"; is_simulated means "scripted P&L, DOES
    touch the real ledger"), but nothing here enforces that combination —
    callers just shouldn't set both."""
    row = {
        "user_id": user_id,
        "strategy_type_id": _strategy_type_id(strategy_type_code),
        "status_id": _bot_status_id("ACTIVE"),
        "pair": pair,
        "allocation_asset_id": allocation_asset_id,
        "allocation_amount": allocation_amount,
        "interval_seconds": interval_seconds,
        "config": config,
        "is_paper": is_paper,
        "is_simulated": is_simulated,
    }
    inserted = get_supabase().table("bots").insert(row).execute()
    bot_id = inserted.data[0]["id"]

    # Notify the bell — see notification_service.py's module docstring for
    # why this call can never raise or block bot creation above, which has
    # already succeeded for real by this point regardless of whether this
    # notification succeeds. Fires for every bot kind (real Grid or
    # simulated) since both funnel through this one function.
    notification_service.create_notification(
        user_id, "BOT_STARTED", "Bot started", f"Your {pair} bot is now running.",
    )

    return bot_id


def get_bot(bot_id: str) -> dict | None:
    rows = get_supabase().table("bots").select("*").eq("id", bot_id).limit(1).execute().data
    return rows[0] if rows else None


def set_bot_status(bot_id: str, status_code: str) -> None:
    """Flips a bot's status — currently only used by simulated_bot_engine.py
    to move a bot to SESSION_CAPPED once it's run its allotted sessions (see
    simulated_bot_service.MAX_SESSIONS). status_code is one of the codes
    listed on _bot_status_id's comment above."""
    get_supabase().table("bots").update({"status_id": _bot_status_id(status_code)}).eq("id", bot_id).execute()


def update_bot_config(bot_id: str, config: dict) -> None:
    """Overwrites the bot's entire config JSONB with a new dict. The strategy
    engine calls this every tick to persist its updated state (e.g. which
    grid levels are currently "holding" a simulated position) — always pass
    the FULL config dict here, not just the changed keys, since this is a
    plain overwrite, not a merge.

    Only call this directly when nothing else could be racing the write
    (e.g. POST /{id}/stop's own close-out, which runs at a point where this
    bot's ACTIVE status was just confirmed a moment earlier in the same
    request). An engine sweep tick, which reads a bot's row and only writes
    its result back several steps later, should use
    update_bot_config_if_active() below instead — see its docstring for why."""
    get_supabase().table("bots").update({"config": config}).eq("id", bot_id).execute()


def update_bot_config_if_active(bot_id: str, config: dict) -> bool:
    """The race-safe version of update_bot_config() above, for the two engine
    sweeps (bot_engine.py, simulated_bot_engine.py). Both read a bot's full
    row at the START of a tick, spend some time computing that tick's result
    (a price lookup, looping grid levels, generating fills), and only THEN
    write the updated config back — which leaves a real gap where a user's
    Stop click (routers/bots.py's POST /{id}/stop) can land in between: it
    reads the bot ACTIVE, closes/settles everything, and sets status
    STOPPED, all before the sweep's own write finally happens. A plain
    update_bot_config() at that point would blindly overwrite the column
    with the sweep's STALE result — computed from before the stop — silently
    erasing the stop's close-out (e.g. reviving a position Stop had just
    closed) even though the stop's ledger credit/debit and bot_fills rows
    had already happened for real. This was caught live during testing: a
    sweep tick landed a BUY fill microseconds after a Stop call, using the
    bot's pre-stop state.

    The fix is the .eq("status_id", ...) below — one atomic SQL statement,
    not a Python read-then-check-then-write (which would just move the race
    a few lines rather than close it). If the bot's status_id no longer
    equals ACTIVE by the moment Postgres actually runs this UPDATE, the
    WHERE clause simply matches zero rows and the write silently doesn't
    happen — Postgres itself is what makes this atomic, not application code.

    Returns True if the write applied, False if it was dropped because the
    bot was no longer ACTIVE. Callers must treat False as "someone else
    (almost always: a user's Stop click) already decided this bot's fate —
    drop this tick's result," not as an error worth raising or logging loud."""
    active_id = _bot_status_id("ACTIVE")
    result = (
        get_supabase()
        .table("bots")
        .update({"config": config})
        .eq("id", bot_id)
        .eq("status_id", active_id)
        .execute()
    )
    return len(result.data) > 0


def list_active_bots() -> list[dict]:
    """Every bot the engine sweep (bot_engine.py) should evaluate this tick.
    Filtering by status_id here (rather than fetching everything and
    filtering in Python) means a PAUSED or STOPPED bot costs nothing extra
    per sweep — it's simply never returned."""
    active_id = _bot_status_id("ACTIVE")
    return get_supabase().table("bots").select("*").eq("status_id", active_id).execute().data


def list_bots_for_user(user_id: str) -> list[dict]:
    """Every bot (any status) belonging to one user — this is what the
    bots-list screen in the frontend reads. Different from
    list_active_bots() above, which is status-filtered and user-agnostic
    (it's for the engine, not for a person looking at their own bots)."""
    return get_supabase().table("bots").select("*").eq("user_id", user_id).execute().data


# Reverse lookup for bot_status_id -> code, same idea as strategy_type_code()
# above — the frontend wants a readable status string ("ACTIVE"), not the
# raw numeric status_id a `bots` row actually stores.
_bot_status_code_cache: dict[int, str] = {}


def bot_status_code(status_id: int) -> str:
    if not _bot_status_code_cache:
        rows = get_supabase().table("bot_statuses").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'bot_statuses' returned no rows")
        _bot_status_code_cache.update({row["id"]: row["code"] for row in rows})
    return _bot_status_code_cache[status_id]
