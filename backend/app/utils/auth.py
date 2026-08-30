from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from gotrue.errors import AuthError

from app.services.auth_service import ensure_user_profile
from app.services.supabase_client import get_supabase_auth_client

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    token = credentials.credentials
    try:
        # A fresh, throwaway client — see get_supabase()'s docstring for why
        # get_user() must never run on the shared service-role client.
        response = get_supabase_auth_client().auth.get_user(token)
    except AuthError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    auth_user = response.user
    referral_code = (auth_user.user_metadata or {}).get("referral_code")
    # email_verified comes straight off the users row (see ensure_user_profile) —
    # not auth_user.email_confirmed_at, which Supabase sets on every signup now
    # that the project's "Confirm email" gate is off and no longer reflects our
    # own OTP-based verification.
    return ensure_user_profile(auth_user.id, auth_user.email, referral_code)
