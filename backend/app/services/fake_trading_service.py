# Fake trading result generator — the SESSION OUTCOME (win/loss, total P&L,
# return %) is still pure scripted random logic, matching a fixed target
# profile (default: 90% of sessions win, winning sessions return >=40%). That
# part is intentionally fake — see generate_fake_trading_result()'s docstring.
#
# v3 — the CHART and individual trade PRICES are no longer fabricated. Both
# are read from Binance's real, public price history for the session's pair
# (via _fetch_real_price_series() below), so the candlestick chart the
# frontend draws is genuine market movement, and every BUY/SELL marker sits
# EXACTLY on the real close price at the moment it "fired" — buy_price and
# sell_price are never adjusted. The scripted total P&L from the paragraph
# above is still hit exactly, but since price is no longer the free variable,
# the QUANTITY traded per round trip is what flexes instead — a trip where
# real price barely moved needs a bigger notional size to realize the same
# dollar profit as one where it moved more. See the "scale" step and the
# fills loop, partway through generate_fake_trading_result(). If the real-data
# fetch fails for any reason (offline, Binance rate-limited, etc.) this falls
# back to synthetic prices instead — see every `real_series is None` branch
# below.
#
# v4 — the FALLBACK (no real data) path used to solve for whatever sell_price
# hit the scripted target exactly, with no bound on how far that could land
# from buy_price — a session whose raw random trips happened to sum small
# while the scripted target was large could produce one trade with an absurd
# price swing (a SELL showing an ~80% "loss" was observed live, which is what
# prompted this). Fallback trips now pick a small, realistic price move up
# front (see FALLBACK_MIN/MAX_TRIP_MOVE_PCT below) and hold it fixed from
# then on, exactly like a real-data trip does — quantity is what flexes to
# still hit the scripted session total, in both modes now, via the same code
# path. This applies to winning trades too, not just losing ones — an
# unrealistically huge WIN would look just as fake as an unrealistic loss.
#
# v5 — a real price window can genuinely trend the whole session in one
# direction (real markets do this) — when that trend fights the day's
# scripted win/loss outcome, the retry loop that re-picks random offsets
# into that SAME fixed real_series can never find a countertrend tick that
# isn't there, no matter how many times it tries. That used to fall through
# to `scale = 0`, silently producing a session with EVERY trip at exactly
# zero quantity/P&L — a live persistent bot did exactly this: an entire
# pending_session with 20 fills, all 0.000000. generate_fake_trading_result()
# now detects this ("does the raw data honestly support the target, in sign
# AND magnitude" — see _honestly_supports_target()) and falls back to the
# v4 synthetic price path for that one session instead of giving up, so the
# scripted outcome (today's admin-configured win_rate) is always honored and
# a session is never dead — see the "v5" block partway through
# generate_fake_trading_result() for exactly when this triggers.
#
# v2 — generates proper buy-then-sell round trips instead of random scattered
# fills. Each round trip is one BUY + one SELL. The SELL entry carries an
# explicit `trade_pnl` key (the P&L on that specific round trip) and a
# `simulated_offset_seconds` key (position within the 10-minute window) so
# the frontend's streaming playback can show each trade appearing in real time.
#
# Fills are returned in chronological order (oldest first) for playback
# streaming — BotDetailPage.jsx reverses them at render time, so this is fine.
#
# This never touches Redis, Supabase, or Binance's PRIVATE (authenticated)
# API — the only outbound call is a public, no-API-key read of Binance's
# price history, the same trust level as binance_market_service.py's ticker
# stream. No order is ever placed and no real balance is ever touched here.

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone

from app.services.binance_market_service import fetch_klines

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Reasoning-text banks — sampled per round trip so consecutive fills read
# naturally and never look copy-pasted.
# ─────────────────────────────────────────────────────────────────────────────
_BUY_REASONS = [
    "Price dipped into the grid level — opening long position.",
    "BUY trigger hit at this grid line — placing market entry.",
    "Entering at support level as price pulls back into range.",
    "Grid level activated — buying allocation for this price band.",
    "Price touched the lower band — BUY order filled.",
    "Momentum stalled at support — executing grid BUY.",
    "Spread in our favour — filling BUY at current ask.",
]

_SELL_WIN_REASONS = [
    "PROFIT — Target level reached. Selling full allocation at ${sell}.",
    "PROFIT — Price moved up to the next grid line. Locking in gain.",
    "PROFIT — Upper grid boundary hit. Closing position at ${sell}.",
    "PROFIT — Take-profit triggered. Sold at ${sell}.",
    "PROFIT — Filled sell order as price crossed the grid level above.",
]

_SELL_LOSS_REASONS = [
    "STOP-LOSS — Price broke below entry. Cutting loss at ${sell} to protect capital.",
    "STOP-LOSS — Downside breach. Closing position early at ${sell}.",
    "STOP-LOSS — Risk threshold reached. Exiting at ${sell} to limit drawdown.",
    "STOP-LOSS — Grid invalidated. Selling at ${sell} — small loss accepted.",
    "STOP-LOSS — Price momentum inverted. Exiting at ${sell} to preserve capital.",
]

