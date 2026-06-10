"""Legacy /orgs/access alias for admin nav checks (frontend compatibility)."""

from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends

from ..authz import get_is_platform_admin
from ..deps import get_db

router = APIRouter()


@router.get("/access")
async def org_access_summary(user_id: str, db=Depends(get_db)) -> Dict:
    return {
        "status": True,
        "data": {
            "is_platform_admin": get_is_platform_admin(db, user_id),
        },
    }
