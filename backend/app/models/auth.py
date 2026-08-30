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
