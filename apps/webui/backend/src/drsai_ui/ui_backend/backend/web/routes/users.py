from __future__ import annotations

from typing import Dict, List, Set

from fastapi import APIRouter, Depends, HTTPException

from ...datamodel.db import (
    AgentModeSettings,
    UserRole,
    Userinfo,
)
from ..deps import get_db
from ..authz import get_is_platform_admin
from ..auth_source import record_auth_source, resolve_auth_source

router = APIRouter()


@router.get("/access")
async def user_access_summary(user_id: str, db=Depends(get_db)) -> Dict:
    """Frontend: platform admin flag for the signed-in user."""
    return {
        "status": True,
        "data": {
            "is_platform_admin": get_is_platform_admin(db, user_id),
        },
    }


def _require_admin(db, operator_user_id: str) -> None:
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    if not get_is_platform_admin(db, operator_user_id):
        raise HTTPException(status_code=403, detail="Admin privileges required")


@router.get("/")
async def list_users(operator_user_id: str, db=Depends(get_db)) -> Dict:
    """
    Merge local + SSO users into one list.

    auth_source resolution (see auth_source.py):
    - Userinfo.meta.auth_source when recorded at login
    - else Userinfo with password -> local
    - else AgentModeSettings only -> sso
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

    local_by_id = {
        str(u.user_id): u for u in local_users if getattr(u, "user_id", None)
    }
    agent_user_ids = {
        str(a.user_id) for a in agent_users if getattr(a, "user_id", None)
    }

    data: List[dict] = []
    for uid in sorted(user_ids):
        data.append(
            {
                "user_id": uid,
                "auth_source": resolve_auth_source(uid, local_by_id, agent_user_ids),
                "is_admin": role_map.get(uid, False),
            }
        )

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

