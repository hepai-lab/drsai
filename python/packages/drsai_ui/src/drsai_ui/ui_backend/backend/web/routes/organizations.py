"""Organizations (cooperation groups), members, org agents, plaza applications."""

from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...datamodel.db import (
    AgentAccessRequest,
    AgentModeSettings,
    Organization,
    OrganizationAgent,
    OrganizationMember,
)
from ..authz import get_is_platform_admin, get_org_membership, is_org_admin
from ..deps import get_db

router = APIRouter()


def _require_platform_admin(db, operator_user_id: str) -> None:
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    if not get_is_platform_admin(db, operator_user_id):
        raise HTTPException(status_code=403, detail="Admin privileges required")


def _require_org_admin_or_platform(db, operator_user_id: str, org_id: int) -> None:
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    if get_is_platform_admin(db, operator_user_id):
        return
    if is_org_admin(db, operator_user_id, org_id):
        return
    raise HTTPException(status_code=403, detail="Org admin or platform admin required")


class OrgCreate(BaseModel):
    slug: str
    display_name: str = ""
    default_agent_id: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class OrgUpdate(BaseModel):
    display_name: Optional[str] = None
    default_agent_id: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class MemberUpsert(BaseModel):
    user_id: str
    role: str = "member"  # org_admin | member


class OrgAgentUpsert(BaseModel):
    agent_id: str
    snapshot: Dict[str, Any]


@router.get("/")
async def list_organizations(operator_user_id: str, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, operator_user_id)
    resp = db.get(Organization, return_json=False)
    rows = resp.data or []
    return {"status": True, "data": [r.model_dump(mode="json") for r in rows]}


@router.get("/catalog")
async def list_org_catalog(db=Depends(get_db)) -> Dict:
    """Public: id, slug, display_name for UI."""
    resp = db.get(Organization, return_json=False)
    rows = resp.data or []
    data = [{"id": r.id, "slug": r.slug, "display_name": r.display_name} for r in rows if r.id is not None]
    return {"status": True, "data": data}


@router.get("/access")
async def org_access_summary(user_id: str, db=Depends(get_db)) -> Dict:
    """Frontend: which org / admin capabilities the user has."""
    is_admin = get_is_platform_admin(db, user_id)
    mem = get_org_membership(db, user_id)
    org_payload = None
    if mem:
        org_row = db.get(Organization, filters={"id": mem.org_id}, return_json=False)
        default_agent_id = None
        if org_row.status and org_row.data:
            default_agent_id = org_row.data[0].default_agent_id
        org_payload = {
            "org_id": mem.org_id,
            "role": mem.role,
            "is_org_admin": str(mem.role) == "org_admin",
            "default_agent_id": default_agent_id,
        }
    return {
        "status": True,
        "data": {
            "is_platform_admin": is_admin,
            "org": org_payload,
        },
    }


@router.get("/me")
async def my_org_membership(user_id: str, db=Depends(get_db)) -> Dict:
    """Current user's organization membership (if any)."""
    mem = get_org_membership(db, user_id)
    if not mem:
        return {"status": True, "data": None}
    org_r = db.get(Organization, filters={"id": mem.org_id}, return_json=False)
    org = org_r.data[0] if org_r.status and org_r.data else None
    payload = {
        "org_id": mem.org_id,
        "user_id": mem.user_id,
        "role": mem.role,
        "slug": org.slug if org else "",
        "display_name": org.display_name if org else "",
        "default_agent_id": getattr(org, "default_agent_id", None) if org else None,
    }
    return {"status": True, "data": payload}


@router.post("/")
async def create_organization(body: OrgCreate, operator_user_id: str, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, operator_user_id)
    slug = body.slug.strip().lower()
    if not slug:
        raise HTTPException(status_code=400, detail="slug required")
    existing = db.get(Organization, filters={"slug": slug}, return_json=False)
    if existing.status and existing.data:
        raise HTTPException(status_code=409, detail="Organization slug already exists")
    org = Organization(
        slug=slug,
        display_name=body.display_name or slug,
        default_agent_id=body.default_agent_id,
        meta=body.meta or {},
    )
    r = db.upsert(org, return_json=False)
    if not r.status:
        raise HTTPException(status_code=500, detail=r.message)
    return {"status": True, "data": r.data.model_dump(mode="json")}


@router.get("/{org_id}")
async def get_organization(org_id: int, operator_user_id: str, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, operator_user_id)
    resp = db.get(Organization, filters={"id": org_id}, return_json=False)
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Organization not found")
    return {"status": True, "data": resp.data[0].model_dump(mode="json")}


@router.put("/{org_id}")
async def update_organization(
    org_id: int,
    body: OrgUpdate,
    operator_user_id: str,
    db=Depends(get_db),
) -> Dict:
    _require_platform_admin(db, operator_user_id)
    resp = db.get(Organization, filters={"id": org_id}, return_json=False)
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Organization not found")
    org: Organization = resp.data[0]
    if body.display_name is not None:
        org.display_name = body.display_name
    if body.default_agent_id is not None:
        org.default_agent_id = body.default_agent_id
    if body.meta is not None:
        org.meta = body.meta
    r = db.upsert(org, return_json=False)
    if not r.status:
        raise HTTPException(status_code=500, detail=r.message)
    return {"status": True, "data": r.data.model_dump(mode="json")}


