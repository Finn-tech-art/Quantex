# Admin-facing endpoints — everything under here except /admin/auth/login
# requires a valid admin session token (get_current_admin), which is a
# completely different credential from the regular Bearer token every other
# router in this app expects (see utils/admin_auth.py / admin_auth_service.py
# for why). Do not add Depends(get_current_user) anywhere in this file.

from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException

from app.models.admin import (
    AdminCountryStatsEntry,
    AdminDailyStatsEntry,
    AdminLoginRequest,
    AdminOverviewResponse,
    AdminProfile,
    AdminTokenResponse,
    ConsolidationAddressEntry,
    ConsolidationAddressesResponse,
    GenerateKeypairRequest,
    GeneratedKeypairResponse,
    PendingSweepEntry,
    PendingSweepsResponse,
    QueuedSweepEntry,
    SessionLimitResponse,
    SetConsolidationAddressRequest,
    SetSessionLimitRequest,
    SetWinRateRequest,
    SetWithdrawalFeeRequest,
    SweepHistoryEntry,
    SweepHistoryResponse,
    SweepNowResponse,
    WinRateResponse,
    WithdrawalFeeResponse,
)
from app.models.kyc import (
    AdminKycQueueResponse,
    AdminKycSubmissionDetail,
    RejectKycRequest,
)
from app.models.withdrawal import (
    AdminWithdrawalDetail,
    AdminWithdrawalQueueResponse,
    RejectWithdrawalRequest,
)
from app.models.withdrawal_unlock_fee import (
    CreateUnlockFeeTypeRequest,
    SetUnlockFeeTypeActiveRequest,
    UnlockFeeType,
    UnlockFeeTypesResponse,
)
from app.services import (
    admin_auth_service,
    admin_overview_service,
    chain_watcher_service,
    custody_service,
    kyc_service,
    session_limit_service,
    win_rate_service,
    withdrawal_fee_service,
    withdrawal_service,
    withdrawal_unlock_fee_service,
)
from app.services.admin_audit_service import log_admin_action
from app.utils.admin_auth import get_current_admin

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Auth (module 1) ──────────────────────────────────────────────────────────
@router.post("/auth/login", response_model=AdminTokenResponse)
def admin_login(body: AdminLoginRequest):
    admin = admin_auth_service.verify_admin_login(body.email, body.password)
    if admin is None:
        # Same status/detail whether the email doesn't exist or the password
        # is wrong — see verify_admin_login's docstring for why.
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = admin_auth_service.create_admin_token(admin["id"], admin["email"])
    return AdminTokenResponse(access_token=token)


@router.get("/auth/me", response_model=AdminProfile)
def admin_me(admin: dict = Depends(get_current_admin)):
    return AdminProfile(id=admin["id"], email=admin["email"])


# ── Dashboard overview ────────────────────────────────────────────────────────
# The admin landing page: today's signup/deposit snapshot plus the full
# day-by-day history the calendar heatmap and charts are built from — see
# admin_overview_service.get_overview's docstring for exactly what "full"
# means (every day since the very first signup or deposit, zero-filled).
@router.get("/overview", response_model=AdminOverviewResponse)
def get_overview(admin: dict = Depends(get_current_admin)):
    result = admin_overview_service.get_overview()
    return AdminOverviewResponse(
        signups_today=result["signups_today"],
        deposits_today_count=result["deposits_today_count"],
        deposits_today_amount=result["deposits_today_amount"],
        daily=[AdminDailyStatsEntry(**entry) for entry in result["daily"]],
        countries=[AdminCountryStatsEntry(**entry) for entry in result["countries"]],
    )


# ── Daily win-rate setting (module 2) ────────────────────────────────────────
@router.get("/win-rate", response_model=WinRateResponse)
def get_win_rate(
    win_date: date | None = None,
    admin: dict = Depends(get_current_admin),
):
    """Defaults to today (UTC) when win_date is omitted — pass an explicit
    ?win_date=YYYY-MM-DD to check/prepare a future date instead."""
    target_date = win_date or win_rate_service.today_utc()
    result = win_rate_service.get_win_rate_for_date(target_date)
    return WinRateResponse(**result)


