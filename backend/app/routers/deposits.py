from fastapi import APIRouter, Depends, HTTPException, WebSocket

from app.models.deposit import ExpectDepositRequest, ExpectDepositResponse
from app.services.deposit_pending_service import PENDING_TTL_SECONDS, set_pending
from app.services.redis_client import get_redis
from app.utils.auth import get_current_user, user_id_from_ws_token
from app.workers.live_deposit_watch import watch_pending_deposit

router = APIRouter(prefix="/deposits", tags=["deposits"])

# Narrowed to TRC-20 only for the mainnet launch (migration
# 019_disable_evm_networks.sql flips the same switch in the DB, via
# networks.is_active). BASE and POLYGON are fully built and working — see
# custody_service.py's EVM sweep section — just not wired up with real
# mainnet credentials yet (no Alchemy mainnet app, no funded relayer
# wallet). Restore "BASE"/"POLYGON" here (and in wallet.py's identical set,
# and DepositPage.jsx's NETWORKS array) once those exist — nothing else
# needs to change.
_SUPPORTED_NETWORKS = {"TRC20"}


@router.post("/expect", response_model=ExpectDepositResponse)
async def expect_deposit(body: ExpectDepositRequest, user: dict = Depends(get_current_user)):
    network = body.network.upper()
    if network not in _SUPPORTED_NETWORKS:
        raise HTTPException(status_code=400, detail=f"Unsupported network: {network}")

    await set_pending(user["id"], network, body.expected_amount)
    watch_pending_deposit.delay(user["id"], network)

    return ExpectDepositResponse(watching=True, ttl_seconds=PENDING_TTL_SECONDS)


@router.websocket("/ws")
async def deposits_ws(websocket: WebSocket, token: str):
    await websocket.accept()

    user_id = await user_id_from_ws_token(token)
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
