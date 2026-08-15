from __future__ import annotations

import asyncio
import os

import asyncpg
import pytest
import pytest_asyncio
from app.services.message import consume_burn

pytestmark = pytest.mark.asyncio

DB_URL = os.getenv(
    "VEILDROP_DATABASE_URL",
    "postgresql://veildrop:veildrop@localhost:5432/veildrop",
)


@pytest_asyncio.fixture(scope="session")
async def pool():
    try:
        p = await asyncpg.create_pool(DB_URL, min_size=1, max_size=10)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"PostgreSQL not reachable: {e}")
    yield p
    await p.close()


async def _seed(pool, case_id: str, burn_after_read: bool = True) -> str:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)
        await conn.execute(
            "INSERT INTO cases (case_id, status, expires_at) VALUES ($1, 'open', now() + interval '1 day')",
            case_id,
        )
        return str(
            await conn.fetchval(
                """
                INSERT INTO encrypted_messages
                    (case_id, sender_type, ciphertext, nonce, tag, burn_after_read)
                VALUES ($1, 'reporter', '\\x01'::BYTEA, '\\x02'::BYTEA, '\\x03'::BYTEA, $2)
                RETURNING message_id
                """,
                case_id,
                burn_after_read,
            )
        )


async def _cleanup(pool, case_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)


class TestBurnOnRead:
    async def test_single_consume(self, pool):
        """A burn-on-read message must be consumable exactly once."""
        case_id = "TEST-BURN-SINGLE"
        try:
            msg_id = await _seed(pool, case_id)
            result = await consume_burn(msg_id)
            assert result is not None, "first consume must succeed"
            assert result["case_id"] == case_id

            second = await consume_burn(msg_id)
            assert second is None, "second consume must fail"
        finally:
            await _cleanup(pool, case_id)

    async def test_concurrent_consume(self, pool):
        """Simultaneous requests must result in exactly one success."""
        case_id = "TEST-BURN-CONC"
        try:
            msg_id = await _seed(pool, case_id)
            results = await asyncio.gather(*[consume_burn(msg_id) for _ in range(10)])
            successes = sum(1 for r in results if r is not None)
            assert successes == 1, f"expected exactly 1 success, got {successes}"
        finally:
            await _cleanup(pool, case_id)

    async def test_second_consume_fails(self, pool):
        """Second consume of same message returns 410."""
        case_id = "TEST-BURN-TWICE"
        try:
            msg_id = await _seed(pool, case_id)
            first = await consume_burn(msg_id)
            assert first is not None
            second = await consume_burn(msg_id)
            assert second is None
        finally:
            await _cleanup(pool, case_id)

    async def test_regular_message_not_consumed(self, pool):
        """Non-burn messages must not be affected by consume endpoint."""
        case_id = "TEST-BURN-REG"
        try:
            msg_id = await _seed(pool, case_id, burn_after_read=False)
            result = await consume_burn(msg_id)
            assert result is None, "regular messages must not be consumable as burn-on-read"
        finally:
            await _cleanup(pool, case_id)
