from typing import Dict, List, Any  
import asyncio, os, json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
# from openai import OpenAI
from hepai import HepAI
from hepai import HRModel
from hepai.components.haiddf.worker._related_class import WorkerInfo
from sqlmodel import Session as DBSession, select
from ...datamodel.db import UserAgents, UserRemoteAgents, UserDDFAgents, AgentModeSettings, UserAgentUsage
from ..deps import get_db
from drsai_ui.ui_backend.backend.database import DatabaseManager
import uuid
from dotenv import load_dotenv
load_dotenv()

from .....agent_factory.agent_mode_cofigs import (
    get_default_agent_mode_config,
    get_platform_agent_policy,
    get_user_agents,
)
from ..auth_source import get_user_source

from loguru import logger

router = APIRouter()

ANALYTICS_TZ = ZoneInfo("Asia/Shanghai")


def _beijing_day_key(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ANALYTICS_TZ).strftime("%Y-%m-%d")


def _bump_daily_use(row: UserAgentUsage, now: datetime) -> None:
    day_key = _beijing_day_key(now)
    if getattr(row, "today_use_day", None) == day_key:
        row.today_use_count = (row.today_use_count or 0) + 1
    else:
        row.today_use_day = day_key
        row.today_use_count = 1


def _agent_entry_display_name(entry: dict) -> str:
    """Resolve display name from a stored agent dict (top-level or config.name)."""
    if not entry:
        return ""
    n = entry.get("name")
    if n is not None and str(n).strip():
        return str(n).strip()
    cfg = entry.get("config") or {}
    n2 = cfg.get("name")
    return str(n2).strip() if n2 is not None else ""


def _remote_agent_url(entry: dict) -> str:
    """Resolve remote agent base URL from top-level or config fields."""
    cfg = entry.get("config") if isinstance(entry.get("config"), dict) else {}
    for key in ("url", "base_url"):
        for source in (entry, cfg):
            value = source.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    return ""


def _validate_saved_agent_config(saved_agent_config: dict) -> str:
    """Validate save payload; return normalized mode or raise HTTP 400."""
    mode_lc = str(saved_agent_config.get("mode") or "").lower()
    if mode_lc not in ("remote", "custom"):
        raise HTTPException(
            status_code=400,
            detail="请指定智能体类型（mode 须为 remote 或 custom）。",
        )
    if mode_lc == "remote":
        if not _agent_entry_display_name(saved_agent_config):
            raise HTTPException(
                status_code=400,
                detail="请填写智能体名称后再保存远程连接。",
            )
        if not _remote_agent_url(saved_agent_config):
            raise HTTPException(
                status_code=400,
                detail="请填写远程智能体 URL 后再保存。",
            )
    else:
        if not _agent_entry_display_name(saved_agent_config):
            raise HTTPException(
                status_code=400,
                detail="请填写智能体名称后再保存自定义智能体。",
            )
        cfg = saved_agent_config.get("config")
        if not isinstance(cfg, dict):
            raise HTTPException(
                status_code=400,
                detail="自定义智能体缺少有效 config。",
            )
        if not isinstance(cfg.get("model_client"), dict):
            raise HTTPException(
                status_code=400,
                detail="自定义智能体缺少 model_client 配置。",
            )
    return mode_lc


def _same_agent_id(a: str, b: str) -> bool:
    return str(a or "").strip() == str(b or "").strip()


def _iter_agents_user_remote_rows(db: DatabaseManager, user_id: str) -> list[dict]:
    """All agent dicts from every userremoteagents row (some DBs have multiple rows per user)."""
    out: list[dict] = []
    remote_resp = db.get(UserRemoteAgents, filters={"user_id": user_id})
    if not (remote_resp.status and remote_resp.data):
        return out
    for row in remote_resp.data:
        agents = getattr(row, "agents", None) or (row.get("agents") if isinstance(row, dict) else None) or []
        out.extend(agents)
    return out


def _add_display_name_keys(
    agents: list,
    exclude_agent_id: str,
    keys: set[str],
) -> None:
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        aid = str(agent.get("id") or "")
        if exclude_agent_id and _same_agent_id(aid, exclude_agent_id):
            continue
        name = _agent_entry_display_name(agent)
        if name:
            keys.add(name.casefold())


