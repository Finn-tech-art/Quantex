from datetime import datetime

from pydantic import BaseModel


# ── User-facing ──────────────────────────────────────────────────────────────
class MySubmissionResponse(BaseModel):
    # None on a brand-new account that has never submitted anything — the
    # frontend shows the upload form in that case rather than a status card.
    id: str | None = None
    status: str  # one of kyc_statuses.code — see quantex-schema.sql's comment
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    # Only ever set when status == "REJECTED" — what the admin typed as the
    # reason, shown back to the user so they know what to fix before
    # resubmitting (REJECTED is not a terminal status precisely so this
    # resubmit path exists — see the schema's own comment on that seed row).
    rejection_reason: str | None = None


# ── Admin-facing ─────────────────────────────────────────────────────────────
class AdminKycSubmissionSummary(BaseModel):
    id: str
    user_id: str
    user_email: str
    status: str
    submitted_at: datetime


class AdminKycQueueResponse(BaseModel):
    submissions: list[AdminKycSubmissionSummary]


class AdminKycSubmissionDetail(BaseModel):
    id: str
    user_id: str
    user_email: str
    status: str
    submitted_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by_email: str | None = None
    rejection_reason: str | None = None
    # Short-expiry signed URLs (see kyc_service.get_admin_submission_detail) —
    # generated fresh on every call to this endpoint, never stored. Expired
    # by the time anyone could usefully share/leak one — see that function's
    # docstring for the exact TTL and how to change it.
    id_front_signed_url: str
    id_back_signed_url: str
    selfie_signed_url: str


class RejectKycRequest(BaseModel):
    reason: str
