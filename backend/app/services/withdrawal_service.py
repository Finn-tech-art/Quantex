# Withdrawal request + admin approval (Phase 4, module 2).
#
# Two-step user flow:
#   1. POST /withdrawals/request  -> create_request()   validates everything,
#      stashes a short-lived draft in Redis, emails a 6-digit OTP tied to it.
#   2. POST /withdrawals/confirm  -> confirm_request()   checks that code and
#      ONLY THEN inserts the real `withdrawals` row, as PENDING.
# From there an admin approves or rejects it from the admin panel
# (routers/admin.py calls approve_withdrawal / reject_withdrawal below).
#
# IMPORTANT — this module is a deliberate dead end past admin approval. The
# full architecture (quantex-definitive-architecture_1.md, Section 4) has
# admin approval trigger a hot-wallet broadcast, then move the withdrawal
# through BROADCAST -> COMPLETED once that on-chain transaction confirms.
# That broadcast worker does not exist yet — it's real future work, not an
# oversight here. What THIS module does: the moment an admin clicks Approve,
# the ledger is debited immediately (see approve_withdrawal's docstring) and
# the row is left sitting at APPROVED forever, tx_hash staying null. Nothing
# else ever touches it after that. To add the real broadcast later: a new
# worker would pick up APPROVED rows, sign + broadcast from the hot wallet,
# and move each one to BROADCAST then COMPLETED (or FAILED) as it confirms —
# none of that changes anything written here.
#
# Why the OTP is tied to a Redis draft id instead of a withdrawals.id: the
# architecture doc calls for the OTP's identifier to be scoped to this
# specific request's content (amount/address/network), not just to the
# user, so a stale/guessed code can never be replayed against a different
# request. But a `withdrawals` row can't exist yet at the moment the OTP is
# sent — nothing should be written to Postgres before the user has proven
# they actually received this specific request at their own email address.
# So the draft lives in Redis with a TTL first, the same disposable-state
# pattern deposit_pending_service.py already uses for the deposit "waiting"
# screen, and only graduates into a real `withdrawals` row once the code is
# confirmed.

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.services import custody_service, notification_service, withdrawal_fee_service, withdrawal_unlock_fee_service
from app.services.auth_service import kyc_status_code
from app.services.network_assets import NETWORK_CONFIG
from app.services.otp_service import generate_and_send_otp, verify_otp
from app.services.redis_client import get_redis
from app.services.supabase_client import get_supabase

# purpose string for the generic OTP service (otp_service.py) — matches the
# exact name the architecture doc uses for this ("withdrawal_confirmation").
# Defined here rather than in otp_service.py itself so that module stays
# feature-agnostic; PURPOSE_EMAIL_VERIFICATION lives there only because
# email verification was the OTP service's first consumer.
PURPOSE_WITHDRAWAL_CONFIRMATION = "withdrawal_confirmation"

# ── Tunable business rules — change any of these to adjust the policy ───────

# Minimum amount a single withdrawal request can be for, compared directly
# against whatever the user typed into the `amount` field. Raise or lower
# this to change the floor platform-wide.
MIN_WITHDRAWAL_AMOUNT = Decimal("100")

# A withdrawal is refused if it would leave the user's remaining balance (in
# that same asset) below this amount. Set to Decimal("0") to remove the
# floor entirely.
BALANCE_FLOOR_AFTER_WITHDRAWAL = Decimal("20")

# The flat fee itself — in the SAME asset being withdrawn (2 USDT fee on a
# USDT withdrawal, 2 USDC fee on a USDC withdrawal) — is no longer a constant
# here. It's admin-configurable at runtime via PUT /admin/withdrawal-fee, read
# fresh from withdrawal_fee_service.get_current_fee() at the point below where
# it's charged (never cached — this is exactly the kind of value that gets
# changed live from the admin panel). See withdrawal_fee_service.py's module
# comment and 014_withdrawal_fee_setting.sql for the full design. Not a
# separate charge on top of what the user typed either way: if someone
# requests to withdraw 100, the fee is subtracted from that 100, so
# 100-fee is what would actually go out on-chain and the full 100 is what
# leaves their balance.

