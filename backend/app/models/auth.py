from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    # Required (not Optional) for every manual signup — the frontend form
    # enforces this with `required` <input>/<select> attributes, and this
    # model enforces it again server-side so nothing can post around the
    # form and leave these blank. Google OAuth accounts never go through
    # this model at all (see 013_users_signup_fields.sql's header comment),
    # so this requirement never blocks that path.
    first_name: str
    last_name: str
    # ISO 3166-1 alpha-2 code (e.g. "US", "KE") — must be one of the codes in
    # frontend/src/data/countries.js's list, which is what the signup
    # dropdown is built from.
    country: str
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


class SetCountryRequest(BaseModel):
    # Same ISO 3166-1 alpha-2 code SignupRequest.country uses. This endpoint
    # backs the one-time country picker in ProtectedRoute.jsx, which every
    # signed-in user with a still-null country gets routed through — most
    # commonly a Google OAuth signup, which never goes through SignupRequest
    # at all, but also any pre-existing account from before country was
    # collected.
    country: str


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
    # All three Optional/None-default here (unlike SignupRequest's required
    # versions above) because an existing row from before this migration, or
    # a Google-OAuth account that never went through the signup form, can
    # have any or all of them unset — see 013_users_signup_fields.sql.
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
