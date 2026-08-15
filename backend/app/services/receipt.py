from __future__ import annotations

import logging
from datetime import UTC, datetime

from ..crypto import get_provider
from ..database import get_pool, require_row

logger = logging.getLogger(__name__)


def canonical_receipt(case_id: str, ciphertext_hash: str, crypto_version: int, timestamp: str) -> str:
    return f"case_id={case_id}&ciphertext_hash={ciphertext_hash}&crypto_ver={crypto_version}&ts={timestamp}"


async def issue(case_id: str, ciphertext_hash: str, crypto_version: int = 1) -> dict:
    pool = await get_pool()
    crypto = get_provider()

    sk, pk = crypto.generate_signing_key()
    created_at = datetime.now(UTC)
    timestamp = created_at.isoformat()
    canonical = canonical_receipt(case_id, ciphertext_hash, crypto_version, timestamp)
    signature = crypto.sign(sk, canonical.encode())

    async with pool.acquire() as conn, conn.transaction():
        key_row = require_row(
            await conn.fetchrow(
                "INSERT INTO receipt_keys (public_key, algorithm, active) VALUES ($1, $2, true) RETURNING key_id",
                pk,
                "Ed25519",
            ),
            "insert receipt key",
        )
        await conn.execute(
            """
            INSERT INTO signed_receipts (case_id, ciphertext_hash, signature, signing_key_id, created_at)
            VALUES ($1, $2, $3, $4, $5)
            """,
            case_id,
            ciphertext_hash,
            signature,
            key_row["key_id"],
            created_at,
        )

    return {
        "case_id": case_id,
        "ciphertext_hash": ciphertext_hash,
        "crypto_version": crypto_version,
        "timestamp": timestamp,
        "signature": signature.hex(),
        "verification_key": pk.hex(),
    }


async def verify_receipt(
    case_id: str,
    ciphertext_hash: str,
    crypto_version: int,
    timestamp: str,
    signature_hex: str,
    verification_key_hex: str,
) -> bool:
    crypto = get_provider()
    try:
        pk = bytes.fromhex(verification_key_hex)
        signature = bytes.fromhex(signature_hex)
    except ValueError:
        return False

    canonical = canonical_receipt(case_id, ciphertext_hash, crypto_version, timestamp)
    return crypto.verify(pk, canonical.encode(), signature)


async def get_receipt(case_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT sr.case_id, sr.ciphertext_hash, sr.signature, sr.created_at,
                   rk.public_key as verification_key
            FROM signed_receipts sr
            JOIN receipt_keys rk ON sr.signing_key_id = rk.key_id
            WHERE sr.case_id = $1
            ORDER BY sr.created_at DESC LIMIT 1
            """,
            case_id,
        )
        if not row:
            return None
        return {
            "case_id": row["case_id"],
            "ciphertext_hash": row["ciphertext_hash"],
            "signature": bytes(row["signature"]).hex(),
            "verification_key": bytes(row["verification_key"]).hex(),
            "created_at": row["created_at"].isoformat(),
        }
