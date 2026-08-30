from app.services.chain_watcher_service import check_single_address
from app.services.deposit_pending_service import is_pending_sync
from app.workers.celery_app import celery_app

MAX_ATTEMPTS = 10
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
