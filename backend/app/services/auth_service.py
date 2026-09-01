import secrets
import string

from postgrest.exceptions import APIError

from app.services.supabase_client import get_supabase, get_supabase_auth_client


def _generate_referral_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


# Word lists behind the auto-generated username (e.g. "north_star",
# "right_wing") — see 018_usernames_and_avatars.sql's own comment on
# `username` for why this is auto-assigned rather than user-typed. Kept
# short and deliberately plain/neutral (no slang, nothing that reads oddly
# combined with an unrelated noun) since every adjective can end up paired
# with every noun — add words here freely, there's no ordering or pairing
# logic to maintain, just avoid anything that could land badly in a
# combination you haven't previewed.
_USERNAME_ADJECTIVES = [
    "north", "quiet", "bold", "silent", "swift", "bright", "iron", "wild",
    "lone", "still", "sharp", "deep", "high", "cool", "grand", "true",
    "keen", "brave", "clear", "far",
]
_USERNAME_NOUNS = [
    "star", "wing", "falcon", "comet", "ridge", "harbor", "ember", "current",
    "summit", "drift", "orbit", "canyon", "tide", "spark", "grove", "hollow",
    "cipher", "beacon", "arrow", "frost",
]


def _generate_username(suffixed: bool = False) -> str:
    """A random "adjective_noun" handle, e.g. "north_star". `suffixed` adds a
    random 4-digit number on the end (e.g. "north_star_4821") — used only on
    a retry after a plain combination already collided with an existing
    username, so a user practically never actually sees a suffixed handle;
    it exists purely to guarantee termination of the retry loops below
    without ever needing to grow the word lists."""
    handle = f"{secrets.choice(_USERNAME_ADJECTIVES)}_{secrets.choice(_USERNAME_NOUNS)}"
    if suffixed:
        handle = f"{handle}_{secrets.randbelow(9000) + 1000}"
    return handle


# The number of entries in frontend/src/components/AvatarGlyph.jsx's
# AVATAR_OPTIONS array, MINUS 1 (so this is the highest valid avatar_id,
# not the count) — see 018_usernames_and_avatars.sql's comment on
# `avatar_id` for why this is a hand-kept-in-sync Python constant rather
# than a CHECK constraint or lookup table. Update this the moment a new
# avatar is added to (or removed from) that array, or set_avatar() below
# will wrongly accept/reject valid indices.
MAX_AVATAR_ID = 11


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
        profile = existing.data[0]
        # Lazy backfill for any account created before 018_usernames_and_
        # avatars.sql — this function already runs on every authenticated
        # request (see get_current_user in utils/auth.py), so every
        # pre-existing row self-heals the next time its owner is seen,
        # with no separate one-off backfill script needed. avatar_id needs
        # no equivalent here: its column DEFAULT already gives every row
        # (old or new) a valid value the moment this migration runs.
        if not profile.get("username"):
            profile["username"] = _assign_username(user_id)
        return profile

    referred_by = _resolve_referred_by(referral_code)
    kyc_status_id = _status_id("kyc_statuses", "UNSUBMITTED")

    for attempt in range(5):
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
                        "username": _generate_username(suffixed=attempt > 0),
                    }
                )
                .execute()
            )
            return inserted.data[0]
        except APIError as exc:
            if exc.code == "23505" and (
                "referral_code" in (exc.details or "") or "username" in (exc.details or "")
            ):
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

    raise RuntimeError("Failed to generate a unique referral code or username after 5 attempts")


def _assign_username(user_id: str) -> str:
    """Backfills a username onto an existing row that predates
    018_usernames_and_avatars.sql — see ensure_user_profile's own comment on
    why this only ever runs for a pre-existing account, never a brand-new
    one (which gets its username inline in the insert() above instead).
    Same retry-on-collision shape as that insert loop, just as an UPDATE."""
    for attempt in range(5):
        candidate = _generate_username(suffixed=attempt > 0)
        try:
            get_supabase().table("users").update({"username": candidate}).eq(
                "id", user_id
            ).execute()
            return candidate
        except APIError as exc:
            if exc.code == "23505" and "username" in (exc.details or ""):
                continue
            raise

    raise RuntimeError(f"Failed to backfill a unique username for user {user_id} after 5 attempts")


def set_avatar(user_id: str, avatar_id: int) -> dict:
    """Backs PUT /auth/avatar. Range-checks against MAX_AVATAR_ID here
    (rather than relying only on a DB constraint) so a bad request gets a
    clean validation error instead of a raw Postgres error surfacing
    through the API — see MAX_AVATAR_ID's own comment for why this is a
    hand-kept-in-sync constant rather than a CHECK constraint."""
    if not 0 <= avatar_id <= MAX_AVATAR_ID:
        raise ValueError(f"avatar_id must be between 0 and {MAX_AVATAR_ID}")
    updated = (
        get_supabase()
        .table("users")
        .update({"avatar_id": avatar_id})
        .eq("id", user_id)
        .execute()
    )
    return updated.data[0]


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


def set_country(user_id: str, country: str) -> dict:
    """Backs PUT /auth/country — the one-time picker ProtectedRoute.jsx shows
    a signed-in user whose profile still has country = null (always true for
    a fresh Google OAuth signup, since that flow never passes through
    SignupRequest; also true for any pre-existing account from before country
    was collected at all). Returns the updated row so the router can build a
    fresh UserProfile without a second round-trip."""
    updated = (
        get_supabase()
        .table("users")
        .update({"country": country})
        .eq("id", user_id)
        .execute()
    )
    return updated.data[0]
