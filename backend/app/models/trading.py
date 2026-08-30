from pydantic import BaseModel


class BuyRequest(BaseModel):
    pair: str
    quote_amount: str  # USDT to spend — decimal STRING, same convention as every other money-shaped request field


class SellRequest(BaseModel):
    pair: str
    quantity: str  # base-asset amount to sell — decimal STRING


class TradeResponse(BaseModel):
    trade_id: int
    pair: str
    side: str
    price: str
    quantity: str
    quote_amount: str
    fee_amount: str


class TradeHistoryEntry(BaseModel):
    id: int
    pair: str
    side: str
    price: str
    quantity: str
    quote_amount: str
    fee_amount: str
    created_at: str


class TradeHistoryResponse(BaseModel):
    trades: list[TradeHistoryEntry]


class CurrentPriceResponse(BaseModel):
    pair: str
    price: str