def _existing_saved_agent_display_name_keys(
    db: DatabaseManager,
    user_id: str,
    exclude_agent_id: str,
) -> set[str]:
    """Display names used by defaults, DDF cache, and saved remote/custom agents (for save-time uniqueness)."""
    keys: set[str] = set()
    _add_display_name_keys(get_default_agent_mode_config(user_id), exclude_agent_id, keys)

    ddf_resp = db.get(UserDDFAgents, filters={"user_id": user_id})
    if ddf_resp.status and ddf_resp.data:
        for ddf_row in ddf_resp.data:
            _add_display_name_keys(ddf_row.agents or [], exclude_agent_id, keys)

    _add_display_name_keys(_iter_agents_user_remote_rows(db, user_id), exclude_agent_id, keys)

    return keys

# @router.get("/ddf_agents")
# async def get_ddf_agents(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db=Depends(get_db)) -> Dict:


class RemoteAgentTestRequest(BaseModel):
    user_id: str
    base_url: str
    model_name: str
    api_key: str

@router.post("/remote_agent/test")
async def test_remote_agent(
    request: RemoteAgentTestRequest) -> Dict:
    '''
    测试远程智能体连接并获取智能体信息
    '''
    try:
        # 使用用户提供的远程 API key 连接远程智能体
        worker = HRModel.connect(
                name=request.model_name,
                api_key=request.api_key,
                base_url=request.base_url,
            )
        # get_info() is sync and may hang on remote issues; enforce timeout
        try:
            agent_info: dict = await asyncio.wait_for(
                asyncio.to_thread(worker.get_info),
                timeout=float(os.getenv("DRSAI_REMOTE_AGENT_TEST_TIMEOUT", "12")),
            )
            logger.info(f"[test_remote_agent] model={request.model_name}, get_info keys: {list(agent_info.keys())}, announcements: {agent_info.get('announcements')}")
        except asyncio.TimeoutError as e:
            raise HTTPException(
                status_code=504,
                detail={
                    "code": 504,
                    "error_type": "timeout",
                    "detail": "Remote agent test timed out. Please retry or verify remote worker status/network.",
                },
            ) from e

        # 安全地处理 owner 字段
        if "author" in agent_info:
            agent_info.update({"owner": agent_info["author"]})
        else:
            agent_info.update({"owner": "Unknown"})

        return {"status": True, "data": agent_info}

    except Exception as e:
        msg = str(e)
        # Map common remote-worker errors to a gateway-style error code for frontend
        if "HAPIStatusError" in msg or "APITimeoutError" in msg or "worker_error" in msg:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": 503,
                    "error_type": "worker_error",
                    "detail": msg,
                },
            ) from e
        raise HTTPException(status_code=500, detail=msg) from e

class SaveRemoteAgentRequest(BaseModel):
    user_id: str
    agent_config: dict