@router.put("/win-rate", response_model=WinRateResponse)
def set_win_rate(
    body: SetWinRateRequest,
    admin: dict = Depends(get_current_admin),
):
    if not (0.0 <= body.win_rate <= 1.0):
        raise HTTPException(status_code=400, detail="win_rate must be between 0 and 1")
    if body.target_min_return < 0:
        raise HTTPException(status_code=400, detail="target_min_return must be >= 0")

    target_date = body.win_date or win_rate_service.today_utc()
    result = win_rate_service.set_win_rate_for_date(
        win_date=target_date,
        win_rate=body.win_rate,
        target_min_return=body.target_min_return,
        admin_id=admin["id"],
    )
    log_admin_action(
        admin_id=admin["id"],
        action="WIN_RATE_SET",
        target_type="daily_win_rate_settings",
        target_id=target_date.isoformat(),
        metadata={"win_rate": body.win_rate, "target_min_return": body.target_min_return},
    )
    return WinRateResponse(**result)


# ── Free-tier session limits ──────────────────────────────────────────────────
# Admins look this up/set it by email (not user_id — an admin thinks in
# emails, same as the KYC and withdrawal queues' own admin-facing displays),
# see session_limit_service.get_user_by_email/set_daily_session_limit.
@router.get("/session-limits/{email}", response_model=SessionLimitResponse)
def get_session_limit(email: str, admin: dict = Depends(get_current_admin)):
    user = session_limit_service.get_user_by_email(email)
    if user is None:
        raise HTTPException(status_code=404, detail="No user found for that email")
    return SessionLimitResponse(
        user_id=user["id"],
        email=user["email"],
        daily_session_limit=user["daily_session_limit"],
        is_default=session_limit_service.is_free_tier(user["daily_session_limit"]),
    )


@router.put("/session-limits", response_model=SessionLimitResponse)
def set_session_limit(body: SetSessionLimitRequest, admin: dict = Depends(get_current_admin)):
    if body.daily_session_limit < 0:
        raise HTTPException(status_code=400, detail="daily_session_limit must be >= 0")

    user = session_limit_service.get_user_by_email(body.email)
    if user is None:
        raise HTTPException(status_code=404, detail="No user found for that email")

    result = session_limit_service.set_daily_session_limit(user["id"], body.daily_session_limit)
    log_admin_action(
        admin_id=admin["id"],
        action="SESSION_LIMIT_SET",
        target_type="users",
        target_id=user["id"],
        metadata={"email": body.email, "daily_session_limit": body.daily_session_limit},
    )
    return SessionLimitResponse(
        user_id=result["user_id"],
        email=user["email"],
        daily_session_limit=result["daily_session_limit"],
        is_default=session_limit_service.is_free_tier(result["daily_session_limit"]),
    )


# ── Deposit consolidation address settings (module 1) ────────────────────────
# Config only — no funds move here. This is the destination the Module 2/3
# sweep worker will read from once it exists; see custody_service.py and the
# architecture doc's "Deposit consolidation" section.
@router.get("/consolidation-addresses", response_model=ConsolidationAddressesResponse)
def list_consolidation_addresses(admin: dict = Depends(get_current_admin)):
    addresses = custody_service.get_all_consolidation_addresses()
    return ConsolidationAddressesResponse(
        addresses=[
            ConsolidationAddressEntry(network=network, destination_address=address, is_configured=address is not None)
            for network, address in addresses.items()
        ]
    )


@router.put("/consolidation-addresses/{network}", response_model=ConsolidationAddressEntry)
def set_consolidation_address(
    network: str,
    body: SetConsolidationAddressRequest,
    admin: dict = Depends(get_current_admin),
):
    try:
        saved_address = custody_service.set_consolidation_address(network, body.destination_address, admin["id"])
    except custody_service.UnknownNetwork as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except custody_service.InvalidDestinationAddress as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Server-side retype-to-confirm isn't enforceable here — the frontend
    # requires typing the address twice before this request is even sent —
    # but the audit trail is: every change is who/when/to-what, permanently.
    log_admin_action(
        admin_id=admin["id"],
        action="CONSOLIDATION_ADDRESS_SET",
        target_type="consolidation_addresses",
        target_id=network,
        metadata={"destination_address": saved_address},
    )
    return ConsolidationAddressEntry(network=network, destination_address=saved_address, is_configured=True)


# ── Deposit consolidation sweeps (module 4) ──────────────────────────────────
# "Sweep Now" and its supporting views. Nothing here runs on a timer — see
# workers/consolidate_deposits.py and custody_service.py's module-4 section
# header for why that's a deliberate design choice, not a gap.
@router.get("/sweeps/pending", response_model=PendingSweepsResponse)
def pending_sweeps(admin: dict = Depends(get_current_admin)):
    pending = custody_service.list_pending_sweeps()
    return PendingSweepsResponse(
        pending=[
            PendingSweepEntry(
                wallet_id=item["wallet_id"],
                network=item["network"],
                asset=item["asset"],
                deposit_address=item["deposit_address"],
                balance=str(item["balance"]),
            )
            for item in pending
        ]
    )


