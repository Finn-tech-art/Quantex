# User-facing withdrawal endpoints — request an amount/network/destination,
# confirm it with the emailed OTP, and see your own withdrawal history. The
# admin approval-queue endpoints live in routers/admin.py instead (same
# split as kyc.py/admin.py — see admin.py's own module comment for why).

from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, WebSocket

from app.models.withdrawal import (
    WithdrawalConfirmBody,
    WithdrawalFeePreviewResponse,
    WithdrawalListResponse,
    WithdrawalRequestBody,
    WithdrawalRequestResponse,
    WithdrawalResendCodeBody,
    WithdrawalResendCodeResponse,
    WithdrawalResponse,
)
from app.services import withdrawal_fee_service, withdrawal_service
from app.services.otp_service import OtpCooldownError
from app.services.redis_client import get_redis
from app.utils.auth import get_current_user, user_id_from_ws_token

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])


@router.get("/fee", response_model=WithdrawalFeePreviewResponse)
def get_withdrawal_fee(user: dict = Depends(get_current_user)):
    # Lets WithdrawPage.jsx preview an accurate fee before submitting,
    # instead of hardcoding a copy of whatever an admin last set — see
    # WithdrawalFeePreviewResponse's docstring in models/withdrawal.py.
    return WithdrawalFeePreviewResponse(fee_amount=str(withdrawal_fee_service.get_current_fee()["fee_amount"]))


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


@router.post("/resend-code", response_model=WithdrawalResendCodeResponse)
async def resend_withdrawal_code(body: WithdrawalResendCodeBody, user: dict = Depends(get_current_user)):
    # Re-sends the OTP for a draft already created by /request — for a user
    # who didn't get the email, or let it get buried, while still on the OTP
    # screen. Does not touch the draft's own content or create a new one;
    # see withdrawal_service.resend_code's docstring for exactly what it
    # does and doesn't do.
    try:
        result = await withdrawal_service.resend_code(user, body.request_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OtpCooldownError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    return WithdrawalResendCodeResponse(**result)


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


@router.websocket("/ws")
async def withdrawals_ws(websocket: WebSocket, token: str):
    # Same shape as deposits.py's own /deposits/ws — see
    # withdrawal_service._publish_status_update's docstring for what gets
    # published here (a bare {"withdrawal_id", "status"} on every admin
    # approve/reject) and user_id_from_ws_token's docstring for why the
    # token travels as a query param instead of an Authorization header.
    # WithdrawPage.jsx doesn't actually need the payload's contents — it
    # just refetches its whole list on any message, same as
    # UnlockFeeCard.jsx's polling already does — so this never needs richer
    # payloads even if more status transitions get published later.
    await websocket.accept()

    user_id = await user_id_from_ws_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return

    r = get_redis()
    pubsub = r.pubsub()
    channel = f"withdrawal_updates:{user_id}"
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            await websocket.send_text(message["data"])
    except Exception:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
