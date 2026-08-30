# ============================================================================
# GRID STRATEGY — how grid trading actually works, in plain terms
# ============================================================================
# A grid bot picks a price range (e.g. $75,000–$79,500 for BTC) and slices it
# into evenly-spaced lines — say 10 levels, so 11 lines total. It then treats
# each line as a trigger:
#   - If the price DROPS down through a line, BUY a small amount there.
#   - If the price later RISES back up through the line ABOVE that purchase,
#     SELL what was bought, pocketing the difference between the two lines
#     as profit.
# This repeats forever, for every level, independently — so in a market that
# just bounces up and down within the range (which is exactly what grid
# trading is designed to profit from, unlike "buy and hold"), the bot keeps
# buying low / selling high on every little wiggle, over and over.
#
# THIS FILE runs in "paper" (simulated) mode only right now: it evaluates
# real, live prices and makes real trading decisions, but instead of placing
# an actual order on Binance, it just writes what WOULD have happened into
# bot_fills — see bot_fill_service.py. It never touches real balances or
# ledger_entries. This is what makes it safe to run and watch before Binance
# API keys or real trading capital exist.
# ============================================================================

import json
from decimal import Decimal

from app.services import bot_fill_service, bot_service
from app.services.redis_client import get_redis_sync

# Every fill gets published to this Redis pub-sub channel (one channel per
# bot) the moment it's recorded — this is what lets a bot-detail screen in
# the browser update INSTANTLY instead of having to poll the API every few
# seconds. Exactly the same pattern already used for deposits (see
# deposit_pending_service.py's "deposit_updates:{user_id}" channel and the
# /deposits/ws WebSocket route in routers/deposits.py) — a WebSocket route
# for bots subscribes to this same channel and forwards whatever gets
# published here straight to the browser.
def bot_channel(bot_id: str) -> str:
    return f"bot_updates:{bot_id}"


def _publish_fill(bot_id: str, side: str, price: Decimal, quantity: Decimal, reasoning_text: str) -> None:
    get_redis_sync().publish(
        bot_channel(bot_id),
        json.dumps(
            {
                "side": side,
                "price": str(price),
                "quantity": str(quantity),
                "reasoning_text": reasoning_text,
            }
        ),
    )


def build_grid_lines(lower: Decimal, upper: Decimal, levels: int) -> list[Decimal]:
    """Splits [lower, upper] into `levels` equal-sized intervals and returns
    the `levels + 1` boundary prices between them, lowest to highest.

    Example: build_grid_lines(Decimal("100"), Decimal("110"), 5) returns
    [100, 102, 104, 106, 108, 110] — 5 intervals, 6 lines. Interval i (for i
    from 0 to levels-1) spans lines[i] to lines[i+1]; that's the buy/sell
    pair for "level i" everywhere else in this file.

    To change how wide the grid is or how many levels it has, you don't edit
    this function — you change the `lower`/`upper`/`levels` values passed
    into build_initial_grid_config() below, at bot-creation time."""
    step = (upper - lower) / levels
    return [lower + step * i for i in range(levels + 1)]