# How long a submitted-but-not-yet-OTP-confirmed withdrawal draft survives in
# Redis before it silently expires and the user has to start over. Matches
# otp_service.OTP_TTL_SECONDS (the code's own expiry) so the two never
# disagree about how long the user actually has to enter the code.
DRAFT_TTL_SECONDS = 10 * 60


class WithdrawalValidationError(ValueError):
    """Raised for any reason a withdrawal request or confirm can't proceed —
    the router turns this straight into a 400, using this exception's
    message as the detail, which is always safe to show the user directly."""


class WithdrawalLedgerWriteFailed(RuntimeError):
    """Raised by approve_withdrawal when the ledger debit itself fails after
    the withdrawal was already claimed as APPROVED — see that function's
    docstring for the rollback this triggers and why the router must turn
    this into a real HTTPException rather than let it propagate unhandled."""


# ── Lookup-table caches — same "small dict, populated once" pattern used
# throughout this codebase (see wallet_service._network_id's comment for the
# full reasoning: a plain dict rather than lru_cache, so a transient DB
# hiccup on the very first call never gets permanently cached as empty). ────
_asset_id_cache: dict[str, int] = {}
_asset_code_cache: dict[int, str] = {}
_network_id_cache: dict[str, int] = {}
_network_code_cache: dict[int, str] = {}
_status_id_cache: dict[str, int] = {}
_status_code_cache: dict[int, str] = {}
_entry_type_id_cache: dict[str, int] = {}


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


def _load_statuses() -> None:
    if _status_id_cache:
        return
    rows = get_supabase().table("withdrawal_statuses").select("id,code").execute().data
    if not rows:
        raise RuntimeError("Lookup table 'withdrawal_statuses' returned no rows")
    _status_id_cache.update({r["code"]: r["id"] for r in rows})
    _status_code_cache.update({r["id"]: r["code"] for r in rows})


def _entry_type_id(code: str) -> int:
    if not _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({r["code"]: r["id"] for r in rows})
    return _entry_type_id_cache[code]


# Which network(s) each asset can be withdrawn over — deliberately the exact
# same asset<->network pairing network_assets.NETWORK_CONFIG already uses
# for DEPOSIT detection (right now: TRC20->USDT, BASE->USDC, POLYGON->USDC,
# one asset per network). Keeping withdrawal eligibility identical to
# deposit eligibility means "can this asset get onto Quantex on network X"
# and "can it get back off on network X" always agree. If NETWORK_CONFIG
# ever grows a second asset on one network (e.g. USDT on Polygon, mentioned
# as a possibility in the architecture doc), this dict picks that up
# automatically — nothing here needs to change by hand.
#
# _ACTIVE_NETWORKS below is the withdrawal-side mirror of deposits.py's and
# wallet.py's _SUPPORTED_NETWORKS = {"TRC20"} (see migration
# 019_disable_evm_networks.sql) — Base/Polygon are deliberately disabled for
# the mainnet launch. Without this filter, ASSET_NETWORKS would still offer
# USDC over a network nobody can ever deposit into anymore. Restore
# "BASE"/"POLYGON" here (alongside the other two files and
# WithdrawPage.jsx's ASSET_NETWORKS) once they're reactivated.
_ACTIVE_NETWORKS = {"TRC20"}

ASSET_NETWORKS: dict[str, list[str]] = {}
for _network_code, _cfg in NETWORK_CONFIG.items():
    if _network_code not in _ACTIVE_NETWORKS:
        continue
    ASSET_NETWORKS.setdefault(_cfg["asset_code"], []).append(_network_code)


def _draft_key(request_id: str) -> str:
    return f"withdrawal_draft:{request_id}"


