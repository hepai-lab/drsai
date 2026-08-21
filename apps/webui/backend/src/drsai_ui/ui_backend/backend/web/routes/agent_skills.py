"""Skill proxy for remote agents.

Identity is user_id; auth is X-Skill-Proxy-Token (DRSAI_SKILL_PROXY_TOKEN).
WebUI serves the user's cached SKILL.md; Higraf/GFS credentials stay here.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, HTTPException, Request, status
from loguru import logger
from pydantic import BaseModel, Field

from ..skill_grant import skill_proxy_internal_token
from .deer_flow import (
    find_cached_skill_md,
    list_cached_user_skills,
    wrap_skill_loaded,
)

router = APIRouter()


class SkillLoadRequest(BaseModel):
    skill: str = Field(..., description="SKILL.md frontmatter name, or slug")
    slug: str | None = Field(default=None, description="Optional directory slug")
    user_id: str | None = Field(default=None, description="User email / id")


def _require_internal_token(request: Request) -> None:
    expected = skill_proxy_internal_token()
    incoming = (request.headers.get("X-Skill-Proxy-Token") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Skill proxy token not configured",
        )
    if not incoming:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Skill-Proxy-Token",
        )
    try:
        matched = hmac.compare_digest(incoming, expected)
    except (TypeError, ValueError):
        matched = False
    if not matched:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Skill-Proxy-Token",
        )


def _resolve_user_id(request: Request, body_user_id: str | None = None) -> str:
    user_id = (
        (body_user_id or "").strip()
        or (request.headers.get("X-User-Id") or "").strip()
        or (request.query_params.get("user_id") or "").strip()
    )
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing user_id (query, X-User-Id header, or body)",
        )
    return user_id


@router.get(
    "/attached",
    summary="列出用户已安装技能",
)
async def list_attached_skills(request: Request):
    _require_internal_token(request)
    user_id = _resolve_user_id(request)
    rows = list_cached_user_skills(user_id)
    logger.info(
        "[agent_skills] list user={} count={}",
        user_id,
        len(rows),
    )
    return {"status": True, "data": {"user_id": user_id, "skills": rows}}


@router.post(
    "/load",
    summary="加载技能全文（远程 Skill 工具）",
)
async def load_skill(req: SkillLoadRequest, request: Request):
    _require_internal_token(request)
    user_id = _resolve_user_id(request, req.user_id)
    slug = (req.slug or "").strip() or None
    name = (req.skill or "").strip()
    if not name and not slug:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="skill or slug is required",
        )

    found_slug, found_name, content = find_cached_skill_md(
        user_id, slug=slug, name=name or None,
    )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{name or slug}' not found for user {user_id}",
        )

    skill_name = found_name or name or found_slug or ""
    wrapped = wrap_skill_loaded(skill_name, content)
    logger.info(
        "[agent_skills] load user={} skill={} slug={}",
        user_id,
        skill_name,
        found_slug or slug,
    )
    return {
        "status": True,
        "data": {
            "name": skill_name,
            "slug": found_slug or slug or "",
            "source": "",
            "content": wrapped,
        },
    }