def build_initial_grid_config(current_price: Decimal, range_pct: Decimal, levels: int) -> dict:
    """Builds the starting `config` dict a new Grid bot's `bots` row should
    be created with (see bot_service.create_bot()'s `config` parameter).

    current_price: the live price at the moment the bot is created — the
    grid is centered on this, e.g. current_price=$77,400 with
    range_pct=Decimal("0.03") (±3%) gives a range of roughly
    $75,078–$79,722.

    range_pct: how wide the grid is, as a fraction of current_price. 0.03
    means the grid spans from 3% below to 3% above the starting price. A
    bigger range_pct means wider spacing between lines (fewer, bigger
    trades) if levels stays the same; to change this for the demo bot, edit
    the value passed in wherever build_initial_grid_config() is called
    (currently the seed script), not this function itself.

    levels: how many grid intervals to create — more levels means each one
    is narrower (smaller price gap = smaller profit per trade, but triggers
    more often).

    Every bot level starts NOT holding anything — a fresh bot begins fully
    in its quote asset (USDT), same as a real user funding a new bot; it
    only starts converting some of that USDT into the traded asset once the
    price actually dips into one of the buy levels below."""
    lower = current_price * (1 - range_pct)
    upper = current_price * (1 + range_pct)
    lines = build_grid_lines(lower, upper, levels)

    return {
        "grid": {
            "lower_bound": str(lower),
            "upper_bound": str(upper),
            "levels": levels,
            # Stored as strings, not floats/Decimals directly — JSON has no
            # native decimal type, and storing exact decimal strings avoids
            # any floating-point round-off creeping into stored prices.
            "lines": [str(line) for line in lines],
            # Keyed by level index as a string ("0", "1", ...) because JSON
            # object keys are always strings, even though we think of these
            # as integer level numbers everywhere else in this file.
            "holdings": {},
            "last_price": str(current_price),
            # Running total of realized profit/loss from completed
            # buy-then-sell round trips. This is *notional* — for a paper
            # bot it never becomes a real balance change; it's purely here
            # so a future bot-detail screen has a number to show as "P&L"
            # without needing to re-derive it from the full bot_fills
            # history on every page load.
            "realized_pnl": "0",
        }
    }


def _format_usd(amount: Decimal) -> str:
    """Just for readable reasoning_text, e.g. Decimal("77400.5") -> "$77,400.50"."""
    return f"${amount:,.2f}"


def _buy_reasoning(level_index: int, buy_line: Decimal, current_price: Decimal, quote_amount: Decimal) -> str:
    return (
        f"Price dropped to {_format_usd(current_price)}, crossing grid line #{level_index} "
        f"at {_format_usd(buy_line)} — bought {_format_usd(quote_amount)} worth at this level."
    )


def _sell_reasoning(level_index: int, sell_line: Decimal, current_price: Decimal, profit: Decimal) -> str:
    outcome = "profit" if profit >= 0 else "loss"
    return (
        f"Price rose to {_format_usd(current_price)}, crossing back above grid line #{level_index + 1} "
        f"at {_format_usd(sell_line)} — sold the position from the level below, "
        f"realizing a {_format_usd(abs(profit))} {outcome} on this round trip."
    )


