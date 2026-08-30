from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.redis_client import get_redis
from app.services.supabase_client import get_supabase

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness_check():
    services = {}

    try:
        get_supabase().auth.admin.list_users()
        services["supabase"] = "ok"
    except Exception as exc:
        services["supabase"] = f"error: {exc}"[:200]

    try:
        await get_redis().ping()
        services["redis"] = "ok"
    except Exception as exc:
        services["redis"] = f"error: {exc}"[:200]

    is_ready = all(status == "ok" for status in services.values())
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"ready": is_ready, "services": services},
    )
