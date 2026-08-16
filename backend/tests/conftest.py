from __future__ import annotations

import os

import pytest

os.environ.setdefault("VEILDROP_SESSION_SECRET", "test-secret-not-for-production")
os.environ.setdefault(
    "VEILDROP_DATABASE_URL",
    "postgresql://veildrop:veildrop@localhost:5432/veildrop",
)
os.environ.setdefault("VEILDROP_LOG_LEVEL", "WARNING")


@pytest.fixture(scope="session", autouse=True)
async def _init_schema():
    """Ensure the database schema exists before any test runs.

    Lets the suite run against a fresh/empty PostgreSQL (CI service or a new
    local install) without a manual ``init_db`` step, and keeps it idempotent.
    Skips gracefully when the database is unreachable (e.g. replication tests
    that only use ``VEILDROP_REPL_PRIMARY_URL``/``STANDBY_URL``).
    """
    from app.database import close_pool, create_pool, init_db

    try:
        pool = await create_pool()
    except Exception:
        pytest.skip("Primary database not reachable")
        return  # unreachable, keeps type-checkers happy

    try:
        await init_db(pool)
    finally:
        await close_pool()
