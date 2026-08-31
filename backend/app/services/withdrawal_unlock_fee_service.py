# Admin-managed library of named, one-time "unlock" fees that gate
# withdrawals platform-wide — see 016_withdrawal_unlock_fees.sql's header
# comment for the full schema this reads/writes and how this differs from
# withdrawal_fee_service.py's single auto-deducted flat fee.
#
# The tricky part this module owns: a fee is paid as a REAL on-chain
# transfer to the user's existing deposit address — the SAME address an
# ordinary deposit uses. There is no separate "fee payment address," so the
# chain-scanning code (chain_watcher_service.py) can't tell a fee payment
# apart from an ordinary deposit by the address alone. The mechanism this
# module provides:
#
#   1. The user calls create_payment_intent() (via POST
#      /withdrawal-fees/{id}/pay) right before being shown their deposit
#      address for the network they picked — this writes a durable Postgres
#      row (withdrawal_unlock_fee_intents), NOT just the ephemeral 10-minute
#      Redis flag deposit_pending_service.py uses, because the real
#      on-chain confirmation this is waiting for can take hours via the
#      backstop sweep, well past that flag's TTL.
#   2. chain_watcher_service._credit_deposit calls
#      try_claim_as_fee_payment() BEFORE it ever calls record_ledger_entry
#      — for every single incoming transfer, on both the live watcher and
#      the periodic backstop sweep (both funnel through that one function,
#      so this module never has to special-case either path). If an open,
#      unexpired intent exists for that (user, network) and the transferred
#      amount falls within MATCH_TOLERANCE of the fee's exact amount, this
#      claims it: the tx_hash is inserted into ledger_tx_dedup directly (so
#      the normal deposit path can never also credit it as balance), the
#      payment is recorded, and the intent is consumed. The transfer is
#      NEVER passed to record_ledger_entry in this case — it never touches
#      `balances` or `ledger_entries` at all, which is what makes this a
#      pure platform fee rather than money the user could later withdraw.
#   3. Anything that doesn't match an open intent (the overwhelmingly common
#      case: an ordinary deposit with no fee pending) falls through
#      untouched to the normal DEPOSIT credit path, exactly as before this
#      module existed.
#
# Residual limitation, stated plainly rather than hidden: because this is
# still the same address, a user who sends TWO transfers around the same
# time — one meant as the fee payment, one an unrelated ordinary deposit
# that happens to land inside MATCH_TOLERANCE of the fee's amount — could
# have the wrong one claimed. Narrowing MATCH_TOLERANCE to just above the
# exact fee amount (not "any amount >= fee", which the old flat withdrawal
# fee's design would have made far worse) keeps this narrow; a fully
# airtight fix would mean a dedicated sub-address per fee (real HD-wallet
# work), a deliberately deferred, bigger lift. See the design conversation
# this module was built from for the tradeoff.

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from postgrest.exceptions import APIError

from app.services.network_assets import NETWORK_CONFIG
from app.services.supabase_client import get_supabase

# Which network(s) can carry a given asset — the exact same derivation
# withdrawal_service.py builds its own ASSET_NETWORKS from, duplicated here
# rather than imported to avoid a circular import (withdrawal_service.py
# already imports THIS module, for the unpaid-fees withdrawal gate). Both
# are built from the same NETWORK_CONFIG source, so they can never disagree.
_ASSET_NETWORKS: dict[str, list[str]] = {}
for _network_code, _cfg in NETWORK_CONFIG.items():
    _ASSET_NETWORKS.setdefault(_cfg["asset_code"], []).append(_network_code)

# A qualifying transfer must be at least the fee's exact amount (never
# credit a partial payment as satisfying it) and no more than 2% over —
# generous enough to absorb someone rounding their transfer up slightly,
# tight enough that an unrelated, much larger deposit sent to the same
# address while a fee happens to be pending is never mistaken for it. See
# this module's header comment for the full reasoning.
MATCH_TOLERANCE = Decimal("1.02")

# How long a payment intent stays open before it's treated as stale — see
# 016_withdrawal_unlock_fees.sql's comment on withdrawal_unlock_fee_intents
# for why 24h specifically.
INTENT_TTL = timedelta(hours=24)

_asset_id_cache: dict[str, int] = {}
_asset_code_cache: dict[int, str] = {}
_network_id_cache: dict[str, int] = {}
_network_code_cache: dict[int, str] = {}


