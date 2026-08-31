from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, bots, deposits, health, kyc, market, notifications, trading, wallet, withdrawals

app = FastAPI(title="Quantex API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(wallet.router)
app.include_router(deposits.router)
app.include_router(bots.router)
app.include_router(trading.router)
app.include_router(market.router)
app.include_router(kyc.router)
app.include_router(withdrawals.router)
app.include_router(notifications.router)
app.include_router(admin.router)
