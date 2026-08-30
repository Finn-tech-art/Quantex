# User-facing withdrawal endpoints — request an amount/network/destination,
# confirm it with the emailed OTP, and see your own withdrawal history. The
# admin approval-queue endpoints live in routers/admin.py instead (same
# split as kyc.py/admin.py — see admin.py's own module comment for why).

from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException

from app.models.withdrawal import (
    WithdrawalConfirmBody,
    WithdrawalListResponse,
    WithdrawalRequestBody,
    WithdrawalRequestResponse,
    WithdrawalResponse,
)
from app.services import withdrawal_service
from app.services.otp_service import OtpCooldownError
from app.utils.auth import get_current_user

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])


@router.post("/request", response_model=WithdrawalRequestResponse)
async def request_withdrawal(body: WithdrawalRequestBody, user: dict = Depends(get_current_user)):
    # Same pattern as routers/bots.py's create_bot(): the model carries
    # `amount` as a plain string (never a float — see models/withdrawal.py's
    # comment on WithdrawalRequestBody.amount), converted to a Decimal here
    # at the edge of the request, before any business logic sees it.
    try:
        amount = Decimal(body.amount)
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="amount must be a valid decimal string")

    try:
        result = await withdrawal_service.create_request(
            user, body.asset, body.network, body.destination_address, amount
        )
    except ValueError as exc:
        # Covers withdrawal_service.WithdrawalValidationError AND
        # custody_service.UnknownNetwork / InvalidDestinationAddress — all
        # three are ValueError subclasses with a message that's always safe
        # to show the user directly (see each one's own docstring).
        raise HTTPException(status_code=400, detail=str(exc))
    except OtpCooldownError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    return WithdrawalRequestResponse(**result)


@router.post("/confirm", response_model=WithdrawalResponse)
async def confirm_withdrawal(body: WithdrawalConfirmBody, user: dict = Depends(get_current_user)):
    try:
        result = await withdrawal_service.confirm_request(user, body.request_id, body.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return WithdrawalResponse(**result)


@router.get("", response_model=WithdrawalListResponse)
def my_withdrawals(user: dict = Depends(get_current_user)):
    return WithdrawalListResponse(
        withdrawals=[WithdrawalResponse(**w) for w in withdrawal_service.list_my_withdrawals(user["id"])]
    )
