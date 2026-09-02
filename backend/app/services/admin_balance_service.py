# Lets an admin manually credit (or debit) a user's balance by email — see
# migration 020_admin_balance_adjustment.sql's own comment for why this is
# most commonly used to hand a hobby-project test account a starting USDT
# balance without needing a real on-chain deposit first, and for why this
# goes through record_ledger_entry() rather than a direct UPDATE on
# balances (keeps the trigger-maintained balances.amount correct
# automatically, and shows up in the user's own activity history exactly
# like a deposit or bonus would).
#
# Same "look a user up by email, since an admin thinks in emails not UUIDs"
# reasoning session_limit_service.get_user_by_email already documents —
# duplicated here rather than imported, matching how every small lookup in
# this codebase is kept local to its own service file.

import logging
from decimal import Decimal, InvalidOperation

from postgrest.exceptions import APIError

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_asset_id_cache: dict[str, int] = {}
_entry_type_id_cache: dict[str, int] = {}

# The only asset this adjusts — every simulated-bot flow in this app assumes
# USDT (see simulated_bot_service._usdt_asset_id's own comment for the same
# assumption elsewhere), and a starting test balance only ever needs to be
# in USDT to actually let a user create a bot. A real multi-asset adjustment
# tool would need its own asset picker in the admin UI; not built here since
# nothing today needs to adjust a non-USDT balance.
ADJUSTABLE_ASSET = "USDT"


def _asset_id(code: str) -> int:
    if not _asset_id_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_id_cache.update({row["code"]: row["id"] for row in rows})
    return _asset_id_cache[code]


def _entry_type_id(code: str) -> int:
    if code not in _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({row["code"]: row["id"] for row in rows})
    return _entry_type_id_cache[code]


def get_user_by_email(email: str) -> dict | None:
    """Returns None (never raises) for an unknown email so the router can
    turn that into a clean 404 rather than a 500 — same convention
    session_limit_service.get_user_by_email already uses."""
    rows = (
        get_supabase()
        .table("users")
        .select("id,email")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def get_balance(user_id: str) -> str:
    """The user's current ADJUSTABLE_ASSET (USDT) balance, as a decimal
    string — "0" for a brand-new account with no balances row at all yet
    (exactly the "haven't deposited, they're at zero" case this feature
    exists for), same "no row means zero" convention used throughout this
    codebase's balance reads."""
    rows = (
        get_supabase()
        .table("balances")
        .select("amount")
        .eq("user_id", user_id)
        .eq("asset_id", _asset_id(ADJUSTABLE_ASSET))
        .limit(1)
        .execute()
        .data
    )
    return str(rows[0]["amount"]) if rows else "0"


def adjust_balance(user_id: str, amount: Decimal, admin_id: str, note: str | None) -> dict:
    """Credits (amount > 0) or debits (amount < 0) the user's USDT balance
    by exactly `amount`, through the same record_ledger_entry() RPC every
    other ledger write in this codebase uses.

    Returns {"applied": bool, "balance": str, "reason": str | None}.
      applied=False, reason="insufficient_balance": a debit larger than the
        user's current balance — Postgres's own balances.amount >= 0 CHECK
        refuses it (same failure mode simulated_bot_ledger_service.
        settle_simulated_session already handles the identical way for a
        losing bot session's debit).
      applied=True: the ledger entry was written and the balance now
        reflects it — `balance` is read fresh after the write, not
        computed locally, so it can never drift from what Postgres
        actually has."""
    try:
        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": user_id,
                "p_asset_id": _asset_id(ADJUSTABLE_ASSET),
                "p_entry_type_id": _entry_type_id("ADMIN_ADJUSTMENT"),
                "p_amount": str(amount),
                "p_metadata": {"source": "admin_adjustment", "admin_id": admin_id, "note": note},
            },
        ).execute()
    except APIError as exc:
        if exc.code == "23514":  # check_violation — balances.amount >= 0
            logger.warning(
                "Admin %s: adjustment of %s for user %s skipped — insufficient balance",
                admin_id, amount, user_id,
            )
            return {"applied": False, "balance": get_balance(user_id), "reason": "insufficient_balance"}
        raise

    return {"applied": True, "balance": get_balance(user_id), "reason": None}


def parse_amount(raw: str) -> Decimal:
    """Decimal(str) round-trip (not a bare float) — same reasoning every
    other money-bearing value crossing this API already follows (see e.g.
    win_rate_service.set_win_rate_for_date's own comment): avoids binary
    float precision drift going into a NUMERIC column. Raises ValueError
    (not InvalidOperation) on a malformed string so callers only need one
    exception type to catch, and rejects exactly 0 up front — ledger_entries
    itself has an `amount <> 0` CHECK, so a 0 adjustment would just fail at
    the database anyway, this only gets there with a clearer message."""
    try:
        value = Decimal(raw)
    except InvalidOperation:
        raise ValueError(f"'{raw}' is not a valid decimal amount")
    if value == 0:
        raise ValueError("amount must not be 0")
    return value
