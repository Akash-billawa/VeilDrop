from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime

from ..crypto import get_provider
from ..database import get_pool, require_row

logger = logging.getLogger(__name__)


async def record(
    event_type: str,
    severity: str = "info",
    case_id: str | None = None,
    investigator_id: str | None = None,
    details: dict | None = None,
    sign: bool = False,
) -> dict:
    pool = await get_pool()
    canonical = {
        "event_type": event_type,
        "severity": severity,
        "case_id": case_id,
        "investigator_id": investigator_id,
        "details": details,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    event_bytes = json.dumps(canonical, sort_keys=True).encode()
    event_hash = hashlib.sha256(event_bytes).digest()
    signature: bytes | None = None

    if sign:
        try:
            crypto = get_provider()
            sk, _ = crypto.generate_signing_key()
            signature = crypto.sign(sk, event_bytes)
        except Exception as e:
            logger.warning("Failed to sign security event: %s", e)

    async with pool.acquire() as conn:
        row = require_row(
            await conn.fetchrow(
                """
                INSERT INTO security_events
                    (event_type, severity, case_id, investigator_id, details, event_hash, signature)
                VALUES ($1, $2, $3, $4, $5::JSONB, $6, $7)
                RETURNING event_id, created_at
                """,
                event_type,
                severity,
                case_id,
                investigator_id,
                details if details else None,
                event_hash,
                signature,
            ),
            "insert security event",
        )

    log_fn = logger.warning if severity in ("warning", "critical") else logger.info
    log_fn("Audit: %s [%s] case=%s inv=%s", event_type, severity, case_id, investigator_id)

    return {"event_id": str(row["event_id"]), "created_at": row["created_at"].isoformat()}


async def list_events(
    investigator_id: str,
    is_admin: bool = False,
    limit: int = 200,
) -> list[dict]:
    """List security events visible to an investigator.

    A `security_admin` sees the full log. All other roles see events that
    reference them directly (auth, sessions) or events on cases assigned to
    them. Case-level event metadata never contains plaintext.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        if is_admin:
            rows = await conn.fetch(
                """
                SELECT event_id, event_type, severity, case_id, investigator_id,
                       details, event_hash, created_at
                FROM security_events
                ORDER BY created_at DESC
                LIMIT $1
                """,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT se.event_id, se.event_type, se.severity, se.case_id,
                       se.investigator_id, se.details, se.event_hash, se.created_at
                FROM security_events se
                WHERE se.investigator_id = $1
                   OR se.case_id IN (
                       SELECT ca.case_id FROM case_assignments ca
                       WHERE ca.investigator_id = $1 AND ca.revoked_at IS NULL
                   )
                ORDER BY se.created_at DESC
                LIMIT $2
                """,
                investigator_id,
                limit,
            )

    out = []
    for r in rows:
        item = dict(r)
        item["event_id"] = str(item["event_id"])
        if item.get("investigator_id") is not None:
            item["investigator_id"] = str(item["investigator_id"])
        if item.get("event_hash") is not None:
            item["event_hash"] = bytes(item["event_hash"]).hex()
        out.append(item)
    return out
