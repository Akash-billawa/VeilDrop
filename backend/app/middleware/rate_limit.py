from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import wraps

from fastapi import HTTPException, Request

from ..config import get_settings
from ..database import get_pool

logger = logging.getLogger(__name__)

_CLEANUP_INTERVAL = 60.0
_last_cleanup_at: float = 0.0


async def _check(key: str, max_reqs: int, window: float) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "SELECT window_start, request_count FROM rate_limit_buckets WHERE bucket_key = $1 FOR UPDATE",
            key,
        )
        now = datetime.now(UTC)

        if row is None:
            await conn.execute(
                "INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count) VALUES ($1, $2, 1)",
                key,
                now,
            )
            return True

        if now - row["window_start"] >= timedelta(seconds=window):
            await conn.execute(
                "UPDATE rate_limit_buckets SET window_start = $1, request_count = 1 WHERE bucket_key = $2",
                now,
                key,
            )
            return True

        if row["request_count"] >= max_reqs:
            return False

        await conn.execute(
            "UPDATE rate_limit_buckets SET request_count = request_count + 1 WHERE bucket_key = $1",
            key,
        )
        return True


async def _cleanup(window: float) -> None:
    global _last_cleanup_at
    now = time.monotonic()
    if now - _last_cleanup_at < _CLEANUP_INTERVAL:
        return
    _last_cleanup_at = now

    cutoff = timedelta(seconds=max(window * 4, 300.0))
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM rate_limit_buckets WHERE window_start < now() - $1::interval",
            cutoff,
        )


def rate_limit(limit_type: str):
    s = get_settings()

    limits = {
        "case_creation": (s.rate_limit_case_per_min, 60.0),
        "auth": (s.rate_limit_auth_per_min, 60.0),
    }

    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            if not request:
                for _, v in kwargs.items():
                    if isinstance(v, Request):
                        request = v
                        break

            max_reqs, window = limits.get(limit_type, (30, 60.0))

            if request:
                client_key = f"{limit_type}:{request.client.host if request.client else 'unknown'}"
            else:
                client_key = f"{limit_type}:unknown"

            await _cleanup(window)

            if not await _check(client_key, max_reqs, window):
                logger.warning("Rate limit exceeded: %s", client_key)
                raise HTTPException(status_code=429, detail="Too many requests. Please wait.")

            return await func(*args, **kwargs)

        return wrapper

    return decorator
