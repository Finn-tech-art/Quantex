# Thin writer for `admin_audit_log` — every admin action that changes state
# (not just win-rate, eventually also KYC approvals, withdrawal approvals,
# user suspensions per the Phase 4/6 build-plan items) should call this so
# there's one place in the DB an admin's history can be reconstructed from.
# A plain insert is enough here, same reasoning as bot_fill_service.py's
# record_fill: this is an append-only log, not money moving between
# accounts, so it doesn't need ledger_entries' dedup/overdraft-safe RPC.

from app.services.supabase_client import get_supabase


def log_admin_action(admin_id: str, action: str, target_type: str, target_id: str, metadata: dict | None = None) -> None:
    get_supabase().table("admin_audit_log").insert(
        {
            "admin_id": admin_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "metadata": metadata or {},
        }
    ).execute()
