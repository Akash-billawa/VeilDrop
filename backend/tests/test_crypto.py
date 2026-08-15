from __future__ import annotations

import os

import pytest
from app.crypto.provider import SUITES, CryptoProvider


@pytest.fixture
def crypto():
    return CryptoProvider(active_version=1)


class TestAESGCM:
    def test_encrypt_decrypt_roundtrip(self, crypto):
        key = os.urandom(32)
        plaintext = b"this is a sensitive report"
        ct, nonce, tag = crypto.encrypt_symmetric(key, plaintext, b"case-123")
        decrypted = crypto.decrypt_symmetric(key, ct, nonce, tag, b"case-123")
        assert decrypted == plaintext

    def test_wrong_key_fails(self, crypto):
        key1 = os.urandom(32)
        key2 = os.urandom(32)
        plaintext = b"confidential"
        ct, nonce, tag = crypto.encrypt_symmetric(key1, plaintext)
        with pytest.raises(Exception):
            crypto.decrypt_symmetric(key2, ct, nonce, tag)

    def test_tampered_ciphertext_fails(self, crypto):
        key = os.urandom(32)
        plaintext = b"important data"
        ct, nonce, tag = crypto.encrypt_symmetric(key, plaintext)
        tampered = bytearray(ct)
        tampered[0] ^= 0xFF
        with pytest.raises(Exception):
            crypto.decrypt_symmetric(key, bytes(tampered), nonce, tag)

    def test_tampered_aad_fails(self, crypto):
        key = os.urandom(32)
        plaintext = b"data"
        ct, nonce, tag = crypto.encrypt_symmetric(key, plaintext, aad=b"real-aad")
        with pytest.raises(Exception):
            crypto.decrypt_symmetric(key, ct, nonce, tag, aad=b"fake-aad")

    def test_nonce_uniqueness(self, crypto):
        key = os.urandom(32)
        nonces = set()
        for _ in range(100):
            _, n, _ = crypto.encrypt_symmetric(key, b"test")
            nonces.add(n)
        assert len(nonces) == 100

    def test_chunked_roundtrip(self, crypto):
        key = os.urandom(32)
        plaintext = os.urandom(200_000)
        encrypted, meta = crypto.aesgcm.encrypt_chunked(key, plaintext, "file-1")
        decrypted = crypto.aesgcm.decrypt_chunked(key, encrypted, meta)
        assert decrypted == plaintext


class TestKDF:
    def test_derive_message_key(self, crypto):
        dek = os.urandom(32)
        k1 = crypto.derive_key(dek, b"message:msg-1:v1")
        k2 = crypto.derive_key(dek, b"message:msg-2:v1")
        k3 = crypto.derive_key(dek, b"evidence:file-1:v1")
        assert k1 != k2
        assert k1 != k3
        assert len(k1) == 32

    def test_different_dek_different_keys(self, crypto):
        d1 = os.urandom(32)
        d2 = os.urandom(32)
        k1 = crypto.derive_key(d1, b"test")
        k2 = crypto.derive_key(d2, b"test")
        assert k1 != k2


class TestHPKE:
    def test_seal_open_roundtrip(self, crypto):
        sk, pk = crypto.generate_hpke_key_pair()
        plaintext = b"Case DEK material - 32 bytes of key data"
        info = b"VeilDrop-Case-Envelope-v1|case-42|inv-a"
        encrypted = crypto.hpke_seal(pk, plaintext, info)
        decrypted = crypto.hpke_open(sk, encrypted, info)
        assert decrypted == plaintext

    def test_wrong_recipient_fails(self, crypto):
        sk_a, pk_a = crypto.generate_hpke_key_pair()
        _, pk_b = crypto.generate_hpke_key_pair()
        plaintext = b"secret dek"
        encrypted = crypto.hpke_seal(pk_b, plaintext)
        with pytest.raises(Exception):
            crypto.hpke_open(sk_a, encrypted)  # wrong sk for pk_b

    def test_tampered_envelope_fails(self, crypto):
        sk, pk = crypto.generate_hpke_key_pair()
        plaintext = b"sensitive key material"
        encrypted = crypto.hpke_seal(pk, plaintext)
        tampered = bytearray(encrypted)
        tampered[-1] ^= 0x01
        with pytest.raises(Exception):
            crypto.hpke_open(sk, bytes(tampered))


class TestSigning:
    def test_sign_verify(self, crypto):
        sk, pk = crypto.generate_signing_key()
        data = b"canonical receipt data"
        sig = crypto.sign(sk, data)
        assert crypto.verify(pk, data, sig) is True

    def test_wrong_key_fails(self, crypto):
        sk_a, pk_a = crypto.generate_signing_key()
        _, pk_b = crypto.generate_signing_key()
        data = b"important"
        sig = crypto.sign(sk_a, data)
        assert crypto.verify(pk_b, data, sig) is False

    def test_tampered_data_fails(self, crypto):
        sk, pk = crypto.generate_signing_key()
        data = b"original"
        sig = crypto.sign(sk, data)
        assert crypto.verify(pk, b"modified", sig) is False


class TestCryptoVersion:
    def test_suite_metadata(self):
        suite = SUITES[1]
        assert suite.version == 1
        assert suite.symmetric_algorithm == "AES-256-GCM"
        assert suite.symmetric_key_bytes == 32
        assert suite.hpke_kem == "DHKEM(X25519)"
        assert suite.signing_algorithm == "Ed25519"
