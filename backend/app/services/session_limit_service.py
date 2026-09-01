# Reads/writes the free-tier session limits added in migration
# 017_free_tier_session_limits.sql — a single per-user knob
# (users.daily_session_limit) that gates two separate things, BOTH enforced
# in simulated_bot_service.create_simulated_bot (not in the engine — a
# simulated bot runs exactly one session and then caps, see that file's
# MAX_SESSIONS comment, so "configure a new bot" and "start another session"
# are the same user action):
#   1. Session LENGTH — a user still on the default limit can only pick a
#      session_length_minutes <= FREE_TIER_MAX_SESSION_LENGTH_MINUTES (see
#      is_free_tier()).
#   2. Configuration COUNT per UTC day — a user can only successfully create
#      up to daily_session_limit bots per day, counted across every bot they
#      own, not per bot (a per-bot count would be meaningless anyway once
#      each bot only ever runs once) — see sessions_started_today()/
#      record_session_started().
# An admin raises daily_session_limit above DEFAULT_DAILY_SESSION_LIMIT (via
# the /admin/session-limits endpoints in routers/admin.py) to lift BOTH
# rules for that user at once — there is deliberately no separate flag for
# exempting just one of the two.

from datetime import date, datetime, timezone

from app.services.supabase_client import get_supabase

# The out-of-the-box daily session count every user starts with — matches
# the DB column's own `default 3` in migration 017, kept in sync here only so
# is_free_tier() below has a Python-side number to compare against without a
# round trip to read the column's DDL default. Change both together.
DEFAULT_DAILY_SESSION_LIMIT = 3

# A user at or below DEFAULT_DAILY_SESSION_LIMIT cannot create a bot whose
# session runs longer than this many minutes — see is_free_tier() and
# simulated_bot_service.create_simulated_bot. Deliberately the same 30-minute
# point fake_trading_service.SESSION_LENGTH_FULL_SCALE_MINUTES uses as its
# "full scale" threshold (not imported from there — the two constants
# happening to share a value is a product choice, not a code dependency;
# change one without the other if that's ever no longer wanted).
FREE_TIER_MAX_SESSION_LENGTH_MINUTES = 30


def today_utc() -> date:
    return datetime.now(tz=timezone.utc).date()


def is_free_tier(daily_session_limit: int) -> bool:
    """A user an admin hasn't raised above the out-of-the-box default is
    "free tier" for both the length cap and the daily count cap — see this
    module's header comment for why one column drives both."""
    return daily_session_limit <= DEFAULT_DAILY_SESSION_LIMIT


def get_daily_session_limit(user_id: str) -> int:
    """Every users row always has this column (not-null, defaulted by the
    migration) — a missing row means user_id itself is wrong, which is
    exactly the "let it raise" case, not something to silently default
    around."""
    row = (
        get_supabase()
        .table("users")
        .select("daily_session_limit")
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not row:
        raise ValueError(f"No user found for id {user_id}")
    return row[0]["daily_session_limit"]


def get_user_by_email(email: str) -> dict | None:
    """Backs the admin session-limits page's lookup-by-email box — admins
    think in emails, not UUIDs, same reasoning kyc_service/withdrawal_service
    already resolve user_id -> email for their own admin-facing displays
    (just inverted here: email -> user_id). Returns None (never raises) for
    an unknown email so the router can turn that into a clean 404 rather than
    a 500."""
    rows = (
        get_supabase()
        .table("users")
        .select("id,email,daily_session_limit")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def set_daily_session_limit(user_id: str, daily_session_limit: int) -> dict:
    """A plain column UPDATE, not an upsert — unlike daily_win_rate_settings
    (a settings table where a row might not exist yet for a given date),
    every user always already has a users row with this column defaulted, so
    there's nothing to insert, only ever to change."""
    get_supabase().table("users").update(
        {"daily_session_limit": daily_session_limit}
    ).eq("id", user_id).execute()
    return {"user_id": user_id, "daily_session_limit": daily_session_limit}


def sessions_started_today(user_id: str) -> int:
    """0 for a user with no row for today — see user_daily_session_counts'
    own comment in the migration for why a missing row means zero rather
    than every user getting a pre-created zeroed row for every date."""
    rows = (
        get_supabase()
        .table("user_daily_session_counts")
        .select("count")
        .eq("user_id", user_id)
        .eq("session_date", today_utc().isoformat())
        .limit(1)
        .execute()
        .data
    )
    return rows[0]["count"] if rows else 0


def has_session_budget_today(user_id: str, daily_session_limit: int) -> bool:
    """Checked BEFORE a new bot is created (see simulated_bot_service.
    create_simulated_bot) — so a user who's already used up today's budget
    is rejected at the configuration step itself, with a clear error,
    rather than a bot getting created and then never actually running."""
    return sessions_started_today(user_id) < daily_session_limit


def record_session_started(user_id: str) -> int:
    """Atomically bumps today's count for user_id and returns the new total —
    called once a new bot has actually, successfully been created (see
    simulated_bot_service.create_simulated_bot), never speculatively before
    that, so a request that fails for an unrelated reason never costs the
    user a slot for a bot that doesn't exist."""
    result = get_supabase().rpc(
        "increment_daily_session_count",
        {"p_user_id": user_id, "p_session_date": today_utc().isoformat()},
    ).execute()
    return result.data
