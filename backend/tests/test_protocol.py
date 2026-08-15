from __future__ import annotations

import json
import os
import secrets

import asyncpg
import pytest
import pytest_asyncio
from app.crypto import AESGCMEngine, KDFEngine, get_provider
from app.services import case as case_svc
from app.services import message as msg_svc

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


def _object_aad(purpose: str, object_id: str, version: int = 1) -> bytes:
    return f"veildrop:{purpose}:{object_id}:v{version}".encode()


def _wrap(provider, kek: bytes, dek: bytes) -> bytes:
    ct, nonce, tag = provider.encrypt_symmetric(kek, dek)
    return nonce + ct + tag


def _unwrap(provider, kek: bytes, wrapped: bytes) -> bytes:
    nonce, ct, tag = wrapped[:12], wrapped[12:44], wrapped[44:]
    return provider.decrypt_symmetric(kek, ct, nonce, tag)


class TestEndToEndProtocol:
    """Replicates the browser flow: encrypt client-side, submit, then decrypt.

    Mirrors frontend/js/crypto.js so a mismatch between the two stacks surfaces here.
    """

    async def test_client_encrypt_service_submit_server_decrypt(self, pool):
        aes_engine, kdf = AESGCMEngine(), KDFEngine()
        provider = get_provider()

        recovery_secret = os.urandom(32)
        dek = os.urandom(32)
        kek = kdf.derive_kek(recovery_secret, crypto_version=1)
        wrapped_dek = _wrap(provider, kek, dek)

        object_id = "msg-" + secrets.token_hex(8)
        report_plaintext = json.dumps(
            {
                "category": "Security & safety",
                "title": "Protocol roundtrip",
                "summary": "submitted through service layer",
                "details": "verify decrypt",
            }
        ).encode("utf-8")
        report_key = kdf.derive_message_key(dek, object_id, b"report", 1)
        ct, nonce, tag = aes_engine.encrypt(report_key, report_plaintext, aad=_object_aad("report", object_id))

        case = await case_svc.create_case(
            ciphertext=ct,
            nonce=nonce,
            tag=tag,
            aad=_object_aad("report", object_id),
            wrapped_dek=wrapped_dek,
            envelope_algorithm="hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
            crypto_version=1,
            burn_after_read=True,
        )
        case_id = case["case_id"]
        try:
            messages = await msg_svc.list_for_case(case_id)
            assert len(messages) == 1, "created case must contain exactly one report message"
            msg = messages[0]
            assert msg["burn_after_read"] is True
            assert msg["consumed_at"] is None

            envelope = await self._get_envelope(pool, case_id)
            assert envelope["algorithm"] == "hpke-dhkem-x25519-hkdf-sha256-aes256gcm"
            unwrapped = _unwrap(provider, kek, bytes(envelope["wrapped_dek"]))
            assert unwrapped == dek, "wrapped DEK in DB must unwrap to the original DEK"

            server_key = kdf.derive_message_key(dek, msg["aad"].decode().split(":")[2], b"report", 1)
            server_plaintext = aes_engine.decrypt(
                server_key,
                bytes(msg["ciphertext"]),
                bytes(msg["nonce"]),
                bytes(msg["tag"]),
                aad=bytes(msg["aad"]),
            )
            assert json.loads(server_plaintext) == json.loads(report_plaintext)
        finally:
            await self._cleanup(pool, case_id)

    async def test_burn_consume_endpoint_semantics(self, pool):
        """A burn-on-read report can be consumed once; second consume fails."""
        aes_engine, kdf = AESGCMEngine(), KDFEngine()
        provider = get_provider()

        dek = os.urandom(32)
        kek = kdf.derive_kek(os.urandom(32), 1)
        object_id = "msg-" + secrets.token_hex(8)
        ct, nonce, tag = aes_engine.encrypt(
            kdf.derive_message_key(dek, object_id, b"report", 1),
            b"{}",
            aad=_object_aad("report", object_id),
        )
        case = await case_svc.create_case(
            ciphertext=ct,
            nonce=nonce,
            tag=tag,
            aad=_object_aad("report", object_id),
            wrapped_dek=_wrap(provider, kek, dek),
            envelope_algorithm="hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
            crypto_version=1,
            burn_after_read=True,
        )
        case_id = case["case_id"]
        try:
            messages = await msg_svc.list_for_case(case_id)
            msg_id = str(messages[0]["message_id"])

            first = await msg_svc.consume_burn(msg_id)
            assert first is not None
            assert first["case_id"] == case_id

            after = await msg_svc.list_for_case(case_id)
            assert all(m["consumed_at"] is not None for m in after), (
                "consumed burn-on-read message must disappear from listings"
            )

            second = await msg_svc.consume_burn(msg_id)
            assert second is None
        finally:
            await self._cleanup(pool, case_id)

    async def _get_envelope(self, pool, case_id: str) -> dict:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT wrapped_dek, algorithm FROM case_envelopes WHERE case_id = $1",
                case_id,
            )
        assert row is not None
        return {"wrapped_dek": bytes(row["wrapped_dek"]), "algorithm": row["algorithm"]}

    async def _cleanup(self, pool, case_id: str) -> None:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM cases WHERE case_id = $1", case_id)
