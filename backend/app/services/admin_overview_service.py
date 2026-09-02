# Backs GET /admin/overview — the admin dashboard's "how's the platform
# doing" screen: today's signup/deposit snapshot, plus a full day-by-day
# history (from the very first signup or deposit through today) that the
# frontend uses for both the calendar heatmap and the line/bar charts.
#
# Same "no snapshot table, derive on demand" philosophy as
# portfolio_history_service.py: this file has no state of its own. It reads
# `users.created_at` for signups and `ledger_entries` (filtered to
# entry_type DEPOSIT) for deposits, and buckets both into UTC calendar days
# in plain Python — no Postgres-side GROUP BY / RPC, matching how every
# other reporting-style read in this codebase (portfolio_history_service.py
# in particular) already does its aggregation: fetch the raw rows, bucket
# them here. Fine at this app's actual scale (a personal project, not a
# platform with millions of rows); if that ever stops being true, this is
# the function to replace with a real SQL aggregate.
#
# Multi-asset caveat: like portfolio_history_service.py and WalletPage.jsx's
# own totalUsd calculation, deposit amounts are summed 1:1 across assets as
# if every asset were USD. That's exactly true today because the only
# assets in play are USDT/USDC (both dollar-pegged stablecoins); it stops
# being exactly true the moment a non-stablecoin asset is added, at which
# point this needs a real price conversion per asset. Flagged here so it
# isn't a silent assumption when that day comes.

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from app.services.supabase_client import get_supabase

# Two decimal places for display — these are USD-notional dollar amounts on
# a dashboard, not a raw ledger row, so unlike a ledger amount (which keeps
# the database's full numeric(20,8) precision) this rounds for readability.
# Same convention portfolio_history_service.py uses for the same reason.
_CENTS = Decimal("0.01")

_entry_type_id_cache: dict[str, int] = {}


def _deposit_entry_type_id() -> int:
    """Same cached-lookup pattern as every other service in this codebase
    (see wallet_service._network_id's comment for the full reasoning) — a
    plain dict, not lru_cache, so a transient DB hiccup on the very first
    call never gets permanently cached as empty."""
    if not _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({r["code"]: r["id"] for r in rows})
    return _entry_type_id_cache["DEPOSIT"]


def _parse_date(raw: str) -> date:
    """Supabase/PostgREST serializes timestamptz columns as ISO-8601 strings
    with a numeric UTC offset — datetime.fromisoformat reads that directly
    (same pattern portfolio_history_service._parse_ts uses), and .date()
    takes just the UTC calendar day, which is the bucketing unit this whole
    module works in."""
    return datetime.fromisoformat(raw).date()


def get_overview() -> dict:
    """Returns {
        "signups_today": int,
        "deposits_today_count": int,
        "deposits_today_amount": str,
        "daily": [ {"date": "YYYY-MM-DD", "signups": int,
                     "deposits_count": int, "deposits_amount": str}, ... ],
        "countries": [ {"country": "US", "signups": int, "active": int}, ... ],
    }

    `daily` covers every UTC calendar day from the earliest signup or
    deposit ever recorded (whichever came first) through today, INCLUSIVE,
    zero-filled for any day with no activity at all — so the frontend's
    calendar heatmap and charts never have to handle gaps themselves. If
    there's no data at all yet, `daily` is a single zero-filled entry for
    today, which is also where signups_today/deposits_today_* come from
    (always daily[-1] by construction, since the range always ends today).

    `countries` is a completely separate, non-time-series breakdown — see
    get_country_breakdown's own docstring for exactly what it counts.
    """
    today = datetime.now(tz=timezone.utc).date()

    signup_rows = get_supabase().table("users").select("created_at").execute().data
    deposit_rows = (
        get_supabase()
        .table("ledger_entries")
        .select("amount,created_at")
        .eq("entry_type_id", _deposit_entry_type_id())
        .execute()
        .data
    )

    signups_by_day: dict[date, int] = defaultdict(int)
    for row in signup_rows:
        signups_by_day[_parse_date(row["created_at"])] += 1

    deposits_count_by_day: dict[date, int] = defaultdict(int)
    deposits_amount_by_day: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in deposit_rows:
        d = _parse_date(row["created_at"])
        deposits_count_by_day[d] += 1
        deposits_amount_by_day[d] += Decimal(str(row["amount"]))

    observed_dates = list(signups_by_day) + list(deposits_count_by_day)
    earliest = min(observed_dates) if observed_dates else today

    daily: list[dict] = []
    d = earliest
    while d <= today:
        daily.append(
            {
                "date": d.isoformat(),
                "signups": signups_by_day.get(d, 0),
                "deposits_count": deposits_count_by_day.get(d, 0),
                "deposits_amount": str(
                    deposits_amount_by_day.get(d, Decimal("0")).quantize(_CENTS, rounding=ROUND_HALF_UP)
                ),
            }
        )
        d += timedelta(days=1)

    today_entry = daily[-1]  # always today's row — the loop above always ends at `today`
    return {
        "signups_today": today_entry["signups"],
        "deposits_today_count": today_entry["deposits_count"],
        "deposits_today_amount": today_entry["deposits_amount"],
        "daily": daily,
        "countries": get_country_breakdown(),
    }


def get_country_breakdown() -> list[dict]:
    """Returns one entry per country that has at least one signup, sorted
    most-signups-first: [{"country": "US", "signups": int, "active": int}, ...].
    `country` is the bare ISO 3166-1 alpha-2 code stored on the user's own
    row (see 013_users_signup_fields.sql) — the router/frontend is what maps
    that to a display name (frontend/src/data/countries.js already carries
    that exact list, built for the signup form's own country dropdown, so
    there's no reason to duplicate a second copy of ~195 country names here
    in Python). A user with no country on file yet (a pre-migration account,
    or a Google OAuth signup that hasn't been through the one-time country
    picker — see ProtectedRoute.jsx's CountryGate) is grouped under the
    literal string "UNKNOWN" rather than dropped, so this total always
    reconciles with the platform's real signup count.

    "active" counts users from that country who have made at least one
    DEPOSIT ledger entry, ever — the plainest, least game-able definition of
    "an account that's actually done something," and the same DEPOSIT
    entry_type this whole module already reads for the deposits side of
    `daily` above.
    """
    users = get_supabase().table("users").select("id,country").execute().data
    deposit_rows = (
        get_supabase()
        .table("ledger_entries")
        .select("user_id")
        .eq("entry_type_id", _deposit_entry_type_id())
        .execute()
        .data
    )
    depositor_ids = {row["user_id"] for row in deposit_rows}

    stats: dict[str, dict] = {}
    for user in users:
        country = user["country"] or "UNKNOWN"
        bucket = stats.setdefault(country, {"country": country, "signups": 0, "active": 0})
        bucket["signups"] += 1
        if user["id"] in depositor_ids:
            bucket["active"] += 1

    return sorted(stats.values(), key=lambda b: b["signups"], reverse=True)
