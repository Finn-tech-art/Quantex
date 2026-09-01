# Reads/writes the free-tier session limits added in migration
# 017_free_tier_session_limits.sql — a single per-user knob
# (users.daily_session_limit) that gates two separate things for a simulated
# bot:
#   1. Session LENGTH at creation time — a user still on the default limit
#      can only pick a session_length_minutes <= FREE_TIER_MAX_SESSION_
#      LENGTH_MINUTES (see is_free_tier() and simulated_bot_service.
#      create_simulated_bot, which calls it).
#   2. Session COUNT per UTC day — a user can only START (generate a fresh
#      win/loss result for) up to daily_session_limit sessions per day,
#      counted across every bot they own, not per bot — see
#      sessions_started_today()/record_session_started() and
#      simulated_bot_engine._start_new_session, which calls both.
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
    """Checked BEFORE generate_fake_trading_result() runs for a new session
    (see simulated_bot_engine._start_new_session) — so a user who's already
    used up today's budget never has a session generated for them at all,
    not just blocked from having it recorded afterward."""
    return sessions_started_today(user_id) < daily_session_limit


def record_session_started(user_id: str) -> int:
    """Atomically bumps today's count for user_id and returns the new total —
    called once a session has actually been saved as the bot's new
    pending_session (i.e. AFTER simulated_bot_service.start_pending_session
    returns True), never speculatively before that, so a session that lost
    the Stop-click race (see that function's own docstring) never consumes a
    slot from the day's budget for nothing."""
    result = get_supabase().rpc(
        "increment_daily_session_count",
        {"p_user_id": user_id, "p_session_date": today_utc().isoformat()},
    ).execute()
    return result.data