def evaluate_grid(bot: dict, current_price: Decimal) -> None:
    """The actual per-tick decision logic — called once per bot, every time
    the bot engine sweep (app/workers/bot_engine.py) runs. `bot` is a full
    row from the `bots` table (as returned by bot_service.get_bot /
    list_active_bots); `current_price` is the latest real price for this
    bot's pair, read from Redis.

    What this function does, step by step:
      1. Reads this bot's grid state (lines, which levels are currently
         "holding" a simulated position, the price seen last tick) out of
         bot["config"]["grid"].
      2. Checks every level for a crossing since last tick, in either
         direction, and simulates a BUY or SELL fill for any that crossed —
         writing a real row to bot_fills via bot_fill_service.record_fill()
         for each one (so a live fill feed built later has real data to
         show), and updating this bot's notional realized_pnl.
      3. Saves the updated grid state back to the bots row (via
         bot_service.update_bot_config), so the NEXT tick knows what
         happened on this one — in particular, "last_price" and which
         levels are currently holding.

    Nothing here ever calls Binance's order-placement API or
    record_ledger_entry() — see the module-level comment at the top of this
    file for why that's the whole point of "paper" mode."""
    grid_config = bot["config"]["grid"]

    lines = [Decimal(line) for line in grid_config["lines"]]
    levels = grid_config["levels"]
    holdings = grid_config["holdings"]
    previous_price = Decimal(grid_config["last_price"])
    realized_pnl = Decimal(grid_config["realized_pnl"])

    # Every level gets an equal slice of the bot's total allocation — e.g. a
    # $500 bot with 10 levels risks $50 per level. To change this to an
    # uneven split (e.g. more capital on levels closer to the current
    # price), this is the one line that would need to change.
    allocation_per_level = Decimal(str(bot["allocation_amount"])) / levels

    # Check every level independently, every tick. Using a plain loop (not
    # trying to guess "the one level that must have changed") is what makes
    # this correct even if the price moves through several levels between
    # two ticks — e.g. a sudden drop that crosses 3 buy lines at once still
    # triggers all 3 buys correctly, instead of silently only catching one.
    for i in range(levels):
        buy_line = lines[i]  # the lower edge of level i — where a BUY triggers
        sell_line = lines[i + 1]  # the upper edge of level i — where its matching SELL triggers
        level_key = str(i)
        level_state = holdings.get(level_key, {"holding": False, "buy_price": None, "quantity": None})

        if not level_state["holding"]:
            # BUY condition: last tick the price was ABOVE this line, and
            # now it's AT OR BELOW it — i.e. it just crossed downward
            # through buy_line since the last time we checked.
            if previous_price > buy_line >= current_price:
                quantity = allocation_per_level / buy_line
                reasoning = _buy_reasoning(i, buy_line, current_price, allocation_per_level)
                bot_fill_service.record_fill(
                    bot_id=bot["id"],
                    side="BUY",
                    price=buy_line,
                    quantity=quantity,
                    reasoning_text=reasoning,
                    binance_order_id=None,  # None = simulated fill, see bot_fill_service.record_fill's docstring
                )
                # Push this fill to anyone watching this bot's live screen
                # right now — see _publish_fill's comment above for why.
                _publish_fill(bot["id"], "BUY", buy_line, quantity, reasoning)
                holdings[level_key] = {
                    "holding": True,
                    "buy_price": str(buy_line),
                    "quantity": str(quantity),
                }
        else:
            # SELL condition: we're currently holding a simulated position
            # bought at this level's buy_line, and the price just crossed
            # UPWARD through sell_line (the line directly above it) — i.e.
            # last tick it was below sell_line, now it's at or above it.
            if previous_price < sell_line <= current_price:
                quantity = Decimal(level_state["quantity"])
                buy_price = Decimal(level_state["buy_price"])
                # Profit = what we sold it for, minus what we paid for it.
                # Both sides use the same quantity, so this is just
                # quantity * (sell price - buy price).
                profit = quantity * (sell_line - buy_price)
                realized_pnl += profit
                reasoning = _sell_reasoning(i, sell_line, current_price, profit)
                bot_fill_service.record_fill(
                    bot_id=bot["id"],
                    side="SELL",
                    price=sell_line,
                    quantity=quantity,
                    reasoning_text=reasoning,
                    binance_order_id=None,
                    trade_pnl=profit,
                )
                _publish_fill(bot["id"], "SELL", sell_line, quantity, reasoning)
                holdings[level_key] = {"holding": False, "buy_price": None, "quantity": None}

    # Persist everything that changed this tick — next tick's
    # `previous_price` comparison and `holdings` lookups both depend on this
    # having actually been saved. Guarded (update_bot_config_if_active, not
    # the plain update_bot_config) because a user's Stop click (POST
    # /{id}/stop -> close_all_positions) can land between this tick starting
    # and this write happening — without the guard, this would silently
    # overwrite whatever Stop just closed with this tick's STALE result,
    # computed from before the stop. If the write doesn't apply, this bot's
    # BUY/SELL fills already inserted above this tick just become a rare,
    # harmless extra log entry — nothing here touches real money either way
    # (see this file's own module comment: paper mode only).
    grid_config["holdings"] = holdings
    grid_config["last_price"] = str(current_price)
    grid_config["realized_pnl"] = str(realized_pnl)

    full_config = bot["config"]
    full_config["grid"] = grid_config
    bot_service.update_bot_config_if_active(bot["id"], full_config)


