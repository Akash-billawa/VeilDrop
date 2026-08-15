from __future__ import annotations

import hashlib
import logging
import os

import aiofiles

from ..config import get_settings
from ..database import get_pool, require_row

logger = logging.getLogger(__name__)


async def store(
    case_id: str,
    encrypted_data: bytes,
    crypto_metadata: dict,
    original_size: int,
    content_type: str | None = None,
) -> dict:
    settings = get_settings()
    pool = await get_pool()

    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM encrypted_evidence WHERE case_id = $1",
            case_id,
        )
        if count >= settings.max_files_per_case:
            raise ValueError(f"Case already has maximum of {settings.max_files_per_case} files")

    content_hash = hashlib.sha256(encrypted_data).hexdigest()
    object_key = f"{content_hash}.enc"
    case_dir = os.path.join(settings.upload_dir, case_id)
    os.makedirs(case_dir, exist_ok=True)
    filepath = os.path.join(case_dir, object_key)

    async with aiofiles.open(filepath, "wb") as f:
        await f.write(encrypted_data)

    encrypted_size = len(encrypted_data)

    async with pool.acquire() as conn:
        row = require_row(
            await conn.fetchrow(
                """
                INSERT INTO encrypted_evidence
                    (case_id, object_key, crypto_metadata, original_size, encrypted_size, content_type)
                VALUES ($1, $2, $3::JSONB, $4, $5, $6)
                RETURNING evidence_id, created_at
                """,
                case_id,
                object_key,
                crypto_metadata,
                original_size,
                encrypted_size,
                content_type,
            ),
            "insert evidence",
        )

    return {
        "evidence_id": str(row["evidence_id"]),
        "object_key": object_key,
        "encrypted_size": encrypted_size,
        "created_at": row["created_at"].isoformat(),
    }


async def list_for_case(case_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT evidence_id, object_key, crypto_metadata, original_size, encrypted_size, content_type, created_at
            FROM encrypted_evidence
            WHERE case_id = $1
            ORDER BY created_at ASC
            """,
            case_id,
        )
        return [dict(r) for r in rows]


async def read_file(object_key: str, case_id: str) -> bytes | None:
    from ..config import get_settings

    settings = get_settings()
    filepath = os.path.join(settings.upload_dir, case_id, object_key)
    if not os.path.exists(filepath):
        return None
    async with aiofiles.open(filepath, "rb") as f:
        return await f.read()