# How far a single simulated round trip's price is allowed to move, as a
# fraction of its buy price, when there's no real market data to anchor it
# to (see _fetch_real_price_series — this only applies when that returns
# None, i.e. the fallback path). Chosen to match what REAL trips actually do:
# every stored fill this app has ever generated in real-data mode — the
# normal case — has landed between -0.45% and +0.89% per trade. Keeping
# fallback trades inside a similar-sized band, win or loss, is what stops any
# one fake trade from ever looking like a market crash or spike; the
# SESSION's overall scripted win/loss and target return (win_rate,
# target_min_return below) are completely unaffected by this — only the
# per-trade PRICE is bounded here, the per-trade QUANTITY still flexes freely
# (same mechanism real-data mode already uses) so the whole session still
# lands on its scripted total. Raise the upper bound if fallback-mode trades
# start looking too samey/small; lower it to make swings gentler still.
FALLBACK_MIN_TRIP_MOVE_PCT = 0.0005  # 0.05%
FALLBACK_MAX_TRIP_MOVE_PCT = 0.006   # 0.6%

# The session length (in minutes) at which a session's scripted return_pct
# hits its FULL, un-throttled size — see _duration_scale()'s docstring for
# the mechanics. Went 30 -> 10 -> 5 across two product decisions: first so a
# 10-minute session couldn't be capped at a third of a 30-minute one's
# range, then so a 5-minute session (the shortest option CreateBotPage.jsx
# offers) could look just as "insane" as every other length too. At 5,
# _duration_scale() is effectively a no-op for every session length this
# app currently offers (5/10/30/60 minutes all resolve to the full 1.0) —
# the mechanism is left in place rather than removed, in case a shorter
# preset is ever added and the "shorter should swing less" idea is wanted
# again; raise this back up to bring that behavior back for whichever
# lengths should stay throttled.
SESSION_LENGTH_FULL_SCALE_MINUTES = 5


def _duration_scale(session_length_minutes: int) -> float:
    """Returns a 0.0-1.0 multiplier applied to a session's scripted
    return_pct, proportional to how far session_length_minutes is into the
    SESSION_LENGTH_FULL_SCALE_MINUTES ramp. Session lengths at or above the
    full-scale point are clamped to exactly 1.0 (no reward for running
    longer than that) — see this constant's own comment for why every
    session length this app currently offers lands in that clamped case.
    This intentionally scales BOTH win and loss magnitude the same way — a
    short losing session loses less too, not just a short winning session
    winning less — so the scaling reads as "less time in the market,
    smaller moves either direction," not as a thumb on the scale toward
    wins."""
    return min(session_length_minutes / SESSION_LENGTH_FULL_SCALE_MINUTES, 1.0)

_THINKING_REASONS = [
    "Analyzing market momentum...",
    "Waiting for price to stabilize within grid boundaries.",
    "Evaluating order book depth on the ask side.",
    "Monitoring support level for potential entry.",
    "Volatility detected — pausing execution temporarily.",
    "Scanning across grid levels for next optimal entry.",
    "Price hovering near mid-band — observing trend direction.",
    "Re-calculating risk thresholds based on recent fills.",
]


def _fmt_time(offset_seconds: int) -> str:
    m, s = divmod(offset_seconds, 60)
    return f"T+{m}:{s:02d}"


def _fetch_real_price_series(symbol: str, session_seconds: int) -> list[float] | None:
    """Pulls the most recent `session_seconds` seconds of REAL price history
    for `symbol` (e.g. "BTCUSDT", no slash — same format bot_engine.py and
    binance_market_service.py use) from Binance's public klines REST
    endpoint. This is a one-shot history pull, not a live subscription, so a
    plain synchronous httpx.get() is enough — no need for the websocket
    machinery binance_market_service.py uses for the always-on live ticker.

    Returns a list of exactly `session_seconds + 1` close prices, one per
    second, oldest first, so real_series[t] is the real market price at
    second `t` of the session window — callers can index straight into it
    using a trade's simulated_offset_seconds. Returns None (deliberately
    NEVER raises) on any failure — bad network, Binance down, unexpected
    response shape, fewer candles than asked for — so callers always have a
    clean "did this work?" check and can fall back to the fully-synthetic
    price path instead of the demo breaking.

    To make the chart cover more or less real history, nothing here needs to
    change — `session_seconds` is driven by session_length_minutes at the
    call site in generate_fake_trading_result()."""
    raw_klines = fetch_klines(symbol, interval="1s", limit=session_seconds + 1)
    if raw_klines is None:
        logger.warning("Falling back to synthetic prices for %s", symbol)
        return None

    # Each kline is [open_time, open, high, low, close, volume, close_time,
    # ...] — index 4 is the close price, which is what "the price at this
    # second" means for our purposes (matches how the candle-bucketing
    # step below reads "close" out of each 5-second bucket too).
    closes = [float(k[4]) for k in raw_klines]
    if len(closes) < session_seconds + 1:
        # Binance returned fewer 1-second candles than requested (can
        # happen right after a symbol starts trading, or under partial
        # rate-limiting) — bail out to the synthetic fallback rather than
        # risk an out-of-range index later when a trade's offset lands
        # past the end of this shorter list.
        logger.warning(
            "Binance returned %d/%d klines for %s — falling back to synthetic prices",
            len(closes), session_seconds + 1, symbol,
        )
        return None
    return closes[-(session_seconds + 1):]


