# Bot endpoints. Real (is_simulated=False) Grid bots are still create-less
# here — there's no self-serve creation wizard for those yet (that's module
# 3.7's other half, later). Module-4 simulated bots DO have a create endpoint
# below (POST ""), alongside the same list/detail/fills/ws/stop endpoints
# both bot kinds share — see POST /{bot_id}/stop for the one action both
# kinds support today.

from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from gotrue.errors import AuthError

from app.models.bot import (
    BotChartResponse, BotDetailResponse, BotsListResponse, BotSummary,
    ChartCandle, CreateBotResponse, CreateSimulatedBotRequest,
    FillEntry, FillsResponse,
    SaveDemoSessionRequest, SaveDemoSessionResponse, StopBotResponse,
)
from app.services.demo_profit_service import credit_demo_profit
from app.services.fake_trading_service import generate_fake_trading_result
from app.services import bot_chart_service, bot_fill_service, bot_service, simulated_bot_service, win_rate_service
from app.services.binance_market_service import get_latest_price
from app.services.redis_client import get_redis
from app.services.simulated_bot_ledger_service import settle_simulated_session
from app.services.strategies import grid
from app.services.supabase_client import get_supabase_auth_client
from app.utils.auth import get_current_user

router = APIRouter(prefix="/bots", tags=["bots"])


def _binance_symbol(pair: str) -> str:
    """Same conversion as bot_engine.py's _binance_symbol — see that file's
    comment for why bots.pair ("BTC/USDT") and the price-feed's Redis key
    ("BTCUSDT") use different formats. Duplicated here rather than shared
    because it's a one-line, self-contained conversion; not worth an import
    just to avoid repeating it."""
    return pair.replace("/", "")


def _ensure_owner(bot: dict | None, user_id: str) -> dict:
    """Every bot-detail/fills/ws endpoint below takes a bot_id straight from
    the URL — without this check, one logged-in user could read another
    user's bot just by guessing/trying a different id. Returns the bot dict
    if the check passes, so callers can do `bot = _ensure_owner(...)` in one
    line instead of checking then re-fetching."""
    if bot is None or bot["user_id"] != user_id:
        # Deliberately 404, not 403 — this way a wrong-owner bot_id looks
        # identical to a bot_id that simply doesn't exist, so it doesn't
        # even confirm to an attacker that a given id is valid but someone
        # else's.
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot


async def _bot_summary(bot: dict) -> BotSummary:
    strategy_code = bot_service.strategy_type_code(bot["strategy_type_id"])
    status_code = bot_service.bot_status_code(bot["status_id"])

    total_pnl = "0"
    if bot.get("is_simulated"):
        # A simulated bot's SETTLED P&L is whatever's actually been applied
        # to the real ledger so far (simulated_bot_engine.py keeps this
        # updated every time a session settles) — but while a session is
        # actively revealing, that alone sits frozen at the previous
        # session's result (often "0") for the whole session length. Adding
        # partial_session_pnl() (same helper POST /{id}/stop and the detail
        # endpoint use) means this list screen's number moves live as SELLs
        # fire, matching what _simulated_bot_detail already does — not
        # something to recompute from a live price, since scripted sessions
        # aren't priced against the current market the way a real Grid
        # bot's open positions are.
        sim = bot["config"].get("simulated", {})
        settled = Decimal(sim.get("realized_pnl", "0"))
        if sim.get("pending_session"):
            settled += simulated_bot_service.partial_session_pnl(sim)
        total_pnl = str(settled)
    elif strategy_code == "GRID":
        price_str = await get_latest_price(_binance_symbol(bot["pair"]))
        if price_str is not None:
            pnl = grid.compute_pnl(bot, Decimal(price_str))
            total_pnl = str(pnl["total_pnl"])
        # If there's no price yet (feed not running), total_pnl just stays
        # "0" rather than erroring the whole bots list over one bot.

    return BotSummary(
        id=bot["id"],
        pair=bot["pair"],
        strategy_type=strategy_code,
        status=status_code,
        is_paper=bot["is_paper"],
        is_simulated=bool(bot.get("is_simulated")),
        allocation_amount=str(bot["allocation_amount"]),
        total_pnl=total_pnl,
    )


