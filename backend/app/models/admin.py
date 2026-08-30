from datetime import date

from pydantic import BaseModel, EmailStr


# ── Admin auth (module 1) ────────────────────────────────────────────────────
class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminProfile(BaseModel):
    id: str
    email: str


# ── Daily win-rate setting (module 2) ────────────────────────────────────────
class SetWinRateRequest(BaseModel):
    # Defaults to today (UTC) when omitted — see win_rate_service for why UTC.
    win_date: date | None = None
    # 0.90 means "90% of sessions on this date are scripted to win" — same
    # meaning as fake_trading_service.generate_fake_trading_result's win_rate
    # parameter, just persisted per-day instead of passed in on every call.
    win_rate: float
    # 0.40 means a winning session's return is scripted to be >= 40% — same
    # meaning as generate_fake_trading_result's target_min_return parameter.
    target_min_return: float = 0.40


class WinRateResponse(BaseModel):
    win_date: date
    win_rate: float
    target_min_return: float
    # True when no admin has set a rate for this date yet and the response is
    # the hardcoded fallback (see win_rate_service.DEFAULT_WIN_RATE) rather
    # than something an admin actually chose.
    is_default: bool


# ── Deposit consolidation address settings (module 1) ───────────────────────
class ConsolidationAddressEntry(BaseModel):
    network: str
    destination_address: str | None
    # False means no admin has configured this network yet — the sweep
    # worker (Module 2/3) must refuse to sweep rather than treat this as an
    # empty string, per the pre-build failure-mode review.
    is_configured: bool


class ConsolidationAddressesResponse(BaseModel):
    addresses: list[ConsolidationAddressEntry]


class SetConsolidationAddressRequest(BaseModel):
    destination_address: str


# ── Deposit consolidation sweeps (module 4) ──────────────────────────────────
class PendingSweepEntry(BaseModel):
    wallet_id: str
    network: str
    asset: str
    deposit_address: str
    balance: str


class PendingSweepsResponse(BaseModel):
    pending: list[PendingSweepEntry]


class QueuedSweepEntry(BaseModel):
    wallet_id: str
    network: str
    asset: str
    deposit_address: str
    balance: str
    task_id: str


class SweepNowResponse(BaseModel):
    queued: list[QueuedSweepEntry]


class SweepHistoryEntry(BaseModel):
    id: str
    wallet_id: str
    network: str | None
    asset: str | None
    status: str | None
    amount: str
    destination_address: str
    sweep_tx_hash: str | None
    error_message: str | None
    created_at: str
    confirmed_at: str | None


class SweepHistoryResponse(BaseModel):
    sweeps: list[SweepHistoryEntry]


# ── Operational wallet generation (module 6) ─────────────────────────────────
class GenerateKeypairRequest(BaseModel):
    chain: str  # "TRON" | "EVM"


class GeneratedKeypairResponse(BaseModel):
    chain: str
    address: str
    # Returned exactly once, at generation time, and never persisted or
    # retrievable again afterward — see custody_service.py's module-6
    # header comment for why.
    private_key: str
