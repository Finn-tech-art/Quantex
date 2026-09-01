from fastapi import APIRouter, Depends, HTTPException

from app.models.wallet import (
    ActivityResponse,
    BalancesResponse,
    DepositAddressResponse,
    PortfolioHistoryResponse,
)
from app.services import portfolio_history_service, wallet_service
from app.utils.auth import get_current_user

router = APIRouter(prefix="/wallet", tags=["wallet"])

# Narrowed to TRC-20 only for the mainnet launch — see the identical comment
# on deposits.py's _SUPPORTED_NETWORKS for why (and how to reverse it). This
# is what stops a user from ever being handed a Base/Polygon deposit
# address right now: without it, a real deposit to one of those addresses
# would just sit uncredited, since chain_watcher_service isn't scanning
# those networks while they're disabled.
_SUPPORTED_NETWORKS = {"TRC20"}

# Matches portfolio_history_service._RANGE_TO_TIMEDELTA's keys plus "all" --
# kept as an explicit set here (rather than importing that private dict)
# so the router's own input validation doesn't reach into the service
# module's internals.
_SUPPORTED_RANGES = {"24h", "7d", "30d", "90d", "180d", "all"}


@router.get("/deposit-address", response_model=DepositAddressResponse)
def deposit_address(network: str, user: dict = Depends(get_current_user)):
    network = network.upper()
    if network not in _SUPPORTED_NETWORKS:
        raise HTTPException(status_code=400, detail=f"Unsupported network: {network}")

    address = wallet_service.get_or_create_deposit_address(user["id"], network)
    return DepositAddressResponse(network=network, deposit_address=address)


@router.get("/balances", response_model=BalancesResponse)
def balances(user: dict = Depends(get_current_user)):
    return BalancesResponse(balances=wallet_service.get_balances(user["id"]))


@router.get("/activity", response_model=ActivityResponse)
def activity(user: dict = Depends(get_current_user)):
    return ActivityResponse(entries=wallet_service.get_recent_activity(user["id"]))


@router.get("/portfolio-history", response_model=PortfolioHistoryResponse)
def portfolio_history(
    range: str = "7d",
    buckets: int = 12,
    user: dict = Depends(get_current_user),
):
    # `range` shadows the Python builtin only inside this function's own
    # scope -- matches the query param name the frontend sends
    # (getPortfolioHistory in api.js), so no request-side renaming needed.
    range = range.lower()
    if range not in _SUPPORTED_RANGES:
        raise HTTPException(status_code=400, detail=f"Unsupported range: {range}")

    points = portfolio_history_service.get_portfolio_history(
        user["id"], range_key=range, buckets=buckets
    )
    return PortfolioHistoryResponse(points=points)
