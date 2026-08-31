# User-facing withdrawal-unlock-fee endpoints — "what do I still owe" and
# "start paying one of them." The admin-facing fee-type management
# endpoints (create/list/activate/deactivate) live in routers/admin.py
# instead, same split as every other admin-vs-user pair in this app (see
# admin.py's own module comment). See withdrawal_unlock_fee_service.py's
# module comment for the full design these two endpoints are the frontend
# half of.

from fastapi import APIRouter, Depends, HTTPException

from app.models.withdrawal_unlock_fee import (
    PayUnlockFeeRequest,
    PayUnlockFeeResponse,
    UnlockFeeType,
    UnpaidFeesResponse,
)
from app.services import wallet_service, withdrawal_unlock_fee_service
from app.utils.auth import get_current_user

router = APIRouter(prefix="/withdrawal-fees", tags=["withdrawal-fees"])


@router.get("/mine", response_model=UnpaidFeesResponse)
def my_unpaid_fees(user: dict = Depends(get_current_user)):
    fees = withdrawal_unlock_fee_service.get_unpaid_active_fees_for_user(user["id"])
    return UnpaidFeesResponse(fees=[UnlockFeeType(**f) for f in fees])


@router.post("/{fee_type_id}/pay", response_model=PayUnlockFeeResponse)
def pay_unlock_fee(fee_type_id: str, body: PayUnlockFeeRequest, user: dict = Depends(get_current_user)):
    network_code = body.network.upper()

    try:
        result = withdrawal_unlock_fee_service.create_payment_intent(user["id"], fee_type_id, network_code)
    except withdrawal_unlock_fee_service.FeeTypeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        # Covers an unknown network code, or a network that doesn't carry
        # this fee's asset — see create_payment_intent's own validation, a
        # plain ValueError with a message that's always safe to show the
        # user directly.
        raise HTTPException(status_code=400, detail=str(exc))

    fee = {k: v for k, v in result.items() if k != "network"}

    # Deliberately the user's SAME deposit address every other network
    # transfer to them uses — there is no separate "fee payment address";
    # see withdrawal_unlock_fee_service.py's module comment for how a
    # payment on this shared address gets told apart from an ordinary
    # deposit once it arrives on-chain.
    deposit_address = wallet_service.get_or_create_deposit_address(user["id"], network_code)

    return PayUnlockFeeResponse(fee=UnlockFeeType(**fee), network=network_code, deposit_address=deposit_address)
