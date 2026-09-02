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


# ── Free-tier session limits ────────────────────────────────────────────────
class SetSessionLimitRequest(BaseModel):
    email: EmailStr
    # See session_limit_service.py's module comment — raising this above
    # DEFAULT_DAILY_SESSION_LIMIT (3) lifts BOTH the 30-minute session-length
    # cap and the daily-session-count cap for this user at once.
    daily_session_limit: int


class SessionLimitResponse(BaseModel):
    user_id: str
    email: str
    daily_session_limit: int
    # True when daily_session_limit is still at the out-of-the-box default —
    # same is_default framing WinRateResponse above uses, so the admin page
    # can show the same "DEFAULT — not set by an admin yet" / "SET BY ADMIN"
    # badge treatment.
    is_default: bool


# ── Dashboard overview ───────────────────────────────────────────────────────
class AdminDailyStatsEntry(BaseModel):
    date: str  # "YYYY-MM-DD", UTC calendar day
    signups: int
    deposits_count: int
    # Decimal STRING, USD-notional (every deposit asset summed 1:1 — see
    # admin_overview_service.py's module comment on the stablecoin
    # assumption behind that).
    deposits_amount: str


class AdminCountryStatsEntry(BaseModel):
    # Bare ISO 3166-1 alpha-2 code (e.g. "US"), or the literal string
    # "UNKNOWN" for users with no country on file yet — see
    # admin_overview_service.get_country_breakdown's docstring. The
    # frontend maps this to a display name via its own countries.js list
    # (the same one the signup form's dropdown already uses), so this
    # never carries a human-readable name itself.
    country: str
    signups: int
    # Users from this country who have made at least one DEPOSIT ledger
    # entry, ever — see get_country_breakdown's docstring for why this is
    # the definition of "active" used here.
    active: int


class AdminOverviewResponse(BaseModel):
    signups_today: int
    deposits_today_count: int
    deposits_today_amount: str
    # Oldest first, one entry per UTC calendar day from the very first
    # signup/deposit ever recorded through today — see
    # admin_overview_service.get_overview's docstring. Backs the day-picker
    # calendar and the combined chart on AdminOverviewPage.jsx.
    daily: list[AdminDailyStatsEntry]
    # Most-signups-first — backs the "signups by country" section on
    # AdminOverviewPage.jsx, below the combined chart.
    countries: list[AdminCountryStatsEntry]


# ── Withdrawal fee setting ───────────────────────────────────────────────────
class WithdrawalFeeResponse(BaseModel):
    # Decimal STRING, not a float — same convention as every other
    # money-bearing value that crosses this API (see
    # WithdrawalRequestBody.amount in models/withdrawal.py for the full
    # reasoning: floats round-trip through JSON with binary rounding error,
    # never acceptable for a value that's either headed into, or came out
    # of, a NUMERIC column).
    fee_amount: str
    # True when no admin has set a fee yet and this is
    # withdrawal_fee_service.DEFAULT_WITHDRAWAL_FEE rather than something an
    # admin actually chose — same meaning as WinRateResponse.is_default above.
    is_default: bool
    updated_at: str | None = None


class SetWithdrawalFeeRequest(BaseModel):
    fee_amount: str


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
