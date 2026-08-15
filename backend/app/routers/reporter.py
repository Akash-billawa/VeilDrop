from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Form, HTTPException, Request

from ..crypto import get_provider
from ..middleware.rate_limit import rate_limit
from ..services import case as case_svc
from ..services import envelope as env_svc
from ..services import evidence as ev_svc
from ..services import message as msg_svc
from ..services import receipt as receipt_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/reporter", tags=["reporter"])


@router.post("/cases")
@rate_limit("case_creation")
async def create_case(
    request: Request,
    ciphertext: str = Form(...),
    nonce: str = Form(...),
    tag: str = Form(...),
    aad: str = Form(""),
    wrapped_dek: str = Form(...),
    envelope_algorithm: str = Form("hpke-dhkem-x25519-aes256gcm"),
    crypto_version: int = Form(1),
    ttl_days: int | None = Form(None),
    category: str | None = Form(None),
    priority: str | None = Form(None),
    burn_after_read: bool = Form(False),
):
    try:
        ct = bytes.fromhex(ciphertext)
        n = bytes.fromhex(nonce)
        t = bytes.fromhex(tag)
        ad = bytes.fromhex(aad) if aad else b""
        wd = bytes.fromhex(wrapped_dek)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex encoding in cryptographic fields") from None

    if len(ct) > 1_048_576:
        raise HTTPException(status_code=413, detail="Report payload exceeds maximum size")

    reporter_meta = {}
    if category:
        reporter_meta["category"] = category
    if priority:
        reporter_meta["priority"] = priority

    result = await case_svc.create_case(
        ciphertext=ct,
        nonce=n,
        tag=t,
        aad=ad,
        wrapped_dek=wd,
        envelope_algorithm=envelope_algorithm,
        crypto_version=crypto_version,
        reporter_meta=reporter_meta if reporter_meta else None,
        ttl_days=ttl_days,
        burn_after_read=burn_after_read,
    )

    ch = get_provider().compute_content_hash(ct)
    receipt = await receipt_svc.issue(result["case_id"], ch, crypto_version)

    logger.info(
        "Case created: %s (size=%d, ttl=%d)",
        result["case_id"],
        len(ct),
        ttl_days or 30,
    )

    return {
        "case_id": result["case_id"],
        "created_at": result["created_at"],
        "expires_at": result["expires_at"],
        "receipt": receipt,
    }


@router.get("/cases/{case_id}")
async def get_case(case_id: str):
    case = await case_svc.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case["status"] == "expired":
        raise HTTPException(status_code=410, detail="This case has expired")

    messages = await msg_svc.list_for_case(case_id)
    evidence = await ev_svc.list_for_case(case_id)
    receipt = await receipt_svc.get_receipt(case_id)
    envelope = await env_svc.get_for_recipient(case_id, f"reporter-{case_id}")

    return {
        "case_id": case["case_id"],
        "status": case["status"],
        "crypto_version": case["crypto_version"],
        "reporter_meta": case["reporter_meta"],
        "created_at": case["created_at"].isoformat(),
        "expires_at": case["expires_at"].isoformat() if case["expires_at"] else None,
        "envelope": {
            "algorithm": envelope["algorithm"],
            "key_version": envelope["key_version"],
            "wrapped_dek": bytes(envelope["wrapped_dek"]).hex(),
        }
        if envelope
        else None,
        "messages": [
            {
                "message_id": str(m["message_id"]),
                "sender_type": m["sender_type"],
                "ciphertext": bytes(m["ciphertext"]).hex(),
                "nonce": bytes(m["nonce"]).hex(),
                "tag": bytes(m["tag"]).hex(),
                "aad": bytes(m["aad"]).hex() if m["aad"] and len(bytes(m["aad"])) > 0 else "",
                "crypto_version": m["crypto_version"],
                "burn_after_read": m["burn_after_read"],
                "consumed_at": m["consumed_at"].isoformat() if m["consumed_at"] else None,
                "created_at": m["created_at"].isoformat(),
            }
            for m in messages
        ],
        "evidence": [
            {
                "evidence_id": str(e["evidence_id"]),
                "object_key": e["object_key"],
                "crypto_metadata": e["crypto_metadata"],
                "original_size": e["original_size"],
                "encrypted_size": e["encrypted_size"],
                "content_type": e["content_type"],
                "created_at": e["created_at"].isoformat(),
            }
            for e in evidence
        ],
        "receipt": receipt,
    }


@router.post("/cases/{case_id}/messages")
async def submit_message(
    case_id: str,
    ciphertext: str = Form(...),
    nonce: str = Form(...),
    tag: str = Form(...),
    aad: str = Form(""),
    crypto_version: int = Form(1),
    burn_after_read: bool = Form(False),
):
    case = await case_svc.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case["status"] in ("closed", "expired"):
        raise HTTPException(status_code=410, detail=f"Case is {case['status']}")

    try:
        ct = bytes.fromhex(ciphertext)
        n = bytes.fromhex(nonce)
        t = bytes.fromhex(tag)
        ad = bytes.fromhex(aad) if aad else b""
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex encoding") from None

    result = await msg_svc.store(
        case_id=case_id,
        sender_type="reporter",
        ciphertext=ct,
        nonce=n,
        tag=t,
        aad=ad,
        crypto_version=crypto_version,
        burn_after_read=burn_after_read,
    )
    return result


@router.post("/cases/{case_id}/messages/{message_id}/consume")
async def consume_message(case_id: str, message_id: str):
    case = await case_svc.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case["status"] in ("closed", "expired"):
        raise HTTPException(status_code=410, detail=f"Case is {case['status']}")

    result = await msg_svc.consume_burn(message_id)
    if not result:
        raise HTTPException(
            status_code=410,
            detail="Message already consumed or not marked burn-on-read",
        )
    return {
        "message_id": str(result["message_id"]),
        "case_id": result["case_id"],
        "consumed_at": datetime.now(UTC).isoformat(),
    }


@router.post("/cases/{case_id}/evidence")
async def upload_evidence(
    case_id: str,
    encrypted_data: str = Form(...),
    crypto_metadata: str = Form(...),
    original_size: int = Form(...),
    content_type: str | None = Form(None),
):
    case = await case_svc.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case["status"] in ("closed", "expired"):
        raise HTTPException(status_code=410, detail=f"Case is {case['status']}")

    try:
        enc = bytes.fromhex(encrypted_data)
        meta = json.loads(crypto_metadata)
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid data format") from None

    result = await ev_svc.store(
        case_id=case_id,
        encrypted_data=enc,
        crypto_metadata=meta,
        original_size=original_size,
        content_type=content_type,
    )
    return result


@router.get("/cases/{case_id}/evidence/{evidence_id}")
async def download_evidence(case_id: str, evidence_id: str):
    case = await case_svc.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if case["status"] == "expired":
        raise HTTPException(status_code=410, detail="This case has expired")

    evidence_list = await ev_svc.list_for_case(case_id)
    target = next((e for e in evidence_list if str(e["evidence_id"]) == evidence_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Evidence not found")

    data = await ev_svc.read_file(target["object_key"], case_id)
    if data is None:
        raise HTTPException(status_code=404, detail="File not found on storage")

    return {
        "evidence_id": str(target["evidence_id"]),
        "object_key": target["object_key"],
        "encrypted_data": data.hex(),
        "crypto_metadata": target["crypto_metadata"],
        "original_size": target["original_size"],
        "content_type": target["content_type"],
    }
