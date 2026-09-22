# -*- coding: utf-8 -*-
"""
Science user authentication via CAS token validation.

Flow: external system embeds our app in an iframe and passes ?tokenId=xxx&user_source=science_user.
We validate tokenId against the CAS API; on success we issue a JWT and redirect to /auth.

CSNS user_agent:
  Preferred: CSNS server POSTs /auth/user-agent/exchange with access_token.
  We POST CSNS /api/token/verify with token + fixed key, persist the user,
  return a one-time login_url. The user browser opens login_url; frontend
  POSTs /auth/user-agent/consume.

  Legacy (transition): ?user_source=user_agent&access_token=...&email=...
  Identity still comes from token/verify cstnetId; URL email must match if present.
"""

import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from loguru import logger

from .jwt import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_jwt_token,
)

router = APIRouter()
logger = logger.bind(name="ScienceUserAuth")

CAS_TOKEN_API = os.getenv(
    "SCIENCE_USER_TOKEN_API",
    "http://s01.lssf.cas.cn:8000/dzz-api/restApi_/api/queryAuthAccessTokenById",
)
# 统一认证 token 验证 API — 外部传入 access_token 后，后端调此接口验证并获取用户信息
IHEP_VERIFY_TOKEN_API = os.getenv(
    "SCIENCE_USER_VERIFY_API",
    "https://newlogin.ihep.ac.cn/api/validateAccessToken",
)
# CSNS user_agent 嵌入登录：POST token + 固定 key 校验
_DEFAULT_CSNS_VERIFY_TOKEN_API = "https://user.csns.ihep.ac.cn/api/token/verify"
_DEFAULT_CSNS_VERIFY_TOKEN_KEY = "3a4dec8389aa11e899fffa163e84aab7"
USER_AGENT_DEFAULT_NAME = "iPanda"
REQUEST_TIMEOUT = 10.0
user_agent_router = APIRouter()


def _csns_verify_api() -> str:
    return (
        os.getenv("USER_AGENT_VERIFY_API")
        or os.getenv("CSNS_VERIFY_TOKEN_API")
        or _DEFAULT_CSNS_VERIFY_TOKEN_API
    ).strip()


def _csns_verify_key() -> str:
    return (
        os.getenv("USER_AGENT_VERIFY_KEY")
        or os.getenv("CSNS_VERIFY_TOKEN_KEY")
        or _DEFAULT_CSNS_VERIFY_TOKEN_KEY
    ).strip()


def _csns_verify_form(access_token: str) -> dict[str, str]:
    """CSNS token/verify: application/x-www-form-urlencoded with token + key only."""
    form = {"token": access_token}
    key = _csns_verify_key()
    if key:
        form["key"] = key
    return form


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


