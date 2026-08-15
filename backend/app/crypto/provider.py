from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import IntEnum

from .aes_gcm import AESGCMEngine
from .hpke import HPKEEngine
from .hybrid_kem import HybridKEMEngine
from .kdf import KDFEngine
from .signing import SigningEngine

logger = logging.getLogger(__name__)


class CryptoVersion(IntEnum):
    V1_HPKE_X25519_AES256GCM = 1
    V2_HYBRID_MLKEM768_X25519 = 2


@dataclass(frozen=True)
class AlgorithmSuite:
    version: int
    name: str
    symmetric_algorithm: str
    symmetric_key_bytes: int
    symmetric_nonce_bytes: int
    symmetric_tag_bytes: int
    kdf_algorithm: str
    kdf_salt_bytes: int
    hpke_kem: str
    hpke_kdf: str
    hpke_aead: str
    signing_algorithm: str
    envelope_protocol: str

    def metadata(self) -> dict:
        return {
            "version": self.version,
            "name": self.name,
            "sym_alg": self.symmetric_algorithm,
            "sym_key_bytes": self.symmetric_key_bytes,
            "sym_nonce_bytes": self.symmetric_nonce_bytes,
            "sym_tag_bytes": self.symmetric_tag_bytes,
            "kdf": self.kdf_algorithm,
            "kdf_salt_bytes": self.kdf_salt_bytes,
            "hpke_kem": self.hpke_kem,
            "hpke_kdf": self.hpke_kdf,
            "hpke_aead": self.hpke_aead,
            "signing": self.signing_algorithm,
            "envelope": self.envelope_protocol,
        }


SUITES: dict[int, AlgorithmSuite] = {
    CryptoVersion.V1_HPKE_X25519_AES256GCM: AlgorithmSuite(
        version=1,
        name="hpke-dhkem-x25519-hkdf-sha256-aes256gcm",
        symmetric_algorithm="AES-256-GCM",
        symmetric_key_bytes=32,
        symmetric_nonce_bytes=12,
        symmetric_tag_bytes=16,
        kdf_algorithm="HKDF-SHA-256",
        kdf_salt_bytes=32,
        hpke_kem="DHKEM(X25519)",
        hpke_kdf="HKDF-SHA256",
        hpke_aead="AES-256-GCM",
        signing_algorithm="Ed25519",
        envelope_protocol="HPKE-BASE",
    ),
    CryptoVersion.V2_HYBRID_MLKEM768_X25519: AlgorithmSuite(
        version=2,
        name="hpke-hybrid-mlkem768-x25519-hkdf-sha256-aes256gcm",
        symmetric_algorithm="AES-256-GCM",
        symmetric_key_bytes=32,
        symmetric_nonce_bytes=12,
        symmetric_tag_bytes=16,
        kdf_algorithm="HKDF-SHA-256",
        kdf_salt_bytes=32,
        hpke_kem="HYBRID(MLKEM-768 + DHKEM-X25519)",
        hpke_kdf="HKDF-SHA256",
        hpke_aead="AES-256-GCM",
        signing_algorithm="Ed25519",
        envelope_protocol="HPKE-BASE-DUAL-KEM",
    ),
}


class CryptoProvider:
    def __init__(self, active_version: int = 1):
        self.active_version = active_version
        self.suite = SUITES[active_version]
        self.aesgcm = AESGCMEngine()
        self.kdf = KDFEngine()
        self.hpke = HPKEEngine()
        self.signing = SigningEngine()

    def get_suite(self, version: int | None = None) -> AlgorithmSuite:
        return SUITES[version or self.active_version]

    def _envelope_engine(self, version: int | None = None) -> HPKEEngine | HybridKEMEngine:
        selected = self.get_suite(version)
        if selected.version == CryptoVersion.V2_HYBRID_MLKEM768_X25519:
            return HybridKEMEngine()
        return self.hpke

    def encrypt_symmetric(self, key: bytes, plaintext: bytes, aad: bytes = b"") -> tuple[bytes, bytes, bytes]:
        return self.aesgcm.encrypt(key, plaintext, aad)

    def decrypt_symmetric(self, key: bytes, ciphertext: bytes, nonce: bytes, tag: bytes, aad: bytes = b"") -> bytes:
        return self.aesgcm.decrypt(key, ciphertext, nonce, tag, aad)

    def derive_key(self, ikm: bytes, info: bytes, length: int = 32, salt: bytes | None = None) -> bytes:
        return self.kdf.derive(ikm, info, length, salt)

    def hkdf_expand(self, prk: bytes, info: bytes, length: int = 32) -> bytes:
        return self.kdf.expand(prk, info, length)

    def generate_hpke_key_pair(self, version: int | None = None) -> tuple[bytes, bytes]:
        return self._envelope_engine(version).generate_key_pair()

    def hpke_seal(
        self,
        public_key: bytes,
        plaintext: bytes,
        info: bytes = b"",
        version: int | None = None,
    ) -> bytes:
        return self._envelope_engine(version).seal(public_key, plaintext, info)

    def hpke_open(
        self,
        private_key: bytes,
        ciphertext: bytes,
        info: bytes = b"",
        version: int | None = None,
    ) -> bytes:
        return self._envelope_engine(version).open(private_key, ciphertext, info)

    def generate_signing_key(self) -> tuple[bytes, bytes]:
        return self.signing.generate_key_pair()

    def sign(self, private_key: bytes, data: bytes) -> bytes:
        return self.signing.sign(private_key, data)

    def verify(self, public_key: bytes, data: bytes, signature: bytes) -> bool:
        return self.signing.verify(public_key, data, signature)

    def envelope_encrypt(self, public_key: bytes, case_dek: bytes, info: bytes, version: int | None = None) -> bytes:
        return self.hpke_seal(public_key, case_dek, info, version=version)

    def envelope_decrypt(
        self, private_key: bytes, wrapped_dek: bytes, info: bytes, version: int | None = None
    ) -> bytes:
        return self.hpke_open(private_key, wrapped_dek, info, version=version)

    def compute_content_hash(self, data: bytes) -> str:
        import hashlib

        return f"sha256:{hashlib.sha256(data).hexdigest()}"


_provider: CryptoProvider | None = None


def get_provider() -> CryptoProvider:
    global _provider
    if _provider is None:
        from ..config import get_settings

        settings = get_settings()
        _provider = CryptoProvider(active_version=settings.crypto_active_version)
    return _provider


def _invalidate_provider():
    global _provider
    _provider = None
