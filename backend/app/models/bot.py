from pydantic import BaseModel


class BotSummary(BaseModel):
    id: str
    pair: str
    strategy_type: str
    status: str
    is_paper: bool
    is_simulated: bool
    allocation_amount: str
    total_pnl: str


class BotsListResponse(BaseModel):
    bots: list[BotSummary]


class BotDetailResponse(BaseModel):
    id: str
    pair: str
    strategy_type: str
    status: str
    is_paper: bool
    is_simulated: bool
    allocation_amount: str
    current_price: str
    realized_pnl: str
    unrealized_pnl: str
    total_pnl: str
    # dict/list here, not a strongly-typed shape — this is the Grid
    # strategy's own internal state (see grid.py's build_initial_grid_config
    # for the exact shape), passed through as-is for the bot-detail screen
    # to render. A DCA/Momentum bot would have a differently-shaped config,
    # which is exactly why this isn't a fixed set of fields.
    grid_lines: list[str]
    holdings: dict
    # Only ever set for a simulated bot (see migration/simulated_bot_service
    # for what populates it) — when this bot's next scripted session is due,
    # ISO 8601. None for a real Grid bot, which has no session concept, and
    # also None for a simulated bot with no session scheduled right now
    # (one is currently in progress — see session_started_at below — or the
    # bot has been capped, see simulated_bot_service.MAX_SESSIONS).
    next_session_due_at: str | None = None
    # A simulated bot's most recent session's start time (ISO 8601) and
    # length in minutes — together enough for the frontend to render a real
    # elapsed/total progress bar (see components/SessionProgress.jsx). Set
    # from the moment a session starts and stays set even after it settles
    # (use `status` to tell "in progress" from "complete" — ACTIVE vs
    # SESSION_CAPPED — not these two fields). Both None only if this bot has
    # never started a session yet.
    session_started_at: str | None = None
    session_length_minutes: int | None = None


class FillEntry(BaseModel):
    side: str
    price: str
    quantity: str
    quote_amount: str
    reasoning_text: str
    created_at: str
    # This round trip's realized P&L (SELL only — always None on a BUY).
    # See migration 008's comment on bot_fills.trade_pnl for what populates it.
    trade_pnl: str | None = None


class FillsResponse(BaseModel):
    fills: list[FillEntry]


class ChartCandle(BaseModel):
    time: int  # Unix seconds
    open: str
    high: str
    low: str
    close: str
    # Real base-asset volume for a bot's own /chart data (Binance kline
    # field index 5 — see bot_chart_service.get_recent_candles). None for
    # the demo session's /bots/demo/fake-session candles, which have no
    # real volume concept behind their synthetic price path — the frontend
    # treats a missing/None volume as "don't draw a volume pane" rather
    # than defaulting it to 0, which would draw a flat empty bar instead.
    volume: str | None = None


class BotChartResponse(BaseModel):
    candles: list[ChartCandle]


class SaveDemoSessionRequest(BaseModel):
    # session_id is the UUID generated per session by fake_trading_service
    # — used as the idempotency key to prevent double-crediting.
    session_id: str
    total_pnl: str   # decimal string, e.g. "185.43" or "-22.11"
    is_win: bool


class SaveDemoSessionResponse(BaseModel):
    credited: bool      # True = new credit applied; False = duplicate, no-op
    amount_credited: str  # "0" on a loss or a duplicate


# ── Module 4 — user-created simulated bots ──────────────────────────────────
class CreateSimulatedBotRequest(BaseModel):
    pair: str = "BTC/USDT"
    # Decimal-safe string, same convention as every other money-shaped field
    # in this codebase (e.g. SaveDemoSessionRequest.total_pnl) — never a bare
    # float here, to avoid binary floating-point round-off on a value that
    # goes straight into a NUMERIC column and the ledger.
    allocation_amount: str
    # How many minutes of (simulated) trading a single scripted session
    # represents — mirrors FakeSessionPage's session_length_minutes, but
    # here it only shapes the generated fills/chart realism, since a
    # session settles instantly rather than streaming live (see
    # simulated_bot_engine.py's module comment).
    session_length_minutes: int = 10
    # How often a new session starts, in seconds. Must be >=
    # simulated_bot_service.MIN_INTERVAL_SECONDS (60 by default).
    interval_seconds: int = 900  # 15 minutes


class CreateBotResponse(BaseModel):
    id: str


class StopBotResponse(BaseModel):
    id: str
    status: str    # always "STOPPED" — see routers/bots.py's POST /{id}/stop
    total_pnl: str  # the bot's final, fully-realized P&L the moment it stopped
