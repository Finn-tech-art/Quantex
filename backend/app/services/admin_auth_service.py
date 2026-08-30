# Admin authentication — deliberately separate from auth_service.py /
# utils/auth.py, which handle regular platform *users* through Supabase Auth
# (GoTrue). Admins are NOT Supabase Auth users — the `admins` table (see
# quantex-schema.sql, "ADMINS (operationally separate from regular platform
# users)") is a flat, standalone table with its own email + bcrypt password
# hash. Because Supabase Auth never sees an admin login, this service has to
# do the two things GoTrue would normally do for us:
#   1. Verify a password against a stored hash (bcrypt, below).
#   2. Issue and verify our own signed session token (PyJWT, below) — this is
#      NOT a Supabase access token, and get_current_user (utils/auth.py) will
#      never accept one; admin routes use get_current_admin
#      (utils/admin_auth.py) instead, which only accepts tokens from here.

import time

import bcrypt
import jwt

from app.config import settings
from app.services.supabase_client import get_supabase

# How long an admin session token stays valid before a fresh login is
# required. This is a single-superadmin hobby setup, not a multi-admin SaaS,
# so a generous window is fine — raise/lower this if you want to be logged
# out of /admin sooner or later.
TOKEN_TTL_SECONDS = 12 * 60 * 60  # 12 hours

_JWT_ALGORITHM = "HS256"


def hash_password(plain_password: str) -> str:
    """Used by scripts/create_admin.py when seeding/updating an admin's
    password — never called from a request path (there's no self-serve admin
    signup endpoint, on purpose)."""
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _find_admin_by_email(email: str) -> dict | None:
    rows = (
        get_supabase()
        .table("admins")
        .select("id,email,password_hash")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def verify_admin_login(email: str, password: str) -> dict | None:
    """Returns the admin row {id, email} on success, or None on a bad
    email/password. Deliberately returns None rather than raising for a bad
    password — same reasoning as most login flows: the caller (router) maps
    None to a generic 401, so a wrong password and an unknown email look
    identical to whoever's making the request."""
    admin = _find_admin_by_email(email)
    if admin is None:
        return None
    if not bcrypt.checkpw(password.encode("utf-8"), admin["password_hash"].encode("utf-8")):
        return None
    return {"id": admin["id"], "email": admin["email"]}


def create_admin_token(admin_id: str, email: str) -> str:
    now = int(time.time())
    payload = {
        "sub": admin_id,
        "email": email,
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
        # Distinguishes an admin token from any other JWT floating around
        # (there is currently only this one kind, but get_current_admin below
        # checks this explicitly rather than assuming — see its comment).
        "aud": "quantex-admin",
    }
    return jwt.encode(payload, settings.admin_jwt_secret, algorithm=_JWT_ALGORITHM)


def decode_admin_token(token: str) -> dict:
    """Raises jwt.PyJWTError (or a subclass — ExpiredSignatureError,
    InvalidSignatureError, etc.) on any invalid/expired/tampered token; the
    caller (get_current_admin) is what turns that into an HTTP 401."""
    return jwt.decode(
        token,
        settings.admin_jwt_secret,
        algorithms=[_JWT_ALGORITHM],
        audience="quantex-admin",
    )


def get_admin_by_id(admin_id: str) -> dict | None:
    """Re-fetches the admin row on every authenticated request (see
    get_current_admin) rather than trusting the JWT payload alone — this is
    what makes deleting an admin's row actually revoke their access
    immediately, instead of waiting up to TOKEN_TTL_SECONDS for a stale token
    to expire on its own."""
    rows = (
        get_supabase()
        .table("admins")
        .select("id,email")
        .eq("id", admin_id)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None
