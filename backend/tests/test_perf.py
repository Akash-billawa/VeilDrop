"""Performance regression smoke tests.

Thresholds are intentionally loose (10-100x the expected cost) so they catch
gross regressions (algorithm swaps, accidental O(n^2) paths) without being
flaky on shared CI runners. Run with: pytest -m perf
"""

from __future__ import annotations

import os
import time

import pytest
from app.crypto.aes_gcm import AES_KEY_SIZE, AESGCMEngine
from app.crypto.kdf import KDFEngine
from app.database import get_pool
from app.services.case import create_case
from app.services.message import consume_burn, store

pytestmark = [pytest.mark.perf, pytest.mark.asyncio]

MI = 1024 * 1024


class TestAesThroughput:
    async def test_chunked_roundtrip_1mib(self) -> None:
        key = os.urandom(AES_KEY_SIZE)
        engine = AESGCMEngine()
        plaintext = os.urandom(MI)

        start = time.perf_counter()
        ct, meta = engine.encrypt_chunked(key, plaintext, file_id="perf-bench-1")
        encrypt_s = time.perf_counter() - start

        start = time.perf_counter()
        recovered = engine.decrypt_chunked(key, ct, meta)
        decrypt_s = time.perf_counter() - start

        assert recovered == plaintext
        # Expect well under 1s each; 10s is an extreme outlier, not a perf gate.
        assert encrypt_s < 10.0
        assert decrypt_s < 10.0

    async def test_kdf_derive_message_key_100k(self) -> None:
        engine = KDFEngine()
        dek = os.urandom(32)

        start = time.perf_counter()
        for i in range(100_000):
            engine.derive_message_key(dek, f"obj-{i}", b"bench")
        elapsed = time.perf_counter() - start

        assert elapsed < 10.0


class TestDbPathLatency:
    async def test_case_create_and_message_store(self) -> None:
        """End-to-end reporter path: create case, store message, consume burn."""
        key = os.urandom(AES_KEY_SIZE)
        engine = AESGCMEngine()
        plaintext = os.urandom(16 * 1024)
        ct, nonce, tag = engine.encrypt(key, plaintext)
        wrapped_dek = KDFEngine().derive(key, b"bench-wrapped-dek")

        pool = await get_pool()
        await pool.execute("DELETE FROM cases WHERE case_id LIKE 'VEIL-PERF%'")

        start = time.perf_counter()
        case = await create_case(
            ciphertext=ct,
            nonce=nonce,
            tag=tag,
            aad=b"",
            wrapped_dek=wrapped_dek,
            envelope_algorithm="AES-256-GCM-v1",
        )
        create_s = time.perf_counter() - start
        assert case["case_id"].startswith("VEIL-PERF") or case["case_id"].startswith("VEIL-")

        start = time.perf_counter()
        msg = await store(
            case_id=case["case_id"],
            sender_type="investigator",
            ciphertext=ct,
            nonce=nonce,
            tag=tag,
            burn_after_read=True,
        )
        store_s = time.perf_counter() - start

        consumed = await consume_burn(msg["message_id"])
        assert consumed is not None

        await pool.execute("DELETE FROM cases WHERE case_id = $1", case["case_id"])

        assert create_s < 10.0
        assert store_s < 10.0
