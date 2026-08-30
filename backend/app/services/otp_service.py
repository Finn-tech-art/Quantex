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
    purpose: str, identifier: str, email: str, subject: str, heading: str
) -> None:
    r = get_redis()
    if await r.exists(_cooldown_key(purpose, identifier)):
        raise OtpCooldownError("Please wait before requesting another code")

    code = f"{secrets.randbelow(1_000_000):06d}"
    await r.set(_code_key(purpose, identifier), code, ex=OTP_TTL_SECONDS)
    await r.delete(_attempts_key(purpose, identifier))
    await r.set(_cooldown_key(purpose, identifier), "1", ex=OTP_RESEND_COOLDOWN_SECONDS)

    await send_email(to=email, subject=subject, html=render_otp_email(code, heading))


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
