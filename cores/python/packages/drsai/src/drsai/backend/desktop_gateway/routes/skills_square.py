"""Skills Square proxy routes for ``desktop_gateway``.

Bridge (20260902 meeting): Desktop and WebUI share the same Skill tables hosted
by the WebUI. These routes forward catalog operations to
``{OPENDRSAI_SKILLS_API_BASE_URL|env-default}/api/skills*`` with the caller's
HepAI OIDC Bearer (and optional ``X-OpenDrSai-Auth-Mode`` /
``X-OpenDrSai-Principal``). Desktop Skills Square does not use API keys.

Environment defaults (override with ``OPENDRSAI_SKILLS_API_BASE_URL``):
- test / development → ``https://drsaiv2.ihep.ac.cn``
- production → ``https://opendrsai.ihep.ac.cn``

Local installed skills remain on ``/v1/skills`` (skills_api). This module only
covers the online marketplace surface.
"""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request, Response

logger = logging.getLogger("drsai.desktop_gateway.skills_square")

api = APIRouter(prefix="/v1/skills-square", tags=["skills-square"])

_DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

SKILLS_SQUARE_TEST_API_ROOT = "https://drsaiv2.ihep.ac.cn"
SKILLS_SQUARE_PRODUCTION_API_ROOT = "https://opendrsai.ihep.ac.cn"


def _is_skills_square_test_environment() -> bool:
    launch = (os.environ.get("OPENDRSAI_DESKTOP_LAUNCH_MODE") or "").strip().lower()
    if launch in {"development", "dev"}:    
        return True
    if launch in {"production", "prod"}:
        return False
    active = (os.environ.get("OPENDRSAI_ACTIVE_PLATFORM") or "").strip().lower()
    if active in {"development", "dev"}:
        return True
    if active in {"production", "prod"}:
        return False
    return (os.environ.get("OPENDRSAI_DESKTOP_DEV") or "").strip() == "1"


def _skills_api_root() -> str:
    override = (os.environ.get("OPENDRSAI_SKILLS_API_BASE_URL") or "").strip().rstrip("/")
    if override:
        return override
    # HepAI portal (ai / ai-dev) has no /api/skills* — only WebUI hosts do.
    if _is_skills_square_test_environment():
        return SKILLS_SQUARE_TEST_API_ROOT
    return SKILLS_SQUARE_PRODUCTION_API_ROOT


def _auth_headers(
    authorization: str | None,
    x_opendrsai_auth_mode: str | None = None,
    x_opendrsai_principal: str | None = None,
) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if authorization and authorization.strip():
        headers["Authorization"] = authorization.strip()
    if x_opendrsai_auth_mode:
        headers["X-OpenDrSai-Auth-Mode"] = x_opendrsai_auth_mode
    if x_opendrsai_principal:
        headers["X-OpenDrSai-Principal"] = x_opendrsai_principal
    return headers


async def _proxy(
    method: str,
    path: str,
    *,
    authorization: str | None,
    params: dict[str, Any] | None = None,
    content: bytes | None = None,
    content_type: str | None = None,
    auth_mode: str | None = None,
    principal: str | None = None,
    stream: bool = False,
) -> Response:
    root = _skills_api_root()
    url = f"{root}{path}"
    if params:
        cleaned = {k: v for k, v in params.items() if v is not None and v != ""}
        if cleaned:
            url = f"{url}?{urlencode(cleaned, doseq=True)}"

    headers = _auth_headers(authorization, auth_mode, principal)
    if content_type:
        headers["Content-Type"] = content_type

    try:
        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT, follow_redirects=True) as client:
            upstream = await client.request(method, url, headers=headers, content=content)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail=f"Skills Square upstream timeout: {exc}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Skills Square upstream error: {exc}") from exc

    if stream or "application/zip" in (upstream.headers.get("content-type") or ""):
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/octet-stream"),
            headers={
                k: v
                for k, v in {
                    "Content-Disposition": upstream.headers.get("content-disposition"),
                }.items()
                if v
            },
        )

    media = upstream.headers.get("content-type", "application/json")
    return Response(content=upstream.content, status_code=upstream.status_code, media_type=media)


