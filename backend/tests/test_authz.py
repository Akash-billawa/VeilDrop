from __future__ import annotations

import os
import secrets

import asyncpg
import pytest
import pytest_asyncio
from app.crypto import get_provider
from app.routers.investigator import require_role
from app.services import audit as audit_svc
from app.services import auth as auth_svc
from app.services import case as case_svc
from app.services import envelope as env_svc
from fastapi import HTTPException

pytestmark = pytest.mark.asyncio

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


def _wrap(provider, kek: bytes, dek: bytes) -> bytes:
    ct, nonce, tag = provider.encrypt_symmetric(kek, dek)
    return nonce + ct + tag


async def _make_investigator(role: str = "investigator", password: str = "correct horse battery staple"):
    username = "test_" + secrets.token_hex(4)
    inv = await auth_svc.create_investigator(username=username, password=password, role=role)
    return inv["investigator_id"], username, password


async def _make_case(reporter_meta: dict | None = None):
    provider = get_provider()
    kek, dek = os.urandom(32), os.urandom(32)
    case = await case_svc.create_case(
        ciphertext=os.urandom(24),
        nonce=os.urandom(12),
        tag=os.urandom(16),
        aad=b"veildrop:report:msg-test:v1",
        wrapped_dek=_wrap(provider, kek, dek),
        envelope_algorithm="hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
        crypto_version=1,
        reporter_meta=reporter_meta,
    )
    return case["case_id"]


async def _cleanup_case(pool, case_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)


async def _cleanup_investigators(pool, ids: list[str]) -> None:
    async with pool.acquire() as conn:
        for iid in ids:
            await conn.execute("DELETE FROM investigators WHERE investigator_id = $1", iid)


class TestAuthorization:
    """Authorization isolation tests - run against a live test database."""

    async def test_investigator_isolation(self, pool):
        """Investigator A must not access Case B."""
        inv_a, _, _ = await _make_investigator()
        inv_b, _, _ = await _make_investigator()
        case_id = await _make_case()
        try:
            await case_svc.assign_case(case_id, inv_a, "write")

            listed = await case_svc.get_assigned_cases(inv_a)
            assert any(c["case_id"] == case_id for c in listed)
            assert await case_svc.check_access(case_id, inv_a) == "write"
            assert await case_svc.check_access(case_id, inv_b) is None
        finally:
            await _cleanup_case(pool, case_id)
            await _cleanup_investigators(pool, [inv_a, inv_b])

    async def test_unauthenticated_rejected(self, pool):
        """Tokens without a valid session must be rejected."""
        assert await auth_svc.validate_session("garbage-token") is None
        assert await auth_svc.validate_session("") is None

    async def test_expired_session_rejected(self, pool):
        """Expired sessions must be rejected."""
        inv, _, _ = await _make_investigator()
        try:
            sess = await auth_svc.create_session(inv)
            assert await auth_svc.validate_session(sess["session_token"]) is not None

            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE investigator_sessions SET expires_at = now() - interval '1 minute' WHERE session_id = $1",
                    sess["session_id"],
                )
            assert await auth_svc.validate_session(sess["session_token"]) is None
        finally:
            await _cleanup_investigators(pool, [inv])

    async def test_role_boundaries(self, pool):
        """Investigator role cannot perform admin operations."""
        ids = []
        try:
            for role in ("investigator", "senior_investigator", "security_admin"):
                iid, username, password = await _make_investigator(role=role)
                ids.append(iid)
                auth = await auth_svc.authenticate_password(username, password)
                assert auth is not None and auth["role"] == role

            gate = require_role("security_admin")
            try:
                await gate(session={"role": "investigator", "investigator_id": ids[0]})
                raise AssertionError("investigator must not pass the security_admin gate")
            except HTTPException as e:
                assert e.status_code == 403

            session = await gate(session={"role": "security_admin", "investigator_id": ids[2]})
            assert session["role"] == "security_admin"
        finally:
            await _cleanup_investigators(pool, ids)

    async def test_assigned_case_meta_and_envelope(self, pool):
        """Assigned-case listing exposes reporter_meta and the investigator envelope."""
        inv, _, _ = await _make_investigator()
        case_id = await _make_case(reporter_meta={"category": "Fraud & finance"})
        try:
            await case_svc.assign_case(case_id, inv, "write")
            await env_svc.create_investigator_envelope(
                case_id,
                inv,
                os.urandom(48),
                "hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
            )

            listed = await case_svc.get_assigned_cases(inv)
            row = next(c for c in listed if c["case_id"] == case_id)
            assert row["reporter_meta"] == {"category": "Fraud & finance"}
            assert row["crypto_version"] == 1
            assert row["env_algorithm"] == "hpke-dhkem-x25519-hkdf-sha256-aes256gcm"
            assert row["env_key_version"] == 1
        finally:
            await _cleanup_case(pool, case_id)
            await _cleanup_investigators(pool, [inv])

    async def test_audit_scope(self, pool):
        """Audit listing is scoped: self + assigned cases; admin sees everything."""
        inv_a, _, _ = await _make_investigator()
        inv_b, _, _ = await _make_investigator()
        case_id = await _make_case()
        try:
            await case_svc.assign_case(case_id, inv_a, "read")

            ev_self = await audit_svc.record("auth_success", severity="info", investigator_id=inv_a)
            ev_case = await audit_svc.record("case_created", severity="info", case_id=case_id)
            ev_other = await audit_svc.record("auth_success", severity="info", investigator_id=inv_b)
            ev_other_case = await audit_svc.record(
                "auth_logout", severity="info", case_id=case_id, investigator_id=inv_b
            )

            a_ids = {e["event_id"] for e in await audit_svc.list_events(inv_a)}
            assert ev_self["event_id"] in a_ids
            assert ev_case["event_id"] in a_ids
            assert ev_other["event_id"] not in a_ids
            assert ev_other_case["event_id"] in a_ids  # case is assigned to A

            b_ids = {e["event_id"] for e in await audit_svc.list_events(inv_b)}
            assert ev_other["event_id"] in b_ids
            assert ev_self["event_id"] not in b_ids
            assert ev_case["event_id"] not in b_ids

            admin_ids = {e["event_id"] for e in await audit_svc.list_events(inv_a, is_admin=True)}
            for ev in (ev_self, ev_case, ev_other, ev_other_case):
                assert ev["event_id"] in admin_ids

            hashed = next(e for e in await audit_svc.list_events(inv_a) if e["event_hash"])
            assert isinstance(hashed["event_hash"], str) and len(hashed["event_hash"]) == 64
        finally:
            await _cleanup_case(pool, case_id)
            await _cleanup_investigators(pool, [inv_a, inv_b])
