# The Markets tab's only endpoint — a full snapshot of every USDT-quoted
# coin's current 24hr performance, read straight out of the Redis cache
# binance_market_service.stream_all_tickers() keeps refreshed once a second.
# See that function's docstring for exactly what's included/excluded
# (leveraged tokens filtered out, USDT pairs only) and why this is a
# completely separate data path from the per-symbol prices bot trading uses.

from fastapi import APIRouter, Depends, HTTPException

from app.models.market import MarketsResponse, MarketTicker, RealPricesResponse
from app.services import binance_market_service
from app.utils.auth import get_current_user

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/tickers", response_model=MarketsResponse)
async def get_tickers(user: dict = Depends(get_current_user)):
    tickers = await binance_market_service.get_all_tickers()
    if tickers is None:
        # Same "feed isn't running" signal trading.py's /trade/price route
        # gives — happens if market_data_feed.py hasn't been started yet,
        # or was just restarted and hasn't received its first tick.
        raise HTTPException(status_code=503, detail="No live market data available yet — is market_data_feed running?")

    # Sorted here (server-side) rather than trusting Binance's own array
    # order, and by quote_volume (USDT traded in the last 24h) rather than
    # alphabetically — that puts the coins people actually care about
    # (BTC, ETH, ...) near the top instead of buried in an A-Z list of
    # 300+ symbols. Change the `key=` below to sort by a different field
    # (e.g. change_percent, for a "biggest movers" ordering instead).
    ordered = sorted(tickers, key=lambda t: float(t["quote_volume"]), reverse=True)
    return MarketsResponse(tickers=[MarketTicker(**t) for t in ordered])


@router.get("/real-prices", response_model=RealPricesResponse)
async def get_real_prices(user: dict = Depends(get_current_user)):
    # Deliberately never 503s the way /tickers above does — an empty
    # {} is a perfectly valid (if momentarily unhelpful) answer here rather
    # than an error, since the caller (useRealAssetPrices.js) already treats
    # "my asset isn't in this map yet" as "not ready", the same way it
    # treats a totally empty map. See get_all_real_prices()'s own docstring
    # for exactly what this is and why it's kept separate from /tickers.
    return RealPricesResponse(prices=await binance_market_service.get_all_real_prices())