def _load_assets() -> None:
    if _asset_id_cache:
        return
    rows = get_supabase().table("assets").select("id,code").execute().data
    if not rows:
        raise RuntimeError("Lookup table 'assets' returned no rows")
    _asset_id_cache.update({r["code"]: r["id"] for r in rows})
    _asset_code_cache.update({r["id"]: r["code"] for r in rows})


def _load_networks() -> None:
    if _network_id_cache:
        return
    rows = get_supabase().table("networks").select("id,code").execute().data
    if not rows:
        raise RuntimeError("Lookup table 'networks' returned no rows")
    _network_id_cache.update({r["code"]: r["id"] for r in rows})
    _network_code_cache.update({r["id"]: r["code"] for r in rows})


def _fee_type_to_dict(row: dict) -> dict:
    _load_assets()
    return {
        "id": row["id"],
        "name": row["name"],
        "asset": _asset_code_cache[row["asset_id"]],
        "amount": str(row["amount"]),
        "is_active": row["is_active"],
        "created_at": row["created_at"],
    }


# ── Admin-facing — managing the library itself ───────────────────────────────
def list_fee_types() -> list[dict]:
    rows = (
        get_supabase()
        .table("withdrawal_unlock_fee_types")
        .select("*")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return [_fee_type_to_dict(r) for r in rows]


class UnknownAsset(ValueError):
    """Raised when an admin tries to create a fee type for an asset code
    that isn't in the `assets` lookup table at all — almost certainly a
    typo, since the asset picker on the admin page only ever offers real
    codes."""


def create_fee_type(name: str, asset_code: str, amount: Decimal, admin_id: str) -> dict:
    _load_assets()
    asset_code = asset_code.upper()
    if asset_code not in _asset_id_cache:
        raise UnknownAsset(f"'{asset_code}' is not a known asset")

    inserted = (
        get_supabase()
        .table("withdrawal_unlock_fee_types")
        .insert(
            {
                "name": name,
                "asset_id": _asset_id_cache[asset_code],
                "amount": str(amount),
                "created_by_admin_id": admin_id,
            }
        )
        .execute()
        .data[0]
    )
    return _fee_type_to_dict(inserted)


def set_fee_type_active(fee_type_id: str, is_active: bool) -> dict | None:
    """Returns the updated row, or None if fee_type_id doesn't exist."""
    updated = (
        get_supabase()
        .table("withdrawal_unlock_fee_types")
        .update({"is_active": is_active})
        .eq("id", fee_type_id)
        .execute()
        .data
    )
    return _fee_type_to_dict(updated[0]) if updated else None


# ── User-facing — what's owed, and paying it ─────────────────────────────────
def get_unpaid_active_fees_for_user(user_id: str) -> list[dict]:
    """Every currently-active fee type this user has NOT yet paid — this is
    both what GET /withdrawal-fees/mine shows on the withdraw screen, and
    what withdrawal_service.create_request checks to decide whether to
    refuse a withdrawal request outright."""
    active_types = (
        get_supabase()
        .table("withdrawal_unlock_fee_types")
        .select("*")
        .eq("is_active", True)
        .execute()
        .data
    )
    if not active_types:
        return []

    paid_type_ids = {
        row["fee_type_id"]
        for row in (
            get_supabase()
            .table("withdrawal_unlock_fee_payments")
            .select("fee_type_id")
            .eq("user_id", user_id)
            .in_("fee_type_id", [t["id"] for t in active_types])
            .execute()
            .data
        )
    }
    return [_fee_type_to_dict(t) for t in active_types if t["id"] not in paid_type_ids]


class FeeTypeNotFound(ValueError):
    """Raised for a fee_type_id that doesn't exist, or exists but is no
    longer active — paying an inactive fee type makes no sense (nothing is
    gated on it anymore), so this is treated the same as not-found rather
    than silently accepting a payment intent for it."""


def create_payment_intent(user_id: str, fee_type_id: str, network_code: str) -> dict:
    """Step 1 of paying a fee — see this module's header comment for the
    full mechanism. Returns {"network": ..., "asset": ..., "amount": ...}
    for the router to hand off to wallet_service.get_or_create_deposit_address.
    Upserts on (user_id, fee_type_id), so re-calling this (e.g. the user
    switched which network to pay on, or their first intent expired) just
    replaces the open intent rather than erroring."""
    fee_type_rows = (
        get_supabase()
        .table("withdrawal_unlock_fee_types")
        .select("*")
        .eq("id", fee_type_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
    )
    if not fee_type_rows:
        raise FeeTypeNotFound(f"No active fee type with id '{fee_type_id}'")
    fee_type = fee_type_rows[0]

    _load_assets()
    _load_networks()
    network_code = network_code.upper()
    if network_code not in _network_id_cache:
        raise ValueError(f"'{network_code}' is not a known network")

    fee_asset_code = _asset_code_cache[fee_type["asset_id"]]
    if network_code not in _ASSET_NETWORKS.get(fee_asset_code, []):
        raise ValueError(f"{fee_asset_code} cannot be paid over the {network_code} network")

    now = datetime.now(tz=timezone.utc)
    get_supabase().table("withdrawal_unlock_fee_intents").upsert(
        {
            "user_id": user_id,
            "fee_type_id": fee_type_id,
            "network_id": _network_id_cache[network_code],
            "created_at": now.isoformat(),
            "expires_at": (now + INTENT_TTL).isoformat(),
        },
        on_conflict="user_id,fee_type_id",
    ).execute()

    return {"network": network_code, **_fee_type_to_dict(fee_type)}


def try_claim_as_fee_payment(user_id: str, network_code: str, asset_code: str, amount: Decimal, tx_hash: str) -> bool:
    """Called from chain_watcher_service._credit_deposit for EVERY incoming
    transfer, before it's ever credited as ordinary balance. Returns True if
    this transfer was claimed as a fee payment (caller must NOT also credit
    it as a deposit), False if there was no matching open intent (caller
    should proceed with the normal DEPOSIT credit, exactly as before this
    module existed).

    "Matching" means: an intent open for this exact (user, network), whose
    fee type is for this exact asset, hasn't expired, and whose amount the
    transferred amount falls within MATCH_TOLERANCE of (see this module's
    header comment for why a tolerance band, not "any amount >= fee")."""
    _load_networks()
    _load_assets()
    if network_code not in _network_id_cache or asset_code not in _asset_id_cache:
        return False
    network_id = _network_id_cache[network_code]

    now = datetime.now(tz=timezone.utc)
    intents = (
        get_supabase()
        .table("withdrawal_unlock_fee_intents")
        .select("*")
        .eq("user_id", user_id)
        .eq("network_id", network_id)
        .gt("expires_at", now.isoformat())
        .execute()
        .data
    )
    if not intents:
        return False

    # Manual join (not a PostgREST embedded select) — same "fetch, then
    # look up related rows separately" convention every other service in
    # this codebase already uses (see e.g. withdrawal_service.get_admin_detail
    # fetching the withdrawal row, then the user row, then the admin row as
    # separate calls).
    fee_types_by_id = {
        t["id"]: t
        for t in (
            get_supabase()
            .table("withdrawal_unlock_fee_types")
            .select("*")
            .in_("id", [i["fee_type_id"] for i in intents])
            .execute()
            .data
        )
    }

    for intent in intents:
        fee_type = fee_types_by_id.get(intent["fee_type_id"])
        if fee_type is None or not fee_type["is_active"]:
            continue
        if _asset_code_cache[fee_type["asset_id"]] != asset_code:
            continue
        fee_amount = Decimal(str(fee_type["amount"]))
        if not (fee_amount <= amount <= fee_amount * MATCH_TOLERANCE):
            continue

        # Claim the tx_hash into the SAME dedup table record_ledger_entry
        # itself writes to — this is what makes it impossible for the
        # normal deposit path to also credit this same transfer as balance,
        # whether that's attempted concurrently or on a later re-scan.
        try:
            get_supabase().table("ledger_tx_dedup").insert(
                {"network_id": network_id, "tx_hash": tx_hash}
            ).execute()
        except APIError as exc:
            if exc.code == "23505":
                # Already claimed — by this same call racing itself across
                # the live watcher and a backstop sweep, or genuinely
                # already credited as an ordinary deposit a moment earlier.
                # Either way, not this module's to take.
                return False
            raise

        get_supabase().table("withdrawal_unlock_fee_payments").insert(
            {
                "user_id": user_id,
                "fee_type_id": fee_type["id"],
                "network_id": network_id,
                "tx_hash": tx_hash,
                "amount_paid": str(amount),
            }
        ).execute()

        get_supabase().table("withdrawal_unlock_fee_intents").delete().eq("id", intent["id"]).execute()

        return True

    return False
