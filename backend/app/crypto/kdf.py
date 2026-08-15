from __future__ import annotations

import hmac
import os

KDF_SALT_BYTES = 32


def generate_salt() -> bytes:
    return os.urandom(KDF_SALT_BYTES)


class KDFEngine:
    def extract(self, ikm: bytes, salt: bytes | None = None) -> bytes:
        if salt is None:
            salt = b"\x00" * KDF_SALT_BYTES
        return hmac.digest(salt, ikm, "sha256")

    def expand(self, prk: bytes, info: bytes, length: int = 32) -> bytes:
        n = (length + 31) // 32
        if n > 255:
            raise ValueError("HKDF expand too large")
        t = b""
        okm = b""
        for i in range(1, n + 1):
            t = hmac.digest(prk, t + info + bytes([i]), "sha256")
            okm += t
        return okm[:length]

    def derive(
        self,
        ikm: bytes,
        info: bytes,
        length: int = 32,
        salt: bytes | None = None,
    ) -> bytes:
        prk = self.extract(ikm, salt)
        return self.expand(prk, info, length)

    def derive_message_key(
        self,
        case_dek: bytes,
        object_id: str,
        purpose: bytes,
        crypto_version: int = 1,
    ) -> bytes:
        info = b"|".join(
            [
                purpose,
                object_id.encode("utf-8"),
                f"v{crypto_version}".encode(),
            ]
        )
        return self.derive(case_dek, info)

    def derive_kek(
        self,
        recovery_secret: bytes,
        crypto_version: int = 1,
    ) -> bytes:
        info = b"|".join([b"veildrop-reporter-kek", f"v{crypto_version}".encode()])
        return self.derive(
            ikm=recovery_secret,
            info=info,
            salt=b"\x00" * KDF_SALT_BYTES,
        )