@router.get("", response_model=BotsListResponse)
async def list_bots(user: dict = Depends(get_current_user)):
    bots = bot_service.list_bots_for_user(user["id"])
    # Each bot needs its own price lookup for its own P&L, so these can't be
    # trivially done as one batched call — fine at this scale (a handful of
    # bots per user), worth revisiting if a user ever has many bots at once.
    summaries = [await _bot_summary(bot) for bot in bots]
    return BotsListResponse(bots=summaries)


@router.post("", response_model=CreateBotResponse)
def create_bot(body: CreateSimulatedBotRequest, user: dict = Depends(get_current_user)):
    """Creates a new module-4 simulated bot for the authenticated user — the
    only kind of bot this endpoint creates; there's still no self-serve
    creation path for a real (is_simulated=False) Grid bot (see this file's
    module comment). Runs its first scripted session on the very next
    simulated-bot-engine sweep (see simulated_bot_service.build_initial_simulated_config)."""
    try:
        allocation_amount = Decimal(body.allocation_amount)
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="allocation_amount must be a valid decimal string")

    try:
        bot_id = simulated_bot_service.create_simulated_bot(
            user_id=user["id"],
            pair=body.pair,
            allocation_amount=allocation_amount,
            session_length_minutes=body.session_length_minutes,
            interval_seconds=body.interval_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return CreateBotResponse(id=bot_id)


@router.get("/{bot_id}", response_model=BotDetailResponse)
async def bot_detail(bot_id: str, user: dict = Depends(get_current_user)):
    bot = _ensure_owner(bot_service.get_bot(bot_id), user["id"])
    strategy_code = bot_service.strategy_type_code(bot["strategy_type_id"])
    status_code = bot_service.bot_status_code(bot["status_id"])

    if bot.get("is_simulated"):
        return await _simulated_bot_detail(bot, strategy_code, status_code)

    if strategy_code != "GRID":
        # DCA/Momentum bots can exist in the DB (nothing stops creating one
        # directly) but have no detail-view rendering logic yet, since their
        # config shape is different from Grid's — surface that plainly
        # instead of silently showing wrong/empty Grid-shaped data.
        raise HTTPException(status_code=400, detail=f"No detail view yet for strategy {strategy_code}")

    price_str = await get_latest_price(_binance_symbol(bot["pair"]))
    if price_str is None:
        raise HTTPException(status_code=503, detail="No live price available yet — is market_data_feed running?")

    current_price = Decimal(price_str)
    pnl = grid.compute_pnl(bot, current_price)
    grid_config = bot["config"]["grid"]

    return BotDetailResponse(
        id=bot["id"],
        pair=bot["pair"],
        strategy_type=strategy_code,
        status=status_code,
        is_paper=bot["is_paper"],
        is_simulated=False,
        allocation_amount=str(bot["allocation_amount"]),
        current_price=str(current_price),
        realized_pnl=str(pnl["realized_pnl"]),
        unrealized_pnl=str(pnl["unrealized_pnl"]),
        total_pnl=str(pnl["total_pnl"]),
        grid_lines=grid_config["lines"],
        holdings=grid_config["holdings"],
    )


async def _simulated_bot_detail(bot: dict, strategy_code: str, status_code: str) -> BotDetailResponse:
    """A simulated bot's detail view has no grid state to render (see
    migration 007's comment on why it still reports strategy_type GRID) and
    its P&L never depends on the live price the way a real Grid bot's
    unrealized_pnl does — every session settles in full the moment it runs,
    so there's never an "open position" to mark against the current price.
    current_price is still fetched purely for display (the frontend already
    shows it elsewhere); its absence isn't fatal here the way it is for a
    real bot, since nothing below actually needs it to compute anything."""
    price_str = await get_latest_price(_binance_symbol(bot["pair"]))
    sim = bot["config"].get("simulated", {})
    settled_realized_pnl = Decimal(sim.get("realized_pnl", "0"))
    pending_session = sim.get("pending_session")

    # While a session is actively revealing, its own timing is the source of
    # truth; once it's settled (pending_session cleared), fall back to
    # last_session_started_at/length so the frontend can still render a
    # frozen "session complete" progress bar instead of it just vanishing —
    # see start_pending_session's comment on why those two survive settling.
    if pending_session:
        session_started_at = pending_session["session_start"]
        session_length_minutes = pending_session["session_length_minutes"]
        # sim["realized_pnl"] only ever gets updated once a session fully
        # SETTLES (finish_session, or a user-triggered stop_pending_session)
        # — so without this, the P&L hero card and the Realized box would
        # sit frozen at whatever the bot's PREVIOUS session left behind
        # (often exactly "0" for a bot on its very first session) for the
        # bot's ENTIRE session length, even while real SELL fills with real
        # trade_pnl are streaming into the execution log below. Adding
        # partial_session_pnl() — the same "sum of trade_pnl for fills
        # already revealed" helper POST /{id}/stop uses to settle an early
        # stop — makes this card track what's actually happened so far,
        # live, the moment each SELL fires, not just at the very end.
        live_realized_pnl = settled_realized_pnl + simulated_bot_service.partial_session_pnl(sim)
    else:
        session_started_at = sim.get("last_session_started_at")
        session_length_minutes = sim.get("last_session_length_minutes")
        live_realized_pnl = settled_realized_pnl

    return BotDetailResponse(
        id=bot["id"],
        pair=bot["pair"],
        strategy_type=strategy_code,
        status=status_code,
        is_paper=bot["is_paper"],
        is_simulated=True,
        allocation_amount=str(bot["allocation_amount"]),
        current_price=price_str or "0",
        realized_pnl=str(live_realized_pnl),
        # There's no "open position" concept for a simulated bot's scripted
        # fills (see this function's own docstring) — a fill has either
        # already happened (counted in live_realized_pnl above) or hasn't
        # happened yet (not counted at all), nothing in between to mark
        # against a live price, so this stays "0" for this bot kind always.
        unrealized_pnl="0",
        total_pnl=str(live_realized_pnl),
        grid_lines=[],
        holdings={},
        next_session_due_at=sim.get("next_session_due_at"),
        session_started_at=session_started_at,
        session_length_minutes=session_length_minutes,
    )


@router.post("/{bot_id}/stop", response_model=StopBotResponse)
async def stop_bot(bot_id: str, user: dict = Depends(get_current_user)):
    """The backend half of the live screen's Stop button (see
    BotDetailPage.jsx's ActionRow). Always allowed while a bot is ACTIVE, for
    BOTH bot kinds this app has today — and safely so, because neither engine
    ever places a real Binance order (see grid.py's and
    simulated_bot_engine.py's own module comments: both are paper/notional).
    So "stop" never risks a live execution failure the way flattening an
    actual market position would; what it DOES do is turn whatever's still
    "unrealized" right now into one final, locked-in number, so nothing about
    the bot's P&L can keep moving after this call returns:

      - Real (is_simulated=False) Grid bot: every grid level currently
        holding an open paper position gets closed at the live price, right
        now — see grid.close_all_positions.
      - Simulated bot, mid-session (a pending_session is actively revealing):
        settles the REAL ledger balance, but only for the partial result of
        whichever fills the user actually watched happen so far — not the
        full scripted session total, which includes fills that were never
        even revealed yet. See simulated_bot_service.partial_session_pnl.
      - Simulated bot, between sessions (ACTIVE, nothing pending right now):
        nothing to settle — just cancels whatever session was next due.

    Either way, bots.status_id flips to STOPPED (a terminal status — see
    quantex-schema.sql's bot_statuses seed data) and this bot will never be
    picked up by either engine sweep again (bot_service.list_active_bots()
    only ever returns ACTIVE bots)."""
    bot = _ensure_owner(bot_service.get_bot(bot_id), user["id"])
    status_code = bot_service.bot_status_code(bot["status_id"])
    if status_code != "ACTIVE":
        # Covers both "already stopped" (a second click) and "capped" (a
        # simulated bot that already ran its one session) — either way,
        # there's nothing left to stop.
        raise HTTPException(status_code=400, detail=f"Bot is {status_code}, not ACTIVE — nothing to stop")

    if bot.get("is_simulated"):
        sim = bot["config"].get("simulated", {})
        pending = sim.get("pending_session")
        if pending is not None:
            partial_pnl = simulated_bot_service.partial_session_pnl(sim)
            settlement = settle_simulated_session(
                user_id=bot["user_id"],
                bot_id=bot["id"],
                session_id=pending["session_id"],
                total_pnl=partial_pnl,
            )
            applied_pnl = settlement["amount"] if settlement["applied"] else Decimal("0")
            simulated_bot_service.stop_pending_session(bot, sim, applied_pnl)
        else:
            simulated_bot_service.cancel_scheduled_session(bot, sim)
        total_pnl = sim.get("realized_pnl", "0")
    else:
        strategy_code = bot_service.strategy_type_code(bot["strategy_type_id"])
        if strategy_code != "GRID":
            # Same "no rendering logic yet for this strategy shape" guard
            # bot_detail() already uses above — stopping a strategy this
            # backend can't even read the state of isn't safe to attempt.
            raise HTTPException(status_code=400, detail=f"No stop logic yet for strategy {strategy_code}")
        price_str = await get_latest_price(_binance_symbol(bot["pair"]))
        if price_str is None:
            raise HTTPException(status_code=503, detail="No live price available yet — is market_data_feed running?")
        total_pnl = str(grid.close_all_positions(bot, Decimal(price_str)))

    bot_service.set_bot_status(bot["id"], "STOPPED")
    return StopBotResponse(id=bot["id"], status="STOPPED", total_pnl=total_pnl)


@router.get("/demo/fake-session")
def fake_session(
    target_min_return: float | None = None,
    win_rate: float | None = None,
    session_length_minutes: int = 10,
    allocation_amount: float = 500.0,
    initial_price: float = 75_000.0,
    pair: str = "BTC/USDT",
):
    """Return one session result matching the requested target profile. No DB
    reads or writes — nothing here is persisted until /demo/save-session is
    called separately. The win/loss outcome and total return are still
    scripted (pure random, matching win_rate/target_min_return below), but
    the chart and each trade's price are read from Binance's real public
    price history when that call succeeds, falling back to synthetic prices
    if it doesn't — see fake_trading_service.py's module docstring for the
    full explanation.

    target_min_return / win_rate: when omitted (the normal case — the
    frontend never sends these), both are resolved from whatever an admin
    has set for TODAY via PUT /admin/win-rate (win_rate_service.py), falling
    back to the 90%/40% defaults if no admin has configured today yet. Pass
    them explicitly only to override that for one call (e.g. manual testing).
    """
    if win_rate is None or target_min_return is None:
        today = win_rate_service.get_today_win_rate()
        if win_rate is None:
            win_rate = today["win_rate"]
        if target_min_return is None:
            target_min_return = today["target_min_return"]

    return generate_fake_trading_result(
        target_min_return=target_min_return,
        win_rate=win_rate,
        session_length_minutes=session_length_minutes,
        allocation_amount=allocation_amount,
        initial_price=initial_price,
        pair=pair,
    )


@router.post("/demo/save-session", response_model=SaveDemoSessionResponse)
def save_demo_session(
    body: SaveDemoSessionRequest,
    user: dict = Depends(get_current_user),
):
    """Persist the profit from a winning fake-trading demo session to the
    user's real USDT balance via the normal ledger_entry pathway.

    - Only winning sessions (is_win=True, total_pnl > 0) credit the balance.
    - Losing sessions return credited=False and amount_credited="0" — no debit.
    - Submitting the same session_id twice is idempotent: the second call
      returns credited=False, no second credit is applied.

    The session_id must be the UUID that the /bots/demo/fake-session response
    included in detail.id — that UUID is what makes the idempotency key unique
    per session.
    """
    from decimal import Decimal

    pnl = Decimal(body.total_pnl)

    if not body.is_win or pnl <= 0:
        # Loss or zero — nothing to credit; return immediately without touching DB.
        return SaveDemoSessionResponse(credited=False, amount_credited="0")

    was_credited = credit_demo_profit(
        user_id=user["id"],
        session_id=body.session_id,
        total_pnl=pnl,
    )
    return SaveDemoSessionResponse(
        credited=was_credited,
        amount_credited=str(pnl) if was_credited else "0",
    )


@router.get("/{bot_id}/fills", response_model=FillsResponse)
def bot_fills(bot_id: str, user: dict = Depends(get_current_user)):
    bot = _ensure_owner(bot_service.get_bot(bot_id), user["id"])
    fills = bot_fill_service.get_fills(bot["id"])
    return FillsResponse(
        fills=[
            FillEntry(
                side=fill["side"],
                price=str(fill["price"]),
                quantity=str(fill["quantity"]),
                quote_amount=str(fill["quote_amount"]),
                reasoning_text=fill["reasoning_text"],
                created_at=fill["created_at"],
                trade_pnl=str(fill["trade_pnl"]) if fill.get("trade_pnl") is not None else None,
            )
            for fill in fills
        ]
    )


@router.get("/{bot_id}/chart", response_model=BotChartResponse)
async def bot_chart(bot_id: str, window_minutes: int = bot_chart_service.DEFAULT_WINDOW_MINUTES, user: dict = Depends(get_current_user)):
    """Recent real price history for this bot's pair — same data source
    (Binance's public klines) and candle shape as the demo's chart, just a
    longer, coarser, non-streaming window. See bot_chart_service.py for why
    1-minute candles instead of the demo's 1-second ones."""
    bot = _ensure_owner(bot_service.get_bot(bot_id), user["id"])
    candles = bot_chart_service.get_recent_candles(_binance_symbol(bot["pair"]), window_minutes)
    if candles is None:
        raise HTTPException(status_code=503, detail="Could not fetch price history right now — try again shortly.")
    return BotChartResponse(
        candles=[
            ChartCandle(
                time=c["time"],
                open=str(c["open"]),
                high=str(c["high"]),
                low=str(c["low"]),
                close=str(c["close"]),
                volume=str(c["volume"]),
            )
            for c in candles
        ]
    )


async def _user_id_from_token(token: str) -> str | None:
    # Identical approach to routers/deposits.py's _user_id_from_token — see
    # that function's comment for why a WebSocket needs its own token
    # validation instead of the normal HTTPBearer/Depends(get_current_user)
    # used by regular HTTP routes.
    try:
        response = get_supabase_auth_client().auth.get_user(token)
    except AuthError:
        return None
    if response is None or response.user is None:
        return None
    return response.user.id


@router.websocket("/{bot_id}/ws")
async def bot_ws(websocket: WebSocket, bot_id: str, token: str):
    """Live push for one bot's fills, as they happen — see grid.py's
    _publish_fill for where these messages actually come from. This is what
    lets a bot-detail screen show a new fill the instant it's simulated,
    instead of the browser having to poll the API every few seconds."""
    await websocket.accept()

    user_id = await _user_id_from_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return

    bot = bot_service.get_bot(bot_id)
    if bot is None or bot["user_id"] != user_id:
        await websocket.close(code=4404)
        return

    r = get_redis()
    pubsub = r.pubsub()
    channel = grid.bot_channel(bot_id)
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            await websocket.send_text(message["data"])
    except Exception:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
