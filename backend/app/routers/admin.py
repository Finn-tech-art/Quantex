# Admin-facing endpoints — everything under here except /admin/auth/login
# requires a valid admin session token (get_current_admin), which is a
# completely different credential from the regular Bearer token every other
# router in this app expects (see utils/admin_auth.py / admin_auth_service.py
# for why). Do not add Depends(get_current_user) anywhere in this file.

from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.models.admin import (
    AdminLoginRequest,
    AdminProfile,
    AdminTokenResponse,
    ConsolidationAddressEntry,
    ConsolidationAddressesResponse,
    GenerateKeypairRequest,
    GeneratedKeypairResponse,
    PendingSweepEntry,
    PendingSweepsResponse,
    QueuedSweepEntry,
    SetConsolidationAddressRequest,
    SetWinRateRequest,
    SweepHistoryEntry,
    SweepHistoryResponse,
    SweepNowResponse,
    WinRateResponse,
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
from app.services import admin_auth_service, custody_service, kyc_service, win_rate_service, withdrawal_service
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
