# Response shapes for GET /market/tickers — see app/routers/market.py and
# app/services/binance_market_service.py's stream_all_tickers() for where
# every field below actually comes from. All price-ish fields are decimal
# STRINGs (never float), matching the convention used everywhere else in
# this app (see trading.py's models) so the frontend never has to worry
# about float rounding when it displays or compares them.

from pydantic import BaseModel


class MarketTicker(BaseModel):
    symbol: str          # full Binance symbol, e.g. "BTCUSDT"
    base: str            # base asset only, e.g. "BTC" — this is what the frontend uses to look up the coin's logo
    price: str            # last traded price
    change_percent: str    # 24hr % change, e.g. "-3.42" (already a percentage, not a fraction — render as-is with a trailing "%")
    high: str               # 24hr high
    low: str                  # 24hr low
    volume: str                # 24hr base-asset volume
    quote_volume: str            # 24hr quote-asset (USDT) volume — this is what the list is sorted by, most-traded first


class MarketsResponse(BaseModel):
    tickers: list[MarketTicker]


# Response shape for GET /market/real-prices — see
# binance_market_service.get_all_real_prices()'s own docstring for why this
# is a separate endpoint from /market/tickers above rather than reusing it:
# /market/tickers is deliberately jittered for a "feels alive" Markets page,
# while this one is always the true last-seen Binance price, straight off
# the never-jittered price:{SYMBOL} keys. Keyed by base asset (e.g. "BTC"),
# not full symbol, since every caller of this only ever wants "what's BTC
# worth right now", not the USDT-quoted pair name.
class RealPricesResponse(BaseModel):
    prices: dict[str, str]