async def _fetch_cas_user(token_id: str) -> dict:
    """Call the CAS API and return the user data dict, or raise HTTPException."""
    url = f"{CAS_TOKEN_API}?id={token_id}"
    logger.info(f"[CAS] requesting url={url}")
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(url)
        logger.info(f"[CAS] response status={resp.status_code} body={resp.text[:500]}")
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(f"[CAS] HTTP error tokenId={token_id}: status={exc.response.status_code} body={exc.response.text[:500]}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="science_user_auth_failed",
        )
    except Exception as exc:
        logger.exception(f"[CAS] request failed tokenId={token_id}: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="science_user_auth_failed",
        )

    if not body.get("success"):
        logger.info(f"[CAS] success=false for tokenId={token_id}, body={body}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="science_user_auth_failed",
        )

    # 响应结构：{ data: [ {data: "sql..."}, {data: [{EMAIL:...}], success:true} ] }
    # 用户信息在外层 data 列表中 success=true 且 data 为 list 的那一项里
    outer = body.get("data")
    if not isinstance(outer, list):
        logger.warning(f"[CAS] unexpected outer data type={type(outer)} for tokenId={token_id}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="science_user_auth_failed")

    user_dict = None
    for item in outer:
        if not isinstance(item, dict):
            continue
        inner = item.get("data")
        if isinstance(inner, list) and inner and isinstance(inner[0], dict) and "EMAIL" in inner[0]:
            user_dict = inner[0]
            break

    if user_dict is None:
        logger.warning(f"[CAS] could not locate user record in response for tokenId={token_id}: {outer}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="science_user_auth_failed")

    logger.info(f"[CAS] found user record: {user_dict}")
    return user_dict


_CSNS_EMAIL_KEYS = (
    "email",
    "EMAIL",
    "mail",
    "Mail",
    "cstnetId",
    "username",
    "userName",
    "loginName",
    "login",
    "account",
    "user_id",
    "userId",
    "sub",
)
_CSNS_ID_KEYS = ("umtId", "umt_id", "uid", "id")


_CSNS_OK_CODES = {200, "200", 0, "0"}


def _csns_token_ok(body: dict) -> bool:
    """CSNS token/verify (and legacy validatetoken): code 200/0 plus success flag."""
    if body.get("valid") is False or body.get("success") is False:
        return False
    code = body.get("code")
    if code is not None and code not in _CSNS_OK_CODES:
        if str(code).strip().lower() not in {"success", "ok", "true"}:
            return False
    flag = body.get("stauts") or body.get("status") or body.get("success") or body.get("valid")
    if flag is None:
        return True
    if isinstance(flag, bool):
        return flag
    if isinstance(flag, (int, float)):
        return flag in (200, 0, 1)
    return str(flag).strip().lower() in {"success", "ok", "true", "1", "200", "0"}


def _pick_csns_user_id(obj: object, *, depth: int = 0, allow_bare_id: bool = False) -> str | None:
    if depth > 5 or obj is None:
        return None
    if isinstance(obj, str) and obj.strip():
        return obj.strip().lower()
    if isinstance(obj, list):
        for item in obj[:20]:
            found = _pick_csns_user_id(item, depth=depth + 1, allow_bare_id=allow_bare_id)
            if found:
                return found
        return None
    if not isinstance(obj, dict):
        return None
    for key in _CSNS_EMAIL_KEYS:
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    for nested_key in ("user", "userInfo", "userinfo", "profile", "data", "result"):
        if nested_key in obj:
            found = _pick_csns_user_id(
                obj.get(nested_key), depth=depth + 1, allow_bare_id=False
            )
            if found:
                return found
    if allow_bare_id:
        for key in _CSNS_ID_KEYS:
            value = obj.get(key)
            if value is not None and str(value).strip() and key != "code":
                return str(value).strip().lower()
    return None


def _extract_csns_user_id(body: object) -> str | None:
    """Extract a user identifier from CSNS token/verify JSON."""
    if not isinstance(body, dict):
        return None
    if not _csns_token_ok(body):
        return None

    nested = True
    payload = body.get("result")
    if payload in (None, {}, []):
        payload = body.get("data")
    if payload in (None, {}, []):
        payload = body
        nested = False

    found = _pick_csns_user_id(payload, allow_bare_id=nested)
    if found:
        return found
    return None


def _normalize_embed_user(value: str | None) -> str | None:
    """Normalize CSNS embed identity from the URL (email / cstnetId / username)."""
    if not isinstance(value, str):
        return None
    user = value.strip().lower()
    return user or None


def _resolve_user_agent_id(body: object, email: str = "") -> str | None:
    """After CSNS token validation succeeds, pick the login user_id.

    Identity comes only from CSNS token/verify (`cstnetId`). If the caller
    also sent an email (legacy URL embed), it must match.
    """
    if not isinstance(body, dict) or not _csns_token_ok(body):
        return None
    user_id = _extract_csns_user_id(body)
    if not user_id:
        return None
    query_user = _normalize_embed_user(email)
    if query_user and query_user != user_id:
        logger.warning(
            f"[CSNS] URL email={query_user} does not match cstnetId={user_id}"
        )
        return None
    return user_id


async def _persist_embed_user(user_id: str, user_source: str) -> None:
    """Record SSO user_source and seed default agents if this is a first login.

    CSNS (``user_agent``) users need the full catalog (DDF + remotes) on first
    login so the post-login ``share_agent=true&agentName=iPanda`` redirect can
    match. Seeding only DEFAULT_REMOTE_AGENTS leaves DocMaster alone and breaks
    the iPanda default.
    """
    from drsai_ui.ui_backend.backend.web.deps import get_db
    from drsai_ui.ui_backend.backend.datamodel.db import AgentModeSettings
    from drsai_ui.agent_factory.agent_mode_cofigs import (
        find_agent_by_name,
        get_default_agent_mode_config,
        get_user_agent_default_agent_name,
        get_user_agents,
    )
    from drsai_ui.ui_backend.backend.web.auth_source import record_auth_source

    db = await get_db()
    record_auth_source(db, user_id, "sso", user_source=user_source)
    resp_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if resp_agent.status and resp_agent.data:
        return

    agents_list: list = []
    default_agent_id = None

    if user_source == "user_agent":
        try:
            result = await get_user_agents(
                user_id=user_id,
                authorization="",
                is_refresh=True,
                db=db,
                user_source=user_source,
            )
            agents_list = list(result.get("data") or [])
        except Exception:
            logger.exception(
                "[CSNS] Failed to refresh full agent catalog for %s; "
                "falling back to DEFAULT_REMOTE_AGENTS",
                user_id,
            )
            agents_list = get_default_agent_mode_config(
                user_id, user_source=user_source
            )

        target_name = get_user_agent_default_agent_name()
        matched = find_agent_by_name(agents_list, target_name)
        if matched and matched.get("id"):
            default_agent_id = str(matched["id"])
            for agent in agents_list:
                if isinstance(agent, dict):
                    agent["is_default"] = str(agent.get("id") or "") == default_agent_id
        else:
            logger.warning(
                "[CSNS] Default agent %r not in catalog for %s (count=%d)",
                target_name,
                user_id,
                len(agents_list),
            )
    else:
        agents_list = get_default_agent_mode_config(user_id, user_source=user_source)

    # Prefer empty agents_mode — live catalog is assembled on list; keep row as
    # first-login gate + default_agent_id store.
    db.upsert(
        AgentModeSettings(
            user_id=user_id,
            agents_mode=[],
            default_agent_id=default_agent_id,
        )
    )


async def _issue_embed_session(user_id: str, user_source: str) -> JSONResponse:
    """Issue our JWT + refresh cookie. Does not persist user records."""
    access_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )

    response = JSONResponse(
        content={
            "status": True,
            "data": {
                "user_id": user_id,
                "access_token": access_token.access_token,
                "agent_name": USER_AGENT_DEFAULT_NAME if user_source == "user_agent" else None,
            },
        }
    )

    from drsai_ui.ui_backend.backend.web.auth_cookies import set_refresh_cookie
    set_refresh_cookie(response, refresh_token.access_token)
    return response


async def _complete_embed_login(user_id: str, user_source: str) -> JSONResponse:
    """Persist user_source, seed default agents, and issue our JWT."""
    await _persist_embed_user(user_id, user_source)
    return await _issue_embed_session(user_id, user_source)


def _public_app_base(request: Request) -> str:
    configured = (
        os.getenv("DRSAI_PUBLIC_URL")
        or os.getenv("PUBLIC_APP_URL")
        or "https://drsaiv2.ihep.ac.cn"
    ).strip().rstrip("/")
    if configured:
        return configured
    proto = (
        request.headers.get("x-forwarded-proto")
        or request.url.scheme
        or "https"
    )
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or "drsaiv2.ihep.ac.cn"
    )
    return f"{proto}://{host}"


