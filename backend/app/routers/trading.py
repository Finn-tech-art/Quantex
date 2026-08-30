# The manual Trade screen's endpoints — buy/sell any of trading_service's
# SUPPORTED_PAIRS at the live price, plus the price/chart/history reads the
# frontend needs to render the screen. See trading_service.py's module
# comment for the fee model and why this is "simulated execution, real
# ledger effect" rather than either a fully-fake demo or a real Binance
# order.

from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException

from app.models.bot import BotChartResponse, ChartCandle
from app.models.trading import (
    BuyRequest, CurrentPriceResponse, SellRequest,
    TradeHistoryEntry, TradeHistoryResponse, TradeResponse,
)
from app.services import bot_chart_service, trading_service
from app.services.trading_service import InsufficientBalanceError
from app.utils.auth import get_current_user

router = APIRouter(prefix="/trade", tags=["trading"])


def _binance_symbol(pair: str) -> str:
    return pair.replace("/", "")


def _ensure_supported(pair: str) -> None:
    if pair not in trading_service.SUPPORTED_PAIRS:
        raise HTTPException(status_code=400, detail=f"Unsupported pair: {pair}")


def _parse_decimal(value: str, field_name: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}: {value!r}")
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be greater than 0")
    return parsed


@router.get("/price", response_model=CurrentPriceResponse)
async def current_price(pair: str, user: dict = Depends(get_current_user)):
    _ensure_supported(pair)
    price = await trading_service.get_current_price(pair)
    if price is None:
        raise HTTPException(status_code=503, detail="No live price available yet — is market_data_feed running?")
    return CurrentPriceResponse(pair=pair, price=str(price))


@router.get("/chart", response_model=BotChartResponse)
def chart(pair: str, window_minutes: int = bot_chart_service.DEFAULT_WINDOW_MINUTES, user: dict = Depends(get_current_user)):
    _ensure_supported(pair)
    candles = bot_chart_service.get_recent_candles(_binance_symbol(pair), window_minutes)
    if candles is None:
        raise HTTPException(status_code=503, detail="Could not fetch price history right now — try again shortly.")
    return BotChartResponse(
        candles=[
            ChartCandle(
                time=c["time"], open=str(c["open"]), high=str(c["high"]), low=str(c["low"]),
                close=str(c["close"]), volume=str(c["volume"]),
            )
            for c in candles
        ]
    )


@router.post("/buy", response_model=TradeResponse)
async def buy(body: BuyRequest, user: dict = Depends(get_current_user)):
    _ensure_supported(body.pair)
    quote_amount = _parse_decimal(body.quote_amount, "quote_amount")
    try:
        result = await trading_service.buy(user["id"], body.pair, quote_amount)
    except InsufficientBalanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return TradeResponse(
        trade_id=result["trade_id"], pair=result["pair"], side=result["side"],
        price=str(result["price"]), quantity=str(result["quantity"]),
        quote_amount=str(result["quote_amount"]), fee_amount=str(result["fee_amount"]),
    )


@router.post("/sell", response_model=TradeResponse)
async def sell(body: SellRequest, user: dict = Depends(get_current_user)):
    _ensure_supported(body.pair)
    quantity = _parse_decimal(body.quantity, "quantity")
    try:
        result = await trading_service.sell(user["id"], body.pair, quantity)
    except InsufficientBalanceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return TradeResponse(
        trade_id=result["trade_id"], pair=result["pair"], side=result["side"],
        price=str(result["price"]), quantity=str(result["quantity"]),
        quote_amount=str(result["quote_amount"]), fee_amount=str(result["fee_amount"]),
    )


@router.get("/history", response_model=TradeHistoryResponse)
def history(pair: str | None = None, user: dict = Depends(get_current_user)):
    if pair:
        _ensure_supported(pair)
    rows = trading_service.get_history(user["id"], pair)
    return TradeHistoryResponse(
        trades=[
            TradeHistoryEntry(
                id=r["id"], pair=r["pair"], side=r["side"], price=str(r["price"]),
                quantity=str(r["quantity"]), quote_amount=str(r["quote_amount"]),
                fee_amount=str(r["fee_amount"]), created_at=r["created_at"],
            )
            for r in rows
        ]
    )
