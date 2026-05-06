from __future__ import annotations

from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException

from ...datamodel.db import (
    AgentModeSettings,
    Organization,
    OrganizationMember,
    UserRole,
    Userinfo,
)
from ..deps import get_db
from ..authz import get_is_platform_admin

router = APIRouter()


def _require_admin(db, operator_user_id: str) -> None:
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    if not get_is_platform_admin(db, operator_user_id):
        raise HTTPException(status_code=403, detail="Admin privileges required")


@router.get("/")
async def list_users(operator_user_id: str, db=Depends(get_db)) -> Dict:
    """
    Merge local + SSO users into one list.

    Current heuristic:
    - local users: present in Userinfo table
    - sso users: present in AgentModeSettings table but not in Userinfo
    """
    _require_admin(db, operator_user_id)

    user_ids: Set[str] = set()

    local_users = db.get(Userinfo, return_json=False).data or []
    for u in local_users:
        if getattr(u, "user_id", None):
            user_ids.add(str(u.user_id))

    agent_users = db.get(AgentModeSettings, return_json=False).data or []
    for a in agent_users:
        if getattr(a, "user_id", None):
            user_ids.add(str(a.user_id))

    # Roles
    roles = db.get(UserRole, return_json=False).data or []
    role_map = {str(r.user_id): bool(r.is_admin) for r in roles if getattr(r, "user_id", None)}

    local_set = {str(u.user_id) for u in local_users if getattr(u, "user_id", None)}

    members = db.get(OrganizationMember, return_json=False).data or []
    all_orgs = db.get(Organization, return_json=False).data or []
    org_map: Dict[int, Organization] = {int(o.id): o for o in all_orgs if o.id is not None}
    org_by_user: Dict[str, dict] = {}
    for m in members:
        uid = getattr(m, "user_id", None)
        if not uid:
            continue
        o = org_map.get(int(m.org_id))
        slug = getattr(o, "slug", "") if o else ""
        display_name = getattr(o, "display_name", "") if o else ""
        org_by_user[str(uid)] = {
            "org_id": m.org_id,
            "org_slug": slug or None,
            "org_display_name": display_name or None,
            "org_role": str(getattr(m, "role", "member") or "member"),
        }

    data: List[dict] = []
    for uid in sorted(user_ids):
        row: dict = {
            "user_id": uid,
            "auth_source": "local" if uid in local_set else "sso",
            "is_admin": role_map.get(uid, False),
        }
        if uid in org_by_user:
            row.update(org_by_user[uid])
        else:
            row["org_id"] = None
            row["org_slug"] = None
            row["org_display_name"] = None
            row["org_role"] = None
        data.append(row)

    return {"status": True, "data": data}


@router.put("/{user_id}/admin")
async def set_admin(
    user_id: str,
    operator_user_id: str,
    is_admin: bool = True,
    db=Depends(get_db),
) -> Dict:
    _require_admin(db, operator_user_id)

    # Upsert role record
    existing = db.get(UserRole, filters={"user_id": user_id}, return_json=False)
    if existing.status and existing.data:
        role: UserRole = existing.data[0]
        role.is_admin = bool(is_admin)
        resp = db.upsert(role)
    else:
        resp = db.upsert(UserRole(user_id=user_id, is_admin=bool(is_admin)))

    if not resp.status:
        raise HTTPException(status_code=500, detail="Failed to update user role")

    return {"status": True, "data": {"user_id": user_id, "is_admin": bool(is_admin)}}