def compute_pnl(bot: dict, current_price: Decimal) -> dict:
    """Works out this Grid bot's profit/loss right now, for display on a
    bot-detail screen. Two parts, added together for the total:

      - realized: profit already locked in from completed buy-then-sell
        round trips — this is just grid_config["realized_pnl"], updated by
        evaluate_grid() every time a SELL happens.
      - unrealized: for every level CURRENTLY holding a simulated position
        (bought, not yet sold), what it would be worth if sold at
        current_price right now instead — i.e. (current_price - the price
        we "bought" at) * quantity, summed across every held level. This
        can be negative (a paper loss) if current_price has dropped below
        where a level bought in.

    Doesn't write anything to the database — this is read-only, safe to
    call as often as needed (e.g. every time the bot-detail API endpoint is
    hit) without affecting the bot's actual state."""
    grid_config = bot["config"]["grid"]
    realized_pnl = Decimal(grid_config["realized_pnl"])

    unrealized_pnl = Decimal("0")
    for level_state in grid_config["holdings"].values():
        if level_state["holding"]:
            quantity = Decimal(level_state["quantity"])
            buy_price = Decimal(level_state["buy_price"])
            unrealized_pnl += quantity * (current_price - buy_price)

    return {
        "realized_pnl": realized_pnl,
        "unrealized_pnl": unrealized_pnl,
        "total_pnl": realized_pnl + unrealized_pnl,
    }


def close_all_positions(bot: dict, current_price: Decimal) -> Decimal:
    """Called once, when a user clicks Stop on this bot (see routers/bots.py's
    POST /bots/{id}/stop) — closes out EVERY level currently holding an open
    paper position, unconditionally, at current_price. This is the "flatten"
    half of stopping a Grid bot: without it, whatever unrealized_pnl
    compute_pnl() was showing a second ago would just disappear the moment
    the bot goes STOPPED (nothing evaluates it again, so it would never turn
    into a real SELL fill) — the position and its P&L would still be sitting
    in `holdings`, but nothing would be watching it or ever showing it again.

    The math per level is identical to a normal SELL crossing inside
    evaluate_grid() above (profit = quantity * (current_price - buy_price)),
    the only difference is WHEN it fires: evaluate_grid() only sells a level
    once price crosses back above that level's own sell_line; this closes
    every open level right now, regardless of where price actually is,
    because a stop is the user unconditionally saying "I'm done" rather than
    the strategy's own exit condition being met. A level with no open
    position (holding=False) is left untouched — there's nothing to close.

    Returns the bot's new (fully realized, no unrealized remaining)
    realized_pnl, so the caller doesn't need a second read to report it.
    To change how the closing fill's reasoning_text reads, edit the f-string
    below — nothing else about the math depends on its wording."""
    grid_config = bot["config"]["grid"]
    holdings = grid_config["holdings"]
    realized_pnl = Decimal(grid_config["realized_pnl"])

    for level_key, level_state in holdings.items():
        if not level_state["holding"]:
            continue
        quantity = Decimal(level_state["quantity"])
        buy_price = Decimal(level_state["buy_price"])
        profit = quantity * (current_price - buy_price)
        realized_pnl += profit
        outcome = "profit" if profit >= 0 else "loss"
        reasoning = (
            f"Bot stopped — closed the open position from grid line #{level_key} "
            f"at {_format_usd(current_price)}, realizing a {_format_usd(abs(profit))} {outcome}."
        )
        bot_fill_service.record_fill(
            bot_id=bot["id"],
            side="SELL",
            price=current_price,
            quantity=quantity,
            reasoning_text=reasoning,
            binance_order_id=None,  # None = paper fill, same convention as every other fill in this file
            trade_pnl=profit,
        )
        _publish_fill(bot["id"], "SELL", current_price, quantity, reasoning)
        holdings[level_key] = {"holding": False, "buy_price": None, "quantity": None}

    # Persist the now-fully-closed state — same "write the whole config back"
    # pattern evaluate_grid() uses, so the next (never-happening, since the
    # bot is about to go STOPPED) tick would see consistent state either way.
    grid_config["holdings"] = holdings
    grid_config["last_price"] = str(current_price)
    grid_config["realized_pnl"] = str(realized_pnl)

    full_config = bot["config"]
    full_config["grid"] = grid_config
    bot_service.update_bot_config(bot["id"], full_config)
    return realized_pnl