@router.delete("/{org_id}")
async def delete_organization(org_id: int, operator_user_id: str, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, operator_user_id)
    db.delete(Organization, filters={"id": org_id})
    return {"status": True, "data": {"deleted": org_id}}


@router.get("/{org_id}/members")
async def list_members(org_id: int, operator_user_id: str, db=Depends(get_db)) -> Dict:
    _require_org_admin_or_platform(db, operator_user_id, org_id)
    resp = db.get(OrganizationMember, filters={"org_id": org_id}, return_json=False)
    rows = resp.data or []
    return {"status": True, "data": [r.model_dump(mode="json") for r in rows]}


@router.post("/{org_id}/members")
async def add_member(
    org_id: int,
    body: MemberUpsert,
    operator_user_id: str,
    db=Depends(get_db),
) -> Dict:
    _require_org_admin_or_platform(db, operator_user_id, org_id)
    other = db.get(OrganizationMember, filters={"user_id": body.user_id}, return_json=False)
    if other.status and other.data:
        m = other.data[0]
        if m.org_id != org_id:
            raise HTTPException(status_code=409, detail="User already belongs to another organization")
        raise HTTPException(status_code=409, detail="User already in this organization")
    member = OrganizationMember(
        org_id=org_id,
        user_id=body.user_id,
        role=body.role if body.role in ("org_admin", "member") else "member",
    )
    r = db.upsert(member, return_json=False)
    if not r.status:
        raise HTTPException(status_code=500, detail=r.message)
    return {"status": True, "data": r.data.model_dump(mode="json")}


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(
    org_id: int,
    user_id: str,
    operator_user_id: str,
    db=Depends(get_db),
) -> Dict:
    _require_org_admin_or_platform(db, operator_user_id, org_id)
    db.delete(OrganizationMember, filters={"org_id": org_id, "user_id": user_id})
    return {"status": True, "data": {"removed": user_id}}


@router.get("/{org_id}/agents")
async def list_org_agents(org_id: int, db=Depends(get_db)) -> Dict:
    resp = db.get(OrganizationAgent, filters={"org_id": org_id}, return_json=False)
    rows = resp.data or []
    return {"status": True, "data": [r.model_dump(mode="json") for r in rows]}


@router.post("/{org_id}/agents")
async def upsert_org_agent(
    org_id: int,
    body: OrgAgentUpsert,
    operator_user_id: str,
    db=Depends(get_db),
) -> Dict:
    _require_org_admin_or_platform(db, operator_user_id, org_id)
    snap = dict(body.snapshot or {})
    snap["id"] = body.agent_id
    row = OrganizationAgent(org_id=org_id, agent_id=body.agent_id, snapshot=snap)
    existing = db.get(
        OrganizationAgent,
        filters={"org_id": org_id, "agent_id": body.agent_id},
        return_json=False,
    )
    if existing.status and existing.data:
        row = existing.data[0]
        row.snapshot = snap
    r = db.upsert(row, return_json=False)
    if not r.status:
        raise HTTPException(status_code=500, detail=r.message)
    return {"status": True, "data": r.data.model_dump(mode="json")}


@router.delete("/{org_id}/agents/{agent_id}")
async def delete_org_agent(
    org_id: int,
    agent_id: str,
    operator_user_id: str,
    db=Depends(get_db),
) -> Dict:
    _require_org_admin_or_platform(db, operator_user_id, org_id)
    db.delete(OrganizationAgent, filters={"org_id": org_id, "agent_id": agent_id})
    return {"status": True, "data": {"deleted": agent_id}}


# --- Plaza ---


@router.get("/plaza/agents")
async def plaza_list_other_org_agents(user_id: str, db=Depends(get_db)) -> Dict:
    """Agents from organizations other than the user's (for Agent Square)."""
    mem = get_org_membership(db, user_id)
    my_org = mem.org_id if mem else None
    resp = db.get(OrganizationAgent, return_json=False)
    rows: List[OrganizationAgent] = resp.data or []
    out: List[Dict[str, Any]] = []
    for r in rows:
        if my_org is not None and r.org_id == my_org:
            continue
        org_r = db.get(Organization, filters={"id": r.org_id}, return_json=False)
        org_slug = ""
        org_name = ""
        if org_r.status and org_r.data:
            org_slug = org_r.data[0].slug
            org_name = org_r.data[0].display_name or org_slug
        snap = dict(r.snapshot or {})
        snap.setdefault("id", r.agent_id)
        out.append(
            {
                "org_id": r.org_id,
                "org_slug": org_slug,
                "org_display_name": org_name,
                "agent_id": r.agent_id,
                "snapshot": snap,
            }
        )
    return {"status": True, "data": out}


class PlazaApply(BaseModel):
    applicant_user_id: str
    target_org_id: int
    requested_agent_id: str