@router.post("/sweeps/run", response_model=SweepNowResponse)
def run_sweep_now(admin: dict = Depends(get_current_admin)):
    # trigger_sweep_now() re-lists pending sweeps itself rather than trusting
    # whatever the admin's browser last rendered — see its docstring.
    queued = custody_service.trigger_sweep_now()
    log_admin_action(
        admin_id=admin["id"],
        action="SWEEP_NOW_TRIGGERED",
        target_type="sweeps",
        target_id="batch",
        metadata={"count": len(queued), "wallet_ids": [q["wallet_id"] for q in queued]},
    )
    return SweepNowResponse(
        queued=[
            QueuedSweepEntry(
                wallet_id=q["wallet_id"],
                network=q["network"],
                asset=q["asset"],
                deposit_address=q["deposit_address"],
                balance=str(q["balance"]),
                task_id=q["task_id"],
            )
            for q in queued
        ]
    )


@router.post("/sweeps/run/{wallet_id}", response_model=SweepNowResponse)
def run_sweep_one(wallet_id: str, admin: dict = Depends(get_current_admin)):
    # The single-deposit counterpart to run_sweep_now above — queues just
    # ONE wallet's sweep rather than every pending one, since each sweep
    # now costs real money (GetBlock Energy rental) and an admin shouldn't
    # have to pay to consolidate everything just to move one urgent
    # deposit. Same response shape as the bulk endpoint (a list, just
    # always length 1) so the frontend doesn't need a second response type.
    try:
        queued = custody_service.trigger_sweep_one(wallet_id)
    except custody_service.WalletNotPending as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    log_admin_action(
        admin_id=admin["id"],
        action="SWEEP_NOW_TRIGGERED",
        target_type="sweeps",
        target_id=wallet_id,
        metadata={"count": 1, "wallet_ids": [wallet_id]},
    )
    return SweepNowResponse(
        queued=[
            QueuedSweepEntry(
                wallet_id=queued["wallet_id"],
                network=queued["network"],
                asset=queued["asset"],
                deposit_address=queued["deposit_address"],
                balance=str(queued["balance"]),
                task_id=queued["task_id"],
            )
        ]
    )


@router.get("/sweeps", response_model=SweepHistoryResponse)
def sweep_history(admin: dict = Depends(get_current_admin)):
    sweeps = custody_service.list_recent_sweeps()
    return SweepHistoryResponse(
        sweeps=[SweepHistoryEntry(**{**s, "amount": str(s["amount"])}) for s in sweeps]
    )


# ── Operational wallet generation (module 6) ─────────────────────────────────
# A convenience keygen, not a provisioning flow — see custody_service.py's
# module-6 header comment for exactly what this does and doesn't do (in
# particular: it does NOT make the key live, that still needs a manual env
# var change + restart). Never logs the private key itself, only that a
# keypair was generated and its resulting public address.
@router.post("/wallets/generate", response_model=GeneratedKeypairResponse)
def generate_operational_wallet(body: GenerateKeypairRequest, admin: dict = Depends(get_current_admin)):
    if body.chain == "TRON":
        result = custody_service.generate_tron_keypair()
    elif body.chain == "EVM":
        result = custody_service.generate_evm_keypair()
    else:
        raise HTTPException(status_code=400, detail="chain must be 'TRON' or 'EVM'")

    log_admin_action(
        admin_id=admin["id"],
        action="OPERATIONAL_WALLET_GENERATED",
        target_type="operational_wallet",
        target_id=result["address"],
        metadata={"chain": body.chain},
    )
    return GeneratedKeypairResponse(chain=body.chain, address=result["address"], private_key=result["private_key"])


# ── KYC review queue (Phase 4) ───────────────────────────────────────────────
@router.get("/kyc", response_model=AdminKycQueueResponse)
def kyc_queue(admin: dict = Depends(get_current_admin)):
    return AdminKycQueueResponse(submissions=kyc_service.list_pending_queue())


