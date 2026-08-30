# User-facing KYC endpoints — submit documents, check status. The admin
# review-queue endpoints live in routers/admin.py instead (same split as
# every other admin-vs-user pair in this app: admin.py requires a
# get_current_admin session, this file requires the regular get_current_user
# Supabase token — see admin.py's own module comment for why those are never
# mixed in one file).

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.models.kyc import MySubmissionResponse
from app.services import kyc_service
from app.utils.auth import get_current_user

router = APIRouter(prefix="/kyc", tags=["kyc"])


@router.get("/status", response_model=MySubmissionResponse)
def my_status(user: dict = Depends(get_current_user)):
    return MySubmissionResponse(**kyc_service.get_my_submission(user))


@router.post("/submit", response_model=MySubmissionResponse)
async def submit(
    id_front: UploadFile = File(...),
    id_back: UploadFile = File(...),
    selfie: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Reads all three uploads into memory here (files are capped at 5MB
    each by kyc_service.MAX_UPLOAD_BYTES, so this is never more than ~15MB
    per request) rather than streaming them — simplest correct thing at this
    scale, and it's what lets submit_kyc validate everything before
    uploading anything (see that function's docstring)."""
    files = {}
    for field, upload in (("id_front", id_front), ("id_back", id_back), ("selfie", selfie)):
        files[field] = (await upload.read(), upload.content_type or "")

    try:
        result = kyc_service.submit_kyc(user, files)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return MySubmissionResponse(
        id=result["id"],
        status="PENDING",
        submitted_at=result["submitted_at"],
        reviewed_at=None,
        rejection_reason=None,
    )
