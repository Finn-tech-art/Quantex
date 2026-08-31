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
    metadata = auth_user.user_metadata or {}
    referral_code = metadata.get("referral_code")
    # first_name/last_name/country come from the same user_metadata bag
    # sign_up() writes them into (see auth_service.sign_up's comment) — for
    # a Google OAuth account none of these keys exist, so all three come
    # back None here, and ensure_user_profile stores that as-is (see
    # 013_users_signup_fields.sql for why the columns allow that).
    first_name = metadata.get("first_name")
    last_name = metadata.get("last_name")
    country = metadata.get("country")
    # email_verified comes straight off the users row (see ensure_user_profile) —
    # not auth_user.email_confirmed_at, which Supabase sets on every signup now
    # that the project's "Confirm email" gate is off and no longer reflects our
    # own OTP-based verification.
    profile = ensure_user_profile(auth_user.id, auth_user.email, referral_code, first_name, last_name, country)

    # Deliberately NOT written into the `users` table row (ensure_user_profile
    # never sees this) — it's read fresh from Supabase's own live OAuth
    # session on every single request instead, then merged onto the profile
    # dict just for this response. That's the right call for something
    # purely cosmetic that Google already keeps current on its end: no
    # migration needed to add a column, and it can never go stale the way a
    # once-saved copy could if someone changes their Google photo later.
    # Google's OAuth metadata sets both "avatar_url" and "picture" to the
    # same URL — checking both means this still works if that ever changes
    # on Supabase/Google's side. None for an email/password account, since
    # user_metadata simply won't have either key.
    profile["avatar_url"] = (auth_user.user_metadata or {}).get("avatar_url") or (
        auth_user.user_metadata or {}
    ).get("picture")
    return profile
