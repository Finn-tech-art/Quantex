# KYC submission + admin review (Phase 4, module 1). Handles uploading the
# three required documents to the private Storage bucket (see migrations/
# 009_kyc_documents_bucket.sql), writing the kyc_submissions row, and the
# admin-side queue/approve/reject actions. Withdrawals (the other half of
# Phase 4) are a separate, later module — this file only ever reads
# users.kyc_status_id, never gates a withdrawal on it.

from datetime import datetime, timezone
from uuid import uuid4

from app.config import settings
from app.services.supabase_client import get_supabase

# 5MB / JPEG-PNG-PDF-only — the exact limits the architecture doc specifies
# for the KYC upload screen. Change either dict/constant here to loosen or
# tighten what's accepted; nothing else needs to change to do that (the
# router just forwards whatever bytes/content-type it received, unvalidated,
# straight into submit_kyc below).
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
}

# How long an admin's signed document-preview URL stays valid after
# get_admin_submission_detail() generates it — short on purpose (the
# architecture doc calls for "signed short-expiry URLs"): long enough for an
# admin to actually look at the three images/PDFs in one review session,
# short enough that a copy-pasted or accidentally-shared link is useless
# again within minutes. Raise this if reviews are timing out mid-look.
SIGNED_URL_TTL_SECONDS = 300


# Same "fetch the whole small lookup table once, cache it in a plain dict"
# pattern used throughout this codebase (see bot_service.py's own comment
# for the full reasoning) — kept as its own private cache here rather than
# importing auth_service's equivalent across module boundaries.
_status_cache: dict[str, int] = {}
_status_code_cache: dict[int, str] = {}


def _load_statuses() -> None:
    if _status_cache:
        return
    rows = get_supabase().table("kyc_statuses").select("id,code").execute().data
    if not rows:
        raise RuntimeError("Lookup table 'kyc_statuses' returned no rows")
    _status_cache.update({row["code"]: row["id"] for row in rows})
    _status_code_cache.update({row["id"]: row["code"] for row in rows})


def _status_id(code: str) -> int:
    _load_statuses()
    return _status_cache[code]


def _status_code(status_id: int) -> str:
    _load_statuses()
    return _status_code_cache[status_id]


def _bucket():
    return get_supabase().storage.from_(settings.kyc_documents_bucket)


def _validate_file(content: bytes, content_type: str, field_name: str) -> str:
    """Returns the file extension to store this field under, or raises
    ValueError with a message safe to show the user directly (routers/kyc.py
    turns this straight into a 400's detail)."""
    if not content:
        raise ValueError(f"{field_name}: file is empty")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError(f"{field_name}: only JPEG, PNG, or PDF files are accepted")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError(f"{field_name}: file is too large — 5MB maximum")
    return ALLOWED_CONTENT_TYPES[content_type]


# ── User-facing ──────────────────────────────────────────────────────────────
def get_my_submission(user: dict) -> dict:
    """users.kyc_status_id (not the submission row's own status_id) is the
    source of truth for `status` here — same field /auth/me already reads —
    so this and the profile endpoint can never disagree. The submission row
    (if any) only supplies the extra detail /auth/me doesn't carry:
    submitted_at, reviewed_at, rejection_reason."""
    status_code = _status_code(user["kyc_status_id"])
    submission_id = user.get("current_kyc_submission_id")
    if submission_id is None:
        return {
            "id": None, "status": status_code,
            "submitted_at": None, "reviewed_at": None, "rejection_reason": None,
        }

    rows = get_supabase().table("kyc_submissions").select("*").eq("id", submission_id).limit(1).execute().data
    if not rows:
        # Shouldn't happen (current_kyc_submission_id is an FK) — fall back
        # to just the status rather than 500ing the whole profile screen.
        return {
            "id": None, "status": status_code,
            "submitted_at": None, "reviewed_at": None, "rejection_reason": None,
        }

    row = rows[0]
    return {
        "id": row["id"],
        "status": status_code,
        "submitted_at": row["submitted_at"],
        "reviewed_at": row.get("reviewed_at"),
        "rejection_reason": row.get("rejection_reason"),
    }


def submit_kyc(user: dict, files: dict[str, tuple[bytes, str]]) -> dict:
    """`files` must have exactly the keys "id_front", "id_back", "selfie",
    each a (content_bytes, content_type) tuple — see routers/kyc.py's submit
    endpoint, the only caller. Raises ValueError (turned into a 400 by the
    router) if the user already has a submission in flight or approved, or
    if any file fails validation — checked for ALL THREE files before
    uploading ANY of them, so a bad third file never leaves two orphaned
    objects sitting in storage from a submission that's about to fail
    anyway.

    Returns the new kyc_submissions row."""
    current_status = _status_code(user["kyc_status_id"])
    if current_status in ("PENDING", "UNDER_REVIEW", "APPROVED"):
        raise ValueError(f"Cannot submit — your current KYC status is {current_status}")

    extensions = {
        field: _validate_file(content, content_type, field)
        for field, (content, content_type) in files.items()
    }

    user_id = user["id"]
    submission_id = str(uuid4())
    bucket = _bucket()
    paths = {}
    for field, (content, content_type) in files.items():
        path = f"{user_id}/{submission_id}/{field}.{extensions[field]}"
        # upsert=true is a safety net, not the expected path — submission_id
        # is a fresh UUID every call, so this path has never been written to
        # before. It only matters if a previous attempt partially uploaded
        # under this exact id and the caller retried with the same bytes.
        bucket.upload(path, content, {"content-type": content_type, "upsert": "true"})
        paths[field] = path

    pending_id = _status_id("PENDING")
    now = datetime.now(tz=timezone.utc).isoformat()
    inserted = (
        get_supabase()
        .table("kyc_submissions")
        .insert(
            {
                "id": submission_id,
                "user_id": user_id,
                "status_id": pending_id,
                "id_front_url": paths["id_front"],
                "id_back_url": paths["id_back"],
                "selfie_url": paths["selfie"],
                "submitted_at": now,
            }
        )
        .execute()
        .data[0]
    )

    get_supabase().table("users").update(
        {"kyc_status_id": pending_id, "current_kyc_submission_id": submission_id}
    ).eq("id", user_id).execute()

    return inserted


