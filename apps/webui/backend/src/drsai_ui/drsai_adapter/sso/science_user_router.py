# -*- coding: utf-8 -*-
"""
Science user authentication via CAS token validation.

Flow: external system embeds our app in an iframe and passes ?tokenId=xxx&user_source=science_user.
We validate tokenId against the CAS API; on success we issue a JWT and redirect to /auth.
"""

import os
from datetime import timedelta

import httpx
from fastapi import APIRouter, HTTPException, status
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
# CSNS user_agent 嵌入登录：从 URL 取 access_token，调此接口校验
CSNS_VERIFY_TOKEN_API = os.getenv(
    "USER_AGENT_VERIFY_API",
    "https://login.csns.ihep.ac.cn/api/validatetoken",
)
USER_AGENT_DEFAULT_NAME = "iPanda"
REQUEST_TIMEOUT = 10.0
user_agent_router = APIRouter()


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


def _csns_token_ok(body: dict) -> bool:
    """CSNS /api/validatetoken: { result, code: 200, stauts: "success" }."""
    code = body.get("code")
    if code not in (200, "200"):
        return False
    flag = body.get("stauts") or body.get("status") or body.get("success")
    if flag is None:
        return True
    if isinstance(flag, bool):
        return flag
    return str(flag).strip().lower() in {"success", "ok", "true", "1"}


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
    """Extract a user identifier from CSNS /api/validatetoken JSON."""
    if not isinstance(body, dict):
        return None
    if not _csns_token_ok(body):
        return None

    payload = body.get("result")
    if payload in (None, {}, []):
        payload = body.get("data")
    if payload in (None, {}, []):
        return None

    found = _pick_csns_user_id(payload, allow_bare_id=True)
    if found:
        return found
    return None


async def _complete_embed_login(user_id: str, user_source: str) -> JSONResponse:
    """Issue our JWT, persist user_source, and seed default agents."""
    access_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )

    from drsai_ui.ui_backend.backend.web.deps import get_db
    from drsai_ui.ui_backend.backend.datamodel.db import AgentModeSettings, UserAgents
    from drsai_ui.agent_factory.agent_mode_cofigs import get_default_agent_mode_config
    from drsai_ui.ui_backend.backend.web.auth_source import record_auth_source

    db = await get_db()
    record_auth_source(db, user_id, "sso", user_source=user_source)
    resp_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not resp_agent.status or not resp_agent.data:
        agents_list = get_default_agent_mode_config(user_id, user_source=user_source)
        db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
        db.upsert(UserAgents(user_id=user_id, agents=agents_list))

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
    """Validate access_token via CSNS /api/validatetoken and return the JSON body.

    GET https://login.csns.ihep.ac.cn/api/validatetoken?access_token=...
    Falls back to POST form if GET is not accepted.
    """
    logger.info(f"[CSNS] validating access_token via {CSNS_VERIFY_TOKEN_API}")
    token_params = {"access_token": access_token, "token": access_token}
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(
                CSNS_VERIFY_TOKEN_API,
                params=token_params,
            )
            if resp.status_code in (404, 405, 415):
                logger.info(
                    f"[CSNS] GET status={resp.status_code}, retrying POST form"
                )
                resp = await client.post(
                    CSNS_VERIFY_TOKEN_API,
                    data=token_params,
                )
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
async def user_agent_verify(access_token: str):
    """
    Validate a CSNS access_token from the embed URL and return our JWT.

    Query param: access_token
    Returns: { status, data: { access_token, user_id, agent_name } }
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="access_token is required",
        )

    body = await _fetch_csns_user(access_token)
    user_id = _extract_csns_user_id(body)
    if not user_id:
        logger.warning(f"[CSNS] could not extract user from validatetoken: {body}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_agent_auth_failed",
        )

    logger.info(f"user_agent authenticated via CSNS: {user_id}")
    return await _complete_embed_login(user_id, "user_agent")

