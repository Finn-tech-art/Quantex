from pydantic import BaseModel


class DepositAddressResponse(BaseModel):
    network: str
    deposit_address: str


class BalanceEntry(BaseModel):
    asset: str
    amount: str


class BalancesResponse(BaseModel):
    balances: list[BalanceEntry]


class ActivityEntry(BaseModel):
    entry_type: str
    asset: str
    network: str | None
    amount: str
    tx_hash: str | None
    created_at: str


class ActivityResponse(BaseModel):
    entries: list[ActivityEntry]


class PortfolioHistoryPoint(BaseModel):
    # t is Unix seconds marking the START of this bucket's window (same
    # "time = open_time" convention BotChartResponse's ChartCandle uses) --
    # see portfolio_history_service.get_portfolio_history()'s docstring for
    # the full shape/derivation explanation.
    t: int
    open: str
    high: str
    low: str
    close: str


class PortfolioHistoryResponse(BaseModel):
    points: list[PortfolioHistoryPoint]
