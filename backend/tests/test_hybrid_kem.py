"""Post-quantum hybrid HPKE tests (CryptoVersion.V2).

The hybrid wraps DHKEM(X25519) + ML-KEM-768 with a dual-KEM combiner
(concatenation-then-hash, per ARCHITECTURE.md §21). V2 stays inactive by
default; these tests exercise the engine directly and through the provider
dispatch.
"""

from __future__ import annotations

import os

import pytest
from app.crypto.hybrid_kem import (
    HYBRID_ENC_PREFIX_SIZE,
    HYBRID_PUBLIC_BLOB_SIZE,
    HybridKEMEngine,
    combine_shared_secrets,
)
from app.crypto.provider import SUITES, CryptoProvider, CryptoVersion

V2 = CryptoVersion.V2_HYBRID_MLKEM768_X25519


@pytest.fixture
def crypto_v2():
    return CryptoProvider(active_version=V2)


class TestHybridKEMEngine:
    def test_key_pair_sizes(self) -> None:
        engine = HybridKEMEngine()
        sk, pk = engine.generate_key_pair()
        assert len(pk) == HYBRID_PUBLIC_BLOB_SIZE
        assert len(sk) == 96  # 32 X25519 + 64 ML-KEM seed

    def test_seal_open_roundtrip(self) -> None:
        engine = HybridKEMEngine()
        sk, pk = engine.generate_key_pair()
        plaintext = os.urandom(512)
        info = b"case-42"
        wrapped = engine.seal(pk, plaintext, info)
        assert len(wrapped) > HYBRID_ENC_PREFIX_SIZE + 12 + 16
        opened = engine.open(sk, wrapped, info)
        assert opened == plaintext

    def test_seal_open_roundtrip_empty(self) -> None:
        engine = HybridKEMEngine()
        sk, pk = engine.generate_key_pair()
        opened = engine.open(sk, engine.seal(pk, b""), b"")
        assert opened == b""

    def test_wrong_recipient_fails(self) -> None:
        engine = HybridKEMEngine()
        sk_a, pk_a = engine.generate_key_pair()
        _, pk_b = engine.generate_key_pair()
        wrapped = engine.seal(pk_b, b"secret for b")
        with pytest.raises(Exception):
            engine.open(sk_a, wrapped)

    def test_tampered_envelope_fails(self) -> None:
        engine = HybridKEMEngine()
        sk, pk = engine.generate_key_pair()
        wrapped = bytearray(engine.seal(pk, b"tamper me"))
        wrapped[-1] ^= 0x01
        with pytest.raises(Exception):
            engine.open(sk, bytes(wrapped))

    def test_truncated_envelope_rejected(self) -> None:
        engine = HybridKEMEngine()
        sk, pk = engine.generate_key_pair()
        wrapped = engine.seal(pk, b"short")
        with pytest.raises(ValueError):
            engine.open(sk, wrapped[: HYBRID_ENC_PREFIX_SIZE + 20])

    def test_bad_key_lengths_rejected(self) -> None:
        engine = HybridKEMEngine()
        with pytest.raises(ValueError):
            engine.seal(b"\x00" * 32, b"x")
        with pytest.raises(ValueError):
            engine.open(b"\x00" * 32, b"x")

    def test_combiner_binds_ephemeral_material(self) -> None:
        s1 = combine_shared_secrets(b"a" * 32, b"b" * 32, b"e1", b"c1")
        s2 = combine_shared_secrets(b"a" * 32, b"b" * 32, b"e2", b"c1")
        s3 = combine_shared_secrets(b"a" * 32, b"b" * 32, b"e1", b"c2")
        assert s1 == combine_shared_secrets(b"a" * 32, b"b" * 32, b"e1", b"c1")
        assert s1 != s2 and s1 != s3
        assert len(s1) == 32

    def test_deterministic_key_schedule_both_sides(self) -> None:
        """The combiner output must be identical on sender and receiver."""
        engine = HybridKEMEngine()
        sk, pk = engine.generate_key_pair()
        plaintext = b"determinism"
        wrapped = engine.seal(pk, plaintext, b"info")
        assert engine.open(sk, wrapped, b"info") == plaintext
        with pytest.raises(Exception):
            engine.open(sk, wrapped, b"other-info")


class TestProviderDispatch:
    def test_v2_suite_registered(self) -> None:
        suite = SUITES[V2]
        assert suite.version == 2
        assert "MLKEM-768" in suite.hpke_kem
        assert suite.envelope_protocol == "HPKE-BASE-DUAL-KEM"

    def test_v1_still_active_default(self) -> None:
        provider = CryptoProvider()
        assert provider.active_version == 1
        assert isinstance(provider.get_suite().hpke_kem, str)

    def test_provider_v2_seal_open(self, crypto_v2) -> None:
        sk, pk = crypto_v2.generate_hpke_key_pair()
        dek = os.urandom(32)
        wrapped = crypto_v2.envelope_encrypt(pk, dek, b"envelope-info", version=V2)
        opened = crypto_v2.envelope_decrypt(sk, wrapped, b"envelope-info", version=V2)
        assert opened == dek

    def test_provider_version_parameter_isolated(self) -> None:
        """Explicit version= overrides the provider's active version."""
        provider = CryptoProvider(active_version=1)
        sk2, pk2 = provider.generate_hpke_key_pair(version=V2)
        dek = os.urandom(32)
        wrapped = provider.hpke_seal(pk2, dek, version=V2)
        assert provider.hpke_open(sk2, wrapped, version=V2) == dek

    def test_cross_version_ciphertexts_are_incompatible(self) -> None:
        provider = CryptoProvider(active_version=1)
        sk1, pk1 = provider.generate_hpke_key_pair(version=1)
        sk2, pk2 = provider.generate_hpke_key_pair(version=V2)
        dek = os.urandom(32)

        wrapped_v1 = provider.hpke_seal(pk1, dek, version=1)
        with pytest.raises(Exception):
            provider.hpke_open(sk2, wrapped_v1, version=V2)

        wrapped_v2 = provider.hpke_seal(pk2, dek, version=V2)
        with pytest.raises(Exception):
            provider.hpke_open(sk1, wrapped_v2, version=1)

    def test_suite_metadata_explicit_algorithm_ids(self) -> None:
        md = SUITES[V2].metadata()
        assert md["name"] == "hpke-hybrid-mlkem768-x25519-hkdf-sha256-aes256gcm"
        assert md["hpke_kem"] == "HYBRID(MLKEM-768 + DHKEM-X25519)"
        assert md["hpke_aead"] == "AES-256-GCM"
        assert md["kdf"] == "HKDF-SHA-256"
        assert md["envelope"] == "HPKE-BASE-DUAL-KEM"