def _require_csns_exchange_secret(request: Request) -> None:
    secret = (
        os.getenv("CSNS_EXCHANGE_SECRET")
        or os.getenv("USER_AGENT_EXCHANGE_SECRET")
        or ""
    ).strip()
    if not secret:
        logger.warning(
            "[CSNS] CSNS_EXCHANGE_SECRET is unset; /exchange is unauthenticated"
        )
        return
    provided = ""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        provided = auth[7:].strip()
    if not provided:
        provided = (request.headers.get("x-csns-secret") or "").strip()
    if not provided or not hmac.compare_digest(provided, secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_agent_auth_failed",
        )


async def _read_exchange_access_token(request: Request, access_token: str) -> str:
    token = (access_token or "").strip()
    if token:
        return token
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        return str(form.get("access_token") or form.get("token") or "").strip()
    try:
        body = await request.json()
    except Exception:
        body = {}
    if isinstance(body, dict):
        return str(body.get("access_token") or body.get("token") or "").strip()
    return ""


def _ticket_ttl() -> int:
    raw = (os.getenv("USER_AGENT_TICKET_TTL_SECONDS") or "90").strip()
    try:
        ttl = int(raw)
    except ValueError:
        ttl = 90
    return ttl if ttl > 0 else 90


async def _create_login_ticket(user_id: str) -> tuple[str, int]:
    from drsai_ui.ui_backend.backend.web.deps import get_db
    from drsai_ui.ui_backend.backend.datamodel.db import UserAgentLoginTicket

    ttl = _ticket_ttl()
    ticket_value = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(seconds=ttl)
    db = await get_db()
    _cleanup_login_tickets(db)
    saved = db.upsert(
        UserAgentLoginTicket(
            ticket=ticket_value,
            user_id=user_id,
            expires_at=expires_at,
        )
    )
    if not saved.status:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="user_agent_auth_failed",
        )
    return ticket_value, ttl


