from app.services.chain_watcher_service import sweep_all_networks
from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.deposit_sweep.run_deposit_sweep")
def run_deposit_sweep() -> None:
    sweep_all_networks()
