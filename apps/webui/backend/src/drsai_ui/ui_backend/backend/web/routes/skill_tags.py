"""Admin-only CRUD for skill tags (categories).

All endpoints require operator_user_id with platform admin privileges.
"""

from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException

from ...datamodel.db import SkillTag
from ..authz import get_is_platform_admin
from ..deps import get_db

router = APIRouter()


def _require_admin(db, operator_user_id: str) -> None:
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    if not get_is_platform_admin(db, operator_user_id):
        raise HTTPException(status_code=403, detail="Admin privileges required")


@router.get("/")
async def list_tags(operator_user_id: str, db=Depends(get_db)) -> Dict:
    """List all skill tags, ordered by sort_order then name.

    Accessible to any authenticated user (not just admin) — the category
    filter in the skills square needs read access for everyone.
    """
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    items = db.get(SkillTag, return_json=False)
    if not items.status:
        raise HTTPException(status_code=500, detail=items.message)
    rows: List[SkillTag] = items.data or []
    rows.sort(key=lambda r: (r.sort_order, r.name))
    return {
        "status": True,
        "data": [r.model_dump(mode="json") for r in rows],
    }


@router.post("/")
async def create_tag(
    operator_user_id: str,
    name: str,
    sort_order: int = 0,
    db=Depends(get_db),
) -> Dict:
    """Create a new skill tag. Name must be unique."""
    _require_admin(db, operator_user_id)
    name = name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tag name cannot be empty")

    # Check duplicate
    existing = db.get(SkillTag, filters={"name": name}, return_json=False)
    if existing.status and existing.data:
        raise HTTPException(status_code=409, detail=f"Tag '{name}' already exists")

    tag = SkillTag(name=name, sort_order=sort_order)
    resp = db.upsert(tag)
    if not resp.status:
        raise HTTPException(status_code=500, detail=resp.message)
    return {"status": True, "data": resp.data}


@router.put("/{tag_id}")
async def update_tag(
    tag_id: int,
    operator_user_id: str,
    name: str | None = None,
    sort_order: int | None = None,
    db=Depends(get_db),
) -> Dict:
    """Update a tag's name and/or sort_order."""
    _require_admin(db, operator_user_id)

    existing = db.get(SkillTag, filters={"id": tag_id}, return_json=False)
    if not existing.status or not existing.data:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag: SkillTag = existing.data[0]
    if name is not None:
        name = name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Tag name cannot be empty")
        # Check name uniqueness (exclude self)
        dup = db.get(SkillTag, filters={"name": name}, return_json=False)
        if dup.status and dup.data:
            for d in dup.data:
                if d.id != tag_id:
                    raise HTTPException(status_code=409, detail=f"Tag name '{name}' already exists")
        tag.name = name
    if sort_order is not None:
        tag.sort_order = sort_order

    resp = db.upsert(tag)
    if not resp.status:
        raise HTTPException(status_code=500, detail=resp.message)
    return {"status": True, "data": resp.data}


@router.delete("/{tag_id}")
async def delete_tag(
    tag_id: int,
    operator_user_id: str,
    db=Depends(get_db),
) -> Dict:
    """Delete a skill tag."""
    _require_admin(db, operator_user_id)
    resp = db.delete(SkillTag, filters={"id": tag_id})
    if not resp.status:
        raise HTTPException(status_code=500, detail=resp.message)
    return {"status": True, "data": {"id": tag_id}}