def generate_fake_trading_result(
    target_min_return: float = 0.40,
    win_rate: float = 0.90,
    session_length_minutes: int = 10,
    allocation_amount: float = 500.0,
    initial_price: float = 75_000.0,
    pair: str = "BTC/USDT",
) -> dict:
    """Generate one fake session result matching the requested target profile.

    The SESSION-LEVEL outcome (win or lose, total P&L, return %) is scripted —
    decided up front from win_rate/target_min_return below — and stays that
    way regardless of real market data. What real data changes is everything
    underneath that number: the candlestick chart and each trade's buy/sell
    PRICE are read from Binance's real public price history for `pair` (see
    _fetch_real_price_series()) when that call succeeds, and are never
    adjusted — every marker sits exactly on the real chart. To still hit the
    scripted total, the QUANTITY traded per round trip flexes instead (a
    trip real price barely moved on needs a bigger notional size for the
    same dollar profit) — so trade sizes, not prices, are the "fake" part
    when real data is in play. If the fetch fails for any reason, this falls
    back to a small, realistic-but-synthetic price move per trip instead
    (see FALLBACK_MIN/MAX_TRIP_MOVE_PCT) — quantity still flexes the same
    way to hit the scripted total, so no individual trade, in either mode,
    can ever show an unrealistic price swing. The scripted total P&L is
    identical either way, only the visual chart/price realism differs.

    Returns
    -------
    dict with two keys:
        "detail" — matches BotDetailResponse field-for-field (all values are
                   strings/bools/lists/dicts as the real endpoint returns),
                   plus private "_win", "_return_pct", "_fake",
                   "_session_length_minutes" keys for FakeSessionPage.jsx.
        "fills"  — list of fill dicts in CHRONOLOGICAL order (oldest first)
                   for streaming playback. Each fill is FillEntry-compatible
                   plus two extra keys the real endpoint never sends:
                     trade_pnl  (str | null) — P&L for this round trip,
                                only set on SELL entries.
                     simulated_offset_seconds (int) — position within the
                                session window, used by the frontend timer.
    """
    rng = random.Random()  # un-seeded — every call is genuinely different

    # ── Session-level outcome ───────────────────────────────────────────────
    session_is_win = rng.random() < win_rate

    if session_is_win:
        # Swings both ABOVE and BELOW target_min_return — sometimes by a
        # small margin, sometimes by a large one — rather than the old
        # target_min_return + uniform(0, 0.15), which only ever floored at
        # the admin's number and crept up from there. The swing is sized as
        # a FRACTION of target_min_return itself (+/-50%), not a fixed
        # absolute band, so a big admin-configured target still gets
        # proportionally big swings and a small one gets small swings. The
        # 0.01 floor only ever matters if an admin sets a very small
        # target_min_return — under the default 0.40 it's never actually
        # reached (worst case swing is -0.20, i.e. 0.20 return, well clear
        # of the floor) — it exists purely so a "win" can never mathematically
        # come out zero or negative, which would contradict session_is_win.
        return_pct = max(0.01, target_min_return + rng.uniform(-0.5, 0.5) * target_min_return)
    else:
        return_pct = -rng.uniform(0.05, 0.20)

    # Throttle the roll above down toward zero for a short session — see
    # _duration_scale()'s docstring. This runs BEFORE target_total_pnl is
    # derived, so every dollar amount below (and every trip's flexed
    # quantity, since that's solved to hit target_total_pnl) already reflects
    # the scaled-down return — nothing downstream needs its own awareness of
    # session length to stay consistent with it.
    return_pct *= _duration_scale(session_length_minutes)

    target_total_pnl = allocation_amount * return_pct

    # ── Round-trip generation ───────────────────────────────────────────────
    num_trips = rng.randint(8, 12)
    session_seconds = session_length_minutes * 60
    now = datetime.now(tz=timezone.utc)
    session_start = now - timedelta(seconds=session_seconds)

    # Try to get real market history for this pair covering the session
    # window — real_series[t] is the genuine price at second t. `None` here
    # means the fetch failed, so every `real_series is not None` branch below
    # falls back to the old fully-synthetic behavior instead.
    symbol = pair.replace("/", "")  # "BTC/USDT" -> "BTCUSDT", same conversion routers/bots.py's _binance_symbol uses
    real_series = _fetch_real_price_series(symbol, session_seconds)

    # What the chart/grid should visually center around: the real price the
    # session window actually started at when real data loaded, otherwise
    # the caller-supplied initial_price fallback. Using the real anchor here
    # matters — initial_price defaults to a hardcoded $75,000 that drifts out
    # of date, and grid lines drawn around a stale anchor would sit visibly
    # off the real chart.
    chart_start_price = real_series[0] if real_series is not None else initial_price

    # Allocation per level — spread evenly across a 10-level grid.
    levels = 10
    alloc_per_level = allocation_amount / levels

    # Generate raw round trips with un-scaled P&Ls.
    #
    # Real-data mode: buy_price and sell_price are BOTH taken exactly from
    # real_series and never adjusted — every trade marker sits exactly on the
    # real chart line, with zero exceptions. To still hit the scripted
    # session target, the QUANTITY traded is what flexes instead of price
    # (see the fills loop below) — a trip where real BTC barely moved needs a
    # bigger notional size to produce the same dollar profit as a trip where
    # it moved more. That's the deliberate trade-off here: prices are 100%
    # real, trade *sizes* are the fake part.
    #
    # Fallback mode (no real data): unchanged from before — a fixed
    # allocation-sized quantity, and the SELL price is what's solved for
    # instead, via the scaling step below.
    #
    # raw_pnl_sum's sign MUST end up matching target_total_pnl's sign — the
    # scaling step below can only ever multiply by a non-negative factor (a
    # negative one would make quantities negative, which is physically
    # impossible), so if the sign doesn't already match going in, there is no
    # scale factor that fixes it afterward. So in real-data mode, each trip
    # doesn't just take the first random sell_offset it finds — it searches a
    # handful of candidate hold-durations (_find_real_sell_offset below) for
    # one where the real price genuinely moved in the direction this trip is
    # scripted to go (~70% of trips follow the session's own win/loss
    # direction, 30% go against it, mirroring how a real mixed session
    # looks). Real 1-second BTC data almost always has both up- and down-
    # ticking stretches within any 25-70 second window, even during a
    # trend, so this local search succeeds far more reliably than hoping a
    # whole random session nets the right direction by chance.
    base_interval = session_seconds / (num_trips + 1)

    def _find_real_sell_offset(buy_offset_s: int, want_positive: bool, prefer_strong: bool) -> int:
        """Searches real offsets after buy_offset_s for one whose price moved
        in the `want_positive` direction (up if True, down if False).

        `prefer_strong` controls WHICH matching candidate wins: True picks
        the one that moved FURTHEST in that direction (used for the ~70% of
        trips going the session's own win/loss direction, so their combined
        weight reliably dominates the total); False picks the one that moved
        LEAST (used for the ~30% going against it, so they stay genuinely
        small and can't accidentally outweigh the majority). Without this
        split, both groups tend to get similarly-sized typical real deltas,
        and a noisy real market can easily tip the AGGREGATE sum the wrong
        way even when more trips individually went the intended way — this
        was observed happening in practice, hence the two-sided bias here
        rather than just picking the strongest match every time.

        Falls back to the very first candidate tried if somehow nothing in
        30 tries moved in the wanted direction at all (can happen during an
        extremely strong, sustained trend with no local pullback whatsoever
        inside the search window — rare, but a real possibility, not just a
        theoretical one).

        Searches up to 3 minutes out (capped at the session's end), NOT just
        the ~25-70s "typical hold" range a fallback synthetic trip uses —
        that narrower band was too thin to reliably contain a countertrend
        tick once there are more than a handful of trips competing for the
        same few seconds of the window. To make hunted-for trips look
        tighter/looser in time, adjust SEARCH_SPAN_S below."""
        SEARCH_SPAN_S = 180
        search_hi = min(buy_offset_s + SEARCH_SPAN_S, session_seconds - 10)
        search_lo = min(buy_offset_s + 25, search_hi)
        first_candidate = None
        best_candidate, best_abs_delta = None, None
        for _ in range(30):
            candidate = rng.randint(search_lo, search_hi) if search_lo < search_hi else search_hi
            if first_candidate is None:
                first_candidate = candidate
            delta = real_series[candidate] - real_series[buy_offset_s]
            if (delta > 0) == want_positive and delta != 0:
                is_better = (
                    best_abs_delta is None
                    or (abs(delta) > best_abs_delta if prefer_strong else abs(delta) < best_abs_delta)
                )
                if is_better:
                    best_candidate, best_abs_delta = candidate, abs(delta)
        return best_candidate if best_candidate is not None else first_candidate

    def _sourced_prices(buy_offset_s: int, want_positive: bool, prefer_strong: bool) -> tuple[float, float, int]:
        """Returns (buy_price, sell_price, sell_offset_s) for one trip —
        real Binance prices when available, a small realistic synthetic
        move otherwise. Factored out of the old inline loop body so every
        trip-building path in this function (the weight-based _build_trip
        below, still used by _generate_trips() for a losing session, and
        the planned-pnl _build_planned_trip below, used by
        _generate_scripted_win_trips() for a winning session) sources
        prices exactly the same way — neither decides HOW a price is
        sourced, only WHEN (buy_offset_s), which DIRECTION it should go
        (want_positive), and how hard to search for a strong vs weak real
        match (prefer_strong)."""
        if real_series is not None:
            sell_offset_s = _find_real_sell_offset(buy_offset_s, want_positive, prefer_strong=prefer_strong)
            return real_series[buy_offset_s], real_series[sell_offset_s], sell_offset_s

        # No real price history for this window (offline, Binance
        # rate-limited, etc.) — pick a small, REALISTIC price move instead
        # (see FALLBACK_MIN/MAX_TRIP_MOVE_PCT's own comment above for
        # exactly how small, and how to change it), then treat it exactly
        # like a real one from here on: FIXED once chosen, never re-solved
        # later from the scaled target. This is what stops a single fake
        # trade from ever showing an absurd price swing (e.g. the ~80%
        # "loss" on one SELL that prompted this whole v4 change — see the
        # module docstring).
        hold_duration = rng.uniform(25.0, min(70.0, base_interval * 0.75))
        sell_offset_s = int(min(session_seconds - 10.0, buy_offset_s + hold_duration))
        # Anchored to chart_start_price (the real price this session
        # actually started at, when a real fetch succeeded at all — see
        # chart_start_price's own comment above) rather than the raw
        # initial_price parameter directly. This matters for the v5 case
        # below: a session that fetched real data fine but later falls
        # back here anyway (because the real trend fought the scripted
        # target too hard) still anchors its synthetic prices to a
        # genuinely recent real price instead of the stale hardcoded
        # $75,000 default callers never override (see
        # simulated_bot_engine.py's call site, which never passes
        # initial_price). When no real fetch ever succeeded,
        # chart_start_price already just equals initial_price, so this is
        # a no-op change for that case.
        buy_price = chart_start_price * rng.uniform(0.991, 1.009)
        move_pct = rng.uniform(FALLBACK_MIN_TRIP_MOVE_PCT, FALLBACK_MAX_TRIP_MOVE_PCT)
        sell_price = buy_price * ((1 + move_pct) if want_positive else (1 - move_pct))
        return buy_price, sell_price, sell_offset_s

    def _build_trip(buy_offset_s: int, want_positive: bool, prefer_strong: bool, weight_mult: float = 1.0) -> dict:
        """A WEIGHT-based trip, used by _generate_trips() (the fully-random
        shape, still used for a losing session) — weight_qty is a nominal
        "how big a slice of this bot's allocation" basis, used ONLY to
        weight how much this trip contributes relative to the others before
        the session-wide `scale` step (see the fills loop below) normalizes
        everything to target_total_pnl. This works fine for 8-12 evenly-
        weighted trips (see _generate_scripted_win_trips' own docstring for
        why it does NOT work well for that shape's few, deliberately lumpy
        trips — that path uses _build_planned_trip below instead, which
        solves quantity directly rather than leaning on a shared scale)."""
        buy_price, sell_price, sell_offset_s = _sourced_prices(buy_offset_s, want_positive, prefer_strong)
        weight_qty = (alloc_per_level / buy_price) * weight_mult
        raw_pnl = weight_qty * (sell_price - buy_price)
        return dict(buy_price=buy_price, sell_price=sell_price, raw_pnl=raw_pnl,
                    weight_qty=weight_qty, buy_offset_s=buy_offset_s, sell_offset_s=sell_offset_s)

    def _build_planned_trip(buy_offset_s: int, planned_pnl: float, want_positive: bool, prefer_strong: bool) -> dict:
        """A PLANNED-PNL trip, used by _generate_scripted_win_trips() —
        solves weight_qty directly from planned_pnl and this trip's own
        (already-fixed) price delta, rather than an arbitrary weight later
        normalized by a SHARED scale factor across every trip. See that
        function's own docstring for why this matters: with only a
        handful of deliberately different-sized trips, two large ones can
        easily net close to zero raw P&L by pure chance, which would force
        a shared scale factor sky-high and blow up every trip's size along
        with it (observed live in testing — a $500 allocation showing a
        ~$1,800 single "trade"). Solving quantity per-trip from a planned
        dollar amount sidesteps that failure mode entirely: this trip's
        size never depends on any other trip's luck."""
        buy_price, sell_price, sell_offset_s = _sourced_prices(buy_offset_s, want_positive, prefer_strong)
        price_delta = sell_price - buy_price
        # The 1e-9 guard is purely defensive (a real market or the fallback
        # move_pct floor should never actually produce a near-zero delta) —
        # falls back to an allocation-sized quantity rather than exploding
        # if it somehow ever did.
        weight_qty = (planned_pnl / price_delta) if abs(price_delta) > 1e-9 else alloc_per_level / buy_price
        raw_pnl = weight_qty * price_delta
        return dict(buy_price=buy_price, sell_price=sell_price, raw_pnl=raw_pnl,
                    weight_qty=weight_qty, buy_offset_s=buy_offset_s, sell_offset_s=sell_offset_s)

    def _generate_trips():
        trips = []
        for i in range(num_trips):
            # Spread fills across the window with slight jitter.
            buy_offset_s = base_interval * (i + 1) + rng.uniform(
                -base_interval * 0.25, base_interval * 0.25
            )
            buy_offset_s = max(15.0, min(session_seconds - 90.0, buy_offset_s))
            buy_offset_s = int(buy_offset_s)

            # Same "does this trip go WITH or AGAINST the session's own
            # scripted direction" split in both branches below — ~70% of
            # trips follow the session's own win/loss outcome, ~30% go
            # against it, so even a winning session shows a couple of small
            # losing trades along the way (and vice versa for a losing
            # session) — a realistic mixed look either branch produces.
            want_positive = (rng.random() < 0.70) if session_is_win else (rng.random() < 0.30)
            # This trip is "majority" (should dominate the total) exactly
            # when its own direction matches the session's overall intended
            # direction — see _find_real_sell_offset's docstring for why
            # that determines prefer_strong here.
            is_majority_trip = want_positive == session_is_win
            trips.append(_build_trip(buy_offset_s, want_positive, prefer_strong=is_majority_trip))
        return trips, sum(t["raw_pnl"] for t in trips)

    # How far into the session (as a FRACTION of session_seconds) the
    # scripted early win below can land. Originally 0.20-0.50 (the "2nd
    # through 5th minute of a 10-minute session"), moved much earlier per
    # product decision — that window left the fill feed looking empty for
    # several minutes at the start of every session, which read as the bot
    # being slow/broken rather than "thinking." Now the first fill lands
    # within roughly the first 3%-15% of the session instead. Still a
    # range, not a single fixed point, so it never lands on a suspiciously
    # round, predictable moment. Same reasoning for _CLOSING_WIN_WINDOW
    # below (the last stretch of the session, unchanged). Both are
    # fractions, not fixed minute counts, so this scales to any session
    # length (a 1-hour session's early win lands proportionally later in
    # real time than a 5-minute one's, not at the exact same offset).
    _EARLY_WIN_WINDOW = (0.03, 0.15)
    _CLOSING_WIN_WINDOW = (0.80, 0.95)

    def _generate_scripted_win_trips():
        """The winning-session narrative: one big win early in the session,
        a few small losses through the middle, then the single biggest win
        right near the close — only ever used when session_is_win is True.
        A losing session still uses _generate_trips()'s fully-random mixed
        shape, completely unchanged — this scripted arc is specifically a
        winning-day narrative, not a general replacement.

        Unlike _generate_trips(), this does NOT lean on the shared `scale`
        step to reach target_total_pnl — each trip's planned_pnl is a
        FRACTION of target_total_pnl chosen so all fractions sum to exactly
        1.0 (early_fraction + every loss_fraction + closing_fraction, the
        last one defined as whatever's left over), then _build_planned_trip
        solves each trip's own quantity directly from its own planned
        dollar amount. The total is therefore correct BY CONSTRUCTION,
        never by chance — see _build_planned_trip's own docstring for why
        the shared-scale approach specifically broke down for a shape this
        lumpy (a couple of large, independently-priced trips can net close
        to zero by pure chance, which would otherwise force a shared scale
        sky-high). This changes WHEN trips happen and HOW BIG they are —
        never how a trip's price is sourced (still real Binance history
        when available) and never the session's final total, so this shape
        composes cleanly with return_pct's own plus/minus variance around
        target_min_return without either one needing to know about the
        other."""
        latest_start_s = session_seconds - 90.0  # same settle-time buffer _generate_trips() reserves

        # Planned share of target_total_pnl per role. early_fraction and
        # each loss_fraction are drawn independently; closing_fraction is
        # whatever's left so the three groups always sum to exactly 1.0 —
        # it ends up the largest share in every case (it has to cover both
        # "the rest of the win" AND paying back whatever the losses took
        # out), which is exactly the "biggest win, closing out the
        # session" story this function is building.
        early_fraction = rng.uniform(0.12, 0.25)
        num_losses = rng.randint(2, 3)  # "a few losses"
        loss_fractions = [rng.uniform(-0.10, -0.03) for _ in range(num_losses)]
        closing_fraction = 1.0 - early_fraction - sum(loss_fractions)

        # ── Early big win ────────────────────────────────────────────────
        early_win_offset_s = int(min(latest_start_s, rng.uniform(
            _EARLY_WIN_WINDOW[0] * session_seconds, _EARLY_WIN_WINDOW[1] * session_seconds
        )))
        trips = [_build_planned_trip(
            early_win_offset_s, early_fraction * target_total_pnl, want_positive=True, prefer_strong=True
        )]

        # ── A few small losses through the middle ───────────────────────
        # Spread evenly between the early win and the start of the closing
        # window, each with its own jitter so they don't land on perfectly
        # even intervals either.
        closing_window_start_s = _CLOSING_WIN_WINDOW[0] * session_seconds
        loss_span_s = max(30.0, closing_window_start_s - early_win_offset_s)
        for i, loss_fraction in enumerate(loss_fractions):
            loss_base_s = early_win_offset_s + loss_span_s * (i + 1) / (num_losses + 1)
            loss_offset_s = loss_base_s + rng.uniform(-loss_span_s * 0.15, loss_span_s * 0.15)
            loss_offset_s = int(min(latest_start_s, max(early_win_offset_s + 20, loss_offset_s)))
            trips.append(_build_planned_trip(
                loss_offset_s, loss_fraction * target_total_pnl, want_positive=False, prefer_strong=False
            ))

        # ── Biggest win, closing out the session ────────────────────────
        closing_offset_s = int(min(latest_start_s, rng.uniform(
            closing_window_start_s, _CLOSING_WIN_WINDOW[1] * session_seconds
        )))
        closing_offset_s = max(closing_offset_s, early_win_offset_s + 60)
        trips.append(_build_planned_trip(
            closing_offset_s, closing_fraction * target_total_pnl, want_positive=True, prefer_strong=True
        ))

        trips.sort(key=lambda t: t["buy_offset_s"])
        return trips, sum(t["raw_pnl"] for t in trips)

    # Which shape generates this session's trips — decided once, reused for
    # every retry/fallback attempt below so a losing session never
    # accidentally gets the winning-day arc (or vice versa) partway through
    # its own retry loop.
    _generate_this_session = _generate_scripted_win_trips if session_is_win else _generate_trips

    # Upper bound on `scale` (target_total_pnl / raw_pnl_sum, see the fills
    # loop below) that still counts as "honest" — added alongside the
    # scripted winning-day arc above. With only 4-5 role-based trips instead
    # of the old 8-12 evenly-random ones, a raw sum landing close to net
    # zero by pure chance (the early/closing wins and the losses roughly
    # cancelling out) is far more likely than it ever realistically was with
    # more, smaller trips — and the old absolute "> 0.001" floor alone let
    # that through: a raw sum of a few dollars against an $80 target still
    # passed it, but forced a 15-20x scale that blew individual trade sizes
    # up to hundreds of dollars on a much smaller allocation (observed live
    # in testing — a $500 allocation showing an ~$1,800 single "trade").
    # Lowering this raises the retry rate; raising it risks the same
    # blowup returning.
    MAX_HONEST_SCALE = 5.0

    def _honestly_supports_target(pnl_sum: float) -> bool:
        """True if raw_pnl_sum is both the right SIGN to scale toward
        target_total_pnl and large enough in magnitude to scale by no more
        than MAX_HONEST_SCALE (not so close to zero that `scale` would have
        to blow up an essentially-flat set of trips to reach the target) —
        i.e. this is data this session could honestly be built from, not
        data that has to be forced or zeroed to fit the scripted outcome."""
        return (
            abs(pnl_sum) > 0.001
            and (pnl_sum > 0) == (target_total_pnl > 0)
            and abs(pnl_sum) >= abs(target_total_pnl) / MAX_HONEST_SCALE
        )

    raw_trips, raw_pnl_sum = _generate_this_session()
    # The per-trip direction split above (want_positive, and for real-data
    # trips the strong/weak search) is the main mechanism and usually gets
    # the aggregate sign right on its own — this is a cheap top-up for the
    # minority of cases where per-trip noise still tips the SUM the wrong
    # way, regenerating the whole trip set (fresh random offsets/prices each
    # time) until it honestly supports the target or attempts run out. Costs
    # nothing when the first attempt already succeeds, which is the common
    # case. Applies in both real-data and fallback mode, and to both trip
    # shapes — every want_positive is still decided the same way underneath,
    # so all of them benefit equally from this retry.
    for _ in range(3):
        if _honestly_supports_target(raw_pnl_sum):
            break
        raw_trips, raw_pnl_sum = _generate_this_session()

    # v5 — a real price window can genuinely trend the whole session in one
    # direction with no countertrend tick anywhere in it (a real market
    # doing exactly what real markets do). When that trend fights the day's
    # scripted win/loss outcome, retrying above is useless — every retry
    # re-picks random offsets into the SAME fixed real_series, so a
    # session-long monotonic trend fails the SAME way every time, not just
    # by bad luck. Before this fix, that meant the whole session got
    # clamped to scale=0 — a dead, no-fills-ever session (observed live: a
    # persistent simulated bot whose entire pending_session came out at
    # exactly $0.00, all quantities 0.000000). Falling back to the small,
    # realistic SYNTHETIC price path here — the same one used when Binance
    # is unreachable, anchored to this session's own real starting price via
    # chart_start_price — is what keeps the scripted outcome (today's
    # admin-configured win_rate) always honored instead: every session still
    # shows real, sensibly-sized trades, at the cost of that one session's
    # trades no longer sitting on live Binance data specifically. Real-data
    # sessions are unaffected — this only triggers when 4 real-data attempts
    # in a row couldn't honestly support the target.
    if real_series is not None and not _honestly_supports_target(raw_pnl_sum):
        real_series = None
        raw_trips, raw_pnl_sum = _generate_this_session()
        for _ in range(3):
            if _honestly_supports_target(raw_pnl_sum):
                break
            raw_trips, raw_pnl_sum = _generate_this_session()

    # ── Scale raw P&Ls so they sum to the session target ───────────────────
    # Guard against degenerate case (all losses summing to 0) — the v5
    # fallback just above means real-data mode reaching this point with
    # non-honest data is now vanishingly rare (would need 4 real-data AND 4
    # fallback attempts to all fail), and fallback mode alone reaching it
    # would need 4 attempts of un-seeded random small moves to all cancel
    # out, which is equally rare. Kept as a guard rather than removed
    # because "rare" isn't "impossible", and this is what keeps that
    # theoretical case from ever dividing by a near-zero raw_pnl_sum.
    scale = (target_total_pnl / raw_pnl_sum) if abs(raw_pnl_sum) > 0.001 else 1.0
    if scale < 0:
        # Clamping to 0 here (rather than flipping every trip's sign with
        # abs()) keeps every individual trip's own buy/sell price exactly as
        # generated — a negative scale would otherwise flip a trip's
        # displayed win/loss without its price actually having gone the
        # other way. `total_pnl` below is derived from what the trades
        # actually sum to (raw_pnl_sum * scale), not re-asserted from
        # target_total_pnl independently, so the headline number and the
        # per-trade numbers can never disagree — this session would just
        # under-shoot the scripted target instead of contradicting itself.
        scale = 0.0

    # What the trades actually sum to, given whatever scale ended up being.
    # Equal to target_total_pnl in every normal case (scale was solved for
    # exactly that); only differs from it in the clamped edge case above.
    achieved_total_pnl = raw_pnl_sum * scale

    fills = []

    for trip in raw_trips:
        scaled_pnl = trip["raw_pnl"] * scale
        buy_price = trip["buy_price"]

        # Price is fixed (real, or a small realistic fallback move picked in
        # _generate_trips() above) — solve for the quantity that makes this
        # trip realize scaled_pnl. Written as weight_qty*scale rather than
        # scaled_pnl/price_delta — they're algebraically the same
        # (scaled_pnl = weight_qty*price_delta*scale, so dividing back by
        # price_delta cancels it out) but THIS form never divides by
        # price_delta at all, so a trip whose price barely moved (price_delta
        # near zero) still gets a normal-sized quantity instead of one
        # squashed toward zero by a tiny denominator. Same mechanism in both
        # real-data and fallback mode now — see the module docstring's "v4"
        # note for why fallback trips used to solve for price instead, and
        # why that let one trade swing an unrealistic amount.
        sell_price = trip["sell_price"]
        qty = trip["weight_qty"] * scale

        buy_ts = session_start + timedelta(seconds=trip["buy_offset_s"])
        sell_ts = session_start + timedelta(seconds=trip["sell_offset_s"])

        # ── BUY fill ───────────────────────────────────────────────────────
        # quote_amount is qty * buy_price (not the flat per-level allocation
        # figure) in every mode now, since qty itself flexes with `scale`
        # rather than staying allocation-sized — this keeps the fill's own
        # numbers internally consistent even though the trade size no longer
        # matches the bot's stated per-level allocation (that mismatch is
        # the accepted trade-off of keeping every trade's PRICE realistic —
        # see the module docstring).
        buy_quote_amount = qty * buy_price
        fills.append(
            dict(
                side="BUY",
                price=f"{buy_price:.2f}",
                quantity=f"{qty:.6f}",
                quote_amount=f"{buy_quote_amount:.2f}",
                reasoning_text=rng.choice(_BUY_REASONS),
                created_at=buy_ts.isoformat(),
                trade_pnl=None,
                simulated_offset_seconds=trip["buy_offset_s"],
            )
        )

        # ── SELL fill ──────────────────────────────────────────────────────
        # Picked from scaled_pnl's sign — the number actually shown/plotted —
        # rather than assuming it always matches raw_pnl's. scale is forced
        # non-negative above, so in practice the two signs always agree; this
        # still reads scaled_pnl directly rather than relying on that being
        # true, so the reasoning text can never drift out of sync with what's
        # on screen even if the scaling logic above changes later.
        if scaled_pnl >= 0:
            reason_tmpl = rng.choice(_SELL_WIN_REASONS)
        else:
            reason_tmpl = rng.choice(_SELL_LOSS_REASONS)
        reasoning = reason_tmpl.replace("${sell}", f"${sell_price:,.2f}")

        fills.append(
            dict(
                side="SELL",
                price=f"{sell_price:.2f}",
                quantity=f"{qty:.6f}",
                quote_amount=f"{qty * sell_price:.2f}",
                reasoning_text=reasoning,
                created_at=sell_ts.isoformat(),
                trade_pnl=f"{scaled_pnl:.2f}",   # explicit per-trade P&L
                simulated_offset_seconds=trip["sell_offset_s"],
            )
        )

    # ── THINKING entries ───────────────────────────────────────────────────
    num_thoughts = rng.randint(10, 16)
    for _ in range(num_thoughts):
        offset_s = rng.randint(5, session_seconds - 5)
        thought_ts = session_start + timedelta(seconds=offset_s)
        fills.append(
            dict(
                side="THINKING",
                price="0.00",
                quantity="0.000000",
                quote_amount="0.00",
                reasoning_text=rng.choice(_THINKING_REASONS),
                created_at=thought_ts.isoformat(),
                trade_pnl=None,
                simulated_offset_seconds=offset_s,
            )
        )

    # ── Sort chronological for streaming playback ───────────────────────────
    fills.sort(key=lambda f: f["created_at"])

    # ── OHLC Data (Candlesticks) ─────────────────────────────────────────────
    if real_series is not None:
        # Real market data loaded — the chart is just that real price history,
        # unmodified. The BUY/SELL fills above already sit exactly on this
        # same series (see the raw_trips loop), so trade markers line up with
        # the candles with no further reconciling needed here.
        price_series = real_series
    else:
        # Fallback: no real data available. Reconstruct a synthetic path that
        # at least passes exactly through the (also-synthetic) BUY/SELL
        # prices chosen above, interpolating with a little noise in between —
        # this is the original v2 behavior, unchanged.
        waypoints = {0: initial_price}
        for f in fills:
            if f["side"] in ("BUY", "SELL"):
                waypoints[f["simulated_offset_seconds"]] = float(f["price"])

        wp_times = sorted(waypoints.keys())
        if session_seconds not in waypoints:
            wp_times.append(session_seconds)
            waypoints[session_seconds] = waypoints[wp_times[-2]] * rng.uniform(0.999, 1.001)

        price_series = [initial_price] * (session_seconds + 1)

        for i in range(len(wp_times) - 1):
            t0 = wp_times[i]
            t1 = wp_times[i + 1]
            p0 = waypoints[t0]
            p1 = waypoints[t1]
            dt = t1 - t0
            if dt <= 0:
                continue
            for t in range(t0, t1 + 1):
                progress = (t - t0) / dt
                base_p = p0 + (p1 - p0) * progress
                noise = base_p * rng.uniform(-0.0005, 0.0005)
                if t == t0:
                    price_series[t] = p0
                elif t == t1:
                    price_series[t] = p1
                else:
                    price_series[t] = base_p + noise

    candles = []
    candle_interval = 5
    for start_t in range(0, session_seconds, candle_interval):
        end_t = min(start_t + candle_interval, session_seconds)
        if start_t == end_t:
            break
        segment = price_series[start_t:end_t]
        ts = session_start + timedelta(seconds=start_t)
        candles.append({
            "time": int(ts.timestamp()),
            "open": round(segment[0], 2),
            "high": round(max(segment), 2),
            "low": round(min(segment), 2),
            "close": round(segment[-1], 2),
            "simulated_offset_seconds": start_t,
        })

    # ── Detail payload ──────────────────────────────────────────────────────
    # Always derived from achieved_total_pnl (what the trades actually sum
    # to), not target_total_pnl directly — identical in every normal case,
    # but this is what keeps the headline P&L/win-loss/return% consistent
    # with the individual trade_pnl entries even in the rare clamped case
    # from the scaling step above.
    total_pnl = achieved_total_pnl
    win = total_pnl >= 0
    return_pct = total_pnl / allocation_amount
    realized_fraction = rng.uniform(0.80, 0.97)
    realized_pnl = total_pnl * realized_fraction
    unrealized_pnl = total_pnl - realized_pnl
    # The last point on whichever price line the chart is actually showing —
    # real market close if real_series loaded, otherwise the synthetic
    # fallback path's endpoint. Either way, "current price" always matches
    # where the chart visually ends.
    current_price = price_series[-1]

    lower = chart_start_price * 0.980
    upper = chart_start_price * 1.020
    step = (upper - lower) / levels
    grid_lines = [f"{lower + step * i:.2f}" for i in range(levels + 1)]
    holdings = {
        str(i): {"holding": False, "buy_price": None, "quantity": None}
        for i in range(levels)
    }

    detail = dict(
        id=str(uuid.uuid4()),
        pair=pair,
        strategy_type="GRID",
        status="ACTIVE",
        is_paper=True,
        allocation_amount=f"{allocation_amount:.2f}",
        current_price=f"{current_price:.2f}",
        realized_pnl=f"{realized_pnl:.2f}",
        unrealized_pnl=f"{unrealized_pnl:.2f}",
        total_pnl=f"{total_pnl:.2f}",
        grid_lines=grid_lines,
        holdings=holdings,
        # private keys — FakeSessionPage.jsx reads these, BotDetailPage ignores them
        _fake=True,
        _win=win,
        _return_pct=f"{return_pct * 100:.2f}%",
        _session_length_minutes=session_length_minutes,
        _num_trips=num_trips,
    )

    return dict(detail=detail, fills=fills, candles=candles)
