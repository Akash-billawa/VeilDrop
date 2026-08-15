from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import asyncpg
from argon2 import PasswordHasher

from ..config import get_settings
from ..database import get_pool, require_row

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_hasher() -> PasswordHasher:
    s = get_settings()
    return PasswordHasher(
        time_cost=s.argon2_time_cost,
        memory_cost=s.argon2_memory_cost,
        parallelism=s.argon2_parallelism,
    )


def hash_password(password: str) -> str:
    return _get_hasher().hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _get_hasher().verify(password_hash, password)
    except Exception:
        return False


async def create_investigator(
    username: str,
    password: str | None = None,
    role: str = "investigator",
    display_name: str | None = None,
) -> dict:
    pool = await get_pool()
    pw_hash = hash_password(password) if password else None
    async with pool.acquire() as conn:
        try:
            row = require_row(
                await conn.fetchrow(
                    """
                    INSERT INTO investigators (username, display_name, password_hash, role)
                    VALUES ($1, $2, $3, $4)
                    RETURNING investigator_id, created_at
                    """,
                    username,
                    display_name,
                    pw_hash,
                    role,
                ),
                "insert investigator",
            )
            return {"investigator_id": str(row["investigator_id"]), "created_at": row["created_at"].isoformat()}
        except asyncpg.UniqueViolationError:
            raise ValueError("Investigator already exists") from None


async def authenticate_password(username: str, password: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT investigator_id, password_hash, role, active FROM investigators WHERE username = $1",
            username,
        )
        if not row or not row["active"] or not row["password_hash"]:
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        return {"investigator_id": str(row["investigator_id"]), "username": username, "role": row["role"]}


async def create_session(investigator_id: str) -> dict:
    s = get_settings()
    pool = await get_pool()
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).digest()
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=s.session_expire_minutes)
    idle_deadline = now + timedelta(minutes=s.session_idle_minutes)

    async with pool.acquire() as conn:
        row = require_row(
            await conn.fetchrow(
                """
                INSERT INTO investigator_sessions (investigator_id, token_hash, expires_at, idle_deadline)
                VALUES ($1, $2, $3, $4)
                RETURNING session_id
                """,
                investigator_id,
                token_hash,
                expires_at,
                idle_deadline,
            ),
            "insert investigator session",
        )
        return {"session_token": token, "session_id": str(row["session_id"]), "expires_at": expires_at.isoformat()}


async def validate_session(token: str) -> dict | None:
    pool = await get_pool()
    token_hash = hashlib.sha256(token.encode()).digest()
    now = datetime.now(UTC)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT s.session_id, s.investigator_id, s.expires_at, s.idle_deadline,
                   s.revoked_at, i.role, i.active, i.username
            FROM investigator_sessions s
            JOIN investigators i ON s.investigator_id = i.investigator_id
            WHERE s.token_hash = $1
            """,
            token_hash,
        )
        if not row or row["revoked_at"] or row["expires_at"] < now or not row["active"]:
            return None
        if row["idle_deadline"] < now:
            async with pool.acquire() as conn2:
                await conn2.execute(
                    "UPDATE investigator_sessions SET revoked_at = now() WHERE session_id = $1",
                    row["session_id"],
                )
            return None
        new_idle = now + timedelta(minutes=get_settings().session_idle_minutes)
        await conn.execute(
            "UPDATE investigator_sessions SET idle_deadline = $1 WHERE session_id = $2",
            new_idle,
            row["session_id"],
        )
        return {
            "session_id": str(row["session_id"]),
            "investigator_id": str(row["investigator_id"]),
            "role": row["role"],
            "username": row["username"],
        }


async def revoke_session(session_id: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE investigator_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL",
            session_id,
        )


async def revoke_all_sessions(investigator_id: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE investigator_sessions SET revoked_at = now() WHERE investigator_id = $1 AND revoked_at IS NULL",
            investigator_id,
        )


async def store_webauthn_credential(
    investigator_id: str,
    credential_id: bytes,
    public_key: bytes,
    credential_type: str,
    transports: list[str] | None = None,
) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO webauthn_credentials
                (credential_id, investigator_id, public_key, credential_type, transports)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (credential_id) DO UPDATE SET last_used_at = now(), transports = $5
            """,
            credential_id,
            investigator_id,
            public_key,
            credential_type,
            transports,
        )


async def get_investigator(investigator_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT investigator_id, username, display_name, role, active "
            "FROM investigators WHERE investigator_id = $1",
            investigator_id,
        )
        return dict(row) if row else None
