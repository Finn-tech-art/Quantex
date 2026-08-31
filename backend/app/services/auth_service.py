import secrets
import string

from postgrest.exceptions import APIError

from app.services.supabase_client import get_supabase, get_supabase_auth_client


def _generate_referral_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


_lookup_cache: dict[str, dict] = {}


def _lookup(table: str) -> dict:
    """Static reference tables (statuses, networks, etc.) rarely change, so fetch
    each one in full, once, rather than issuing per-row filtered queries. A plain
    dict (not lru_cache) is used deliberately: lru_cache would permanently cache a
    transient empty/failed fetch, wedging every request after it for the rest of
    the process's life. Failing loudly and letting the next call retry is safer."""
    if table in _lookup_cache:
        return _lookup_cache[table]

    rows = get_supabase().table(table).select("id,code").execute().data
    if not rows:
        raise RuntimeError(f"Lookup table '{table}' returned no rows")

    result = {
        "by_code": {row["code"]: row["id"] for row in rows},
        "by_id": {row["id"]: row["code"] for row in rows},
    }
    _lookup_cache[table] = result
    return result


def _status_id(table: str, code: str) -> int:
    return _lookup(table)["by_code"][code]


def kyc_status_code(status_id: int) -> str:
    return _lookup("kyc_statuses")["by_id"][status_id]


def _resolve_referred_by(referral_code: str | None) -> str | None:
    if not referral_code:
        return None
    result = (
        get_supabase()
        .table("users")
        .select("id")
        .eq("referral_code", referral_code)
        .limit(1)
        .execute()
    )
    return result.data[0]["id"] if result.data else None


def ensure_user_profile(
    user_id: str,
    email: str,
    referral_code: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    country: str | None = None,
) -> dict:
    existing = (
        get_supabase().table("users").select("*").eq("id", user_id).limit(1).execute()
    )
    if existing.data:
        return existing.data[0]

    referred_by = _resolve_referred_by(referral_code)
    kyc_status_id = _status_id("kyc_statuses", "UNSUBMITTED")

    for _ in range(5):
        try:
            inserted = (
                get_supabase()
                .table("users")
                .insert(
                    {
                        "id": user_id,
                        "email": email,
                        "referral_code": _generate_referral_code(),
                        "referred_by": referred_by,
                        "kyc_status_id": kyc_status_id,
                        "first_name": first_name,
                        "last_name": last_name,
                        "country": country,
                    }
                )
                .execute()
            )
            return inserted.data[0]
        except APIError as exc:
            if exc.code == "23505" and "referral_code" in (exc.details or ""):
                continue
            if exc.code == "23505":
                # Row already created by a concurrent request — fetch and return it.
                existing = (
                    get_supabase()
                    .table("users")
                    .select("*")
                    .eq("id", user_id)
                    .limit(1)
                    .execute()
                )
                if existing.data:
                    return existing.data[0]
            raise

    raise RuntimeError("Failed to generate a unique referral code after 5 attempts")


def sign_up(
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    country: str,
    referral_code: str | None = None,
) -> dict:
    # With Supabase's "Confirm email" gate turned off, self-service sign_up returns
    # a usable session immediately — the account isn't gated on any Supabase-native
    # confirmation step. Our own email-verification is a separate, dashboard-driven
    # OTP flow (see otp_service) that doesn't block login.
    #
    # first_name/last_name/country/referral_code all get written into
    # Supabase's user_metadata (the "options.data" bag) as well as being
    # passed directly to ensure_user_profile() below — the direct call
    # handles the normal case (this same request creates the profile row
    # right now), and user_metadata is what get_current_user (utils/auth.py)
    # falls back to reading on every later request, so the profile still
    # gets these fields even if this call's own ensure_user_profile
    # somehow never ran. Same belt-and-suspenders pattern this file already
    # used for referral_code alone before this change.
    result = get_supabase_auth_client().auth.sign_up(
        {
            "email": email,
            "password": password,
            "options": {
                "data": {
                    "first_name": first_name,
                    "last_name": last_name,
                    "country": country,
                    **({"referral_code": referral_code} if referral_code else {}),
                }
            },
        }
    )
    if result.session is None:
        raise RuntimeError(
            "Signup did not return a session — check that Supabase's "
            "'Confirm email' project setting is disabled"
        )

    ensure_user_profile(result.user.id, result.user.email, referral_code, first_name, last_name, country)
    return {
        "access_token": result.session.access_token,
        "refresh_token": result.session.refresh_token,
    }


def sign_in(email: str, password: str) -> dict:
    session = get_supabase_auth_client().auth.sign_in_with_password(
        {"email": email, "password": password}
    )
    return {
        "access_token": session.session.access_token,
        "refresh_token": session.session.refresh_token,
    }


def refresh(refresh_token: str) -> dict:
    session = get_supabase_auth_client().auth.refresh_session(refresh_token)
    return {
        "access_token": session.session.access_token,
        "refresh_token": session.session.refresh_token,
    }


def mark_email_verified(user_id: str) -> None:
    get_supabase().table("users").update({"email_verified": True}).eq("id", user_id).execute()
