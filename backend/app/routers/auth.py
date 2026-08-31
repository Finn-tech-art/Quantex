from fastapi import APIRouter, Depends, HTTPException
from gotrue.errors import AuthError

from app.models.auth import (
    LoginRequest,
    RefreshRequest,
    SetCountryRequest,
    SignupRequest,
    TokenResponse,
    UserProfile,
    VerifyEmailConfirmRequest,
)
from app.services import auth_service
from app.services.otp_service import PURPOSE_EMAIL_VERIFICATION, OtpCooldownError, generate_and_send_otp, verify_otp
from app.utils.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _http_error(exc: AuthError, default_status: int) -> HTTPException:
    # AuthError is the common base for every gotrue exception (AuthApiError,
    # AuthWeakPasswordError, etc.) — only some subclasses actually carry a
    # `.status`, so this can't assume one is present.
    status = getattr(exc, "status", None) or default_status
    message = getattr(exc, "message", None) or str(exc)
    return HTTPException(status_code=status, detail=message)


@router.post("/signup", response_model=TokenResponse)
def signup(body: SignupRequest):
    try:
        tokens = auth_service.sign_up(
            body.email, body.password, body.first_name, body.last_name, body.country, body.referral_code
        )
    except AuthError as exc:
        raise _http_error(exc, 400)
    return TokenResponse(**tokens)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    try:
        tokens = auth_service.sign_in(body.email, body.password)
    except AuthError as exc:
        raise _http_error(exc, 401)
    return TokenResponse(**tokens)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(body: RefreshRequest):
    try:
        tokens = auth_service.refresh(body.refresh_token)
    except AuthError as exc:
        raise _http_error(exc, 401)
    return TokenResponse(**tokens)


@router.get("/me", response_model=UserProfile)
def me(user: dict = Depends(get_current_user)):
    return UserProfile(
        id=user["id"],
        email=user["email"],
        referral_code=user["referral_code"],
        kyc_status=auth_service.kyc_status_code(user["kyc_status_id"]),
        email_verified=user["email_verified"],
        created_at=user["created_at"],
        avatar_url=user.get("avatar_url"),
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        country=user.get("country"),
    )


@router.put("/country", response_model=UserProfile)
def set_country(body: SetCountryRequest, user: dict = Depends(get_current_user)):
    # Backs the one-time picker in ProtectedRoute.jsx — see
    # auth_service.set_country's docstring for who ends up here and why.
    # Rebuilt from `user` (already fetched by get_current_user above) rather
    # than a second query, with country swapped for the just-written value —
    # same shape me() below returns.
    auth_service.set_country(user["id"], body.country)
    return UserProfile(
        id=user["id"],
        email=user["email"],
        referral_code=user["referral_code"],
        kyc_status=auth_service.kyc_status_code(user["kyc_status_id"]),
        email_verified=user["email_verified"],
        created_at=user["created_at"],
        avatar_url=user.get("avatar_url"),
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        country=body.country,
    )


@router.post("/verify-email/send")
async def send_verify_email_otp(user: dict = Depends(get_current_user)):
    if user["email_verified"]:
        return {"sent": False, "reason": "already_verified"}
    try:
        await generate_and_send_otp(
            purpose=PURPOSE_EMAIL_VERIFICATION,
            identifier=user["id"],
            email=user["email"],
            subject="Verify your Quantex email",
            heading="Verify your email",
        )
    except OtpCooldownError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    return {"sent": True}


@router.post("/verify-email/confirm")
async def confirm_verify_email_otp(
    body: VerifyEmailConfirmRequest, user: dict = Depends(get_current_user)
):
    ok = await verify_otp(PURPOSE_EMAIL_VERIFICATION, user["id"], body.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    auth_service.mark_email_verified(user["id"])
    return {"verified": True}
