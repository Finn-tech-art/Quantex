# Pydantic request/response models for withdrawal unlock fees — the
# admin-managed library of named, one-time fees that gate withdrawals
# platform-wide. See withdrawal_unlock_fee_service.py's module comment for
# the full design, and models/withdrawal.py's own header comment for why
# user-facing and admin-facing models live together in one file with a
# section split, same convention this file follows.

from pydantic import BaseModel


# ── Shared ────────────────────────────────────────────────────────────────────
class UnlockFeeType(BaseModel):
    id: str
    name: str
    asset: str
    # Decimal STRING, not a float — same convention as every other
    # money-bearing value in this API (see WithdrawalRequestBody.amount in
    # models/withdrawal.py for the full reasoning).
    amount: str
    is_active: bool
    created_at: str


# ── User-facing ──────────────────────────────────────────────────────────────
class UnpaidFeesResponse(BaseModel):
    # Every currently-active fee type this user has not yet paid — empty
    # means nothing is blocking their next withdrawal request. Backs GET
    # /withdrawal-fees/mine, which WithdrawPage.jsx checks before letting a
    # user reach the withdraw form at all.
    fees: list[UnlockFeeType]


class PayUnlockFeeRequest(BaseModel):
    # Which network to pay on — must be one of the networks that carry the
    # fee type's asset (same _ASSET_NETWORKS mapping withdrawal_unlock_fee_
    # service.py builds, e.g. USDT -> TRC20; narrowed to TRC-20 only for the
    # mainnet launch, see migration 019_disable_evm_networks.sql).
    network: str


class PayUnlockFeeResponse(BaseModel):
    fee: UnlockFeeType
    network: str
    deposit_address: str


# ── Admin-facing ─────────────────────────────────────────────────────────────
class UnlockFeeTypesResponse(BaseModel):
    fee_types: list[UnlockFeeType]


class CreateUnlockFeeTypeRequest(BaseModel):
    name: str
    asset: str
    amount: str


class SetUnlockFeeTypeActiveRequest(BaseModel):
    is_active: bool