@router.get("/kyc/{submission_id}", response_model=AdminKycSubmissionDetail)
def kyc_detail(submission_id: str, admin: dict = Depends(get_current_admin)):
    detail = kyc_service.get_admin_submission_detail(submission_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return AdminKycSubmissionDetail(**detail)


@router.post("/kyc/{submission_id}/approve", response_model=AdminKycSubmissionDetail)
def kyc_approve(submission_id: str, admin: dict = Depends(get_current_admin)):
    applied = kyc_service.approve_submission(submission_id, admin["id"])
    if not applied:
        raise HTTPException(status_code=404, detail="Submission not found")
    log_admin_action(
        admin_id=admin["id"], action="KYC_APPROVED",
        target_type="kyc_submissions", target_id=submission_id,
    )
    return AdminKycSubmissionDetail(**kyc_service.get_admin_submission_detail(submission_id))


@router.post("/kyc/{submission_id}/reject", response_model=AdminKycSubmissionDetail)
def kyc_reject(submission_id: str, body: RejectKycRequest, admin: dict = Depends(get_current_admin)):
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="A rejection reason is required")
    applied = kyc_service.reject_submission(submission_id, admin["id"], body.reason.strip())
    if not applied:
        raise HTTPException(status_code=404, detail="Submission not found")
    log_admin_action(
        admin_id=admin["id"], action="KYC_REJECTED",
        target_type="kyc_submissions", target_id=submission_id,
        metadata={"reason": body.reason.strip()},
    )
    return AdminKycSubmissionDetail(**kyc_service.get_admin_submission_detail(submission_id))


# ── Withdrawal fee setting ────────────────────────────────────────────────────
# The flat fee charged on every withdrawal — see withdrawal_fee_service.py's
# module comment. Changing it here only ever affects withdrawals REQUESTED
# after the change; anything already requested (even if not yet approved)
# already has its own fee_amount frozen in from whatever this setting was at
# request time, so there's nothing to migrate or reconcile.
@router.get("/withdrawal-fee", response_model=WithdrawalFeeResponse)
def get_withdrawal_fee(admin: dict = Depends(get_current_admin)):
    result = withdrawal_fee_service.get_current_fee()
    return WithdrawalFeeResponse(
        fee_amount=str(result["fee_amount"]),
        is_default=result["is_default"],
        updated_at=result["updated_at"],
    )


@router.put("/withdrawal-fee", response_model=WithdrawalFeeResponse)
def set_withdrawal_fee(body: SetWithdrawalFeeRequest, admin: dict = Depends(get_current_admin)):
    try:
        fee_amount = Decimal(body.fee_amount)
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="fee_amount must be a valid decimal string")
    if fee_amount < 0:
        raise HTTPException(status_code=400, detail="fee_amount cannot be negative")

    result = withdrawal_fee_service.set_fee(fee_amount, admin["id"])
    log_admin_action(
        admin_id=admin["id"],
        action="WITHDRAWAL_FEE_SET",
        target_type="withdrawal_fee_settings",
        target_id="singleton",
        metadata={"fee_amount": str(fee_amount)},
    )
    return WithdrawalFeeResponse(
        fee_amount=str(result["fee_amount"]),
        is_default=result["is_default"],
        updated_at=result["updated_at"],
    )


# ── Withdrawal unlock fees ────────────────────────────────────────────────────
# A completely different mechanic from the flat fee just above (which is
# auto-deducted from a withdrawal's amount): a named, admin-managed fee that
# EVERY user must pay, once, as its own separate on-chain payment, before
# ANY of their withdrawals can be requested — see
# withdrawal_unlock_fee_service.py's module comment for the full design.
@router.get("/withdrawal-unlock-fees", response_model=UnlockFeeTypesResponse)
def list_unlock_fee_types(admin: dict = Depends(get_current_admin)):
    return UnlockFeeTypesResponse(fee_types=[UnlockFeeType(**f) for f in withdrawal_unlock_fee_service.list_fee_types()])


@router.post("/withdrawal-unlock-fees", response_model=UnlockFeeType)
def create_unlock_fee_type(body: CreateUnlockFeeTypeRequest, admin: dict = Depends(get_current_admin)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    try:
        amount = Decimal(body.amount)
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="amount must be a valid decimal string")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than 0")
    # A fee below the platform's own minimum-deposit floor could never
    # actually be detected on-chain — the chain scanner drops any transfer
    # below MIN_DEPOSIT_USD before a payment even has a chance to be
    # matched against an open intent (see chain_watcher_service.py's
    # _scan_tron/_scan_evm). Refusing it here, at creation time, is far
    # better than an admin discovering it as "nobody's payment is ever
    # detected" days later.
    if amount < chain_watcher_service.MIN_DEPOSIT_USD:
        raise HTTPException(
            status_code=400,
            detail=f"amount must be at least {chain_watcher_service.MIN_DEPOSIT_USD} — anything smaller can never be detected as a real on-chain payment",
        )

    try:
        fee_type = withdrawal_unlock_fee_service.create_fee_type(body.name.strip(), body.asset, amount, admin["id"])
    except withdrawal_unlock_fee_service.UnknownAsset as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    log_admin_action(
        admin_id=admin["id"],
        action="WITHDRAWAL_UNLOCK_FEE_TYPE_CREATED",
        target_type="withdrawal_unlock_fee_types",
        target_id=fee_type["id"],
        metadata={"name": fee_type["name"], "asset": fee_type["asset"], "amount": fee_type["amount"]},
    )
    return UnlockFeeType(**fee_type)


