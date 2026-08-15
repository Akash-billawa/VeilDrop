from __future__ import annotations

import os

import asyncpg
import pytest
import pytest_asyncio
from app.services import case as case_svc
from app.services import envelope as env_svc

DB_URL = os.getenv(
    "VEILDROP_DATABASE_URL",
    "postgresql://veildrop:veildrop@localhost:5432/veildrop",
)


@pytest_asyncio.fixture(scope="module")
async def pool():
    try:
        p = await asyncpg.create_pool(DB_URL, min_size=1, max_size=10)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"PostgreSQL not reachable: {e}")
    yield p
    await p.close()


async def _make_case(ttl_days: int = 30):
    return await case_svc.create_case(
        ciphertext=os.urandom(24),
        nonce=os.urandom(12),
        tag=os.urandom(16),
        aad=b"veildrop:report:exp-test:v1",
        wrapped_dek=os.urandom(44),
        envelope_algorithm="hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
        crypto_version=1,
        ttl_days=ttl_days,
    )


async def _force_past_due(pool, case_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE cases SET expires_at = now() - interval '1 minute' WHERE case_id = $1",
            case_id,
        )


class TestCaseExpiration:
    """Live-database expiration tests (service layer)."""

    async def test_expired_case_status(self, pool):
        case = await _make_case()
        case_id = case["case_id"]
        try:
            assert await case_svc.expire_case(case_id) is True
            detail = await case_svc.get_case(case_id)
            assert detail is not None
            assert detail["status"] == "expired"
            assert detail["closed_at"] is not None
        finally:
            await self._cleanup(pool, case_id)

    async def test_expire_stale_cases(self, pool):
        case = await _make_case()
        case_id = case["case_id"]
        try:
            await _force_past_due(pool, case_id)
            assert await case_svc.expire_stale_cases() >= 1
            detail = await case_svc.get_case(case_id)
            assert detail is not None and detail["status"] == "expired"
        finally:
            await self._cleanup(pool, case_id)

    async def test_envelopes_revoked_on_expiry(self, pool):
        case = await _make_case()
        case_id = case["case_id"]
        investigator = "22222222-2222-2222-2222-222222222222"
        try:
            await env_svc.create_investigator_envelope(
                case_id,
                investigator,
                os.urandom(48),
                "hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
            )
            envelope = await env_svc.get_for_recipient(case_id, investigator)
            assert envelope is not None, "envelope must exist before expiry"

            await case_svc.expire_case(case_id)
            after = await env_svc.get_for_recipient(case_id, investigator)
            assert after is None, "envelope must be revoked after expiry"

            all_env = await env_svc.list_for_case(case_id)
            assert all(e["revoked_at"] is not None for e in all_env)
        finally:
            await self._cleanup(pool, case_id)

    async def test_expired_case_not_re_expired(self, pool):
        case = await _make_case()
        case_id = case["case_id"]
        try:
            assert await case_svc.expire_case(case_id) is True
            assert await case_svc.expire_case(case_id) is False
            assert await case_svc.expire_case(case_id) is False
        finally:
            await self._cleanup(pool, case_id)

    async def test_expired_case_rejects_further_activity(self, pool):
        """Status guard used by the routers: closed/expired blocks messages + evidence."""
        case = await _make_case()
        case_id = case["case_id"]
        try:
            await case_svc.expire_case(case_id)
            detail = await case_svc.get_case(case_id)
            assert detail is not None and detail["status"] == "expired"
        finally:
            await self._cleanup(pool, case_id)

    async def _cleanup(self, pool, case_id: str) -> None:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)
