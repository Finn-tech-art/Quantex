# FastAPI dependency guarding every /admin/* route that isn't the login
# endpoint itself. Mirrors utils/auth.py's get_current_user in shape (both
# take a Bearer token, both return the authenticated row as a dict) but
# checks a completely different credential — see admin_auth_service.py's
# module comment for why admins can't reuse get_current_user/Supabase Auth.

import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services.admin_auth_service import decode_admin_token, get_admin_by_id

admin_bearer_scheme = HTTPBearer()


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Security(admin_bearer_scheme),
) -> dict:
    token = credentials.credentials
    try:
        payload = decode_admin_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin session")

    admin = get_admin_by_id(payload["sub"])
    if admin is None:
        # The token's signature/expiry checked out, but the admin row it
        # points at is gone (deleted since the token was issued) — treat
        # that exactly like an invalid token rather than a 404, so this
        # can't be used to fingerprint whether a given admin id ever existed.
        raise HTTPException(status_code=401, detail="Invalid or expired admin session")
    return admin