@router.put("/withdrawal-unlock-fees/{fee_type_id}/active", response_model=UnlockFeeType)
def set_unlock_fee_type_active(
    fee_type_id: str, body: SetUnlockFeeTypeActiveRequest, admin: dict = Depends(get_current_admin)
):
    fee_type = withdrawal_unlock_fee_service.set_fee_type_active(fee_type_id, body.is_active)
    if fee_type is None:
        raise HTTPException(status_code=404, detail="Fee type not found")

    log_admin_action(
        admin_id=admin["id"],
        action="WITHDRAWAL_UNLOCK_FEE_TYPE_ACTIVATED" if body.is_active else "WITHDRAWAL_UNLOCK_FEE_TYPE_DEACTIVATED",
        target_type="withdrawal_unlock_fee_types",
        target_id=fee_type_id,
    )
    return UnlockFeeType(**fee_type)


# ── Withdrawal approval queue (Phase 4, module 2) ────────────────────────────
# Every withdrawal, regardless of amount, needs manual sign-off here before
# a cent of it moves — see withdrawal_service.py's module comment for
# exactly what "moves" means right now (a ledger debit, not an on-chain
# broadcast — that worker doesn't exist yet).
@router.get("/withdrawals", response_model=AdminWithdrawalQueueResponse)
def withdrawal_queue(admin: dict = Depends(get_current_admin)):
    return AdminWithdrawalQueueResponse(withdrawals=withdrawal_service.list_pending_queue())


@router.get("/withdrawals/{withdrawal_id}", response_model=AdminWithdrawalDetail)
def withdrawal_detail(withdrawal_id: str, admin: dict = Depends(get_current_admin)):
    detail = withdrawal_service.get_admin_detail(withdrawal_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    return AdminWithdrawalDetail(**detail)


@router.post("/withdrawals/{withdrawal_id}/approve", response_model=AdminWithdrawalDetail)
def withdrawal_approve(withdrawal_id: str, admin: dict = Depends(get_current_admin)):
    # approve_withdrawal() itself is what actually debits the ledger — see
    # its docstring for the atomic claim-then-debit ordering that makes this
    # safe against two admins (or one admin's double-click) racing the same
    # withdrawal. False here means it was already decided by the time this
    # request landed, not a transient failure worth retrying.
    try:
        applied = withdrawal_service.approve_withdrawal(withdrawal_id, admin["id"])
    except withdrawal_service.WithdrawalLedgerWriteFailed as exc:
        # Must be a real HTTPException, not a re-raise — an unhandled
        # exception here falls through to Starlette's own 500 handler,
        # which sits OUTSIDE CORSMiddleware and never gets a CORS header
        # attached, so the browser can't read the response at all and
        # reports a bare "Failed to fetch" instead of this message. See
        # approve_withdrawal's docstring for the full explanation.
        raise HTTPException(status_code=500, detail=str(exc))
    if not applied:
        raise HTTPException(status_code=404, detail="Withdrawal not found, or already decided")
    log_admin_action(
        admin_id=admin["id"], action="WITHDRAWAL_APPROVED",
        target_type="withdrawals", target_id=withdrawal_id,
    )
    return AdminWithdrawalDetail(**withdrawal_service.get_admin_detail(withdrawal_id))


@router.post("/withdrawals/{withdrawal_id}/reject", response_model=AdminWithdrawalDetail)
def withdrawal_reject(withdrawal_id: str, body: RejectWithdrawalRequest, admin: dict = Depends(get_current_admin)):
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="A rejection reason is required")
    applied = withdrawal_service.reject_withdrawal(withdrawal_id, body.reason.strip())
    if not applied:
        raise HTTPException(status_code=404, detail="Withdrawal not found, or already decided")
    log_admin_action(
        admin_id=admin["id"], action="WITHDRAWAL_REJECTED",
        target_type="withdrawals", target_id=withdrawal_id,
        metadata={"reason": body.reason.strip()},
    )
    return AdminWithdrawalDetail(**withdrawal_service.get_admin_detail(withdrawal_id))
