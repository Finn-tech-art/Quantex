# Pydantic request/response models for the Withdrawal module (Phase 4,
# module 2). The user-facing request/confirm/list endpoints live in
# routers/withdrawals.py; the admin approval-queue endpoints live in
# routers/admin.py's withdrawals section (same file/router split as every
# other admin-vs-user pair in this app — see admin.py's own module comment).
# See withdrawal_service.py for the full two-step (request -> OTP confirm)
# flow and the validation rules these models are shaped around.

from datetime import datetime

from pydantic import BaseModel


# ── User-facing ──────────────────────────────────────────────────────────────
class WithdrawalRequestBody(BaseModel):
    # asset/network are plain string codes ("USDT" / "TRC20" etc — matching
    # assets.code / networks.code in quantex-schema.sql) rather than numeric
    # database ids, same convention DepositAddressResponse.network already
    # uses in models/wallet.py, so the frontend never has to know Postgres's
    # internal smallint ids.
    asset: str
    network: str
    destination_address: str
    # A decimal STRING, not a float — same reasoning as
    # CreateSimulatedBotRequest.allocation_amount in models/bot.py: a float
    # round-trips through JSON with binary rounding error, which is never
    # acceptable for a value headed into a NUMERIC ledger column. The router
    # converts this with decimal.Decimal(...), which reads a base-10 string
    # exactly with no rounding.
    amount: str


class WithdrawalRequestResponse(BaseModel):
    # The id of the short-lived Redis draft this call created — deliberately
    # NOT a withdrawals.id, because no such database row exists yet at this
    # point. See withdrawal_service.py's module docstring for why the OTP is
    # tied to this draft id rather than to a not-yet-created row. The
    # frontend just holds onto this and passes it back untouched to
    # /withdrawals/confirm.
    request_id: str
    amount: str
    fee_amount: str
    # What would actually leave the platform once approved (amount minus
    # fee) — shown to the user before they commit to the OTP step, the same
    # "you will receive" convention every exchange withdrawal screen uses.
    net_amount: str
    expires_in_seconds: int


class WithdrawalConfirmBody(BaseModel):
    request_id: str
    code: str


class WithdrawalResponse(BaseModel):
    id: str
    status: str  # one of withdrawal_statuses.code — see quantex-schema.sql's seed data
    asset: str
    network: str
    destination_address: str
    amount: str
    fee_amount: str
    # Always null in this module — there is no broadcast worker yet (see
    # withdrawal_service.py's header comment). Kept in the response shape
    # now so the frontend doesn't need a breaking change the day that worker
    # does get built.
    tx_hash: str | None = None
    admin_approved_at: datetime | None = None
    rejection_reason: str | None = None
    created_at: datetime


class WithdrawalListResponse(BaseModel):
    withdrawals: list[WithdrawalResponse]


# ── Admin-facing ─────────────────────────────────────────────────────────────
class AdminWithdrawalSummary(BaseModel):
    id: str
    user_id: str
    user_email: str
    asset: str
    network: str
    destination_address: str
    amount: str
    fee_amount: str
    status: str
    created_at: datetime


class AdminWithdrawalQueueResponse(BaseModel):
    withdrawals: list[AdminWithdrawalSummary]


class AdminWithdrawalDetail(BaseModel):
    id: str
    user_id: str
    user_email: str
    asset: str
    network: str
    destination_address: str
    amount: str
    fee_amount: str
    status: str
    tx_hash: str | None = None
    admin_approved_at: datetime | None = None
    admin_approved_by_email: str | None = None
    rejection_reason: str | None = None
    created_at: datetime


class RejectWithdrawalRequest(BaseModel):
    reason: str
