# Service for crediting a user's real USDT balance from a winning demo session.
#
# The credit goes through the same record_ledger_entry() Postgres function used
# by every other balance movement in the system (deposits, bonuses, etc.) —
# this is intentional. There is no separate code path or table for demo money;
# once credited it is indistinguishable from any other USDT credit in the
# ledger, and the existing maintain_balance() trigger updates balances.amount
# automatically on insert.
#
# Idempotency: the session_id (a UUID generated per session by
# fake_trading_service.generate_fake_trading_result) is used as the
# idempotency_key. If the same session_id is submitted twice,
# record_ledger_entry() returns NULL and no second credit is applied —
# same safety mechanism used by deposit detection.
#
# Losing sessions (negative total_pnl) are silently ignored — a user cannot
# lose real funds from a simulated session. This function only records a
# ledger entry for winning (positive pnl) sessions.

from decimal import Decimal

from app.services.supabase_client import get_supabase

# Process-lifetime caches — same pattern as wallet_service.py and bot_service.py.
_asset_id_cache: dict[str, int] = {}
_entry_type_id_cache: dict[str, int] = {}


def _usdt_asset_id() -> int:
    if not _asset_id_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_id_cache.update({row["code"]: row["id"] for row in rows})
    return _asset_id_cache["USDT"]


def _demo_entry_type_id() -> int:
    if not _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({row["code"]: row["id"] for row in rows})
    return _entry_type_id_cache["DEMO_SESSION_PROFIT"]


def credit_demo_profit(user_id: str, session_id: str, total_pnl: Decimal) -> bool:
    """Credit a winning demo session's profit to the user's real USDT balance.

    Parameters
    ----------
    user_id:
        The authenticated user's ID (UUID string).
    session_id:
        The UUID generated for this session by fake_trading_service — used as
        the idempotency key so submitting the same session twice is a no-op.
    total_pnl:
        The session's total P&L in USDT. Must be positive (callers are
        responsible for only passing winning sessions here).

    Returns
    -------
    True if the credit was applied, False if this session_id was already
    recorded (duplicate submission — idempotency guard fired).

    Raises
    ------
    ValueError:
        If total_pnl is zero or negative — losing sessions must not be passed
        to this function; the caller (the router) should check _win before
        calling.
    """
    if total_pnl <= 0:
        raise ValueError(
            f"credit_demo_profit called with non-positive pnl {total_pnl!r} "
            "— only winning sessions should be passed here"
        )

    # idempotency_key format: "demo:{session_id}" — the "demo:" prefix ensures
    # it can never collide with any other idempotency key in the system (e.g.
    # a deposit sweep's on-chain tx_hash would never start with "demo:").
    idempotency_key = f"demo:{session_id}"

    result = get_supabase().rpc(
        "record_ledger_entry",
        {
            "p_user_id": user_id,
            "p_asset_id": _usdt_asset_id(),
            "p_entry_type_id": _demo_entry_type_id(),
            "p_amount": str(total_pnl),          # Postgres NUMERIC accepts string
            "p_idempotency_key": idempotency_key,
            "p_metadata": {
                "source": "demo_session",
                "session_id": session_id,
            },
        },
    ).execute()

    # record_ledger_entry() returns the new ledger entry id (bigint) on a fresh
    # write, or NULL if the idempotency key was already present (duplicate).
    ledger_id = result.data
    return ledger_id is not None
