from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Form, Header, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..middleware.rate_limit import rate_limit
from ..services import audit as audit_svc
from ..services import auth as auth_svc
from ..services import case as case_svc
from ..services import envelope as env_svc
from ..services import evidence as ev_svc
from ..services import message as msg_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/investigator", tags=["investigator"])


class LoginRequest(BaseModel):
    username: str
    password: str


async def _audit_safe(event_type: str, **kw) -> None:
    """Record an audit event without ever blocking the primary operation."""
    try:
        await audit_svc.record(event_type, **kw)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Failed to record audit event %s: %s", event_type, e)


async def require_session(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.removeprefix("Bearer ")
    session = await auth_svc.validate_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return session


SessionDep = Annotated[dict, Depends(require_session)]


def require_role(min_role: str):
    role_rank = {"investigator": 1, "senior_investigator": 2, "security_admin": 3}

    async def _check(session: SessionDep) -> dict:
        if role_rank.get(session["role"], 0) < role_rank.get(min_role, 999):
            raise HTTPException(status_code=403, detail="Insufficient role")
        return session

    return _check


@router.post("/auth/login")
@rate_limit("auth")
async def login(req: LoginRequest):
    investigator = await auth_svc.authenticate_password(req.username, req.password)
    if not investigator:
        await _audit_safe("auth_failure", severity="warning", details={"username": req.username})
        raise HTTPException(status_code=401, detail="Invalid credentials")
    session = await auth_svc.create_session(investigator["investigator_id"])
    await _audit_safe("auth_success", severity="info", investigator_id=investigator["investigator_id"])
    return {
        "session_token": session["session_token"],
        "expires_at": session["expires_at"],
        "investigator_id": investigator["investigator_id"],
        "role": investigator["role"],
        "username": investigator["username"],
    }


@router.post("/auth/logout")
async def logout(session: SessionDep):
    await auth_svc.revoke_session(session["session_id"])
    await _audit_safe("auth_logout", severity="info", investigator_id=session["investigator_id"])
    return {"status": "logged_out"}


@router.get("/session")
async def get_session(session: SessionDep):
    return {
        "investigator_id": session["investigator_id"],
        "role": session["role"],
        "username": session.get("username"),
    }


@router.get("/cases")
async def list_cases(session: SessionDep):
    cases = await case_svc.get_assigned_cases(session["investigator_id"])
    return {
        "cases": [
            {
                "case_id": c["case_id"],
                "permission": c["permission"],
                "assigned_at": c["assigned_at"].isoformat() if c["assigned_at"] else None,
                "status": c["status"],
                "created_at": c["created_at"].isoformat() if c["created_at"] else None,
                "expires_at": c["expires_at"].isoformat() if c["expires_at"] else None,
                "reporter_meta": c["reporter_meta"],
                "crypto_version": c["crypto_version"],
                "envelope": (
                    {"algorithm": c["env_algorithm"], "key_version": c["env_key_version"]}
                    if c.get("env_algorithm")
                    else None
                ),
            }
            for c in cases
        ]
    }


@router.get("/audit")
async def list_audit(session: SessionDep, limit: int = 200):
    events = await audit_svc.list_events(
        session["investigator_id"],
        is_admin=session["role"] == "security_admin",
        limit=min(max(limit, 1), 500),
    )
    return {"events": events}


@router.get("/policy")
async def get_policy(session: SessionDep):
    s = get_settings()
    return {
        "crypto_active_version": s.crypto_active_version,
        "session_expire_minutes": s.session_expire_minutes,
        "session_idle_minutes": s.session_idle_minutes,
        "argon2": {
            "time_cost": s.argon2_time_cost,
            "memory_cost": s.argon2_memory_cost,
            "parallelism": s.argon2_parallelism,
        },
        "retention": {
            "default_case_ttl_days": s.default_case_ttl_days,
            "max_case_ttl_days": s.max_case_ttl_days,
        },
        "limits": {
            "max_upload_size": s.max_upload_size,
            "max_files_per_case": s.max_files_per_case,
        },
        "rate_limits": {
            "case_creation_per_min": s.rate_limit_case_per_min,
            "auth_per_min": s.rate_limit_auth_per_min,
        },
    }


@router.get("/cases/{case_id}")
async def get_case(case_id: str, session: SessionDep):
    perm = await case_svc.check_access(case_id, session["investigator_id"])
    if not perm and session["role"] != "security_admin":
        raise HTTPException(status_code=403, detail="Access denied: case not assigned")

    case = await case_svc.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    envelope = await env_svc.get_for_recipient(case_id, session["investigator_id"])
    messages = await msg_svc.list_for_case(case_id)
    evidence = await ev_svc.list_for_case(case_id)

    return {
        "case_id": case["case_id"],
        "status": case["status"],
        "crypto_version": case["crypto_version"],
        "reporter_meta": case["reporter_meta"],
        "created_at": case["created_at"].isoformat(),
        "expires_at": case["expires_at"].isoformat() if case["expires_at"] else None,
        "permission": perm,
        "envelope": {
            "wrapped_dek": bytes(envelope["wrapped_dek"]).hex(),
            "algorithm": envelope["algorithm"],
            "key_version": envelope["key_version"],
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
                "original_size": e["original_size"],
                "encrypted_size": e["encrypted_size"],
                "content_type": e["content_type"],
                "created_at": e["created_at"].isoformat(),
            }
            for e in evidence
        ],
    }


