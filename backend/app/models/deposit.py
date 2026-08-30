from pydantic import BaseModel


class ExpectDepositRequest(BaseModel):
    network: str
    expected_amount: str | None = None


class ExpectDepositResponse(BaseModel):
    watching: bool
    ttl_seconds: int
