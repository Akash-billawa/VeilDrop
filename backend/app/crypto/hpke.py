from __future__ import annotations

import os

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

HPKE_INFO_PREFIX = b"VeilDrop-Case-Envelope-v1"
HPKE_KEY_SIZE = 32
AES_256_KEY_SIZE = 32
AES_GCM_NONCE_SIZE = 12


class HPKEEngine:
    def generate_key_pair(self) -> tuple[bytes, bytes]:
        private_key = X25519PrivateKey.generate()
        public_key = private_key.public_key()
        return (
            private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()),
            public_key.public_bytes(Encoding.Raw, PublicFormat.Raw),
        )

    def _load_private(self, private_key_bytes: bytes) -> X25519PrivateKey:
        return X25519PrivateKey.from_private_bytes(private_key_bytes)

    def _load_public(self, public_key_bytes: bytes) -> X25519PublicKey:
        return X25519PublicKey.from_public_bytes(public_key_bytes)

    def _dh(self, private_key: X25519PrivateKey, public_key: X25519PublicKey) -> bytes:
        return private_key.exchange(public_key)

    def _key_schedule(
        self,
        shared_secret: bytes,
        info: bytes,
    ) -> tuple[bytes, bytes]:
        kdf = HKDF(
            algorithm=SHA256(),
            length=HPKE_KEY_SIZE + AES_256_KEY_SIZE,
            salt=None,
            info=info,
        )
        derived = kdf.derive(shared_secret)
        key_enc = derived[:HPKE_KEY_SIZE]
        key_aead = derived[HPKE_KEY_SIZE:]
        return key_enc, key_aead

    def seal(self, public_key_bytes: bytes, plaintext: bytes, info: bytes = b"") -> bytes:
        ephemeral_private = X25519PrivateKey.generate()
        ephemeral_public = ephemeral_private.public_key()

        recipient_public = self._load_public(public_key_bytes)

        dh_result = self._dh(ephemeral_private, recipient_public)

        enc = ephemeral_public.public_bytes(Encoding.Raw, PublicFormat.Raw)

        full_info = HPKE_INFO_PREFIX + info
        _, key_aead = self._key_schedule(dh_result, full_info)

        nonce = os.urandom(AES_GCM_NONCE_SIZE)
        aad = full_info

        aesgcm = AESGCM(key_aead)
        ct_and_tag = aesgcm.encrypt(nonce, plaintext, aad)

        return enc + nonce + ct_and_tag

    def open(self, private_key_bytes: bytes, ciphertext: bytes, info: bytes = b"") -> bytes:
        private_key = self._load_private(private_key_bytes)

        enc = ciphertext[:HPKE_KEY_SIZE]
        nonce = ciphertext[HPKE_KEY_SIZE : HPKE_KEY_SIZE + AES_GCM_NONCE_SIZE]
        ct_and_tag = ciphertext[HPKE_KEY_SIZE + AES_GCM_NONCE_SIZE :]

        ephemeral_public = X25519PublicKey.from_public_bytes(enc)

        dh_result = self._dh(private_key, ephemeral_public)

        full_info = HPKE_INFO_PREFIX + info
        _, key_aead = self._key_schedule(dh_result, full_info)

        aad = full_info
        aesgcm = AESGCM(key_aead)

        plaintext = aesgcm.decrypt(nonce, ct_and_tag, aad)
        return plaintext
