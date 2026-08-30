# Settles one completed simulated-bot session against the user's REAL USDT
# balance — the module-4 counterpart to demo_profit_service.py, but unlike
# that one this credits on a win AND debits on a loss, through the same
# record_ledger_entry() RPC every other ledger write in this codebase uses.
#
# amount is passed SIGNED (positive for a win, negative for a loss) — that
# matches maintain_balance()'s `balances.amount + new.amount` directly, so a
# loss just naturally subtracts. The balances.amount >= 0 CHECK constraint
# means Postgres itself refuses any debit that would take the balance
# negative — see _apply_ledger_entry's except block for how that's handled
# here (the session's fills/chart still get written either way; only the
# balance-affecting part is skipped).

import logging
from decimal import Decimal

from postgrest.exceptions import APIError

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_asset_id_cache: dict[str, int] = {}
_entry_type_id_cache: dict[str, int] = {}


def _usdt_asset_id() -> int:
    if not _asset_id_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_id_cache.update({row["code"]: row["id"] for row in rows})
    return _asset_id_cache["USDT"]


def _entry_type_id(code: str) -> int:
    if code not in _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({row["code"]: row["id"] for row in rows})
    return _entry_type_id_cache[code]


def settle_simulated_session(
    user_id: str, bot_id: str, session_id: str, total_pnl: Decimal
) -> dict:
    """Returns {"applied": bool, "amount": Decimal, "reason": str | None}.

    applied=False, reason="zero_pnl": total_pnl was exactly 0 — nothing to
      record (no entry_type cleanly fits "a session that did nothing").
    applied=False, reason="insufficient_balance": this was a losing session
      but the user's real balance is smaller than the loss — rather than
      erroring the whole engine sweep, the debit is silently skipped for
      this one session (the bot keeps running; a future losing session with
      a healthier balance will debit normally). This is a deliberate v1
      simplification, not a bug — the bot does not auto-pause here.
    applied=True: the ledger entry was written and the real balance moved by
      exactly `amount` (signed — positive for a win, negative for a loss).
    """
    if total_pnl == 0:
        return {"applied": False, "amount": Decimal("0"), "reason": "zero_pnl"}

    is_win = total_pnl > 0
    entry_type_code = "SIMULATED_BOT_PROFIT" if is_win else "SIMULATED_BOT_LOSS"
    idempotency_key = f"simbot:{bot_id}:{session_id}"

    try:
        result = get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": user_id,
                "p_asset_id": _usdt_asset_id(),
                "p_entry_type_id": _entry_type_id(entry_type_code),
                "p_amount": str(total_pnl),  # signed — negative debits naturally, see module docstring
                "p_related_bot_id": bot_id,
                "p_idempotency_key": idempotency_key,
                "p_metadata": {"source": "simulated_bot", "session_id": session_id},
            },
        ).execute()
    except APIError as exc:
        if exc.code == "23514":  # check_violation — balances.amount >= 0
            logger.warning(
                "Simulated bot %s session %s loss of %s skipped — insufficient balance",
                bot_id, session_id, total_pnl,
            )
            return {"applied": False, "amount": Decimal("0"), "reason": "insufficient_balance"}
        raise

    if result.data is None:
        # record_ledger_entry() returned NULL — this idempotency_key was
        # already recorded (a Celery retry re-running the same session),
        # not a real second occurrence.
        return {"applied": False, "amount": Decimal("0"), "reason": "duplicate"}

    return {"applied": True, "amount": total_pnl, "reason": None}
