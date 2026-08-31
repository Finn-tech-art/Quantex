# In-app notification bell — the backend half of NotificationBell.jsx.
#
# This module has exactly two jobs: create_notification() writes one row,
# and everything else below it reads/updates rows for the currently signed
# -in user. It is deliberately NOT the thing that decides WHEN a
# notification should fire — that decision lives at each individual event
# site, which calls create_notification() directly:
#
#   - services/kyc_service.py's _decide()            -> KYC_APPROVED / KYC_REJECTED
#   - services/withdrawal_service.py's approve/reject -> WITHDRAWAL_APPROVED / WITHDRAWAL_REJECTED
#   - services/chain_watcher_service.py's _credit_deposit() -> DEPOSIT_CONFIRMED
#   - services/bot_service.py's create_bot()          -> BOT_STARTED
#   - routers/bots.py's stop_bot()                    -> BOT_STOPPED
#
# To wire up a NEW event as a notification trigger later: add a row to
# notification_types in a new migration (see 014_notifications.sql's
# comment), then call create_notification(user_id, "YOUR_NEW_CODE", title,
# body) from wherever that event already happens in the code — nothing in
# this file needs to change to support a new type.
#
# IMPORTANT — create_notification() never raises. Every one of the five
# call sites above is a moment where something important and irreversible
# already happened for real (a KYC decision was saved, a ledger entry was
# posted, a bot's status flipped) — a notification is a courtesy on top of
# that, not part of the transaction. If the insert below fails for any
# reason (a transient DB hiccup, a bad type code from a future typo), the
# failure is logged and swallowed right here, once, so none of those five
# call sites need their own try/except to stay safe. The cost of this
# design: a notification can silently fail to appear. That's the right
# trade-off for something this non-critical — it must never be the reason
# a withdrawal approval, KYC decision, or bot action itself fails.

import logging

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# How many notifications the bell dropdown loads at once. This is a hard
# cap, not pagination — there is no "load more" in the UI today. Raise this
# if users start regularly having more than this many recent notifications
# and complain about older ones disappearing too fast.
DEFAULT_LIST_LIMIT = 30

# Same "fetch the whole small lookup table once, cache it in a plain dict"
# pattern used throughout this codebase (see withdrawal_service.py's own
# comment on its _asset_id_cache for the full reasoning: a plain dict
# rather than functools.lru_cache, so a transient failure on the very
# first call is never permanently remembered as "empty").
_type_id_cache: dict[str, int] = {}
_type_code_cache: dict[int, str] = {}


def _load_types() -> None:
    if _type_id_cache:
        return
    rows = get_supabase().table("notification_types").select("id,code").execute().data
    if not rows:
        raise RuntimeError("Lookup table 'notification_types' returned no rows")
    _type_id_cache.update({row["code"]: row["id"] for row in rows})
    _type_code_cache.update({row["id"]: row["code"] for row in rows})


def create_notification(user_id: str, type_code: str, title: str, body: str) -> None:
    """Writes one notification row for one user. `type_code` must be one of
    notification_types.code (see migrations/014_notifications.sql's seed
    data) — title/body are plain, already-formatted strings (e.g. "Your
    withdrawal of 98 USDT was approved"), not a template the frontend fills
    in later; see this module's header comment for why.

    Never raises — see the module docstring above for why every failure
    here is caught, logged, and swallowed rather than propagated to the
    caller."""
    try:
        _load_types()
        get_supabase().table("notifications").insert(
            {
                "user_id": user_id,
                "type_id": _type_id_cache[type_code],
                "title": title,
                "body": body,
            }
        ).execute()
    except Exception:
        # exc_info=True so the real cause (bad type_code, DB timeout, ...)
        # still lands in the logs somewhere for later debugging, even
        # though nothing here is allowed to interrupt the caller.
        logger.exception("Failed to create notification (user=%s type=%s)", user_id, type_code)


def _to_response_dict(row: dict) -> dict:
    _load_types()
    return {
        "id": row["id"],
        "type": _type_code_cache[row["type_id"]],
        "title": row["title"],
        "body": row["body"],
        "is_read": row["is_read"],
        "created_at": row["created_at"],
    }


def list_for_user(user_id: str, limit: int = DEFAULT_LIST_LIMIT) -> list[dict]:
    """Most recent notifications first, capped at `limit` — see
    DEFAULT_LIST_LIMIT's comment above for why this has no pagination."""
    rows = (
        get_supabase()
        .table("notifications")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [_to_response_dict(r) for r in rows]


def unread_count(user_id: str) -> int:
    # count="exact" + head=True asks Postgres for just the row count, not
    # the rows themselves — this is the supabase-py idiom for a cheap
    # COUNT(*) that never has to transfer or deserialize any actual data,
    # which matters here since the bell polls this on every refresh (see
    # NotificationBell.jsx's POLL_MS).
    result = (
        get_supabase()
        .table("notifications")
        .select("id", count="exact", head=True)
        .eq("user_id", user_id)
        .eq("is_read", False)
        .execute()
    )
    return result.count or 0


def mark_read(notification_id: str, user_id: str) -> dict | None:
    """Returns the updated row, or None if no notification with this id
    belongs to this user (router turns that into a 404). The .eq("user_id",
    ...) guard is what stops one signed-in user from marking (or even
    discovering the existence of) another user's notification just by
    guessing a different id — same ownership-check pattern as
    bots.py's _ensure_owner, just expressed as part of the UPDATE's WHERE
    clause instead of a separate check-then-act step."""
    rows = (
        get_supabase()
        .table("notifications")
        .update({"is_read": True})
        .eq("id", notification_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    return _to_response_dict(rows[0]) if rows else None


def mark_all_read(user_id: str) -> None:
    """Backs the dropdown's "Mark all read" action. Deliberately
    unconditional (no .eq("is_read", False) filter) — updating rows that
    are already read to "read" again is a harmless no-op, and adding that
    filter would only save Postgres a little redundant write work at the
    cost of one more line to reason about."""
    get_supabase().table("notifications").update({"is_read": True}).eq("user_id", user_id).execute()
