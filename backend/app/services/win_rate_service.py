# Reads/writes `daily_win_rate_settings` — the admin-controlled knob that
# decides, for a given calendar date, what fraction of scripted trading
# sessions come out as a win (and what return a winning session hits). This
# is what fake_trading_service.generate_fake_trading_result's win_rate /
# target_min_return parameters get their values from now, instead of the
# hardcoded 0.90 / 0.37 defaults it used before this module existed — see
# routers/bots.py's fake_session endpoint for where that wiring happens.
#
# "Today" is always UTC here (date.today() would use the server's local
# clock, which on Railway is UTC anyway, but calling utcnow() explicitly
# means this doesn't silently change behavior if that ever isn't true) — the
# same convention the live chart already commits to (see FakeSessionPage.jsx's
# UTC badge comment).

from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.supabase_client import get_supabase

# Used only when no admin has ever set a rate for the requested date — keeps
# the demo/bot experience working exactly as it did before module 2 existed,
# rather than erroring or defaulting to something surprising like 0% or 100%.
# Change these two numbers to change the out-of-the-box behavior for any date
# an admin hasn't explicitly configured yet.
DEFAULT_WIN_RATE = 0.90
DEFAULT_TARGET_MIN_RETURN = 0.40


def today_utc() -> date:
    return datetime.now(tz=timezone.utc).date()


def get_win_rate_for_date(win_date: date) -> dict:
    """Returns {win_date, win_rate, target_min_return, is_default}. Never
    raises for a date with no row — that's the normal case for any day an
    admin hasn't visited the panel for yet, not an error condition."""
    rows = (
        get_supabase()
        .table("daily_win_rate_settings")
        .select("win_date,win_rate,target_min_return")
        .eq("win_date", win_date.isoformat())
        .limit(1)
        .execute()
        .data
    )
    if rows:
        row = rows[0]
        return {
            "win_date": win_date,
            "win_rate": float(row["win_rate"]),
            "target_min_return": float(row["target_min_return"]),
            "is_default": False,
        }
    return {
        "win_date": win_date,
        "win_rate": DEFAULT_WIN_RATE,
        "target_min_return": DEFAULT_TARGET_MIN_RETURN,
        "is_default": True,
    }


def get_today_win_rate() -> dict:
    return get_win_rate_for_date(today_utc())


def set_win_rate_for_date(
    win_date: date, win_rate: float, target_min_return: float, admin_id: str
) -> dict:
    """Upserts the rate for one date. Decimal(str(...)) round-trip (not the
    raw float) going into the RPC-free .upsert() call here avoids the classic
    float-to-NUMERIC precision drift (e.g. 0.1 not being exactly
    representable in binary float) — the same reason every other
    money/rate-bearing column in this codebase passes Decimal-via-string
    rather than a bare float to Postgres."""
    row = {
        "win_date": win_date.isoformat(),
        "win_rate": str(Decimal(str(win_rate))),
        "target_min_return": str(Decimal(str(target_min_return))),
        "set_by_admin_id": admin_id,
    }
    get_supabase().table("daily_win_rate_settings").upsert(row, on_conflict="win_date").execute()
    return {
        "win_date": win_date,
        "win_rate": win_rate,
        "target_min_return": target_min_return,
        "is_default": False,
    }
