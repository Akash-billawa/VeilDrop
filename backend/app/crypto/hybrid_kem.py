from __future__ import annotations

import hashlib
import os

from cryptography.hazmat.primitives.asymmetric.mlkem import (
    MLKEM768PrivateKey,
    MLKEM768PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

HYBRID_INFO_PREFIX = b"VeilDrop-Case-Envelope-v2"
COMBINER_DOMAIN_SEPARATOR = b"VeilDrop-Hybrid-Dual-KEM-v2"

X25519_PRIVATE_SIZE = 32
X25519_PUBLIC_SIZE = 32
MLKEM_SEED_SIZE = 64
MLKEM_PUBLIC_SIZE = 1184
MLKEM_CIPHERTEXT_SIZE = 1088
MLKEM_SHARED_SIZE = 32
AES_256_KEY_SIZE = 32
AES_GCM_NONCE_SIZE = 12

HYBRID_PRIVATE_BLOB_SIZE = X25519_PRIVATE_SIZE + MLKEM_SEED_SIZE
HYBRID_PUBLIC_BLOB_SIZE = X25519_PUBLIC_SIZE + MLKEM_PUBLIC_SIZE
HYBRID_ENC_PREFIX_SIZE = X25519_PUBLIC_SIZE + MLKEM_CIPHERTEXT_SIZE


def combine_shared_secrets(
    classical_ss: bytes,
    mlkem_ss: bytes,
    enc_classical: bytes,
    mlkem_ciphertext: bytes,
) -> bytes:
    """Dual-KEM combiner (RFC 9180-friendly, concatenation-then-hash).

    Both KEMs are IND-CCA, so concatenating the two shared secrets and binding
    the ephemeral encodings (the classical ephemeral public key and the
    ML-KEM ciphertext) is the reviewed TLS-hybrid-design pattern. The result is
    fed to the HKDF-SHA-256 key schedule, never used directly.
    """
    material = b"".join(
        [
            COMBINER_DOMAIN_SEPARATOR,
            classical_ss,
            mlkem_ss,
            enc_classical,
            mlkem_ciphertext,
        ]
    )
    return hashlib.sha256(material).digest()


def _key_schedule(combined: bytes, info: bytes) -> tuple[bytes, bytes]:
    kdf = HKDF(
        algorithm=SHA256(),
        length=X25519_PRIVATE_SIZE + AES_256_KEY_SIZE,
        salt=None,
        info=info,
    )
    derived = kdf.derive(combined)
    key_enc = derived[:X25519_PRIVATE_SIZE]
    key_aead = derived[X25519_PRIVATE_SIZE:]
    return key_enc, key_aead


class HybridKEMEngine:
    """Post-quantum hybrid HPKE: DHKEM(X25519) + ML-KEM-768 with dual-KEM combiner."""

    def generate_key_pair(self) -> tuple[bytes, bytes]:
        classical_private = X25519PrivateKey.generate()
        classical_public = classical_private.public_key()
        mlkem_private = MLKEM768PrivateKey.generate()
        mlkem_public = mlkem_private.public_key()

        private_blob = (
            classical_private.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
            + mlkem_private.private_bytes_raw()
        )
        public_blob = classical_public.public_bytes(Encoding.Raw, PublicFormat.Raw) + mlkem_public.public_bytes_raw()
        return private_blob, public_blob

    def _parse_public_blob(self, public_key_blob: bytes) -> tuple[X25519PublicKey, MLKEM768PublicKey]:
        if len(public_key_blob) != HYBRID_PUBLIC_BLOB_SIZE:
            raise ValueError(
                f"hybrid public key must be {HYBRID_PUBLIC_BLOB_SIZE} bytes "
                f"(X25519 {X25519_PUBLIC_SIZE} + ML-KEM-768 {MLKEM_PUBLIC_SIZE})"
            )
        classical_pub = X25519PublicKey.from_public_bytes(public_key_blob[:X25519_PUBLIC_SIZE])
        mlkem_pub = MLKEM768PublicKey.from_public_bytes(public_key_blob[X25519_PUBLIC_SIZE:])
        return classical_pub, mlkem_pub

    def _parse_private_blob(self, private_key_blob: bytes) -> tuple[X25519PrivateKey, MLKEM768PrivateKey]:
        if len(private_key_blob) != HYBRID_PRIVATE_BLOB_SIZE:
            raise ValueError(
                f"hybrid private key must be {HYBRID_PRIVATE_BLOB_SIZE} bytes "
                f"(X25519 {X25519_PRIVATE_SIZE} + ML-KEM-768 seed {MLKEM_SEED_SIZE})"
            )
        classical_priv = X25519PrivateKey.from_private_bytes(private_key_blob[:X25519_PRIVATE_SIZE])
        mlkem_priv = MLKEM768PrivateKey.from_seed_bytes(private_key_blob[X25519_PRIVATE_SIZE:])
        return classical_priv, mlkem_priv

    def seal(self, public_key_blob: bytes, plaintext: bytes, info: bytes = b"") -> bytes:
        classical_pub, mlkem_pub = self._parse_public_blob(public_key_blob)

        ephemeral_private = X25519PrivateKey.generate()
        enc_classical = ephemeral_private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        classical_ss = ephemeral_private.exchange(classical_pub)

        mlkem_ss, mlkem_ciphertext = mlkem_pub.encapsulate()

        combined = combine_shared_secrets(classical_ss, mlkem_ss, enc_classical, mlkem_ciphertext)

        full_info = HYBRID_INFO_PREFIX + info
        _, key_aead = _key_schedule(combined, full_info)

        nonce = os.urandom(AES_GCM_NONCE_SIZE)
        aesgcm = AESGCM(key_aead)
        ct_and_tag = aesgcm.encrypt(nonce, plaintext, full_info)

        return enc_classical + mlkem_ciphertext + nonce + ct_and_tag

    def open(self, private_key_blob: bytes, ciphertext: bytes, info: bytes = b"") -> bytes:
        classical_priv, mlkem_priv = self._parse_private_blob(private_key_blob)

        if len(ciphertext) < HYBRID_ENC_PREFIX_SIZE + AES_GCM_NONCE_SIZE + 16:
            raise ValueError("hybrid envelope too short")

        enc_classical = ciphertext[:X25519_PUBLIC_SIZE]
        mlkem_ciphertext = ciphertext[X25519_PUBLIC_SIZE:HYBRID_ENC_PREFIX_SIZE]
        nonce = ciphertext[HYBRID_ENC_PREFIX_SIZE : HYBRID_ENC_PREFIX_SIZE + AES_GCM_NONCE_SIZE]
        ct_and_tag = ciphertext[HYBRID_ENC_PREFIX_SIZE + AES_GCM_NONCE_SIZE :]

        classical_ss = classical_priv.exchange(X25519PublicKey.from_public_bytes(enc_classical))
        mlkem_ss = mlkem_priv.decapsulate(mlkem_ciphertext)

        combined = combine_shared_secrets(classical_ss, mlkem_ss, enc_classical, mlkem_ciphertext)

        full_info = HYBRID_INFO_PREFIX + info
        _, key_aead = _key_schedule(combined, full_info)

        aesgcm = AESGCM(key_aead)
        return aesgcm.decrypt(nonce, ct_and_tag, full_info)
