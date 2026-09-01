import json

# Must stay >= live_deposit_watch.MAX_ATTEMPTS * POLL_INTERVAL_SECONDS (20
# minutes) — this is the actual ceiling on how long the live watch can run,
# since is_pending_sync() below returns False the instant this key expires,
# which stops the watch task from rescheduling itself regardless of how many
# attempts it has left.
PENDING_TTL_SECONDS = 20 * 60


def _pending_key(user_id: str, network_code: str) -> str:
    return f"deposit_pending:{user_id}:{network_code}"


def _channel(user_id: str) -> str:
    return f"deposit_updates:{user_id}"


async def set_pending(user_id: str, network_code: str, expected_amount: str | None) -> None:
    """Called from the FastAPI route (async context). Purely disposable UI
    state — no Postgres write, matches the architecture doc exactly."""
    from app.services.redis_client import get_redis

    r = get_redis()
    value = json.dumps({"expected_amount": expected_amount})
    await r.set(_pending_key(user_id, network_code), value, ex=PENDING_TTL_SECONDS)


def is_pending_sync(user_id: str, network_code: str) -> bool:
    """Called from Celery/worker code (sync context)."""
    from app.services.redis_client import get_redis_sync

    return get_redis_sync().exists(_pending_key(user_id, network_code)) > 0


def clear_and_publish_sync(user_id: str, network_code: str, asset_code: str, amount: str, tx_hash: str) -> None:
    """Called after a genuinely new credit (not a dedup no-op). If a live
    session is watching (the pending key still exists), clear it and publish
    so that session's UI resolves instantly instead of waiting out the window."""
    from app.services.redis_client import get_redis_sync

    r = get_redis_sync()
    key = _pending_key(user_id, network_code)
    if not r.exists(key):
        return

    r.delete(key)
    r.publish(
        _channel(user_id),
        json.dumps({"network": network_code, "asset": asset_code, "amount": amount, "tx_hash": tx_hash}),
    )