def _cleanup_login_tickets(db) -> None:
    from sqlmodel import Session, select
    from drsai_ui.ui_backend.backend.datamodel.db import UserAgentLoginTicket

    cutoff = datetime.now(UTC) - timedelta(hours=1)
    try:
        with Session(db.engine) as session:
            rows = session.exec(
                select(UserAgentLoginTicket).where(
                    UserAgentLoginTicket.expires_at <= cutoff
                )
            ).all()
            for row in rows:
                session.delete(row)
            if rows:
                session.commit()
    except Exception as exc:
        logger.warning(f"[CSNS] ticket cleanup skipped: {type(exc).__name__}: {exc}")


async def _consume_login_ticket(ticket_value: str) -> str:
    from sqlmodel import Session, select
    from drsai_ui.ui_backend.backend.web.deps import get_db
    from drsai_ui.ui_backend.backend.datamodel.db import UserAgentLoginTicket

    ticket_value = (ticket_value or "").strip()
    if not ticket_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ticket is required",
        )

    db = await get_db()
    now = datetime.now(UTC)
    with Session(db.engine) as session:
        row = session.exec(
            select(UserAgentLoginTicket).where(
                UserAgentLoginTicket.ticket == ticket_value
            )
        ).first()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="user_agent_auth_failed",
            )
        expires_at = row.expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if row.used_at is not None or expires_at is None or now >= expires_at:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="user_agent_auth_failed",
            )
        user_id = (row.user_id or "").strip().lower()
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="user_agent_auth_failed",
            )
        row.used_at = now
        session.add(row)
        session.commit()
        return user_id


@router.post("/token")
async def science_user_token(token_id: str):
    """
    Validate a CAS tokenId and return a JWT access token.

    Query param: tokenId
    Returns: { status, data: { access_token, user_id } }
    """
    if not token_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tokenId is required",
        )

    user_dict = await _fetch_cas_user(token_id)

    email = user_dict.get("EMAIL") or user_dict.get("email")
    if not email:
        logger.warning(f"CAS user data missing EMAIL for tokenId={token_id}: {user_dict}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="science_user_auth_failed",
        )

    user_id = email.strip().lower()
    logger.info(f"Science user authenticated: {user_id} (tokenId={token_id})")
    return await _complete_embed_login(user_id, "science_user")


