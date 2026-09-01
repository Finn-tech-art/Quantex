from app.services.chain_watcher_service import check_single_address
from app.services.deposit_pending_service import is_pending_sync
from app.workers.celery_app import celery_app

# 20 checks x 60s = 20 minutes of live polling (was 10/10 minutes). Must stay
# in lockstep with deposit_pending_service.PENDING_TTL_SECONDS below — that
# Redis key's TTL is what is_pending_sync() checks each attempt, so if this
# window were ever longer than the TTL, the key would expire mid-watch and
# silently cut the polling short before MAX_ATTEMPTS is reached. Verified
# cheap to run at this length: each attempt is one extra TronGrid call (now
# scoped to a single address, not the whole USDT contract — see
# chain_watcher_service._scan_tron) and a couple of trivial Redis ops, both
# negligible even at many times this frequency for a hobby-project user
# count. Raise MAX_ATTEMPTS (and PENDING_TTL_SECONDS to match) further if an
# even longer live window is ever wanted.
MAX_ATTEMPTS = 20
POLL_INTERVAL_SECONDS = 60


@celery_app.task(name="app.workers.live_deposit_watch.watch_pending_deposit")
def watch_pending_deposit(user_id: str, network_code: str, attempt: int = 1) -> None:
    if not is_pending_sync(user_id, network_code):
        return  # window already resolved (credited) or expired — nothing to do

    # Credits internally if a matching transfer is found; that also clears
    # the pending key and publishes, via chain_watcher_service._credit_deposit.
    check_single_address(user_id, network_code)

    if attempt >= MAX_ATTEMPTS:
        return

    if not is_pending_sync(user_id, network_code):
        return  # resolved by the check just above

    watch_pending_deposit.apply_async(
        args=[user_id, network_code, attempt + 1], countdown=POLL_INTERVAL_SECONDS
    )
