from __future__ import annotations

import logging

from ..database import get_pool, require_row

logger = logging.getLogger(__name__)


async def store(
    case_id: str,
    sender_type: str,
    ciphertext: bytes,
    nonce: bytes,
    tag: bytes,
    aad: bytes = b"",
    crypto_version: int = 1,
    burn_after_read: bool = False,
) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = require_row(
            await conn.fetchrow(
                """
                    INSERT INTO encrypted_messages
                        (case_id, sender_type, ciphertext, nonce, tag, aad, crypto_version, burn_after_read)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING message_id, created_at
                    """,
                case_id,
                sender_type,
                ciphertext,
                nonce,
                tag,
                aad,
                crypto_version,
                burn_after_read,
            ),
            "insert message",
        )
        return {"message_id": str(row["message_id"]), "created_at": row["created_at"].isoformat()}


async def consume_burn(message_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
                SELECT message_id, case_id, ciphertext, nonce, tag, aad, crypto_version, sender_type
                FROM encrypted_messages
                WHERE message_id = $1 AND burn_after_read = true AND consumed_at IS NULL
                FOR UPDATE
                """,
            message_id,
        )
        if not row:
            return None
        await conn.execute(
            "UPDATE encrypted_messages SET consumed_at = now() WHERE message_id = $1",
            message_id,
        )
        return {
            "message_id": str(row["message_id"]),
            "case_id": row["case_id"],
            "ciphertext": bytes(row["ciphertext"]),
            "nonce": bytes(row["nonce"]),
            "tag": bytes(row["tag"]),
            "aad": bytes(row["aad"]) if row["aad"] else b"",
            "crypto_version": row["crypto_version"],
            "sender_type": row["sender_type"],
        }


async def list_for_case(case_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT message_id, sender_type, ciphertext, nonce, tag, aad, crypto_version,
                   burn_after_read, consumed_at, created_at
            FROM encrypted_messages
            WHERE case_id = $1
              AND (burn_after_read = false OR consumed_at IS NULL)
            ORDER BY created_at ASC
            """,
            case_id,
        )
        return [dict(r) for r in rows]
