from functools import lru_cache

import redis
import redis.asyncio as redis_asyncio

from app.config import settings


@lru_cache
def get_redis() -> redis_asyncio.Redis:
    return redis_asyncio.from_url(settings.redis_url, decode_responses=True)


@lru_cache
def get_redis_sync() -> redis.Redis:
    """Non-async client for use inside Celery tasks, which run synchronously —
    get_redis()'s asyncio client would need an event loop that isn't there."""
    return redis.from_url(settings.redis_url, decode_responses=True)