@api.get("/status")
async def skills_square_status(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    has_auth = bool(authorization and authorization.strip())
    return {
        "status": True,
        "data": {
            "state": "ready" if has_auth else "requires_login",
            "message": (
                "Skills Square proxy ready."
                if has_auth
                else "Provide Authorization bearer (HepAI OIDC access token preferred)."
            ),
            "upstream": _skills_api_root(),
            "environment": "test" if _is_skills_square_test_environment() else "production",
            "auth_required": True,
        },
    }


@api.get("/stats")
async def skills_square_stats(
    authorization: str | None = Header(default=None),
) -> Response:
    return await _proxy("GET", "/api/skills/stats", authorization=authorization)


@api.get("")
async def list_skills_square(
    request: Request,
    authorization: str | None = Header(default=None),
    x_opendrsai_auth_mode: str | None = Header(default=None),
    x_opendrsai_principal: str | None = Header(default=None),
) -> Response:
    params = dict(request.query_params)
    return await _proxy(
        "GET",
        "/api/skills",
        authorization=authorization,
        params=params,
        auth_mode=x_opendrsai_auth_mode,
        principal=x_opendrsai_principal,
    )


@api.get("/tags")
async def list_skill_tags(
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    params = dict(request.query_params)
    return await _proxy("GET", "/api/skill-tags/", authorization=authorization, params=params)


@api.post("/tags")
async def create_skill_tag(
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    params = dict(request.query_params)
    return await _proxy("POST", "/api/skill-tags/", authorization=authorization, params=params)


@api.put("/tags/{tag_id}")
async def update_skill_tag(
    tag_id: int,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    params = dict(request.query_params)
    return await _proxy(
        "PUT",
        f"/api/skill-tags/{tag_id}",
        authorization=authorization,
        params=params,
    )


@api.delete("/tags/{tag_id}")
async def delete_skill_tag(
    tag_id: int,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    params = dict(request.query_params)
    return await _proxy(
        "DELETE",
        f"/api/skill-tags/{tag_id}",
        authorization=authorization,
        params=params,
    )


@api.get("/higraf")
async def list_higraf_skills(
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    params = dict(request.query_params)
    return await _proxy(
        "GET",
        "/api/deer-flow/skill-hub/list",
        authorization=authorization,
        params=params,
    )


@api.post("/upload")
async def upload_skill(
    request: Request,
    authorization: str | None = Header(default=None),
    x_opendrsai_auth_mode: str | None = Header(default=None),
    x_opendrsai_principal: str | None = Header(default=None),
) -> Response:
    body = await request.body()
    return await _proxy(
        "POST",
        "/api/skills/upload",
        authorization=authorization,
        params=dict(request.query_params),
        content=body,
        content_type=request.headers.get("content-type"),
        auth_mode=x_opendrsai_auth_mode,
        principal=x_opendrsai_principal,
    )


@api.get("/{slug}")
async def get_skill(
    slug: str,
    request: Request,
    authorization: str | None = Header(default=None),
    x_opendrsai_auth_mode: str | None = Header(default=None),
    x_opendrsai_principal: str | None = Header(default=None),
) -> Response:
    return await _proxy(
        "GET",
        f"/api/skills/{slug}",
        authorization=authorization,
        params=dict(request.query_params),
        auth_mode=x_opendrsai_auth_mode,
        principal=x_opendrsai_principal,
    )


@api.put("/{slug}")
async def update_skill(
    slug: str,
    request: Request,
    authorization: str | None = Header(default=None),
    x_opendrsai_auth_mode: str | None = Header(default=None),
    x_opendrsai_principal: str | None = Header(default=None),
) -> Response:
    body = await request.body()
    return await _proxy(
        "PUT",
        f"/api/skills/{slug}",
        authorization=authorization,
        params=dict(request.query_params),
        content=body,
        content_type=request.headers.get("content-type"),
        auth_mode=x_opendrsai_auth_mode,
        principal=x_opendrsai_principal,
    )


@api.delete("/{slug}")
async def delete_skill(
    slug: str,
    request: Request,
    authorization: str | None = Header(default=None),
    x_opendrsai_auth_mode: str | None = Header(default=None),
    x_opendrsai_principal: str | None = Header(default=None),
) -> Response:
    return await _proxy(
        "DELETE",
        f"/api/skills/{slug}",
        authorization=authorization,
        params=dict(request.query_params),
        auth_mode=x_opendrsai_auth_mode,
        principal=x_opendrsai_principal,
    )


@api.get("/{slug}/download")
async def download_skill(
    slug: str,
    request: Request,
    authorization: str | None = Header(default=None),
    x_opendrsai_auth_mode: str | None = Header(default=None),
    x_opendrsai_principal: str | None = Header(default=None),
) -> Response:
    return await _proxy(
        "GET",
        f"/api/skills/{slug}/download",
        authorization=authorization,
        params=dict(request.query_params),
        auth_mode=x_opendrsai_auth_mode,
        principal=x_opendrsai_principal,
        stream=True,
    )


@api.get("/{slug}/skill-md")
async def skill_md(
    slug: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    return await _proxy(
        "GET",
        f"/api/skills/{slug}/skill-md",
        authorization=authorization,
        params=dict(request.query_params),
    )


@api.get("/{slug}/profile")
async def skill_profile(
    slug: str,
    authorization: str | None = Header(default=None),
) -> Response:
    return await _proxy(
        "GET",
        f"/api/skills/{slug}/profile",
        authorization=authorization,
        stream=True,
    )


@api.put("/{slug}/visibility")
async def skill_visibility(
    slug: str,
    request: Request,
    authorization: str | None = Header(default=None),
    visibility: str | None = Query(default=None),
) -> Response:
    params = dict(request.query_params)
    if visibility:
        params["visibility"] = visibility
    return await _proxy(
        "PUT",
        f"/api/skills/{slug}/visibility",
        authorization=authorization,
        params=params,
    )


def router() -> APIRouter:
    return api
