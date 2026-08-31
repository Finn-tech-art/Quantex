# Reads/writes `withdrawal_fee_settings` — the admin-controlled flat fee
# charged on every withdrawal, replacing withdrawal_service.py's old
# hardcoded WITHDRAWAL_FLAT_FEE constant. Deliberately its own small module
# (rather than folded into withdrawal_service.py) because two very different
# callers both need it: withdrawal_service.create_request (charges it),
# and routers/withdrawals.py's GET /withdrawals/fee (previews it to the user
# on the withdraw form before they submit, so WithdrawPage.jsx never has to
# hardcode a copy of this value the way it used to — see that page's
# now-removed WITHDRAWAL_FLAT_FEE comment).
#
# Same "singleton settings row, no row yet = hardcoded default" shape as
# win_rate_service.py, just with one row total instead of one per date —
# see 014_withdrawal_fee_setting.sql's header comment for why a single row is
# the right shape here and daily_win_rate_settings' per-date shape isn't.

from decimal import Decimal

from app.services.supabase_client import get_supabase

# Used until an admin sets a fee for the first time via PUT /admin/withdrawal-fee
# — this is the exact value WITHDRAWAL_FLAT_FEE used to be hardcoded to, so
# nothing about live withdrawal behavior changes the moment this module's
# migration runs. Change this to change the out-of-the-box fee for a fresh
# environment that's never had an admin configure one.
DEFAULT_WITHDRAWAL_FEE = Decimal("2")

_SETTINGS_ROW_ID = 1


def get_current_fee() -> dict:
    """Returns {"fee_amount": Decimal, "is_default": bool, "updated_at": str | None}.
    Never raises for the common case of no admin having set a fee yet — that's
    the normal state for a fresh environment, not an error condition."""
    rows = (
        get_supabase()
        .table("withdrawal_fee_settings")
        .select("fee_amount,updated_at")
        .eq("id", _SETTINGS_ROW_ID)
        .limit(1)
        .execute()
        .data
    )
    if rows:
        return {
            "fee_amount": Decimal(str(rows[0]["fee_amount"])),
            "is_default": False,
            "updated_at": rows[0]["updated_at"],
        }
    return {"fee_amount": DEFAULT_WITHDRAWAL_FEE, "is_default": True, "updated_at": None}


def set_fee(fee_amount: Decimal, admin_id: str) -> dict:
    """Upserts the single settings row. Decimal(str(...)) round-trip into the
    upsert (not a raw float) — same reasoning as every other money-bearing
    column in this codebase — avoids binary float precision drift landing in
    a NUMERIC column."""
    row = {
        "id": _SETTINGS_ROW_ID,
        "fee_amount": str(fee_amount),
        "set_by_admin_id": admin_id,
    }
    get_supabase().table("withdrawal_fee_settings").upsert(row, on_conflict="id").execute()
    return get_current_fee()
