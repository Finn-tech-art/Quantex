from fastapi import APIRouter, Depends, HTTPException, WebSocket
from gotrue.errors import AuthError

from app.models.deposit import ExpectDepositRequest, ExpectDepositResponse
from app.services.deposit_pending_service import PENDING_TTL_SECONDS, set_pending
from app.services.redis_client import get_redis
from app.services.supabase_client import get_supabase_auth_client
from app.utils.auth import get_current_user
from app.workers.live_deposit_watch import watch_pending_deposit

router = APIRouter(prefix="/deposits", tags=["deposits"])

_SUPPORTED_NETWORKS = {"TRC20", "BASE", "POLYGON"}


@router.post("/expect", response_model=ExpectDepositResponse)
async def expect_deposit(body: ExpectDepositRequest, user: dict = Depends(get_current_user)):
    network = body.network.upper()
    if network not in _SUPPORTED_NETWORKS:
        raise HTTPException(status_code=400, detail=f"Unsupported network: {network}")

    await set_pending(user["id"], network, body.expected_amount)
    watch_pending_deposit.delay(user["id"], network)

    return ExpectDepositResponse(watching=True, ttl_seconds=PENDING_TTL_SECONDS)


async def _user_id_from_token(token: str) -> str | None:
    # Browsers' native WebSocket API can't set an Authorization header, so the
    # access token travels as a query param here instead — same validation
    # get_current_user does, just without the HTTPBearer/Depends plumbing
    # that's built around a normal HTTP request.
    try:
        response = get_supabase_auth_client().auth.get_user(token)
    except AuthError:
        return None
    if response is None or response.user is None:
        return None
    return response.user.id


@router.websocket("/ws")
async def deposits_ws(websocket: WebSocket, token: str):
    await websocket.accept()

    user_id = await _user_id_from_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return

    r = get_redis()
    pubsub = r.pubsub()
    channel = f"deposit_updates:{user_id}"
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
