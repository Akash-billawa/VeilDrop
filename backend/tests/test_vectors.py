from __future__ import annotations

import json
import pathlib

import pytest
from app.crypto import AESGCMEngine, KDFEngine

VECTOR_PATH = pathlib.Path(__file__).parent / "vectors" / "reporter_v1.json"

pytestmark = pytest.mark.skipif(
    not VECTOR_PATH.exists(),
    reason="vector file not generated (run: node frontend/tests/gen-vectors.cjs)",
)

AES_KEY_SIZE = 32
AES_NONCE_SIZE = 12
AES_TAG_SIZE = 16


def _load_vector() -> dict:
    with open(VECTOR_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _object_aad(purpose: str, object_id: str, version: int = 1) -> bytes:
    return f"veildrop:{purpose}:{object_id}:v{version}".encode()


class TestCrossLanguageVectors:
    """Verifies the Python backend decrypts what the browser produces."""

    @pytest.fixture(scope="class")
    @classmethod
    def vector(cls):
        return _load_vector()

    @pytest.fixture(scope="class")
    @classmethod
    def engines(cls):
        return AESGCMEngine(), KDFEngine()

    def test_wrapped_dek_unwraps(self, vector, engines):
        aes_engine, kdf = engines
        recovery_secret = bytes.fromhex(vector["recovery_secret_hex"])
        kek = kdf.derive_kek(recovery_secret, crypto_version=1)
        wrapped = bytes.fromhex(vector["wrapped_dek_hex"])

        assert len(wrapped) == AES_NONCE_SIZE + AES_KEY_SIZE + AES_TAG_SIZE
        nonce, ct, tag = wrapped[:12], wrapped[12:44], wrapped[44:]

        dek = aes_engine.decrypt(kek, ct, nonce, tag)
        assert dek.hex() == vector["dek_hex"]

    def test_report_object_decrypts(self, vector, engines):
        aes_engine, kdf = engines
        dek = bytes.fromhex(vector["dek_hex"])
        obj = next(o for o in vector["objects"] if o["purpose"] == "report")

        key = kdf.derive_message_key(dek, obj["object_id"], b"report", 1)
        plaintext = aes_engine.decrypt(
            key,
            bytes.fromhex(obj["ciphertext_hex"]),
            bytes.fromhex(obj["nonce_hex"]),
            bytes.fromhex(obj["tag_hex"]),
            aad=_object_aad(obj["purpose"], obj["object_id"]),
        )
        assert plaintext.decode("utf-8") == obj["plaintext_utf8"]

    def test_message_object_decrypts(self, vector, engines):
        aes_engine, kdf = engines
        dek = bytes.fromhex(vector["dek_hex"])
        obj = next(o for o in vector["objects"] if o["purpose"] == "message")

        key = kdf.derive_message_key(dek, obj["object_id"], b"message", 1)
        plaintext = aes_engine.decrypt(
            key,
            bytes.fromhex(obj["ciphertext_hex"]),
            bytes.fromhex(obj["nonce_hex"]),
            bytes.fromhex(obj["tag_hex"]),
            aad=_object_aad(obj["purpose"], obj["object_id"]),
        )
        assert plaintext.decode("utf-8") == obj["plaintext_utf8"]

    def test_evidence_blob_decrypts(self, vector, engines):
        aes_engine, kdf = engines
        dek = bytes.fromhex(vector["dek_hex"])
        obj = next(o for o in vector["objects"] if o["purpose"] == "evidence")
        blob = bytes.fromhex(obj["blob_hex"])

        key = kdf.derive_message_key(dek, obj["object_id"], b"evidence", 1)
        nonce, ct_tag = blob[:12], blob[12:]
        ct, tag = ct_tag[: obj["original_size"]], ct_tag[obj["original_size"] :]
        plaintext = aes_engine.decrypt(
            key,
            ct,
            nonce,
            tag,
            aad=_object_aad(obj["purpose"], obj["object_id"]),
        )
        expected = bytes(i & 0xFF for i in range(obj["original_size"]))
        assert plaintext == expected

    def test_aad_matches_client_format(self, vector):
        obj = vector["objects"][0]
        aad = _object_aad(obj["purpose"], obj["object_id"])
        assert aad.hex() == obj["aad_hex"]

    def test_wrong_aad_rejected(self, vector, engines):
        aes_engine, kdf = engines
        dek = bytes.fromhex(vector["dek_hex"])
        obj = vector["objects"][0]
        key = kdf.derive_message_key(dek, obj["object_id"], b"report", 1)
        with pytest.raises(Exception):
            aes_engine.decrypt(
                key,
                bytes.fromhex(obj["ciphertext_hex"]),
                bytes.fromhex(obj["nonce_hex"]),
                bytes.fromhex(obj["tag_hex"]),
                aad=b"veildrop:report:wrong-id:v1",
            )