async def _fetch_ihep_user(username: str, access_token: str) -> dict:
    """通过 IHEP 统一认证 validateAccessToken 接口验证 access_token 并获取用户信息。

    POST https://newlogin.ihep.ac.cn/api/validateAccessToken
    参数: username (登录邮箱), accessToken (外部传入的 IHEP access_token)
    返回: { code, data: { valid, email, ... } }
    """
    logger.info(f"[IHEP] validating access_token via {IHEP_VERIFY_TOKEN_API}")
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(
                IHEP_VERIFY_TOKEN_API,
                data={"username": username, "accessToken": access_token},
            )
        logger.info(f"[IHEP] response status={resp.status_code} body={resp.text[:500]}")
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(f"[IHEP] HTTP error: status={exc.response.status_code} body={exc.response.text[:500]}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="science_user_auth_failed",
        )
    except Exception as exc:
        logger.exception(f"[IHEP] request failed: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="science_user_auth_failed",
        )

    if not isinstance(body, dict):
        logger.warning(f"[IHEP] unexpected response type={type(body)}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="science_user_auth_failed")

    logger.info(f"[IHEP] validateAccessToken response keys: {list(body.keys())}")
    return body


@router.post("/verify")
async def science_user_verify(access_token: str, username: str = ""):
    """
    Validate an IHEP unified-auth access_token + username and return our own JWT.

    Query params: access_token, username
    Returns: { status, data: { access_token, user_id } }
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="access_token is required",
        )
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="username is required",
        )

    user_dict = await _fetch_ihep_user(username=username, access_token=access_token)

    # 提取 data 字段（validateAccessToken 返回 { code, data: { valid, email, ... } }）
    data = user_dict.get("data", user_dict)

    # 检查 token 是否有效
    if not data.get("valid"):
        reason = data.get("reason", "unknown")
        logger.warning(f"[IHEP] token invalid: reason={reason}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="science_user_auth_failed",
        )

    # 从验证响应中提取 email
    email = (
        data.get("email")
        or data.get("username")
        or data.get("cstnetId")
        or data.get("sub")
    )
    if not email:
        logger.warning(f"[IHEP] userinfo missing email: {user_dict}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="science_user_auth_failed",
        )

    user_id = email.strip().lower()
    logger.info(f"Science user authenticated via IHEP: {user_id}")
    return await _complete_embed_login(user_id, "science_user")


async def _fetch_csns_user(access_token: str) -> dict:
    """Validate access_token via CSNS POST /api/token/verify and return the JSON body.

    POST https://user.csns.ihep.ac.cn/api/token/verify
    Content-Type: application/x-www-form-urlencoded
    body: token=...&key=...
    """
    api = _csns_verify_api()
    form = _csns_verify_form(access_token)
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    logger.info(
        f"[CSNS] validating access_token={_mask_secret(access_token)} "
        f"key={_mask_secret(form.get('key', ''))} via {api}"
    )
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(api, data=form, headers=headers)
        logger.info(f"[CSNS] response status={resp.status_code} body={resp.text[:500]}")
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            f"[CSNS] HTTP error: status={exc.response.status_code} body={exc.response.text[:500]}"
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="user_agent_auth_failed",
        )
    except Exception as exc:
        logger.exception(f"[CSNS] request failed: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="user_agent_auth_failed",
        )

    if not isinstance(body, dict):
        logger.warning(f"[CSNS] unexpected response type={type(body)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_agent_auth_failed",
        )
    return body


@user_agent_router.post("/verify")
async def user_agent_verify(access_token: str, email: str = ""):
    """
    Legacy browser embed: validate a CSNS access_token and return our JWT.

    Identity comes from token/verify `cstnetId`. Optional `email` must match.
    Prefer /exchange + /consume so the CSNS token never appears in the browser URL.
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="access_token is required",
        )

    body = await _fetch_csns_user(access_token)
    user_id = _resolve_user_agent_id(body, email=email)
    if not user_id:
        logger.warning(
            f"[CSNS] token ok={_csns_token_ok(body) if isinstance(body, dict) else False} "
            f"but no cstnetId (or email mismatch) in token/verify: {body}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_agent_auth_failed",
        )

    logger.info(f"user_agent authenticated via CSNS: {user_id}")
    return await _complete_embed_login(user_id, "user_agent")


@user_agent_router.post("/exchange")
async def user_agent_exchange(request: Request, access_token: str = Query("")):
    """CSNS server-to-server: validate access_token, persist user, return one-time login_url.

    Do not return our JWT here — the caller is CSNS's server, not the user browser.
    """
    _require_csns_exchange_secret(request)
    token = await _read_exchange_access_token(request, access_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="access_token is required",
        )

    body = await _fetch_csns_user(token)
    user_id = _resolve_user_agent_id(body)
    if not user_id:
        logger.warning(
            f"[CSNS] exchange token ok={_csns_token_ok(body) if isinstance(body, dict) else False} "
            f"but no cstnetId in token/verify: {body}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_agent_auth_failed",
        )

    await _persist_embed_user(user_id, "user_agent")
    ticket_value, ttl = await _create_login_ticket(user_id)
    login_url = (
        f"{_public_app_base(request)}/"
        f"?user_source=user_agent&ticket={ticket_value}"
    )
    logger.info(
        f"[CSNS] exchange ok user_id={user_id} ticket={_mask_secret(ticket_value)} ttl={ttl}s"
    )
    return JSONResponse(
        content={
            "status": True,
            "data": {
                "login_url": login_url,
                "expires_in": ttl,
                "user_id": user_id,
            },
        }
    )


@user_agent_router.post("/consume")
async def user_agent_consume(ticket: str = Query("")):
    """Browser: consume a one-time ticket and issue our JWT + refresh cookie."""
    user_id = await _consume_login_ticket(ticket)
    logger.info(f"[CSNS] consume ok user_id={user_id}")
    return await _issue_embed_session(user_id, "user_agent")

