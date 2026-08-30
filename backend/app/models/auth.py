from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    referral_code: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class VerifyEmailConfirmRequest(BaseModel):
    code: str


class UserProfile(BaseModel):
    id: str
    email: str
    referral_code: str
    kyc_status: str
    email_verified: bool
    created_at: str
    # Only ever set for a Google-OAuth login — Supabase puts Google's
    # profile photo URL in the auth user's own user_metadata (see
    # get_current_user in utils/auth.py, which is where this actually gets
    # read). None for an email/password account, since there's no photo to
    # show — the frontend falls back to a plain initial-letter circle
    # whenever this is None (see MenuPage.jsx).
    avatar_url: str | None = None
