from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import auth as auth_svc
from ..services import case as case_svc
from ..services import envelope as env_svc
from ..services.audit import record as audit
from .investigator import require_role

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

require_admin = require_role("security_admin")
require_senior = require_role("senior_investigator")

AdminDep = Annotated[dict, Depends(require_admin)]
SeniorDep = Annotated[dict, Depends(require_senior)]

ROLES = ("investigator", "senior_investigator", "security_admin")
PERMISSIONS = ("read", "write", "admin")  # matches case_assignments CHECK constraint


# Request bodies, not query parameters: query strings land in access logs,
# proxy logs, and browser history. Passwords and key material must not.
class CreateInvestigatorRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=12, max_length=1024)
    role: str = "investigator"
    display_name: str | None = Field(default=None, max_length=256)


class AssignCaseRequest(BaseModel):
    case_id: str
    investigator_id: str
    permission: str = "read"


class AssignEnvelopeRequest(BaseModel):
    case_id: str
    investigator_id: str
    wrapped_dek: str
    algorithm: str = "hpke-dhkem-x25519-aes256gcm"


class RegisterKeyRequest(BaseModel):
    public_key: str
    algorithm: str


@router.get("/cases")
async def list_all_cases(session: SeniorDep):
    cases = await case_svc.list_all_cases(investigator_id=session["investigator_id"])
    return {
        "cases": [
            {
                "case_id": c["case_id"],
                "status": c["status"],
                "created_at": c["created_at"].isoformat() if c["created_at"] else None,
                "expires_at": c["expires_at"].isoformat() if c["expires_at"] else None,
                "reporter_meta": c["reporter_meta"],
                "crypto_version": c["crypto_version"],
                "permission": c.get("permission"),
                "assigned_at": c["assigned_at"].isoformat() if c.get("assigned_at") else None,
                "is_assigned": c.get("is_assigned", False),
                "assignment_count": c.get("assignment_count", 0),
            }
            for c in cases
        ]
    }


@router.post("/investigators")
async def create_investigator(req: CreateInvestigatorRequest, session: AdminDep):
    if req.role not in ROLES:
        raise HTTPException(status_code=422, detail="Unknown role")
    try:
        result = await auth_svc.create_investigator(
            username=req.username,
            password=req.password,
            role=req.role,
            display_name=req.display_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    await audit(
        "investigator_created",
        severity="info",
        investigator_id=result["investigator_id"],
        details={"username": req.username, "role": req.role},
    )
    return result


@router.post("/assignments")
async def assign_case(req: AssignCaseRequest, session: SeniorDep):
    if req.permission not in PERMISSIONS:
        raise HTTPException(status_code=422, detail="Unknown permission")
    try:
        result = await case_svc.assign_case(req.case_id, req.investigator_id, req.permission)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    reporter_env = await env_svc.get_for_recipient(req.case_id, f"reporter-{req.case_id}")
    if reporter_env:
        existing = await env_svc.get_for_recipient(req.case_id, req.investigator_id)
        if not existing:
            await env_svc.create_investigator_envelope(
                req.case_id,
                req.investigator_id,
                bytes(reporter_env["wrapped_dek"]),
                reporter_env["algorithm"],
            )
            await audit(
                "envelope_assigned",
                severity="info",
                case_id=req.case_id,
                investigator_id=req.investigator_id,
                details={"source": "auto_copy_from_reporter"},
            )

    return result


@router.post("/envelopes")
async def assign_envelope(req: AssignEnvelopeRequest, session: SeniorDep):
    try:
        wd = bytes.fromhex(req.wrapped_dek)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex encoding") from None

    result = await env_svc.create_investigator_envelope(req.case_id, req.investigator_id, wd, req.algorithm)
    await audit(
        "envelope_assigned",
        severity="info",
        case_id=req.case_id,
        investigator_id=req.investigator_id,
    )
    return result


@router.post("/cases/{case_id}/expire")
async def expire_case(case_id: str, session: SeniorDep):
    ok = await case_svc.expire_case(case_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Case not found or already expired")
    return {"status": "expired"}


@router.post("/investigators/{investigator_id}/revoke-sessions")
async def revoke_sessions(investigator_id: str, session: AdminDep):
    await auth_svc.revoke_all_sessions(investigator_id)
    return {"status": "sessions_revoked"}


@router.post("/investigators/{investigator_id}/keys")
async def register_investigator_key(
    investigator_id: str,
    req: RegisterKeyRequest,
    session: AdminDep,
):
    try:
        pk = bytes.fromhex(req.public_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex") from None
    from ..database import get_pool, require_row

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = require_row(
            await conn.fetchrow(
                """
                INSERT INTO investigator_keys (investigator_id, public_key, algorithm)
                VALUES ($1, $2, $3) RETURNING key_id, created_at
                """,
                investigator_id,
                pk,
                req.algorithm,
            ),
            "insert investigator key",
        )
    return {"key_id": str(row["key_id"]), "created_at": row["created_at"].isoformat()}
