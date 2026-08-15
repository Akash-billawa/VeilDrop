from __future__ import annotations

import pytest
from app.crypto import get_provider
from app.services.receipt import canonical_receipt, verify_receipt

pytestmark = pytest.mark.asyncio


class TestReceiptVerification:
    """Stateless receipt verification (Ed25519) — no DB required."""

    @pytest.fixture(scope="class")
    @classmethod
    def keys(cls):
        crypto = get_provider()
        sk, pk = crypto.generate_signing_key()
        return sk, pk

    async def test_valid_receipt_verifies(self, keys):
        """A properly signed receipt must verify."""
        sk, pk = keys
        timestamp = "2026-08-06T12:00:00+00:00"
        canonical = canonical_receipt("VEIL-ABC", "abc123", 1, timestamp)
        signature = get_provider().sign(sk, canonical.encode())
        ok = await verify_receipt("VEIL-ABC", "abc123", 1, timestamp, signature.hex(), pk.hex())
        assert ok is True

    async def test_modified_hash_fails(self, keys):
        """Modified ciphertext hash must cause verification failure."""
        sk, pk = keys
        timestamp = "2026-08-06T12:00:00+00:00"
        canonical = canonical_receipt("VEIL-ABC", "abc123", 1, timestamp)
        signature = get_provider().sign(sk, canonical.encode())
        ok = await verify_receipt("VEIL-ABC", "abc124", 1, timestamp, signature.hex(), pk.hex())
        assert ok is False

    async def test_modified_timestamp_fails(self, keys):
        """Modified timestamp must cause verification failure."""
        sk, pk = keys
        canonical = canonical_receipt("VEIL-ABC", "abc123", 1, "2026-08-06T12:00:00+00:00")
        signature = get_provider().sign(sk, canonical.encode())
        ok = await verify_receipt("VEIL-ABC", "abc123", 1, "2026-08-06T12:00:01+00:00", signature.hex(), pk.hex())
        assert ok is False

    async def test_wrong_verification_key_fails(self, keys):
        """Verification with wrong public key must fail."""
        sk, _ = keys
        timestamp = "2026-08-06T12:00:00+00:00"
        canonical = canonical_receipt("VEIL-ABC", "abc123", 1, timestamp)
        signature = get_provider().sign(sk, canonical.encode())
        _, other_pk = get_provider().generate_signing_key()
        ok = await verify_receipt("VEIL-ABC", "abc123", 1, timestamp, signature.hex(), other_pk.hex())
        assert ok is False

    async def test_retired_key_fails(self, keys):
        """A key that is no longer the signing key (retired/rotated out) must not verify."""
        _, pk = keys
        timestamp = "2026-08-06T12:00:00+00:00"
        canonical = canonical_receipt("VEIL-ABC", "abc123", 1, timestamp)
        _, other_sk = get_provider().generate_signing_key()
        signature = get_provider().sign(other_sk, canonical.encode())
        ok = await verify_receipt("VEIL-ABC", "abc123", 1, timestamp, signature.hex(), pk.hex())
        assert ok is False

    async def test_garbage_signature_and_key_rejected(self, keys):
        """Malformed hex and empty signatures must fail closed."""
        sk, pk = keys
        timestamp = "2026-08-06T12:00:00+00:00"
        assert await verify_receipt("VEIL-ABC", "abc123", 1, timestamp, "zz-not-hex", pk.hex()) is False
        assert await verify_receipt("VEIL-ABC", "abc123", 1, timestamp, "", "not-hex") is False
        canonical = canonical_receipt("VEIL-ABC", "abc123", 1, timestamp)
        signature = get_provider().sign(sk, canonical.encode())
        ok = await verify_receipt("VEIL-ABC", "abc123", 1, timestamp, signature.hex()[:-4] + "0000", pk.hex())
        assert ok is False
