from __future__ import annotations

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)


class SigningEngine:
    def generate_key_pair(self) -> tuple[bytes, bytes]:
        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key()
        return (
            private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()),
            public_key.public_bytes(Encoding.Raw, PublicFormat.Raw),
        )

    def sign(self, private_key_bytes: bytes, data: bytes) -> bytes:
        private_key = Ed25519PrivateKey.from_private_bytes(private_key_bytes)
        return private_key.sign(data)

    def verify(self, public_key_bytes: bytes, data: bytes, signature: bytes) -> bool:
        try:
            public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
            public_key.verify(signature, data)
            return True
        except Exception:
            return False
