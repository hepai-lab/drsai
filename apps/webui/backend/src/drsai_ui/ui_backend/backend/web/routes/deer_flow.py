"""
Deer Flow — Higraf 内部 token-exchange 认证代理。

通过内部 token 调用 Higraf 的 token-exchange 接口，获取 Higraf JWT 和知识库 token，
后续请求通过 Cookie 传递这些 token。
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

router = APIRouter()

# ── 配置 ──────────────────────────────────────────────────────────────────────

DEER_FLOW_INTERNAL_AUTH_TOKEN = os.getenv("DEER_FLOW_INTERNAL_AUTH_TOKEN") or ""
REQUEST_TIMEOUT = float(os.getenv("DEER_FLOW_REQUEST_TIMEOUT", "10.0"))


def _higraf_base_url() -> str:
    """惰性读取 HIGRAF_BASE_URL，避免模块加载时 .env 尚未加载的问题。"""
    return os.getenv("HIGRAF_BASE_URL", "http://higraf.ihep.ac.cn")

logger = logger.bind(name="DeerFlow")

# ── 模型 ──────────────────────────────────────────────────────────────────────


class TokenExchangeRequest(BaseModel):
    """内部 token-exchange 请求体"""

    oauth_provider: str = Field(..., description="OAuth 提供方，例如 ihep")
    oauth_id: str = Field(..., description="OAuth 用户唯一标识")
    email: str = Field(..., description="用户邮箱")
    display_name: Optional[str] = Field(default=None, description="用户显示名称（可选）")


class TokenExchangeResponse(BaseModel):
    """Higraf token-exchange 返回的 token 信息"""

    access_token: Optional[str] = Field(default=None, description="Higraf JWT access token")
    refresh_token: Optional[str] = Field(default=None, description="Higraf refresh token")
    kb_token: Optional[str] = Field(default=None, description="知识库 token")
    token_type: str = Field(default="Bearer")
    expires_in: Optional[int] = Field(default=None, description="token 过期时间（秒）")


# ── Cookie 常量 ───────────────────────────────────────────────────────────────

HIGRAF_ACCESS_TOKEN_COOKIE = "higraf_access_token"
HIGRAF_REFRESH_TOKEN_COOKIE = "higraf_refresh_token"
HIGRAF_KB_TOKEN_COOKIE = "higraf_kb_token"
SECONDS_OF_ONE_DAY = 24 * 60 * 60


def _cookie_secure() -> bool:
    return os.getenv("SERVICE_MODE") == "PROD"


# ── 路由 ──────────────────────────────────────────────────────────────────────


@router.post(
    "/auth/token-exchange",
    response_model=dict,
    summary="内部 Token Exchange",
    description="通过内部认证 token 换取 Higraf JWT 和知识库 token，并设置 Cookie。",
)
async def token_exchange(request: TokenExchangeRequest, fastapi_request: Request) -> JSONResponse:
    """
    调用 Higraf 的内部 token-exchange 接口，获取 Higraf JWT 和知识库 token。

    请求头需要携带 X-Internal-Token，与配置的 DEER_FLOW_INTERNAL_AUTH_TOKEN 匹配。
    Higraf 返回的 token 会通过 HttpOnly Cookie 设置到响应中，供后续接口使用。
    """
    # ── 验证内部 token ──
    incoming_token = fastapi_request.headers.get("X-Internal-Token", "")
    if not incoming_token or incoming_token != DEER_FLOW_INTERNAL_AUTH_TOKEN:
        logger.warning(
            f"[DeerFlow] token-exchange rejected: invalid X-Internal-Token "
            f"(received={incoming_token[:8]}...)"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal token",
        )

    # ── 调用 Higraf token-exchange ──
    url = f"{_higraf_base_url()}/api/internal/v1/auth/token-exchange"
    payload = request.model_dump(exclude_none=True)

    logger.info(
        f"[DeerFlow] token-exchange request -> {url} "
        f"oauth_provider={request.oauth_provider} "
        f"oauth_id={request.oauth_id} "
        f"email={request.email}"
    )

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "X-Internal-Token": DEER_FLOW_INTERNAL_AUTH_TOKEN,
                    "Content-Type": "application/json",
                },
            )
        logger.info(f"[DeerFlow] token-exchange response status={resp.status_code}")
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[DeerFlow] Higraf HTTP error: status={exc.response.status_code} "
            f"body={exc.response.text[:500]}"
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Higraf token-exchange failed: {exc.response.status_code}",
        )
    except httpx.TimeoutException:
        logger.error("[DeerFlow] Higraf token-exchange timeout")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Higraf token-exchange timed out",
        )
    except Exception as exc:
        logger.exception(f"[DeerFlow] unexpected error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Higraf token-exchange failed",
        )

    # ── 解析 Higraf 响应 ──
    if not isinstance(body, dict):
        logger.warning(f"[DeerFlow] unexpected response type: {type(body)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected response from Higraf",
        )

    data = body.get("data", body)
    if not isinstance(data, dict):
        data = body

    access_token = data.get("access_token") or data.get("token")
    refresh_token = data.get("refresh_token")
    kb_token = data.get("knowledge_token") or data.get("kb_token") or data.get("knowledge_base_token")
    expires_in = data.get("expires_in") or data.get("expires")
    token_type = data.get("token_type", "Bearer")

    logger.info(
        f"[DeerFlow] token-exchange success for email={request.email}, "
        f"has_access_token={bool(access_token)}, "
        f"has_refresh_token={bool(refresh_token)}, "
        f"has_kb_token={bool(kb_token)}"
    )

    # ── 构建响应并设置 Cookie ──
    response_content = {
        "status": True,
        "message": "Token exchange successful",
        "data": {
            "email": request.email,
            "has_access_token": bool(access_token),
            "has_kb_token": bool(kb_token),
            "token_type": token_type,
        },
    }
    if expires_in is not None:
        response_content["data"]["expires_in"] = expires_in

    response = JSONResponse(content=response_content)

    # 将 Higraf token 写入 HttpOnly Cookie，供后续接口使用
    cookie_max_age = int(expires_in) if isinstance(expires_in, (int, float)) and expires_in > 0 else SECONDS_OF_ONE_DAY

    if access_token:
        response.set_cookie(
            key=HIGRAF_ACCESS_TOKEN_COOKIE,
            value=access_token,
            httponly=True,
            path="/",
            samesite="lax",
            secure=_cookie_secure(),
            max_age=cookie_max_age,
        )
    if refresh_token:
        response.set_cookie(
            key=HIGRAF_REFRESH_TOKEN_COOKIE,
            value=refresh_token,
            httponly=True,
            path="/",
            samesite="lax",
            secure=_cookie_secure(),
            max_age=cookie_max_age * 7,  # refresh token 有效期更长
        )
    if kb_token:
        response.set_cookie(
            key=HIGRAF_KB_TOKEN_COOKIE,
            value=kb_token,
            httponly=True,
            path="/",
            samesite="lax",
            secure=_cookie_secure(),
            max_age=cookie_max_age,
        )

    return response


@router.post("/auth/refresh", summary="刷新 Higraf token")
async def refresh_higraf_token(fastapi_request: Request) -> JSONResponse:
    """
    使用 refresh token Cookie 刷新 Higraf access token。
    """
    refresh_token = fastapi_request.cookies.get(HIGRAF_REFRESH_TOKEN_COOKIE)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    url = f"{_higraf_base_url()}/api/internal/v1/auth/refresh"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(
                url,
                json={"refresh_token": refresh_token},
                headers={
                    "X-Internal-Token": DEER_FLOW_INTERNAL_AUTH_TOKEN,
                    "Content-Type": "application/json",
                },
            )
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Higraf token refresh failed: {exc.response.status_code}",
        )
    except Exception as exc:
        logger.exception(f"[DeerFlow] refresh error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Higraf token refresh failed",
        )

    data = body.get("data", body) if isinstance(body, dict) else {}
    access_token = data.get("access_token") or data.get("token")
    new_refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in")

    response = JSONResponse(content={
        "status": True,
        "message": "Token refreshed",
        "data": {"has_access_token": bool(access_token)},
    })

    cookie_max_age = int(expires_in) if isinstance(expires_in, (int, float)) and expires_in > 0 else SECONDS_OF_ONE_DAY

    if access_token:
        response.set_cookie(
            key=HIGRAF_ACCESS_TOKEN_COOKIE,
            value=access_token,
            httponly=True,
            path="/",
            samesite="lax",
            secure=_cookie_secure(),
            max_age=cookie_max_age,
        )
    if new_refresh_token:
        response.set_cookie(
            key=HIGRAF_REFRESH_TOKEN_COOKIE,
            value=new_refresh_token,
            httponly=True,
            path="/",
            samesite="lax",
            secure=_cookie_secure(),
            max_age=cookie_max_age * 7,
        )

    return response


# ── 辅助函数：从 Cookie 读取 Higraf token ─────────────────────────────────────


def get_higraf_access_token(request: Request) -> Optional[str]:
    """从请求 Cookie 中读取 Higraf access token。"""
    return request.cookies.get(HIGRAF_ACCESS_TOKEN_COOKIE)


def get_higraf_kb_token(request: Request) -> Optional[str]:
    """从请求 Cookie 中读取 Higraf 知识库 token。"""
    return request.cookies.get(HIGRAF_KB_TOKEN_COOKIE)


# ── 公开函数：供外部模块调用 Higraf API ──────────────────────────────────────

_HIGRAF_SKILL_SLUG_RE = re.compile(r"^skill-[a-zA-Z0-9-]+$")

_TOKEN_TTL_SEC = 30 * 60
_SKILLS_TTL_SEC = 10 * 60
_token_cache: dict = {"token": None, "at": 0.0}
_skills_cache: dict[str, dict] = {}


def is_higraf_skill_slug(slug: str) -> bool:
    """Return True if slug looks like a Higraf skill id (e.g. skill-f44f20e44638)."""
    return bool(_HIGRAF_SKILL_SLUG_RE.match(slug))


async def get_system_higraf_access_token() -> str | None:
    """Obtain a system-level Higraf JWT via internal token-exchange."""
    now = time.monotonic()
    cached = _token_cache.get("token")
    if cached and (now - float(_token_cache.get("at") or 0)) < _TOKEN_TTL_SEC:
        return cached

    token_url = f"{_higraf_base_url()}/api/internal/v1/auth/token-exchange"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(
                token_url,
                json={
                    "oauth_provider": "ihep",
                    "oauth_id": "sys",
                    "email": "sys@higraf.ihep.ac.cn",
                },
                headers={
                    "X-Internal-Token": DEER_FLOW_INTERNAL_AUTH_TOKEN,
                    "Content-Type": "application/json",
                },
            )
        resp.raise_for_status()
        token_body = resp.json()
        data = token_body.get("data", token_body) if isinstance(token_body, dict) else token_body
        if isinstance(data, dict):
            token = data.get("access_token") or data.get("token")
            if token:
                _token_cache["token"] = token
                _token_cache["at"] = now
            return token
    except Exception as exc:
        logger.warning(f"[DeerFlow] system token-exchange failed: {type(exc).__name__}: {exc}")
    return None


def get_cached_higraf_skills(visibility: str = "public") -> list[dict]:
    """Return cached Higraf skills without hitting the network."""
    entry = _skills_cache.get(visibility) or {}
    items = entry.get("items") or []
    return list(items) if isinstance(items, list) else []


def higraf_skills_cache_fresh(visibility: str = "public") -> bool:
    entry = _skills_cache.get(visibility)
    if not entry:
        return False
    return (time.monotonic() - float(entry.get("at") or 0)) < _SKILLS_TTL_SEC


async def _fetch_higraf_skills_uncached(visibility: str) -> list[dict]:
    base_url = _higraf_base_url()
    logger.info(f"[DeerFlow] fetch_higraf_skills called, base_url={base_url}, visibility={visibility}")

    access_token = await get_system_higraf_access_token()
    if not access_token:
        logger.warning("[DeerFlow] fetch_higraf_skills: no access_token from token-exchange")
        return []

    url = f"{_higraf_base_url()}/api/v1/skill-hub/list"
    params = {"visibility": visibility}
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"Cookie": f"access_token={access_token}"},
            )
        resp.raise_for_status()
        body = resp.json()
    except Exception as exc:
        logger.warning(f"[DeerFlow] fetch_higraf_skills list failed: {type(exc).__name__}: {exc}")
        return []

    data = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(data, list):
        logger.warning(
            f"[DeerFlow] fetch_higraf_skills: unexpected response type={type(data)}, "
            f"body keys={list(body.keys()) if isinstance(body, dict) else 'N/A'}"
        )
        return []
    logger.info(f"[DeerFlow] fetch_higraf_skills: got {len(data)} skills")
    return data


async def fetch_higraf_skills(visibility: str = "public") -> list[dict]:
    """Higraf skill-hub/list. Uses an in-memory TTL cache so the public skills
    list is not blocked on Higraf on every request.
    """
    if higraf_skills_cache_fresh(visibility):
        return get_cached_higraf_skills(visibility)
    items = await _fetch_higraf_skills_uncached(visibility)
    _skills_cache[visibility] = {"items": items, "at": time.monotonic(), "refreshing": False}
    return items


def schedule_higraf_skills_refresh(visibility: str = "public") -> None:
    """Refresh Higraf list in the background; list endpoints should not await this."""
    entry = _skills_cache.setdefault(visibility, {"items": [], "at": 0.0, "refreshing": False})
    if higraf_skills_cache_fresh(visibility) or entry.get("refreshing"):
        return
    entry["refreshing"] = True

    async def _run() -> None:
        try:
            items = await _fetch_higraf_skills_uncached(visibility)
            _skills_cache[visibility] = {"items": items, "at": time.monotonic(), "refreshing": False}
            await _persist_higraf_skills(items)
        except Exception:
            logger.warning("[DeerFlow] background higraf refresh failed", exc_info=True)
            cached = _skills_cache.get(visibility)
            if isinstance(cached, dict):
                cached["refreshing"] = False

    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        entry["refreshing"] = False


async def _persist_higraf_skills(higraf_items: list[dict]) -> None:
    """Insert missing Higraf skills into SkillMeta so later lists are DB-only."""
    if not higraf_items:
        return
    from datetime import datetime

    from ..deps import get_db
    from ...datamodel.db import SkillMeta

    db_mgr = await get_db()
    resp = db_mgr.get(SkillMeta)
    existing = {row.slug for row in (resp.data or [])} if resp.status else set()
    inserted = 0
    for h in higraf_items:
        slug = h.get("skillId") or h.get("id") or ""
        if not slug or slug in existing:
            continue
        updated = None
        raw = h.get("updatedAt") or h.get("updated_at") or ""
        if raw:
            try:
                updated = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                updated = None
        db_mgr.upsert(SkillMeta(
            slug=slug,
            name=h.get("name") or h.get("skillName") or slug,
            description=h.get("description") or "",
            icon=h.get("emoji") or "package",
            version=h.get("version") or h.get("currentVersion") or "1.0.0",
            owner=h.get("authorName") or "系统预置",
            downloads=int(h.get("callCount") or 0),
            category=h.get("categoryL2") or None,
            updated_at=updated or datetime.now(),
        ))
        existing.add(slug)
        inserted += 1
    if inserted:
        logger.info("[DeerFlow] persisted %d Higraf skills into SkillMeta", inserted)


async def fetch_higraf_skill_detail(skill_id: str) -> dict | None:
    """Fetch a single Higraf skill by id."""
    access_token = await get_system_higraf_access_token()
    if not access_token:
        return None

    url = f"{_higraf_base_url()}/api/v1/skill-hub/by-id/{skill_id}"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(url, headers={"Cookie": f"access_token={access_token}"})
        resp.raise_for_status()
        body = resp.json()
    except Exception as exc:
        logger.warning(f"[DeerFlow] fetch_higraf_skill_detail failed skill_id={skill_id}: {type(exc).__name__}: {exc}")
        return None

    if isinstance(body, dict) and "detail" in body and "skillId" not in body and "id" not in body:
        return None
    data = body.get("data", body) if isinstance(body, dict) else body
    return data if isinstance(data, dict) else None


async def download_higraf_skill_bytes(skill_id: str) -> tuple[bytes | None, bool]:
    """Download a Higraf skill zip and return raw bytes + restricted flag.

    Returns (bytes, False) on success, (None, True) on 403, (None, False) on other errors.
    """
    access_token = await get_system_higraf_access_token()
    if not access_token:
        return None, False

    url = f"{_higraf_base_url()}/api/v1/skill-hub/by-id/{skill_id}/download"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(url, headers={"Cookie": f"access_token={access_token}"})
        resp.raise_for_status()
        return resp.content, False
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            logger.warning(f"[DeerFlow] download_higraf_skill_bytes restricted skill_id={skill_id}")
            return None, True
        logger.warning(f"[DeerFlow] download_higraf_skill_bytes failed skill_id={skill_id}: {type(exc).__name__}: {exc}")
        return None, False
    except Exception as exc:
        logger.warning(f"[DeerFlow] download_higraf_skill_bytes failed skill_id={skill_id}: {type(exc).__name__}: {exc}")
        return None, False


# ── 通用代理调用 ──────────────────────────────────────────────────────────────


async def _proxy_get(path: str, fastapi_request: Request) -> dict:
    """通用 GET 代理：将请求转发到 Higraf，用 Cookie 中的 access_token 鉴权，透传 query params。"""
    access_token = fastapi_request.cookies.get(HIGRAF_ACCESS_TOKEN_COOKIE)
    if not access_token:
        access_token = fastapi_request.headers.get("X-Access-Token")

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token",
        )

    url = f"{_higraf_base_url()}{path}"
    params = dict(fastapi_request.query_params)
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"Cookie": f"access_token={access_token}"},
            )
        logger.info(f"[DeerFlow] GET {path} -> status={resp.status_code}")
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(f"[DeerFlow] HTTP error {path}: status={exc.response.status_code} body={exc.response.text[:500]}")
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"Higraf request failed: {exc.response.status_code}",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Higraf request timed out",
        )
    except Exception as exc:
        logger.exception(f"[DeerFlow] unexpected error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Higraf request failed",
        )


# ── 1.2 查询当前用户信息 ──────────────────────────────────────────────────────


@router.get(
    "/auth/me",
    summary="查询当前用户信息",
    description="通过 Cookie 中的 access_token 查询 Higraf 当前用户信息。",
)
async def auth_me(fastapi_request: Request) -> dict:
    """GET /agent/api/v1/auth/me — 返回当前用户信息。"""
    body = await _proxy_get("/agent/api/v1/auth/me", fastapi_request)
    return {
        "status": True,
        "data": body,
    }


# ── 11 技能列表 ───────────────────────────────────────────────────────────────


@router.get(
    "/skill-hub/list",
    summary="查询技能列表",
    description="代理 Higraf 技能列表接口，支持 visibility、categoryL2、kind、search、academicGroupId 等筛选。",
)
async def skill_hub_list(fastapi_request: Request) -> dict:
    """GET /agent/api/v1/skill-hub/list — 代理查询公开/组内技能。

    支持的 query 参数（透传）：
      - visibility: public | group
      - academicGroupId: 学术组 ID（visibility=group 时必填）
      - categoryL2: 二级分类
      - kind: 技能类型（user 等）
      - search: 搜索关键词
    """
    # 优先使用用户 cookie 中的 token，没有时退回到系统级 token
    access_token = fastapi_request.cookies.get(HIGRAF_ACCESS_TOKEN_COOKIE)
    if not access_token:
        access_token = fastapi_request.headers.get("X-Access-Token")
    if not access_token:
        access_token = await get_system_higraf_access_token()

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token",
        )

    url = f"{_higraf_base_url()}/agent/api/v1/skill-hub/list"
    params = dict(fastapi_request.query_params)
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"Cookie": f"access_token={access_token}"},
            )
        logger.info(f"[DeerFlow] GET /agent/api/v1/skill-hub/list -> status={resp.status_code}")
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(f"[DeerFlow] skill-hub/list HTTP error: status={exc.response.status_code} body={exc.response.text[:500]}")
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"Higraf request failed: {exc.response.status_code}",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Higraf request timed out",
        )
    except Exception as exc:
        logger.exception(f"[DeerFlow] skill-hub/list unexpected error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Higraf request failed",
        )

    return {
        "status": True,
        "data": body,
    }


# ── 技能下载 ──────────────────────────────────────────────────────────────────


async def _proxy_download(path: str, fastapi_request: Request) -> StreamingResponse:
    """流式代理下载：转发 GET 请求，返回二进制流。"""
    access_token = fastapi_request.cookies.get(HIGRAF_ACCESS_TOKEN_COOKIE)
    if not access_token:
        access_token = fastapi_request.headers.get("X-Access-Token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")

    url = f"{_higraf_base_url()}{path}"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        req = client.build_request("GET", url, headers={"Cookie": f"access_token={access_token}"})
        resp = await client.send(req, stream=True)
        if resp.status_code != 200:
            body = await resp.aread()
            logger.error(f"[DeerFlow] download error {path}: status={resp.status_code} body={body[:500]}")
            raise HTTPException(status_code=resp.status_code, detail="Download failed")

        content_disposition = resp.headers.get("content-disposition", "")
        content_type = resp.headers.get("content-type", "application/octet-stream")

        async def stream():
            async for chunk in resp.aiter_bytes():
                yield chunk

        return StreamingResponse(
            stream(),
            media_type=content_type,
            headers={"Content-Disposition": content_disposition} if content_disposition else {},
        )


@router.get(
    "/skill-hub/by-id/{skill_id}/download",
    summary="下载技能包",
    description="根据 skill_id 下载技能 zip 包，流式透传。",
)
async def skill_hub_download(skill_id: str, fastapi_request: Request):
    """GET /api/v1/skill-hub/by-id/{skill_id}/download — 流式下载技能 zip 包。"""
    return await _proxy_download(f"/api/v1/skill-hub/by-id/{skill_id}/download", fastapi_request)