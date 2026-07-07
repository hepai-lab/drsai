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
REQUEST_TIMEOUT = 10.0


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

    access_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )

    # Lazy imports to avoid circular deps
    from drsai_ui.ui_backend.backend.web.deps import get_db
    from drsai_ui.ui_backend.backend.datamodel.db import AgentModeSettings, UserAgents
    from drsai_ui.agent_factory.agent_mode_cofigs import get_default_agent_mode_config
    from drsai_ui.ui_backend.backend.web.auth_source import record_auth_source

    db = await get_db()
    record_auth_source(db, user_id, "sso", user_source="science_user")
    resp_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not resp_agent.status or not resp_agent.data:
        agents_list = get_default_agent_mode_config(user_id, user_source="science_user")
        db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
        db.upsert(UserAgents(user_id=user_id, agents=agents_list))

    response = JSONResponse(
        content={
            "status": True,
            "data": {
                "user_id": user_id,
                "access_token": access_token.access_token,
            },
        }
    )

    from drsai_ui.ui_backend.backend.web.auth_cookies import set_refresh_cookie
    set_refresh_cookie(response, refresh_token.access_token)

    return response


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

    access_token_jwt = create_jwt_token(
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
    record_auth_source(db, user_id, "sso", user_source="science_user")
    resp_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not resp_agent.status or not resp_agent.data:
        agents_list = get_default_agent_mode_config(user_id, user_source="science_user")
        db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
        db.upsert(UserAgents(user_id=user_id, agents=agents_list))

    response = JSONResponse(
        content={
            "status": True,
            "data": {
                "user_id": user_id,
                "access_token": access_token_jwt.access_token,
            },
        }
    )

    from drsai_ui.ui_backend.backend.web.auth_cookies import set_refresh_cookie
    set_refresh_cookie(response, refresh_token.access_token)

    return response