@router.get("/cases/{case_id}/evidence/{evidence_id}")
async def download_evidence(
    case_id: str,
    evidence_id: str,
    session: SessionDep,
):
    perm = await case_svc.check_access(case_id, session["investigator_id"])
    if not perm and session["role"] != "security_admin":
        raise HTTPException(status_code=403, detail="Access denied")

    evidence_list = await ev_svc.list_for_case(case_id)
    target = next((e for e in evidence_list if str(e["evidence_id"]) == evidence_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Evidence not found")

    data = await ev_svc.read_file(target["object_key"], case_id)
    if data is None:
        raise HTTPException(status_code=404, detail="File not found on storage")

    return {
        "encrypted_data": data.hex(),
        "crypto_metadata": target["crypto_metadata"],
        "original_size": target["original_size"],
    }


@router.post("/cases/{case_id}/messages")
async def send_message(
    session: SessionDep,
    case_id: str,
    ciphertext: str = Form(...),
    nonce: str = Form(...),
    tag: str = Form(...),
    aad: str = Form(""),
    crypto_version: int = Form(1),
    burn_after_read: bool = Form(False),
):
    perm = await case_svc.check_access(case_id, session["investigator_id"])
    if not perm and session["role"] != "security_admin":
        raise HTTPException(status_code=403, detail="Case not assigned")
    if perm and perm not in ("write", "admin"):
        raise HTTPException(status_code=403, detail="Read-only access on this case")

    case = await case_svc.get_case(case_id)
    if case and case["status"] in ("closed", "expired"):
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
        sender_type="investigator",
        ciphertext=ct,
        nonce=n,
        tag=t,
        aad=ad,
        crypto_version=crypto_version,
        burn_after_read=burn_after_read,
    )
    return result


@router.post("/cases/{case_id}/messages/{message_id}/consume")
async def consume_burn(
    case_id: str,
    message_id: str,
    session: SessionDep,
):
    perm = await case_svc.check_access(case_id, session["investigator_id"])
    if not perm and session["role"] != "security_admin":
        raise HTTPException(status_code=403, detail="Case not assigned")

    result = await msg_svc.consume_burn(message_id)
    if not result:
        raise HTTPException(
            status_code=410,
            detail="Message already consumed or not marked burn-on-read",
        )
    return {
        "ciphertext": result["ciphertext"].hex(),
        "nonce": result["nonce"].hex(),
        "tag": result["tag"].hex(),
        "aad": result["aad"].hex() if result["aad"] else "",
        "crypto_version": result["crypto_version"],
        "sender_type": result["sender_type"],
    }
