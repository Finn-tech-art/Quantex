# Derives a portfolio balance-over-time chart (for the Home screen's hero
# card, and any future "how has my balance moved" view) WITHOUT a snapshot
# table or a scheduled job -- see quantex-schema.sql's comment on
# `ledger_entries`: balances are single-entry and append-only, so a user's
# balance at any past instant is exactly reconstructible by walking the
# ledger backwards from the current, materialized `balances` total. That
# means this file has no state of its own; it's a pure read-and-derive
# layer over data that already exists, which is also why it can never
# drift out of sync with the real balance the way a periodic snapshot
# worker could.
#
# Multi-asset caveat: like WalletPage.jsx's own totalUsd calculation, this
# sums every asset 1:1 as if it were USD. That's exactly true today because
# the only assets in play are USDT/USDC (both dollar-pegged stablecoins);
# it stops being exactly true the moment a non-stablecoin asset is added,
# at which point this needs a real price conversion per asset. Flagged here
# so it isn't a silent assumption when that day comes.
#
# Intra-session caveat: a simulated bot's profit/loss is only written to
# ledger_entries when its session SETTLES (see
# simulated_bot_ledger_service.settle_simulated_session) -- a session still
# in progress hasn't moved the ledger yet, so this chart won't reflect
# unrealized P&L from a bot that's mid-session. Invisible on a 30-day
# range, more noticeable on "24h".

import logging
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from app.services.supabase_client import get_supabase
from app.services.wallet_service import get_balances

logger = logging.getLogger(__name__)

# How far back each named range looks. "all" is handled separately below
# (it looks back to the user's very first ledger entry, not a fixed
# duration) -- add a new entry here to support another fixed range, e.g.
# "90d": timedelta(days=90).
_RANGE_TO_TIMEDELTA = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
    "180d": timedelta(days=180),
}

# Hard ceiling on how many buckets a caller can request, independent of
# whatever the frontend actually asks for -- protects against a pathological
# request (buckets=1_000_000) doing an absurd amount of looping for no
# visual benefit. The frontend's own default is 12 (matching the design
# spec's "12 candles"); raise this cap only if a screen genuinely needs a
# finer chart than that.
_MAX_BUCKETS = 500

# Two decimal places for display -- these are USD-notional dollar amounts on
# a chart, not a raw ledger row, so unlike BalanceEntry.amount (which keeps
# the database's full numeric(20,8) precision) this rounds for readability.
_CENTS = Decimal("0.01")


def _parse_ts(raw: str) -> datetime:
    """Supabase/PostgREST serializes `timestamptz` columns as ISO-8601
    strings with a numeric UTC offset (e.g. "...+00:00") -- datetime's own
    fromisoformat() reads that directly, same as the existing pattern in
    workers/simulated_bot_engine.py. Centralized here so every parse in
    this file goes through one place."""
    return datetime.fromisoformat(raw)


def get_portfolio_history(user_id: str, range_key: str = "7d", buckets: int = 12) -> list[dict]:
    """Returns `buckets` OHLC points, oldest first, each shaped
    {t, open, high, low, close} -- t is the Unix-seconds START of that
    bucket's window (same "time = open_time" convention bot_chart_service
    already uses), and open/high/low/close are decimal strings.

    range_key: "24h" | "7d" | "30d" | "all". "all" looks back to the
    user's very first ledger entry rather than a fixed duration; a
    brand-new user with no ledger history yet gets a 1-hour window instead
    of a zero-width one, so bucket math below never divides by zero.

    A bucket with no ledger activity carries the previous bucket's close
    forward flat (open == high == low == close) rather than leaving a gap
    -- this is a deliberate choice (see the Home screen design discussion)
    over inventing data or breaking the line.

    To change the default number of candles shown, change the `buckets`
    default here (or have the caller pass a different value) -- nothing
    else in this function depends on 12 specifically.
    """
    range_key = range_key.lower()
    buckets = max(1, min(buckets, _MAX_BUCKETS))
    now = datetime.now(tz=timezone.utc)

    if range_key == "all":
        earliest = (
            get_supabase()
            .table("ledger_entries")
            .select("created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=False)
            .limit(1)
            .execute()
            .data
        )
        range_start = _parse_ts(earliest[0]["created_at"]) if earliest else now - timedelta(hours=1)
    else:
        delta = _RANGE_TO_TIMEDELTA.get(range_key)
        if delta is None:
            raise ValueError(
                f"Unsupported range: {range_key!r} -- expected one of "
                f"{sorted(_RANGE_TO_TIMEDELTA) + ['all']}"
            )
        range_start = now - delta

    # Defensive floor: an "all" range whose single ledger entry landed in
    # the same instant as `now` (a brand-new account, first request racing
    # its own first deposit) would otherwise produce a zero-width window --
    # widen it to 1 minute so the bucket math below never divides by zero.
    if range_start >= now:
        range_start = now - timedelta(minutes=1)

    # The current, materialized total (see get_balances() -- this is the
    # same trigger-maintained `balances` table WalletPage.jsx's totalUsd
    # already sums the same way). This is the one number in this whole
    # function that is NOT derived/approximated -- it's the real, current
    # balance, and every bucket is computed by walking backward/forward
    # from it, which is what guarantees the chart's last close always
    # matches this exactly.
    current_total = sum((Decimal(b["amount"]) for b in get_balances(user_id)), Decimal("0"))

    # Every ledger movement inside the window, oldest first. Summing these
    # and subtracting from current_total gives the balance AT range_start
    # -- i.e. running the ledger backwards without needing a snapshot.
    entries = (
        get_supabase()
        .table("ledger_entries")
        .select("amount,created_at")
        .eq("user_id", user_id)
        .gte("created_at", range_start.isoformat())
        .order("created_at", desc=False)
        .execute()
        .data
    )
    entries_in_range_sum = sum((Decimal(str(e["amount"])) for e in entries), Decimal("0"))
    start_balance = current_total - entries_in_range_sum

    bucket_width = (now - range_start) / buckets
    # Bucket i covers [edges[i], edges[i+1]). Computed by fixed-width steps
    # from range_start rather than repeated addition, so this can't drift
    # from float/timedelta rounding across many buckets; edges[-1] is then
    # pinned to `now` exactly, in case the division above left it a
    # microsecond short.
    edges = [range_start + bucket_width * i for i in range(buckets + 1)]
    edges[-1] = now

    points: list[dict] = []
    running = start_balance
    entry_idx = 0
    entry_count = len(entries)

    for i in range(buckets):
        bucket_end = edges[i + 1]
        open_ = running
        high = running
        low = running

        # Apply every entry that falls before this bucket's end (entries
        # are sorted ascending, and entry_idx only ever moves forward, so
        # this whole function is a single O(entries + buckets) pass, never
        # re-scanning an entry it's already consumed).
        while entry_idx < entry_count and _parse_ts(entries[entry_idx]["created_at"]) < bucket_end:
            running += Decimal(str(entries[entry_idx]["amount"]))
            if running > high:
                high = running
            if running < low:
                low = running
            entry_idx += 1

        close = running
        points.append(
            {
                "t": int(edges[i].timestamp()),
                "open": str(open_.quantize(_CENTS, rounding=ROUND_HALF_UP)),
                "high": str(high.quantize(_CENTS, rounding=ROUND_HALF_UP)),
                "low": str(low.quantize(_CENTS, rounding=ROUND_HALF_UP)),
                "close": str(close.quantize(_CENTS, rounding=ROUND_HALF_UP)),
            }
        )

    return points
