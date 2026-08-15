from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta

import asyncpg

from ..database import get_pool, require_row
from .audit import record as audit_record

logger = logging.getLogger(__name__)


def generate_case_id() -> str:
    raw = hashlib.sha256(secrets.token_bytes(32)).hexdigest()[:12]
    return f"VEIL-{raw.upper()}"


async def create_case(
    ciphertext: bytes,
    nonce: bytes,
    tag: bytes,
    aad: bytes,
    wrapped_dek: bytes,
    envelope_algorithm: str,
    crypto_version: int = 1,
    reporter_meta: dict | None = None,
    ttl_days: int | None = None,
    burn_after_read: bool = False,
) -> dict:
    from ..config import get_settings

    settings = get_settings()
    pool = await get_pool()

    if ttl_days is None:
        ttl_days = settings.default_case_ttl_days
    ttl_days = min(ttl_days, settings.max_case_ttl_days)

    case_id = generate_case_id()
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=ttl_days)
    recipient_id = f"reporter-{case_id}"

    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
            INSERT INTO cases (case_id, status, reporter_meta, created_at, expires_at, crypto_version)
            VALUES ($1, 'open', $2::JSONB, $3, $4, $5)
            """,
            case_id,
            reporter_meta if reporter_meta else None,
            now,
            expires_at,
            crypto_version,
        )
        await conn.execute(
            """
            INSERT INTO encrypted_messages
                (case_id, sender_type, ciphertext, nonce, tag, aad, crypto_version, burn_after_read)
            VALUES ($1, 'reporter', $2, $3, $4, $5, $6, $7)
            """,
            case_id,
            ciphertext,
            nonce,
            tag,
            aad,
            crypto_version,
            burn_after_read,
        )
        await conn.execute(
            """
            INSERT INTO case_envelopes (case_id, recipient_id, recipient_type, wrapped_dek, key_version, algorithm)
            VALUES ($1, $2, 'reporter', $3, 1, $4)
            """,
            case_id,
            recipient_id,
            wrapped_dek,
            envelope_algorithm,
        )

    await audit_record("case_created", severity="info", case_id=case_id, details={"ttl_days": ttl_days})
    logger.info("Case created: %s", case_id)

    return {
        "case_id": case_id,
        "recipient_id": recipient_id,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
    }


async def get_case(case_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT case_id, status, reporter_meta, created_at, expires_at, "
            "closed_at, crypto_version FROM cases WHERE case_id = $1",
            case_id,
        )
        return dict(row) if row else None


async def expire_case(case_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        r = await conn.execute(
            "UPDATE cases SET status = 'expired', closed_at = now() "
            "WHERE case_id = $1 AND status NOT IN ('expired','closed')",
            case_id,
        )
        if r == "UPDATE 0":
            return False
        await conn.execute(
            "UPDATE case_envelopes SET revoked_at = now() WHERE case_id = $1 AND revoked_at IS NULL",
            case_id,
        )
    await audit_record("case_expired", severity="info", case_id=case_id)
    return True


async def expire_stale_cases() -> int:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        rows = await conn.fetch(
            """
            UPDATE cases SET status = 'expired', closed_at = now()
            WHERE expires_at < now() AND status NOT IN ('expired','closed')
            RETURNING case_id
            """,
        )
        if rows:
            ids = [r["case_id"] for r in rows]
            await conn.execute(
                "UPDATE case_envelopes SET revoked_at = now() WHERE case_id = ANY($1::text[]) AND revoked_at IS NULL",
                ids,
            )
        return len(rows)


async def assign_case(case_id: str, investigator_id: str, permission: str = "read") -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            row = require_row(
                await conn.fetchrow(
                    """
                    INSERT INTO case_assignments (case_id, investigator_id, permission)
                    VALUES ($1, $2, $3)
                    RETURNING assignment_id, assigned_at
                    """,
                    case_id,
                    investigator_id,
                    permission,
                ),
                "insert case assignment",
            )
            await audit_record("case_assigned", severity="info", case_id=case_id, investigator_id=investigator_id)
            return {"assignment_id": str(row["assignment_id"]), "assigned_at": row["assigned_at"].isoformat()}
        except asyncpg.UniqueViolationError:
            raise ValueError("Assignment already exists") from None


async def get_assigned_cases(investigator_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ca.case_id, ca.permission, ca.assigned_at,
                   c.status, c.created_at, c.expires_at,
                   c.reporter_meta, c.crypto_version,
                   env.algorithm AS env_algorithm, env.key_version AS env_key_version
            FROM case_assignments ca
            JOIN cases c ON ca.case_id = c.case_id
            LEFT JOIN LATERAL (
                SELECT ce.algorithm, ce.key_version
                FROM case_envelopes ce
                WHERE ce.case_id = c.case_id
                  AND ce.recipient_id = $1::text
                  AND ce.recipient_type = 'investigator'
                  AND ce.revoked_at IS NULL
                ORDER BY ce.created_at DESC
                LIMIT 1
            ) env ON true
            WHERE ca.investigator_id = $1::uuid AND ca.revoked_at IS NULL
            ORDER BY ca.assigned_at DESC
            """,
            investigator_id,
        )
        return [dict(r) for r in rows]


async def check_access(case_id: str, investigator_id: str) -> str | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT permission FROM case_assignments
            WHERE case_id = $1 AND investigator_id = $2 AND revoked_at IS NULL
            """,
            case_id,
            investigator_id,
        )
        return row["permission"] if row else None


async def set_case_status(case_id: str, status: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.execute(
            "UPDATE cases SET status = $1, "
            "closed_at = CASE WHEN $1 IN ('closed','expired') THEN now() ELSE closed_at END "
            "WHERE case_id = $2",
            status,
            case_id,
        )
        return r != "UPDATE 0"
