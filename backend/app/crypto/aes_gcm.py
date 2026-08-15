from __future__ import annotations

import os
import struct

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AES_KEY_SIZE = 32
AES_NONCE_SIZE = 12
AES_TAG_SIZE = 16
AES_CHUNK_SIZE = 65536

MAX_ENCRYPTIONS_PER_KEY = 1 << 32


def generate_nonce() -> bytes:
    return os.urandom(AES_NONCE_SIZE)


def counter_nonce(counter: int) -> bytes:
    return struct.pack("!QQ", counter >> 32, counter & 0xFFFFFFFF)[:AES_NONCE_SIZE]


class AESGCMEngine:
    def encrypt(
        self,
        key: bytes,
        plaintext: bytes,
        aad: bytes = b"",
        nonce: bytes | None = None,
    ) -> tuple[bytes, bytes, bytes]:
        if len(key) != AES_KEY_SIZE:
            raise ValueError(f"key must be {AES_KEY_SIZE} bytes")
        if nonce is not None and len(nonce) != AES_NONCE_SIZE:
            raise ValueError(f"nonce must be {AES_NONCE_SIZE} bytes")

        if nonce is None:
            nonce = generate_nonce()

        aesgcm = AESGCM(key)
        ct_and_tag = aesgcm.encrypt(nonce, plaintext, aad)
        ciphertext = ct_and_tag[: len(plaintext)]
        tag = ct_and_tag[len(plaintext) :]
        return ciphertext, nonce, tag

    def decrypt(
        self,
        key: bytes,
        ciphertext: bytes,
        nonce: bytes,
        tag: bytes,
        aad: bytes = b"",
    ) -> bytes:
        if len(key) != AES_KEY_SIZE:
            raise ValueError(f"key must be {AES_KEY_SIZE} bytes")
        if len(nonce) != AES_NONCE_SIZE:
            raise ValueError(f"nonce must be {AES_NONCE_SIZE} bytes")

        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ciphertext + tag, aad)

    def encrypt_chunked(
        self,
        file_key: bytes,
        plaintext: bytes,
        file_id: str,
    ) -> tuple[bytes, dict]:
        chunks: list[bytes] = []
        offset = 0
        total_chunks = (len(plaintext) + AES_CHUNK_SIZE - 1) // AES_CHUNK_SIZE
        file_id_bytes = file_id.encode("utf-8")

        for i in range(total_chunks):
            chunk = plaintext[offset : offset + AES_CHUNK_SIZE]
            nonce = struct.pack("!QQ", i, 0)[:AES_NONCE_SIZE]
            aad = b"".join(
                [
                    struct.pack("!H", i),
                    struct.pack("!H", total_chunks),
                    struct.pack("!I", len(chunk)),
                    file_id_bytes,
                ]
            )
            ct, _, tag = self.encrypt(file_key, chunk, aad=aad, nonce=nonce)
            chunks.append(ct + tag)
            offset += AES_CHUNK_SIZE

        metadata = {
            "algorithm": "AES-256-GCM-chunked-v1",
            "key_bytes": AES_KEY_SIZE,
            "nonce_bytes": AES_NONCE_SIZE,
            "tag_bytes": AES_TAG_SIZE,
            "chunk_size": AES_CHUNK_SIZE,
            "total_chunks": total_chunks,
            "original_size": len(plaintext),
            "file_id": file_id,
        }
        return b"".join(chunks), metadata

    def decrypt_chunked(
        self,
        file_key: bytes,
        ciphertext: bytes,
        metadata: dict,
    ) -> bytes:
        chunk_size = metadata["chunk_size"]
        total_chunks = metadata["total_chunks"]
        tag_bytes = metadata["tag_bytes"]
        original_size = metadata["original_size"]
        file_id_bytes = metadata["file_id"].encode("utf-8")
        chunks: list[bytes] = []
        offset = 0

        for i in range(total_chunks):
            chunk_pt_len = min(chunk_size, original_size - i * chunk_size)
            full_len = chunk_pt_len + tag_bytes
            chunk_data = ciphertext[offset : offset + full_len]
            ct = chunk_data[:chunk_pt_len]
            tag = chunk_data[chunk_pt_len:]
            nonce = struct.pack("!QQ", i, 0)[:AES_NONCE_SIZE]
            aad = b"".join(
                [
                    struct.pack("!H", i),
                    struct.pack("!H", total_chunks),
                    struct.pack("!I", chunk_pt_len),
                    file_id_bytes,
                ]
            )
            chunks.append(self.decrypt(file_key, ct, nonce, tag, aad))
            offset += full_len

        return b"".join(chunks)
