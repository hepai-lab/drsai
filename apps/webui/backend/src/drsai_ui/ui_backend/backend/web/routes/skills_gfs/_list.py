"""List skills endpoint.

Tab filtering model:
  全部技能  → visibility=public ( SkillMeta ) + higraf GFS entries
  我的创建  → source="user" && uskills_type="created" && owner_id=user_id
  我的收藏  → source="user" && uskills_type="imported" && owner_id=user_id
  标签筛选  → tags.includes(tag), independent of tab
"""

from __future__ import annotations

from fastapi import HTTPException, Query, Request

from ._constants import logger, router
from ._auth import _get_db, _resolve_user_from_apikey, _skillmeta_to_dict


_DEFAULT_PAGE_SIZE = 20
_MAX_PAGE_SIZE = 200


def _paginate(items: list, page: int, page_size: int) -> tuple[list, dict]:
    total = len(items)
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    start = (page - 1) * page_size
    page_items = items[start:start + page_size] if start < total else []
    return page_items, {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def _match_q(item: dict, q: str) -> bool:
    if not q:
        return True
    ql = q.lower()
    return any(ql in str(item.get(k) or "").lower()
               for k in ("name", "author", "slug"))


def _match_tags(item: dict, tags: str) -> bool:
    if not tags:
        return True
    wanted = {t.strip() for t in tags.split(",") if t.strip()}
    if not wanted:
        return True
    item_tags = set(item.get("tags") or [])
    return bool(wanted & item_tags)


@router.get("")
async def list_skills(
    request: Request,
    type: str = Query("", description="type: public or user"),
    source: str = Query("", description="Filter by source: user, higraf"),
    uskills_type: str = Query("", description="Filter user skills: created, imported"),
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(
        _DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE,
        description=f"Items per page, max {_MAX_PAGE_SIZE}",
    ),
    q: str = Query("", description="Search name / author / slug"),
    tags: str = Query("", description="Filter by tags (comma-separated)"),
    sort: str = Query("name", description="Sort: name, time, downloads, or collects"),
    visibility: str = Query("", description="Filter by visibility: public, private, team"),
) -> dict:
    """List skills.

    Query params:
      type         — public or user (type=user always returns the authenticated user's skills)
      source       — user, higraf (default: all)
      uskills_type — created, imported (only when source=user)
      tags         — comma-separated, e.g. "lhasso,word"
      visibility   — public, private, team
      q            — search name / author / slug
      sort         — name (default), time, downloads, or collects
    """
    return await _list_skills(
        request, type=type,
        source=source, uskills_type=uskills_type,
        page=page, page_size=page_size,
        q=q, tags=tags, sort=sort, visibility=visibility,
    )


async def _list_skills(
    request: Request,
    type: str = "",
    source: str = "",
    uskills_type: str = "",
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    q: str = "",
    tags: str = "",
    sort: str = "name",
    visibility: str = "",
) -> dict:
    from ....datamodel.db import SkillMeta

    type_clean = (type or "").strip().lower()

    resolved_user_id = await _resolve_user_from_apikey(request)

    # type=public → allow unauthenticated access (public data)
    if type_clean == "public" and not resolved_user_id:
        resolved_user_id = ""

    if type_clean != "public" and not resolved_user_id:
        raise HTTPException(status_code=401, detail="API key required")

    db_mgr = await _get_db()
    from ...authz import get_is_platform_admin
    is_admin = get_is_platform_admin(db_mgr, resolved_user_id) if resolved_user_id else False

    source_clean = (source or "").strip().lower()
    utype_clean = (uskills_type or "").strip().lower()
    vis_clean = (visibility or "").strip().lower()

    # ── type=user → only return skills owned by the authenticated user ──────
    if type_clean == "user":
        source_clean = "user"

    # ── type=public → default to visibility=public unless explicitly overridden ──
    if type_clean == "public" and not vis_clean:
        vis_clean = "public"

    filters: dict = {}
    if source_clean and source_clean in ("user", "higraf"):
        filters["source"] = source_clean
    if vis_clean and vis_clean in ("public", "private", "team"):
        filters["visibility"] = vis_clean

    resp = db_mgr.get(SkillMeta, filters=filters if filters else None, order="asc")
    rows = list(resp.data or []) if resp.status else []

    # ── Apply uskills_type filter ──────────────────────────────────────────
    if utype_clean and utype_clean in ("created", "imported"):
        rows = [r for r in rows if getattr(r, "uskills_type", None) == utype_clean]

    # ── type=user → always filter by authenticated user ─────────────────────
    if type_clean == "user":
        rows = [r for r in rows if r.owner_id == resolved_user_id]

    items = []
    for row in rows:
        item = _skillmeta_to_dict(row)
        item["can_edit"] = is_admin or (
            resolved_user_id == row.owner_id or resolved_user_id == row.author
        )
        items.append(item)

    q_clean = (q or "").strip()
    tags_clean = (tags or "").strip()
    if q_clean or tags_clean:
        items = [x for x in items if _match_q(x, q_clean) and _match_tags(x, tags_clean)]

    if (sort or "").strip().lower() == "time":
        items.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    elif (sort or "").strip().lower() == "downloads":
        items.sort(key=lambda x: int(x.get("downloads") or 0), reverse=True)
    elif (sort or "").strip().lower() == "collects":
        items.sort(key=lambda x: int(x.get("collects") or 0), reverse=True)
    else:
        items.sort(key=lambda x: (x.get("name") or "").lower())

    page_items, pagination = _paginate(items, page, page_size)
    return {"status": True, "data": page_items, "pagination": pagination}