@router.post("/plaza/requests")
async def plaza_create_request(body: PlazaApply, db=Depends(get_db)) -> Dict:
    if get_is_platform_admin(db, body.applicant_user_id):
        raise HTTPException(status_code=400, detail="Platform admins do not need to apply")
    mem = get_org_membership(db, body.applicant_user_id)
    if mem and mem.org_id == body.target_org_id:
        raise HTTPException(status_code=400, detail="Agent already belongs to your organization")

    oa = db.get(
        OrganizationAgent,
        filters={"org_id": body.target_org_id, "agent_id": body.requested_agent_id},
        return_json=False,
    )
    if not oa.status or not oa.data:
        raise HTTPException(status_code=404, detail="Agent not found in target organization")

    pending = db.get(
        AgentAccessRequest,
        filters={
            "applicant_user_id": body.applicant_user_id,
            "target_org_id": body.target_org_id,
            "requested_agent_id": body.requested_agent_id,
            "status": "pending",
        },
        return_json=False,
    )
    if pending.status and pending.data:
        raise HTTPException(status_code=409, detail="Request already pending")

    req = AgentAccessRequest(
        applicant_user_id=body.applicant_user_id,
        target_org_id=body.target_org_id,
        requested_agent_id=body.requested_agent_id,
        status="pending",
    )
    r = db.upsert(req, return_json=False)
    if not r.status:
        raise HTTPException(status_code=500, detail=r.message)
    return {"status": True, "data": r.data.model_dump(mode="json")}


@router.get("/plaza/requests/mine")
async def plaza_my_requests(applicant_user_id: str, db=Depends(get_db)) -> Dict:
    resp = db.get(AgentAccessRequest, filters={"applicant_user_id": applicant_user_id}, return_json=False)
    rows = sorted(
        resp.data or [],
        key=lambda x: getattr(x, "created_at", datetime.min) or datetime.min,
        reverse=True,
    )
    return {"status": True, "data": [r.model_dump(mode="json") for r in rows]}


@router.get("/plaza/requests/pending")
async def plaza_list_pending(operator_user_id: str, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, operator_user_id)
    resp = db.get(AgentAccessRequest, filters={"status": "pending"}, return_json=False)
    rows = resp.data or []
    return {"status": True, "data": [r.model_dump(mode="json") for r in rows]}


class ReviewBody(BaseModel):
    operator_user_id: str
    message: Optional[str] = None


@router.put("/plaza/requests/{request_uuid}/approve")
async def plaza_approve(request_uuid: str, body: ReviewBody, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, body.operator_user_id)
    resp = db.get(AgentAccessRequest, filters={"uuid": request_uuid}, return_json=False)
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Request not found")
    req: AgentAccessRequest = resp.data[0]
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")

    oa = db.get(
        OrganizationAgent,
        filters={"org_id": req.target_org_id, "agent_id": req.requested_agent_id},
        return_json=False,
    )
    if not oa.status or not oa.data:
        raise HTTPException(status_code=404, detail="Organization agent no longer exists")

    snap = dict(oa.data[0].snapshot or {})
    snap["id"] = req.requested_agent_id
    snap["granted_cross_org"] = True

    am = db.get(AgentModeSettings, filters={"user_id": req.applicant_user_id}, return_json=False)
    if not am.status or not am.data:
        from drsai_ui.agent_factory.agent_mode_cofigs import get_default_agent_mode_config

        default_agents_mode = get_default_agent_mode_config(user_id=req.applicant_user_id)
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid_lib.uuid4())
        settings = AgentModeSettings(user_id=req.applicant_user_id, agents_mode=default_agents_mode)
        db.upsert(settings)
        am = db.get(AgentModeSettings, filters={"user_id": req.applicant_user_id}, return_json=False)

    settings: AgentModeSettings = am.data[0]
    agents_list = list(settings.agents_mode or [])
    replaced = False
    for i, a in enumerate(agents_list):
        if isinstance(a, dict) and str(a.get("id")) == str(req.requested_agent_id):
            agents_list[i] = snap
            replaced = True
            break
    if not replaced:
        agents_list.append(snap)
    settings.agents_mode = agents_list
    db.upsert(settings)

    req.status = "approved"
    req.reviewer_user_id = body.operator_user_id
    req.reviewed_at = datetime.now()
    req.message = body.message
    db.upsert(req)

    return {"status": True, "data": req.model_dump(mode="json")}


@router.put("/plaza/requests/{request_uuid}/reject")
async def plaza_reject(request_uuid: str, body: ReviewBody, db=Depends(get_db)) -> Dict:
    _require_platform_admin(db, body.operator_user_id)
    resp = db.get(AgentAccessRequest, filters={"uuid": request_uuid}, return_json=False)
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Request not found")
    req: AgentAccessRequest = resp.data[0]
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")
    req.status = "rejected"
    req.reviewer_user_id = body.operator_user_id
    req.reviewed_at = datetime.now()
    req.message = body.message
    db.upsert(req)
    return {"status": True, "data": req.model_dump(mode="json")}
