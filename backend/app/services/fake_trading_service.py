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
# scripted win/loss outcome, a retry loop that re-picked random offsets into
# that SAME fixed real_series could never find a countertrend tick that
# wasn't there, no matter how many times it tried, and used to fall through
# to `scale = 0`, silently producing a session with EVERY trip at exactly
# zero quantity/P&L — a live persistent bot did exactly this: an entire
# pending_session with 20 fills, all 0.000000. This was fixed by detecting
# the case ("does the raw data honestly support the target, in sign AND
# magnitude") and falling back to the v4 synthetic price path for that one
# session instead of giving up. Superseded by v6 below — the underlying
# "does a shared scale factor honestly work out" question this answered no
# longer arises at all, since v6 removed the shared scale entirely.
#
# v6 — the "generate un-scaled trips, then multiply them all by one shared
# scale factor to hit target_total_pnl" approach from v3-v5 above had a
# structural problem once return_pct started regularly landing well above
# 50-100% (a later product decision): a handful of independently-priced
# trips can easily net close to zero raw P&L by pure chance, which forces
# the shared scale sky-high and blows up individual trade sizes — observed
# live twice, first as a ~$1,800 single "trade" on a $500 allocation, later
# as an entire 5-minute session collapsing to $0.00 because the retries
# (see the old v5 paragraph above) all failed to find a big-enough raw sum.
# Each trip's quantity is now solved directly from its own planned dollar
# contribution instead (see _generate_trips' and _build_trip's own
# comments) — the total is correct BY CONSTRUCTION, not by hoping the raw
# numbers happen to average out close to it, so there's no scale left to
# blow up. This also let num_trips grow from a fixed 8-12 to one roughly
# every AVG_TRIP_INTERVAL_SECONDS of session length (dozens to low hundreds
# for a real session), per the product decision that the total should
# visibly accumulate fill-by-fill rather than jump in a couple of big steps.
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
    session_seconds = session_length_minutes * 60
    # One trip roughly every AVG_TRIP_INTERVAL_SECONDS, rather than a fixed
    # 8-12 regardless of session length — so a 5-minute session and a
    # 60-minute one both feel like a steady stream of fills rather than the
    # same handful of trades stretched thin over an hour. Each trip is 2
    # fills (BUY + SELL), so an average interval of 2s here works out to
    # roughly 1 fill/second overall — deliberately faster than a human could
    # place orders, per the product decision behind this number. Matched to
    # simulated_bot_engine._SWEEP_INTERVAL_SECONDS (also lowered, to 2s,
    # alongside this): that's the actual floor on how often a fill can be
    # REVEALED in real time regardless of how densely trips are scheduled
    # here, so spacing them much tighter than the sweep interval wouldn't
    # read as any more frequent to someone watching — they'd just arrive in
    # bigger bursts on the same sweep tick instead of a smooth trickle. A
    # short 5-minute session still gets a floor of 12 trips (rng.randint's
    # old lower bound) so it never feels sparse even though there's less
    # real time to spread them across.
    AVG_TRIP_INTERVAL_SECONDS = 2
    num_trips = max(12, round(session_seconds / AVG_TRIP_INTERVAL_SECONDS))
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

    # Generate round trips, each already solved to realize its own planned
    # dollar contribution (see _generate_trips' own comment for how that's
    # decided per trip, and _build_trip's for how quantity is solved from
    # it) — so unlike an earlier version of this file, there's no separate
    # "generate un-scaled trips, then scale them all by one shared factor"
    # step anymore.
    #
    # Real-data mode: buy_price and sell_price are BOTH taken exactly from
    # real_series and never adjusted — every trade marker sits exactly on the
    # real chart line, with zero exceptions. To still hit each trip's own
    # planned dollar contribution, the QUANTITY traded is what flexes
    # instead of price — a trip where real BTC barely moved needs a bigger
    # notional size to produce the same dollar profit as a trip where it
    # moved more. That's the deliberate trade-off here: prices are 100%
    # real, trade *sizes* are the fake part.
    #
    # Fallback mode (no real data): the same "quantity flexes, price is
    # fixed once chosen" shape as real-data mode, just with a small
    # synthetic price move instead of a real one (see _sourced_prices).
    #
    # Each trip searches for a real price move in whichever direction it
    # was assigned (_find_real_sell_offset below), rather than just taking
    # the first random sell_offset it finds — real 1-second BTC data almost
    # always has both up- and down-ticking stretches within any 25-70
    # second window, even during a trend, so this local search succeeds far
    # more reliably than hoping a whole random session nets the right
    # aggregate direction by chance. It's not load-bearing for the total
    # the way it used to be (that's now guaranteed by construction — see
    # _generate_trips), just for keeping each individual trip's price
    # movement genuine.
    base_interval = session_seconds / (num_trips + 1)

    # How much room to leave at the very start/end of the session for a
    # trip's buy (start) or sell (end) to actually land inside the session
    # window — both scale with base_interval now rather than fixed 15s/90s,
    # which were sized for the old ~10s trip cadence. At the new default
    # ~2s cadence those fixed numbers would eat a large chunk of a short
    # session and pile up many trips at the same clamped offset instead of
    # spreading them out — see _generate_trips' own buy_offset_s clamp,
    # which uses these.
    start_floor_s = max(3.0, base_interval)
    end_buffer_s = max(10.0, base_interval * 5.0)

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
        # How soon after the buy a sell is allowed to fire — scales with
        # base_interval (trips ~2s apart by default now, see
        # AVG_TRIP_INTERVAL_SECONDS) rather than a fixed 25s, which used to
        # assume trips were spaced far enough apart that nothing needed to
        # sell any sooner than that. A fixed 25s floor here would have
        # meant SELLS (which is where the visible P&L actually reveals)
        # couldn't come any faster than one every ~25s even with buys
        # firing every couple of seconds — defeating the point of a denser
        # fill stream.
        search_lo = min(buy_offset_s + max(2, round(base_interval)), search_hi)
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
        move otherwise. Factored out of _build_trip below so a future
        second trip-building path (if one's ever needed again) can reuse
        the same price-sourcing without duplicating it — neither decides
        HOW a price is sourced, only WHEN (buy_offset_s), which DIRECTION
        it should go (want_positive), and how hard to search for a strong
        vs weak real match (prefer_strong)."""
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
        # Scales with base_interval rather than a fixed 25-70s — that fixed
        # band assumed trips were spaced far enough apart to need a hold
        # that long; with trips ~2s apart by default now (see
        # AVG_TRIP_INTERVAL_SECONDS), a 25s-minimum hold would badly lag
        # behind how fast buys are firing. hold_min/hold_max both grow with
        # base_interval so this naturally readjusts if that constant is
        # ever changed back up.
        hold_min = max(1.0, base_interval * 0.5)
        hold_max = max(hold_min + 1.0, base_interval * 3.0)
        hold_duration = rng.uniform(hold_min, hold_max)
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

    def _build_trip(buy_offset_s: int, want_positive: bool, prefer_strong: bool, planned_pnl: float) -> dict:
        """Solves this trip's quantity directly from planned_pnl (its own
        pre-decided dollar contribution) and its own already-fixed price
        delta, rather than an arbitrary weight later normalized by a
        SHARED scale factor across every trip. That shared-scale approach
        (an earlier version of this file) had a real failure mode: with a
        handful of deliberately large/small trips, two large ones could
        land close to net-zero by pure chance, forcing the shared scale
        sky-high and blowing up every trip's size along with it (observed
        live — a $500 allocation showing an ~$1,800 single "trade"), and
        even with many evenly-weighted trips it still required the trips'
        NATURAL combined magnitude to happen to land near target_total_pnl,
        which stopped holding once target_total_pnl started regularly
        exceeding 50-100% of the allocation (also observed live — a
        5-minute session's trips summing to nearly zero against a $300
        target, collapsing the whole session to $0.00). Solving quantity
        per-trip from a planned dollar amount sidesteps both failure modes
        entirely: this trip's size never depends on any other trip's luck,
        and the total is correct by construction — see _generate_trips'
        own comment for how planned_pnl is decided per trip."""
        buy_price, sell_price, sell_offset_s = _sourced_prices(buy_offset_s, want_positive, prefer_strong)
        price_delta = sell_price - buy_price
        # The 1e-9 guard is purely defensive (a real market or the fallback
        # move_pct floor should never actually produce a near-zero delta) —
        # falls back to an allocation-sized quantity rather than exploding
        # if it somehow ever did; that trip then contributes ~$0 (price
        # barely moved), a negligible, self-correcting rounding error
        # against dozens of other trips, not something worth compensating
        # for elsewhere.
        weight_qty = (planned_pnl / price_delta) if abs(price_delta) > 1e-9 else alloc_per_level / buy_price
        raw_pnl = weight_qty * price_delta
        return dict(buy_price=buy_price, sell_price=sell_price, raw_pnl=raw_pnl,
                    weight_qty=weight_qty, buy_offset_s=buy_offset_s, sell_offset_s=sell_offset_s)

    def _flat_win_probability(_fraction: float) -> float:
        """Used for a losing session — a flat 30% chance any given trip
        goes positive, regardless of where it falls in the session, so a
        losing session still shows a few genuine small wins along the way
        rather than every single trip losing."""
        return 0.30

    def _phase_win_probability(fraction: float) -> float:
        """Used for a WINNING session — how likely a trip is to go
        positive, as a function of fraction (0.0 = session start, 1.0 =
        session end). Reads as "starts reasonably well, dips into a run of
        mostly losses, surges hard around the 40%-60% mark (the 4th-6th
        minute of a 10-minute session — the reference point this window
        was calibrated from, expressed as a fraction so it scales to any
        session length), then tapers off to roughly flat for the rest of
        the session" — moved per product decision away from an earlier
        version where the big surge sat in the last third of the session
        (a 10-minute session's "crazy profit" landing right at the very
        end read as suspicious/unrealistic). Built from MANY similar-sized
        trips across the whole session rather than a couple of big jumps —
        the total should visibly accumulate fill-by-fill as the session
        plays out (see num_trips above, and simulated_bot_engine.py's
        reveal loop, which is what actually streams these out over real
        time)."""
        if fraction < 0.20:
            return 0.70
        if fraction < 0.40:
            return 0.30
        if fraction < 0.60:
            return 0.82
        return 0.50

    # How much smaller a MINORITY trip's planned share is kept, relative to
    # a majority one — see _generate_trips' own comment for what majority/
    # minority mean here. Keeps the minority-direction trips (the small
    # losses along the way in a winning session, or the small wins along
    # the way in a losing one) genuinely secondary rather than able to
    # rival the dominant direction's trips in size.
    _MINORITY_SHARE_DAMPING = 0.4

    def _generate_trips(win_probability_fn):
        """Builds num_trips round trips spread across the session (with
        jitter — see the buy_offset_s math below) and hands each one a
        planned_pnl that's its own share of target_total_pnl, with every
        share's sign matching its own trip's direction and every share's
        SIZE randomized (0.5x-1.5x a nominal unit, damped further if this
        trip goes against the session's own overall direction — see
        _MINORITY_SHARE_DAMPING). Shares are then normalized so they sum to
        EXACTLY 1.0 before being multiplied by target_total_pnl — dividing
        each raw share by the sum of all of them is what guarantees the
        trips' planned_pnl values always add up to exactly target_total_pnl,
        regardless of how many trips there are, how the win/loss coin flips
        landed, or what real market data does. That's what replaced the old
        shared `scale` step (see _build_trip's own comment on why that
        broke down) — there's no scale left to compute or clamp here."""
        raw_trips = []
        raw_shares = []
        for i in range(num_trips):
            # Spread fills across the window with slight jitter.
            buy_offset_s = base_interval * (i + 1) + rng.uniform(
                -base_interval * 0.25, base_interval * 0.25
            )
            buy_offset_s = max(start_floor_s, min(session_seconds - end_buffer_s, buy_offset_s))
            buy_offset_s = int(buy_offset_s)

            fraction = (i + 1) / num_trips
            want_positive = rng.random() < win_probability_fn(fraction)
            # This trip is "majority" (should dominate the total) exactly
            # when its own direction matches the session's overall intended
            # direction — see _find_real_sell_offset's docstring for why
            # that determines prefer_strong here, and _MINORITY_SHARE_
            # DAMPING's own comment for how the same idea shapes this
            # trip's planned SIZE too.
            is_majority_trip = want_positive == session_is_win
            magnitude = rng.uniform(0.5, 1.5) * (1.0 if is_majority_trip else _MINORITY_SHARE_DAMPING)
            raw_shares.append(magnitude if want_positive else -magnitude)
            raw_trips.append((buy_offset_s, want_positive, is_majority_trip))

        share_sum = sum(raw_shares)
        # Defensive only — with num_trips this large and the majority/
        # minority damping above, share_sum lands solidly on the same side
        # as target_total_pnl in practice (verified statistically, not just
        # hoped for). This just stops a division by exactly zero in the
        # theoretical case every single trip somehow landed on the losing
        # side of a winning session or vice versa.
        if abs(share_sum) < 1e-9:
            share_sum = 1.0

        trips = []
        for (buy_offset_s, want_positive, is_majority_trip), share in zip(raw_trips, raw_shares):
            planned_pnl = (share / share_sum) * target_total_pnl
            trips.append(_build_trip(buy_offset_s, want_positive, prefer_strong=is_majority_trip, planned_pnl=planned_pnl))
        return trips, sum(t["raw_pnl"] for t in trips)

    # Which probability curve generates this session's trips.
    _win_probability_fn = _phase_win_probability if session_is_win else _flat_win_probability

    # A single call — no retry loop, no real-vs-synthetic fallback attempt,
    # no shared scale to solve or clamp. _generate_trips builds every
    # trip's planned_pnl to already sum to exactly target_total_pnl (see
    # its own comment for how), so there's nothing left here that can come
    # out wrong-signed or need correcting after the fact. This replaced an
    # earlier version that generated trips speculatively and retried (up
    # to 8 times across a real-data attempt and a synthetic fallback) when
    # the raw numbers didn't happen to "honestly support" the target —
    # necessary back when trip sizes were independent of target_total_pnl
    # and only averaged out close to it by chance; unnecessary now that
    # every trip's size is solved directly from its own planned share.
    raw_trips, achieved_total_pnl = _generate_trips(_win_probability_fn)

    fills = []

    for trip in raw_trips:
        scaled_pnl = trip["raw_pnl"]
        buy_price = trip["buy_price"]

        # Price is fixed (real, or a small realistic fallback move picked in
        # _sourced_prices above) — weight_qty was already solved in
        # _build_trip to make this trip realize exactly its own planned_pnl
        # given that fixed price, so it's used directly here, no further
        # scaling needed.
        sell_price = trip["sell_price"]
        qty = trip["weight_qty"]

        buy_ts = session_start + timedelta(seconds=trip["buy_offset_s"])
        sell_ts = session_start + timedelta(seconds=trip["sell_offset_s"])

        # ── BUY fill ───────────────────────────────────────────────────────
        # quote_amount is qty * buy_price (not the flat per-level allocation
        # figure), since qty itself was solved to realize this trip's own
        # planned_pnl rather than staying allocation-sized — this keeps the
        # fill's own numbers internally consistent even though the trade
        # size no longer matches the bot's stated per-level allocation
        # (that mismatch is the accepted trade-off of keeping every trade's
        # PRICE realistic — see the module docstring).
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
        # so the reasoning text can never drift out of sync with what's on
        # screen even in the rare case a trip's realized sign doesn't match
        # what it was originally assigned to be (e.g. _find_real_sell_offset
        # falling back to its first candidate — see that function's own
        # docstring for when that can happen).
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