def _available_balance(user_id: str, asset_id: int) -> Decimal:
    """Balance actually free to withdraw right now: amount minus
    locked_amount (the portion, if any, allocated to active bots — see
    quantex-schema.sql's `balances` table comment). locked_amount is always
    0 in the current codebase (nothing writes to it yet — bot allocation
    doesn't lock funds this way today), so this is equivalent to plain
    `amount` in practice, but reading the real column now means this
    doesn't quietly become wrong the day bot allocation starts using it."""
    rows = (
        get_supabase()
        .table("balances")
        .select("amount,locked_amount")
        .eq("user_id", user_id)
        .eq("asset_id", asset_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return Decimal("0")
    return Decimal(str(rows[0]["amount"])) - Decimal(str(rows[0]["locked_amount"]))


def _to_response_dict(row: dict) -> dict:
    _load_assets()
    _load_networks()
    _load_statuses()
    return {
        "id": row["id"],
        "status": _status_code_cache[row["status_id"]],
        "asset": _asset_code_cache[row["asset_id"]],
        "network": _network_code_cache[row["network_id"]],
        "destination_address": row["destination_address"],
        "amount": str(row["amount"]),
        "fee_amount": str(row["fee_amount"]),
        "tx_hash": row.get("tx_hash"),
        "admin_approved_at": row.get("admin_approved_at"),
        "rejection_reason": row.get("rejection_reason"),
        "created_at": row["created_at"],
    }


# ── User-facing ──────────────────────────────────────────────────────────────
async def create_request(
    user: dict,
    asset_code: str,
    network_code: str,
    destination_address: str,
    amount: Decimal,
) -> dict:
    """Step 1 — validates everything that can be validated right now (KYC,
    asset/network pairing, address format, minimum amount, balance floor)
    and, only if all of it checks out, stores a short-lived Redis draft and
    emails an OTP tied to it. Returns {"request_id", "amount", "fee_amount",
    "net_amount", "expires_in_seconds"} for the frontend to show before the
    user types the code. Raises WithdrawalValidationError (safe 400
    message) on any validation failure, or custody_service's
    UnknownNetwork/InvalidDestinationAddress for a bad address (both are
    plain ValueError subclasses too — the router catches ValueError once,
    not each type separately)."""
    asset_code = asset_code.upper()
    network_code = network_code.upper()

    if kyc_status_code(user["kyc_status_id"]) != "APPROVED":
        raise WithdrawalValidationError(
            "Your identity must be verified before you can withdraw — complete KYC first"
        )

    # Withdrawal unlock fees — a completely separate mechanic from
    # fee_amount below (which is auto-deducted from THIS withdrawal's
    # amount). This is a platform-wide gate: while any fee type is active,
    # every user must pay it once, as its own separate on-chain payment
    # (see withdrawal_unlock_fee_service.py), before they can request ANY
    # withdrawal at all. Checked here, first, before any of the
    # amount/balance validation below even runs.
    unpaid_fees = withdrawal_unlock_fee_service.get_unpaid_active_fees_for_user(user["id"])
    if unpaid_fees:
        owed = ", ".join(f"{f['name']} ({f['amount']} {f['asset']})" for f in unpaid_fees)
        raise WithdrawalValidationError(f"You need to pay the following before you can withdraw: {owed}")

    if network_code not in ASSET_NETWORKS.get(asset_code, []):
        raise WithdrawalValidationError(f"{asset_code} cannot be withdrawn over the {network_code} network")

    # Raises UnknownNetwork / InvalidDestinationAddress on a bad network or
    # a wrongly-shaped address — see custody_service.validate_destination_address's
    # own docstring. Returns the address in its canonical stored form (EVM
    # addresses checksummed), which is what actually gets saved below.
    destination_address = custody_service.validate_destination_address(network_code, destination_address)

    if amount < MIN_WITHDRAWAL_AMOUNT:
        raise WithdrawalValidationError(f"Minimum withdrawal is {MIN_WITHDRAWAL_AMOUNT} {asset_code}")

    _load_assets()
    if asset_code not in _asset_id_cache:
        raise WithdrawalValidationError(f"'{asset_code}' is not a known asset")
    asset_id = _asset_id_cache[asset_code]

    available = _available_balance(user["id"], asset_id)
    if available - amount < BALANCE_FLOOR_AFTER_WITHDRAWAL:
        raise WithdrawalValidationError(
            f"That would leave your balance below the {BALANCE_FLOOR_AFTER_WITHDRAWAL} {asset_code} minimum "
            f"— you have {available} {asset_code} available"
        )

    fee_amount = withdrawal_fee_service.get_current_fee()["fee_amount"]
    net_amount = amount - fee_amount

    request_id = str(uuid.uuid4())
    draft = {
        "user_id": user["id"],
        "asset": asset_code,
        "network": network_code,
        "destination_address": destination_address,
        "amount": str(amount),
        "fee_amount": str(fee_amount),
    }
    r = get_redis()
    await r.set(_draft_key(request_id), json.dumps(draft), ex=DRAFT_TTL_SECONDS)

    # Reuses the generic OTP service as-is — its verify_otp already enforces
    # a 5-attempt lockout per (purpose, identifier) before the code is
    # thrown away (see otp_service.OTP_MAX_ATTEMPTS), which is exactly the
    # "real attempt-throttling" the architecture doc flags as required
    # before this service could be safely reused for something
    # money-moving. Nothing extra needed here for that.
    await generate_and_send_otp(
        purpose=PURPOSE_WITHDRAWAL_CONFIRMATION,
        identifier=request_id,
        email=user["email"],
        subject="Confirm your Quantex withdrawal",
        heading=f"Confirm withdrawal of {amount} {asset_code}",
        # Shown as a details table in the email (see render_otp_email) so
        # the confirmation makes it obvious exactly what's being approved —
        # important for something money-moving, where a user should be able
        # to catch a wrong destination address or network from the email
        # alone before ever entering the code. net_amount/fee_amount are
        # already computed just above, so no extra work happens here beyond
        # formatting them for display.
        details=[
            ("Amount", f"{amount} {asset_code}"),
            ("Network", network_code),
            ("Destination", destination_address),
            ("Fee", f"{fee_amount} {asset_code}"),
            ("You'll receive", f"{net_amount} {asset_code}"),
        ],
    )

    return {
        "request_id": request_id,
        "amount": str(amount),
        "fee_amount": str(fee_amount),
        "net_amount": str(net_amount),
        "expires_in_seconds": DRAFT_TTL_SECONDS,
    }


async def confirm_request(user: dict, request_id: str, code: str) -> dict:
    """Step 2 — verifies the OTP against the Redis draft's id, then (only on
    success) inserts the real `withdrawals` row as PENDING and deletes the
    draft. Re-checks KYC and the balance floor again here, not just at
    /request time, because several minutes can pass while the user reads
    their email and types the code — e.g. a losing bot session could drain
    the balance in between. Raises WithdrawalValidationError with a message
    safe to show directly."""
    ok = await verify_otp(PURPOSE_WITHDRAWAL_CONFIRMATION, request_id, code)
    if not ok:
        raise WithdrawalValidationError("Invalid or expired code")

    r = get_redis()
    key = _draft_key(request_id)
    raw = await r.get(key)
    if raw is None:
        raise WithdrawalValidationError("This withdrawal request has expired — please start again")
    # One-time use: delete immediately after reading, before doing anything
    # else. verify_otp() above already deleted the code itself on success,
    # so a replayed second /confirm call for this request_id fails at the
    # OTP check regardless — this delete is what stops a second call that
    # somehow reused a still-valid code from inserting a second withdrawals
    # row for the same draft.
    await r.delete(key)
    draft = json.loads(raw)

    if draft["user_id"] != user["id"]:
        raise WithdrawalValidationError("This withdrawal request does not belong to your account")

    if kyc_status_code(user["kyc_status_id"]) != "APPROVED":
        raise WithdrawalValidationError(
            "Your identity must be verified before you can withdraw — complete KYC first"
        )

    _load_assets()
    _load_networks()
    _load_statuses()
    asset_id = _asset_id_cache[draft["asset"]]
    network_id = _network_id_cache[draft["network"]]
    amount = Decimal(draft["amount"])
    fee_amount = Decimal(draft["fee_amount"])

    available = _available_balance(user["id"], asset_id)
    if available - amount < BALANCE_FLOOR_AFTER_WITHDRAWAL:
        raise WithdrawalValidationError(
            "Your balance changed since this request was made and it can no longer be completed — please start again"
        )

    pending_id = _status_id_cache["PENDING"]
    inserted = (
        get_supabase()
        .table("withdrawals")
        .insert(
            {
                "user_id": user["id"],
                "status_id": pending_id,
                "asset_id": asset_id,
                "network_id": network_id,
                "amount": str(amount),
                "fee_amount": str(fee_amount),
                "destination_address": draft["destination_address"],
            }
        )
        .execute()
        .data[0]
    )

    return _to_response_dict(inserted)


def list_my_withdrawals(user_id: str, limit: int = 20) -> list[dict]:
    rows = (
        get_supabase()
        .table("withdrawals")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [_to_response_dict(r) for r in rows]


# ── Admin-facing ─────────────────────────────────────────────────────────────
def list_pending_queue() -> list[dict]:
    """Every withdrawal currently awaiting a decision, oldest first — same
    shape/ordering convention as kyc_service.list_pending_queue, so an admin
    working top-to-bottom naturally clears the longest-waiting request
    first."""
    _load_statuses()
    pending_id = _status_id_cache["PENDING"]
    rows = (
        get_supabase()
        .table("withdrawals")
        .select("*")
        .eq("status_id", pending_id)
        .order("created_at")
        .execute()
        .data
    )
    if not rows:
        return []

    user_ids = list({r["user_id"] for r in rows})
    users = get_supabase().table("users").select("id,email").in_("id", user_ids).execute().data
    email_by_id = {u["id"]: u["email"] for u in users}

    return [
        {
            **_to_response_dict(row),
            "user_id": row["user_id"],
            "user_email": email_by_id.get(row["user_id"], "(unknown)"),
        }
        for row in rows
    ]


def get_admin_detail(withdrawal_id: str) -> dict | None:
    """None if no withdrawal exists with this id — router turns that into a
    404."""
    rows = get_supabase().table("withdrawals").select("*").eq("id", withdrawal_id).limit(1).execute().data
    if not rows:
        return None
    row = rows[0]

    user_rows = get_supabase().table("users").select("email").eq("id", row["user_id"]).limit(1).execute().data
    user_email = user_rows[0]["email"] if user_rows else "(unknown)"

    admin_email = None
    if row.get("admin_approved_by"):
        admin_rows = (
            get_supabase().table("admins").select("email").eq("id", row["admin_approved_by"]).limit(1).execute().data
        )
        admin_email = admin_rows[0]["email"] if admin_rows else None

    return {
        **_to_response_dict(row),
        "user_id": row["user_id"],
        "user_email": user_email,
        "admin_approved_by_email": admin_email,
    }


def approve_withdrawal(withdrawal_id: str, admin_id: str) -> bool:
    """Returns False if this withdrawal doesn't exist or is no longer
    PENDING (already decided, or being decided by a second admin request
    racing this one) — the router turns that into a 404.

    This is the ONE place a withdrawal actually moves money. Two things
    happen, strictly in this order:

      1. An atomic, guarded UPDATE — `.eq("status_id", pending_id)` as part
         of the WHERE clause, not a separate read-then-write — claims this
         withdrawal for this call. Postgres guarantees only one concurrent
         request can ever succeed at flipping PENDING -> APPROVED for the
         same row, which is exactly what prevents two admin clicks landing
         at the same moment from double-approving (and double-debiting) the
         same withdrawal. Same technique as kyc_service._decide and
         bot_service.update_bot_config_if_active.

      2. Only once that claim succeeds does the ledger actually get
         debited — two entries through the same record_ledger_entry() RPC
         every other ledger write in this codebase uses: one WITHDRAWAL
         entry for the net amount (what would actually leave on-chain), one
         FEE_WITHDRAWAL entry for the fee, so platform fee revenue stays
         separately reportable from principal withdrawn. Both carry an
         idempotency_key derived from withdrawal_id, so even in the narrow
         case where this function somehow runs twice for a row already
         claimed by step 1 (e.g. a retried request after a network blip),
         the second attempt's debit is a safe no-op instead of a double
         debit.

    There is no step 3 — see this module's header comment for why. The row
    is left at APPROVED, balance already reduced, tx_hash still null.

    If the ledger step (2) raises for ANY reason — e.g. a database-side
    failure unrelated to this code — this function does NOT leave the row
    stranded at APPROVED with nothing actually debited. It rolls the claim
    from step 1 back to PENDING (clearing admin_approved_by/at too) and
    re-raises WithdrawalLedgerWriteFailed, so: the row is visibly back in
    the admin queue instead of silently looking "done" while no money
    actually moved, and clicking Approve again later is a plain, safe
    retry — the idempotency_key on each ledger write means an entry that
    already landed on a prior partial attempt is never written twice.
    The router turns WithdrawalLedgerWriteFailed into a real HTTPException
    rather than letting the raw exception escape unhandled; an unhandled
    exception here still produces a 500 from Starlette's own fallback
    handler, but that fallback response is generated OUTSIDE CORSMiddleware
    and never gets a CORS header attached, so the browser can't read it at
    all and reports a bare "Failed to fetch" instead of the real error —
    confusing on its own, and it was masking the fact that the claim in
    step 1 had already committed. Routing it through a proper HTTPException
    instead fixes both problems with the same change."""
    _load_statuses()
    pending_id = _status_id_cache["PENDING"]
    approved_id = _status_id_cache["APPROVED"]
    now = datetime.now(tz=timezone.utc).isoformat()

    claimed = (
        get_supabase()
        .table("withdrawals")
        .update({"status_id": approved_id, "admin_approved_by": admin_id, "admin_approved_at": now})
        .eq("id", withdrawal_id)
        .eq("status_id", pending_id)
        .execute()
    )
    if not claimed.data:
        return False

    row = claimed.data[0]
    amount = Decimal(str(row["amount"]))
    fee_amount = Decimal(str(row["fee_amount"]))
    net_amount = amount - fee_amount

    try:
        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": row["user_id"],
                "p_asset_id": row["asset_id"],
                "p_entry_type_id": _entry_type_id("WITHDRAWAL"),
                "p_amount": str(-net_amount),  # negative — debit, see maintain_balance()'s comment
                "p_network_id": row["network_id"],
                "p_related_withdrawal_id": withdrawal_id,
                "p_idempotency_key": f"withdrawal:{withdrawal_id}:principal",
            },
        ).execute()

        get_supabase().rpc(
            "record_ledger_entry",
            {
                "p_user_id": row["user_id"],
                "p_asset_id": row["asset_id"],
                "p_entry_type_id": _entry_type_id("FEE_WITHDRAWAL"),
                "p_amount": str(-fee_amount),
                "p_related_withdrawal_id": withdrawal_id,
                "p_idempotency_key": f"withdrawal:{withdrawal_id}:fee",
            },
        ).execute()
    except Exception as exc:
        get_supabase().table("withdrawals").update(
            {"status_id": pending_id, "admin_approved_by": None, "admin_approved_at": None}
        ).eq("id", withdrawal_id).execute()
        raise WithdrawalLedgerWriteFailed(
            "Approval failed while debiting the balance — this withdrawal has been left PENDING again so it can "
            "be retried, and nothing was debited."
        ) from exc

    # Notify the bell — see notification_service.py's module docstring for
    # why this call can never raise or block anything above, both ledger
    # entries having already landed for real by this point regardless of
    # whether this notification succeeds.
    _load_assets()
    notification_service.create_notification(
        row["user_id"], "WITHDRAWAL_APPROVED",
        "Withdrawal approved",
        f"Your withdrawal of {net_amount} {_asset_code_cache[row['asset_id']]} was approved.",
    )

    return True


def reject_withdrawal(withdrawal_id: str, reason: str) -> bool:
    """Same atomic PENDING-guarded UPDATE as approve_withdrawal, just moving
    to REJECTED with a reason instead of touching the ledger — a rejected
    withdrawal never debited anything in the first place (the ledger write
    only ever happens on approval, see above), so there is nothing to
    reverse. Returns False if this withdrawal doesn't exist or is no longer
    PENDING — router turns that into a 404."""
    _load_statuses()
    pending_id = _status_id_cache["PENDING"]
    rejected_id = _status_id_cache["REJECTED"]

    claimed = (
        get_supabase()
        .table("withdrawals")
        .update({"status_id": rejected_id, "rejection_reason": reason})
        .eq("id", withdrawal_id)
        .eq("status_id", pending_id)
        .execute()
    )
    if claimed.data:
        notification_service.create_notification(
            claimed.data[0]["user_id"], "WITHDRAWAL_REJECTED",
            "Withdrawal rejected",
            f"Your withdrawal request was rejected: {reason}",
        )
    return bool(claimed.data)