@router.post("/remote_agent/save")
async def save_remote_agent(
    request: SaveRemoteAgentRequest,
    db=Depends(get_db)) -> Dict:
    '''
    保存用户的远程智能体配置
    '''
    try:
        saved_agent_config = request.agent_config
        if saved_agent_config.get("id") is None:
            saved_agent_config.update({"id": str(uuid.uuid4())})
        agent_id = str(saved_agent_config.get("id") or "")

        mode_lc = _validate_saved_agent_config(saved_agent_config)
        proposed = _agent_entry_display_name(saved_agent_config)
        taken = _existing_saved_agent_display_name_keys(db, request.user_id, agent_id)
        if proposed.casefold() in taken:
            raise HTTPException(
                status_code=409,
                detail="该名称与已有智能体重名，请更换名称后再保存。",
            )
        saved_agent_config["name"] = proposed
        cfg = saved_agent_config.get("config")
        if not isinstance(cfg, dict):
            cfg = {}
            saved_agent_config["config"] = cfg
        cfg["name"] = proposed
        if mode_lc == "remote":
            remote_url = _remote_agent_url(saved_agent_config)
            cfg["url"] = remote_url
            if not saved_agent_config.get("url"):
                saved_agent_config["url"] = remote_url

        # 获取用户现有的远程智能体配置
        response = db.get(UserRemoteAgents, filters={"user_id": request.user_id})
        if response.status and response.data:
            # 用户已有配置，更新现有配置
            user_agents: UserRemoteAgents = response.data[0]
            agents_list = user_agents.agents or []
            for agent in agents_list:
                if _same_agent_id(str(agent.get("id")), agent_id):
                    agents_list.remove(agent)
                    break
            agents_list.append(saved_agent_config)
            user_agents.agents = agents_list
            db.upsert(user_agents)
        else:
            # 用户没有配置，创建新配置
            agents_list = [saved_agent_config]
            user_agents = UserRemoteAgents(
                user_id=request.user_id,
                agents=agents_list
            )
            db.upsert(user_agents)

        return {"status": True, "message": "智能体配置保存/更新成功"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


class RemoveRemoteAgentRequest(BaseModel):
    user_id: str
    id: str

@router.delete("/remote_agent/remove")
async def remove_remote_agent(
    request: RemoveRemoteAgentRequest,
    db=Depends(get_db)) -> Dict:
    '''
    删除用户的远程智能体
    '''
    try:

        del_id = request.id

        # 获取用户的智能体数据
        response = db.get(UserRemoteAgents, filters={"user_id": request.user_id})

        if response.status and response.data:
            user_agents: UserRemoteAgents = response.data[0]
            agents_list = user_agents.agents or []

            # 检查智能体是否存在
            for agent in agents_list:
                if agent["id"] == del_id:
                    agents_list.remove(agent)
                    # 更新数据库
                    user_agents.agents = agents_list
                    update_response = db.upsert(user_agents)
                    if update_response.status:
                        return {"status": True, "message": f"Remote agent '{request.id}' removed successfully"}
                    else:
                        raise HTTPException(status_code=500, detail="Failed to update database")
                    
            else:
                raise HTTPException(status_code=404, detail=f"Remote agent '{request.id}' not found")
        else:
            raise HTTPException(status_code=404, detail="User agents not found")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    

@router.get("/user_agents/list")
async def get_user_agents_route(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db=Depends(get_db)) -> Dict:

    try:
        logger.info("[user_agents/list] Request: user_id=%s, is_refresh=%s", user_id, is_refresh)
        user_source = get_user_source(db, user_id)
        result = await get_user_agents(user_id, authorization, is_refresh, db, user_source=user_source)
        logger.info("[user_agents/list] Response: count=%d, agents=%s", 
                     len(result.get("data", [])), result.get("data"))
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    
@router.get("/user_agents/{agent_id}")
async def get_user_agent_by_id(user_id: str, agent_id: str, db=Depends(get_db)) -> Dict:
    try:
        response = db.get(UserAgents, filters={"user_id": user_id})
        if response.status and response.data:
            user_agents: UserAgents = response.data[0]
            agent = next((agent for agent in user_agents.agents if agent.get("id") == agent_id), None)
            if agent:
                return {"status": True, "data": agent}
            else:
                # raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
               return {"status": False, "message": "该智能体已经下线或更新，请删除图标，联系智能体开发者或者刷新后重新添加"}
        else:
            # raise HTTPException(status_code=404, detail="User agents not found")
            return {"status": False, "message": "该智能体已经下线或更新，请删除图标，联系智能体开发者或者刷新后重新添加"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/user_agent/save")
async def update_user_agent(
    request: SaveRemoteAgentRequest,
    db=Depends(get_db)) -> Dict:
    '''
    保存用户的远程智能体配置
    '''
    try:
        saved_agent_config = request.agent_config
        agent_id: str|None = saved_agent_config.get("id")
        if agent_id is None:
            raise HTTPException(status_code=500, detail="Please to provide agent id")
        updated_agent = None

        response = db.get(UserAgents, filters={"user_id": request.user_id})
        if response.status and response.data:
            # 用户已有配置，更新现有配置
            user_agents: UserAgents = response.data[0]
            agents_list = user_agents.agents or []
            for agent in agents_list:
                if agent["id"] == agent_id:
                    updated_agent = agent
                    agents_list.remove(agent)
                    updated_agent.update(saved_agent_config)
                    agents_list.append(updated_agent)
                    user_agents.agents = agents_list
                    db.upsert(user_agents)
                    break
        
        response = db.get(AgentModeSettings, filters={"user_id": request.user_id}, return_json = False)
        if response.status and response.data:
            # 用户已有配置，更新现有配置
            user_agents: AgentModeSettings = response.data[0]
            agents_list = user_agents.agents_mode or []
            for agent in agents_list:
                if agent["id"] == agent_id:
                    updated_agent = agent
                    agents_list.remove(agent)
                    updated_agent.update(saved_agent_config)
                    agents_list.append(updated_agent)
                    user_agents.agents_mode = agents_list
                    db.upsert(user_agents)
                    break

        return {"status": True, "message": "智能体配置保存/更新成功"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


class RecordAgentUsageRequest(BaseModel):
    user_id: str
    agent_id: str


@router.post("/user_agent/usage")
async def record_user_agent_usage(
    request: RecordAgentUsageRequest,
    db: DatabaseManager = Depends(get_db),
) -> Dict:
    """
    记录用户使用某个智能体（用于“最近使用/使用频次”）
    """
    try:
        now = datetime.now(timezone.utc)
        with DBSession(db.engine) as session:
            existing = session.exec(
                select(UserAgentUsage).where(
                    UserAgentUsage.user_id == request.user_id,
                    UserAgentUsage.agent_id == request.agent_id,
                )
            ).first()

            if existing:
                existing.last_used_at = now
                existing.use_count = (existing.use_count or 0) + 1
                _bump_daily_use(existing, now)
                existing.updated_at = now
                session.add(existing)
                session.commit()
                session.refresh(existing)
                return {"status": True, "data": existing.model_dump(mode="json")}

            day_key = _beijing_day_key(now)
            row = UserAgentUsage(
                user_id=request.user_id,
                agent_id=request.agent_id,
                last_used_at=now,
                use_count=1,
                today_use_day=day_key,
                today_use_count=1,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            return {"status": True, "data": row.model_dump(mode="json")}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/user_agent/recent")
async def get_recent_user_agents(
    user_id: str,
    limit: int = 6,
    db: DatabaseManager = Depends(get_db),
) -> Dict:
    """
    获取用户最近使用的智能体 id 列表（按 last_used_at 倒序）
    """
    try:
        safe_limit = max(1, min(int(limit), 50))
        with DBSession(db.engine) as session:
            rows = session.exec(
                select(UserAgentUsage)
                .where(UserAgentUsage.user_id == user_id)
                .order_by(UserAgentUsage.last_used_at.desc())
                .limit(safe_limit)
            ).all()
        return {
            "status": True,
            "data": [
                {
                    "agent_id": r.agent_id,
                    "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
                    "use_count": r.use_count,
                }
                for r in rows
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# User default agent preference (server-side, persisted in AgentModeSettings)
# ---------------------------------------------------------------------------

class SetDefaultAgentRequest(BaseModel):
    user_id: str
    agent_id: str


def _resolve_default_agent_id(
    user_id: str,
    db: DatabaseManager,
    stored_default: str | None,
) -> str | None:
    """Resolve the effective default agent for a user.

    Policy (no hard-coded builtin):
    - If *stored_default* is set and still present in the user's agent list, use it.
    - Otherwise, prefer an agent flagged ``is_default`` in the user's list.
    - Otherwise, fall back to the first agent in the list.
    - If the list is empty, return ``None``.
    """
    resp = db.get(UserAgents, filters={"user_id": user_id})
    agents: list[dict] = []
    if resp.status and resp.data:
        agents = resp.data[0].agents or []

    available_ids = {str(a.get("id") or "") for a in agents}

    if stored_default and stored_default in available_ids:
        return stored_default

    if stored_default:
        logger.info(
            "User %s default agent %s not available, falling back",
            user_id, stored_default,
        )

    flagged = next(
        (a for a in agents if bool(a.get("is_default")) and a.get("id")),
        None,
    )
    if flagged:
        return str(flagged["id"])

    return agents[0]["id"] if agents else None


@router.get("/user_default_agent")
async def get_user_default_agent(user_id: str, db=Depends(get_db)) -> Dict:
    """Return the user's chosen default agent id (with availability fallback)."""
    try:
        resp = db.get(AgentModeSettings, filters={"user_id": user_id})
        stored = None
        if resp.status and resp.data:
            stored = getattr(resp.data[0], "default_agent_id", None)

        resolved = _resolve_default_agent_id(user_id, db, stored)
        user_source = get_user_source(db, user_id)
        return {
            "status": True,
            "data": {
                "default_agent_id": resolved,
                "stored_default_agent_id": stored,
                **get_platform_agent_policy(user_source=user_source),
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/user_default_agent")
async def set_user_default_agent(
    request: SetDefaultAgentRequest,
    db=Depends(get_db),
) -> Dict:
    """Persist the user's chosen default agent."""
    try:
        resp = db.get(AgentModeSettings, filters={"user_id": request.user_id})
        if resp.status and resp.data:
            settings: AgentModeSettings = resp.data[0]
            settings.default_agent_id = request.agent_id
            db.upsert(settings)
        else:
            default_agents = get_default_agent_mode_config(user_id=request.user_id)
            settings = AgentModeSettings(
                user_id=request.user_id,
                agents_mode=default_agents,
                default_agent_id=request.agent_id,
            )
            db.upsert(settings)

        return {"status": True, "message": "Default agent updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e