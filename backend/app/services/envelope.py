from __future__ import annotations

import logging

from ..database import get_pool, require_row

logger = logging.getLogger(__name__)


async def get_for_recipient(case_id: str, recipient_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, wrapped_dek, algorithm, key_version, revoked_at
            FROM case_envelopes
            WHERE case_id = $1 AND recipient_id = $2 AND revoked_at IS NULL
            ORDER BY key_version DESC
            LIMIT 1
            """,
            case_id,
            recipient_id,
        )
        return dict(row) if row else None


async def create_investigator_envelope(
    case_id: str,
    investigator_id: str,
    wrapped_dek: bytes,
    algorithm: str,
) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = require_row(
            await conn.fetchrow(
                """
                INSERT INTO case_envelopes (case_id, recipient_id, recipient_type, wrapped_dek, key_version, algorithm)
                VALUES ($1, $2, 'investigator', $3, 1, $4)
                RETURNING id, created_at
                """,
                case_id,
                investigator_id,
                wrapped_dek,
                algorithm,
            ),
            "insert investigator envelope",
        )
        return {"envelope_id": str(row["id"]), "created_at": row["created_at"].isoformat()}


async def revoke_for_recipient(case_id: str, recipient_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.execute(
            "UPDATE case_envelopes SET revoked_at = now() "
            "WHERE case_id = $1 AND recipient_id = $2 AND revoked_at IS NULL",
            case_id,
            recipient_id,
        )
        return r != "UPDATE 0"


async def list_for_case(case_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, recipient_id, recipient_type, algorithm, key_version, created_at, revoked_at
            FROM case_envelopes
            WHERE case_id = $1
            ORDER BY created_at
            """,
            case_id,
        )
        return [dict(r) for r in rows]
