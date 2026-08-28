"""Skill proxy for remote agents.

Identity is user_id; auth is X-Skill-Proxy-Token (DRSAI_SKILL_PROXY_TOKEN).
Remote agents POST /download to fetch the original ZIP and extract locally.
Higraf/GFS credentials stay here.
"""

from __future__ import annotations

import io
import hmac

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

from ..skill_grant import skill_proxy_internal_token

router = APIRouter()


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


class SkillDownloadRequest(BaseModel):
    slug: str = Field(..., description="Skill slug / directory name (also the higraf skill_id for source=higraf)")
    source: str = Field(default="public", description="public | higraf | user")
    user_id: str | None = Field(default=None, description="Owner email (required for source=user)")


@router.post(
    "/download",
    summary="下载技能原始 ZIP 包（远程 agent 全量落盘）",
)
async def download_skill(req: SkillDownloadRequest, request: Request):
    """Return the original skill ZIP so a remote agent can extract the full
    package (``SKILL.md`` + ``scripts/`` / ``references/`` / ``assets/``) into
    its local ``skills_dir``. The Skill tool then reads those local files.

    Auth: ``X-Skill-Proxy-Token`` + user_id. Download helpers are reused from
    ``deer_flow`` / ``skills_gfs``.
    """
    _require_internal_token(request)
    user_id = _resolve_user_id(request, req.user_id)
    slug = (req.slug or "").strip()
    source = (req.source or "public").strip() or "public"
    if not slug:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="slug is required",
        )

    zip_bytes: bytes | None = None
    try:
        if source == "higraf":
            from .deer_flow import download_higraf_skill_bytes
            zip_bytes, restricted = await download_higraf_skill_bytes(slug)
            if restricted:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Skill '{slug}' is restricted",
                )
        elif source == "user":
            from .skills_gfs._download import _gfs_download_public_skill_bytes
            zip_bytes = await _gfs_download_public_skill_bytes(slug)
        else:  # public
            from .skills_gfs._download import _gfs_download_public_skill_bytes
            zip_bytes = await _gfs_download_public_skill_bytes(slug)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "[agent_skills] download failed slug={} source={}: {}",
            slug,
            source,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Skill package download failed: {exc}",
        )

    if not zip_bytes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill '{slug}' (source={source}) package not found",
        )

    logger.info(
        "[agent_skills] download user={} slug={} source={} bytes={}",
        user_id,
        slug,
        source,
        len(zip_bytes),
    )
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{slug}.zip"'},
    )
