# Deposit consolidation sweep — Module 2 (Tron/USDT) and Module 3
# (Base/Polygon USDC via EIP-3009). Deliberately NOT on celery_app's
# beat_schedule: per the architecture doc, consolidation is admin-triggered
# only ("Sweep Now" in the admin panel, Module 4 — not yet built), never
# run on a timer. These tasks exist so that trigger can call `.delay(...)`
# and get the on-chain wait off the request thread, not because anything
# schedules them automatically. Contrast with deposit_sweep.py, which *is*
# scheduled — that one is the unrelated twice-daily detection backstop, not
# this consolidation sweep. See custody_service.py for the actual logic and
# its failure-mode handling — both tasks here are thin wrappers.

from app.services import custody_service
from app.services.supabase_client import get_supabase
from app.workers.celery_app import celery_app


def _load_wallet(wallet_id: str) -> dict | None:
    rows = (
        get_supabase()
        .table("wallets")
        .select("id,deposit_address,derivation_index")
        .eq("id", wallet_id)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


@celery_app.task(name="app.workers.consolidate_deposits.sweep_tron_wallet")
def sweep_tron_wallet(wallet_id: str) -> dict:
    wallet_row = _load_wallet(wallet_id)
    if wallet_row is None:
        return {"status": "failed", "error": f"No wallet found with id {wallet_id}"}
    return custody_service.sweep_tron_usdt_deposit(wallet_row)


@celery_app.task(name="app.workers.consolidate_deposits.sweep_evm_wallet")
def sweep_evm_wallet(wallet_id: str, network_code: str) -> dict:
    wallet_row = _load_wallet(wallet_id)
    if wallet_row is None:
        return {"status": "failed", "error": f"No wallet found with id {wallet_id}"}
    return custody_service.sweep_evm_usdc_deposit(wallet_row, network_code)
