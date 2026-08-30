import secrets

from app.services.email_service import render_otp_email, send_email
from app.services.redis_client import get_redis

PURPOSE_EMAIL_VERIFICATION = "email_verification"

OTP_TTL_SECONDS = 10 * 60
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5


class OtpCooldownError(Exception):
    """Raised when a new OTP is requested before the resend cooldown has elapsed."""


def _code_key(purpose: str, identifier: str) -> str:
    return f"otp:{purpose}:{identifier}"


def _attempts_key(purpose: str, identifier: str) -> str:
    return f"otp:{purpose}:{identifier}:attempts"


def _cooldown_key(purpose: str, identifier: str) -> str:
    return f"otp:{purpose}:{identifier}:cooldown"


async def generate_and_send_otp(
    purpose: str,
    identifier: str,
    email: str,
    subject: str,
    heading: str,
    details: list[tuple[str, str]] | None = None,
) -> None:
    """details: optional list of (label, value) rows shown in the email
    body between the heading and the code — e.g. withdrawal_service.py
    passes the amount/network/destination address here so a withdrawal
    confirmation email shows exactly what's being confirmed, not just a
    bare code. Left as None (the default) by every OTHER caller (currently
    just email verification), which renders no such table — see
    render_otp_email's own docstring for the rendering side of this."""
    r = get_redis()
    if await r.exists(_cooldown_key(purpose, identifier)):
        raise OtpCooldownError("Please wait before requesting another code")

    code = f"{secrets.randbelow(1_000_000):06d}"
    await r.set(_code_key(purpose, identifier), code, ex=OTP_TTL_SECONDS)
    await r.delete(_attempts_key(purpose, identifier))
    await r.set(_cooldown_key(purpose, identifier), "1", ex=OTP_RESEND_COOLDOWN_SECONDS)

    await send_email(to=email, subject=subject, html=render_otp_email(code, heading, details))


async def verify_otp(purpose: str, identifier: str, code: str) -> bool:
    r = get_redis()
    code_key = _code_key(purpose, identifier)
    attempts_key = _attempts_key(purpose, identifier)

    stored_code = await r.get(code_key)
    if stored_code is None:
        return False

    attempts = await r.incr(attempts_key)
    if attempts == 1:
        await r.expire(attempts_key, OTP_TTL_SECONDS)
    if attempts > OTP_MAX_ATTEMPTS:
        await r.delete(code_key)
        return False

    if not secrets.compare_digest(stored_code, code):
        return False

    await r.delete(code_key)
    await r.delete(attempts_key)
    return True