# ── Admin-facing ─────────────────────────────────────────────────────────────
def list_pending_queue() -> list[dict]:
    """Every submission currently awaiting a decision, oldest first (so an
    admin working through the queue top-to-bottom naturally clears the
    longest-waiting user first)."""
    pending_id = _status_id("PENDING")
    rows = (
        get_supabase()
        .table("kyc_submissions")
        .select("*")
        .eq("status_id", pending_id)
        .order("submitted_at")
        .execute()
        .data
    )
    if not rows:
        return []

    user_ids = list({row["user_id"] for row in rows})
    users = get_supabase().table("users").select("id,email").in_("id", user_ids).execute().data
    email_by_id = {u["id"]: u["email"] for u in users}

    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "user_email": email_by_id.get(row["user_id"], "(unknown)"),
            "status": "PENDING",
            "submitted_at": row["submitted_at"],
        }
        for row in rows
    ]


def get_admin_submission_detail(submission_id: str) -> dict | None:
    """None if no submission exists with this id — router turns that into a
    404. Generates fresh signed URLs on every call (see SIGNED_URL_TTL_SECONDS'
    comment) rather than storing/caching them anywhere."""
    rows = get_supabase().table("kyc_submissions").select("*").eq("id", submission_id).limit(1).execute().data
    if not rows:
        return None
    sub = rows[0]

    user_rows = get_supabase().table("users").select("email").eq("id", sub["user_id"]).limit(1).execute().data
    user_email = user_rows[0]["email"] if user_rows else "(unknown)"

    reviewed_by_email = None
    if sub.get("reviewed_by"):
        admin_rows = get_supabase().table("admins").select("email").eq("id", sub["reviewed_by"]).limit(1).execute().data
        reviewed_by_email = admin_rows[0]["email"] if admin_rows else None

    bucket = _bucket()
    return {
        "id": sub["id"],
        "user_id": sub["user_id"],
        "user_email": user_email,
        "status": _status_code(sub["status_id"]),
        "submitted_at": sub["submitted_at"],
        "reviewed_at": sub.get("reviewed_at"),
        "reviewed_by_email": reviewed_by_email,
        "rejection_reason": sub.get("rejection_reason"),
        "id_front_signed_url": bucket.create_signed_url(sub["id_front_url"], SIGNED_URL_TTL_SECONDS)["signedURL"],
        "id_back_signed_url": bucket.create_signed_url(sub["id_back_url"], SIGNED_URL_TTL_SECONDS)["signedURL"],
        "selfie_signed_url": bucket.create_signed_url(sub["selfie_url"], SIGNED_URL_TTL_SECONDS)["signedURL"],
    }


def _decide(submission_id: str, admin_id: str, new_status_code: str, rejection_reason: str | None) -> bool:
    """Shared by approve_submission/reject_submission below. Returns False if
    no such submission exists (router turns that into a 404).

    The users.kyc_status_id write is guarded with
    .eq("current_kyc_submission_id", submission_id) — an atomic, single-
    statement WHERE-clause guard, same technique as
    bot_service.update_bot_config_if_active's fix for the sweep/stop race —
    so if this user has ALREADY resubmitted a newer, different submission by
    the time this decision lands (a real if narrow possibility: nothing
    stops a user resubmitting while an old queue entry is still open in an
    admin's browser), this decision updates ONLY the historical
    kyc_submissions row, never overwrites the user's CURRENT (newer) status
    with a decision about an old one."""
    status_id = _status_id(new_status_code)
    now = datetime.now(tz=timezone.utc).isoformat()

    rows = get_supabase().table("kyc_submissions").select("user_id").eq("id", submission_id).limit(1).execute().data
    if not rows:
        return False
    user_id = rows[0]["user_id"]

    get_supabase().table("kyc_submissions").update(
        {
            "status_id": status_id,
            "reviewed_by": admin_id,
            "reviewed_at": now,
            "rejection_reason": rejection_reason,
        }
    ).eq("id", submission_id).execute()

    (
        get_supabase()
        .table("users")
        .update({"kyc_status_id": status_id})
        .eq("id", user_id)
        .eq("current_kyc_submission_id", submission_id)
        .execute()
    )
    return True


def approve_submission(submission_id: str, admin_id: str) -> bool:
    return _decide(submission_id, admin_id, "APPROVED", rejection_reason=None)


def reject_submission(submission_id: str, admin_id: str, reason: str) -> bool:
    return _decide(submission_id, admin_id, "REJECTED", rejection_reason=reason)
