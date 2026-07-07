from typing import Dict, List, Any  
import asyncio, os, json
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
# from openai import OpenAI
from hepai import HepAI
from hepai import HRModel
from hepai.components.haiddf.worker._related_class import WorkerInfo
from drsai_ui.ui_backend.backend.datamodel.db import UserAgents, UserRemoteAgents, UserDDFAgents, AgentModeSettings
from drsai_ui.ui_backend.backend.database import DatabaseManager
import uuid
from dotenv import load_dotenv
load_dotenv()
import logging

logger = logging.getLogger(__name__)

def _truthy_env(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _int_env(name: str, default: int, min_value: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(min_value, value)


def _float_env(name: str, default: float, min_value: float = 0.1) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(min_value, value)


def get_platform_auto_load_default_agent() -> bool:
    """Whether brand-new users (no personal default / usage) auto-select a platform agent."""
    return _truthy_env(os.getenv("DRSUI_AUTO_LOAD_DEFAULT_AGENT"))


def get_platform_default_agent_name() -> str | None:
    """Agent display name to match in /user_agents/list when auto-load is enabled."""
    raw = os.getenv("DRSUI_DEFAULT_AGENT_NAME")
    if raw is None:
        return None
    name = raw.strip()
    return name or None


def get_science_default_agent_name() -> str | None:
    """Science user 专用默认智能体名称 — 无视 auto_load 开关，存在即生效。"""
    raw = os.getenv("DRSCIENCE_DEFAULT_AGENT_NAME")
    if raw is None:
        return None
    name = raw.strip()
    return name or None


def find_agent_by_name(agents: List[Dict[str, Any]], name: str | None) -> Dict[str, Any] | None:
    target = (name or "").strip()
    if not target:
        return None
    return next(
        (agent for agent in agents if str(agent.get("name") or "").strip() == target),
        None,
    )


def get_platform_agent_policy() -> Dict[str, Any]:
    return {
        "auto_load_default_agent": get_platform_auto_load_default_agent(),
        "default_agent_name": get_platform_default_agent_name(),
        "science_default_agent_name": get_science_default_agent_name(),
    }


def _resolve_platform_api_key(
    authorization: str | None,
    *,
    user_id: str | None = None,
    is_refresh: bool = False,
) -> str:
    """Prefer caller Bearer; on DDF refresh without Bearer use user's HepAI key; else admin env."""
    apikey = ""
    if authorization and authorization.startswith("Bearer "):
        apikey = authorization[7:].strip()
    if apikey:
        return apikey
    if is_refresh and user_id:
        try:
            from drsai_ui.drsai_adapter.singleton import (
                personal_key_config_fetcher as fetcher,
            )

            personal = fetcher.get_personal_key(username=user_id).strip()
            if personal:
                return personal
        except Exception as exc:
            logger.warning(
                "Failed to resolve personal HepAI API key for user %s: %s",
                user_id,
                exc,
            )
    for env_name in ("HEPAI_APP_ADMIN_API_KEY", "HEPAI_API_KEY"):
        candidate = (os.getenv(env_name) or "").strip()
        if candidate:
            return candidate
    return ""


def _mark_featured_and_default_agents(agents: List[Dict[str, Any]]) -> None:
    """
    Add UI-related flags to agent dicts.

    Only environment overrides control which agent gets marked "featured" —
    there is no hard-coded builtin fallback. If no env matches, no agent is
    auto-featured; use DEFAULT_REMOTE_AGENTS ordering / is_default to drive
    the default instead.

    Environment overrides (optional):
    - DRSUI_FEATURED_AGENT_ID / _NAME / _OWNER: match rule for "featured" agent
    """
    featured_id = os.getenv("DRSUI_FEATURED_AGENT_ID")
    featured_name = os.getenv("DRSUI_FEATURED_AGENT_NAME")
    featured_owner = os.getenv("DRSUI_FEATURED_AGENT_OWNER")

    def _match(agent: Dict[str, Any]) -> bool:
        a_id = str(agent.get("id") or "").strip()
        a_name = str(agent.get("name") or "").strip()
        a_owner = str(agent.get("owner") or "").strip().lower()

        if featured_id and a_id == featured_id.strip():
            return True
        if featured_name and a_name == featured_name.strip():
            if featured_owner:
                return a_owner == featured_owner.strip().lower()
            return True
        if featured_owner and a_owner == featured_owner.strip().lower():
            return True
        return False

    featured_agent_id: str | None = None
    for agent in agents:
        if _match(agent):
            agent["featured"] = True
            featured_agent_id = str(agent.get("id") or "").strip() or featured_agent_id
            break

    # Default agent selection:
    # - If caller already set `is_default`, keep it.
    # - Else, optionally fall back to featured (keeps legacy "one highlighted agent" behavior).
    # NOTE: We intentionally DO NOT read env like DRSUI_DEFAULT_AGENT_ID here; downstream
    # deployments should control default via DEFAULT_REMOTE_AGENTS ordering.
    if not any(bool(a.get("is_default")) for a in agents):
        target_default_id = (featured_agent_id or "").strip() or None
        if target_default_id:
            for agent in agents:
                if str(agent.get("id") or "").strip() == target_default_id:
                    agent["is_default"] = True
                    break



def get_agent_mode_config(
        user_id: str,
) -> list[dict[str, str]]:
    """
    Legacy built-in agent pack (General / WebSurfer / BESIII) is disabled.

    The catalog for /user_agents/list is built from:
    - DEFAULT_REMOTE_AGENTS JSON (if set), else nothing here;
    - platform DDF agents (get_ddf_agents);
    - user remote/custom agents.

    To ship a fixed starter list, use the DEFAULT_REMOTE_AGENTS file or register
    workers on the HepAI platform instead of hard-coding builtins.
    """
    return []


def get_default_agent_mode_config(
    user_id: str, user_source: str | None = None
) -> List[Dict[str, Any]]:
    """Return the default agent list for a user."""
    agents_list = []
    DEFAULT_REMOTE_AGENTS = os.getenv("DEFAULT_REMOTE_AGENTS", None)
    loaded_default_remote_agents = False
    if DEFAULT_REMOTE_AGENTS:
        try:
            p = Path(DEFAULT_REMOTE_AGENTS).expanduser()
            if p.is_file():
                with p.open("r", encoding="utf-8") as f:
                    default_agents = json.load(f)
                for agent in default_agents:
                    if not agent.get("config"):
                        agent.update(
                            {
                                "config": {
                                    "name": agent.get("name"),
                                    "url": agent.get("url"),
                                    "apiKey": agent.get("apiKey"),
                                }
                            }
                        )
                    if not agent.get("id"):
                        agent.update({"id": str(uuid.uuid4())})
                # First entry is treated as default (downstream-friendly).
                # If the config already has an explicit `is_default`, we keep it.
                if default_agents and not any(bool(a.get("is_default")) for a in default_agents):
                    default_agents[0]["is_default"] = True
                agents_list.extend(default_agents)
                loaded_default_remote_agents = True
            else:
                logger.warning(
                    "DEFAULT_REMOTE_AGENTS file not found: %s (fallback to builtin defaults)",
                    str(p),
                )
        except Exception:
            logger.exception(
                "Failed to load DEFAULT_REMOTE_AGENTS=%s (fallback to builtin defaults)",
                DEFAULT_REMOTE_AGENTS,
            )

    if not loaded_default_remote_agents:
        default_agents_mode = get_agent_mode_config(user_id=user_id)
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid.uuid4())
        agents_list.extend(default_agents_mode)
    return agents_list

async def get_agents_mode(
    user_id: str, db: DatabaseManager, user_source: str | None = None
) -> Dict:
    '''
    获取侧边栏的 mode 配置
    '''
    response = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not response.status or not response.data:
        # create a default agents_mode
        default_agents_mode = get_default_agent_mode_config(
            user_id=user_id, user_source=user_source
        )
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid.uuid4())
        settings = AgentModeSettings(user_id=user_id, agents_mode=default_agents_mode)
        db.upsert(settings)
    else:
        settings = response.data[0]

    stored = [dict(a) for a in (settings.agents_mode or []) if isinstance(a, dict)]
    by_id: Dict[str, Dict[str, Any]] = {}
    for agent in get_default_agent_mode_config(
        user_id=user_id, user_source=user_source
    ):
        if isinstance(agent, dict) and agent.get("id"):
            by_id[str(agent["id"])] = dict(agent)
    for agent in stored:
        if isinstance(agent, dict) and agent.get("id"):
            by_id[str(agent["id"])] = dict(agent)
    merged = list(by_id.values())
    _mark_featured_and_default_agents(merged)
    payload = settings.model_dump(mode="json")
    payload["agents_mode"] = merged
    return {"status": True, "data": payload}
    

async def get_ddf_agents(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db: DatabaseManager = None) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    user_ddf_agents: UserDDFAgents | None = None
    agents_old: List[Dict[str, Any]] = []
    try:
        # Check cache first
        response = db.get(UserDDFAgents, filters={"user_id": user_id})
        
        agents_name_old = {}
        if response.status and response.data:
            user_ddf_agents = response.data[0]
            agents_old = user_ddf_agents.agents or []
            agents_name_old = {agent["name"]: agent for agent in agents_old}
            if not is_refresh:
                # Check if cache is still valid (less than 2 hours old)
                if user_ddf_agents.updated_at:
                    time_diff = datetime.now() - user_ddf_agents.updated_at.replace(tzinfo=None)
                    if time_diff < timedelta(hours=2):
                        # Return cached data
                        return {"status": True, "data": agents_old}

        apikey = _resolve_platform_api_key(
            authorization, user_id=user_id, is_refresh=is_refresh
        )
        if not apikey:
            return {"status": True, "data": agents_old}

        client = HepAI(
            api_key=apikey,
            base_url="https://aiapi.ihep.ac.cn/apiv2"
        )
        models = client.agents.list()

        timeout_seconds = _float_env("DRSUI_DDF_AGENT_INFO_TIMEOUT", default=5.0, min_value=0.5)
        max_concurrency = _int_env("DRSUI_DDF_AGENT_INFO_MAX_CONCURRENCY", default=8, min_value=1)
        semaphore = asyncio.Semaphore(max_concurrency)

        async def _fetch_model_info(model_id: str) -> Dict[str, Any] | None:
            try:
                async with semaphore:
                    worker = HRModel.connect(
                        name=model_id,
                        api_key=apikey,
                        base_url="https://aiapi.ihep.ac.cn/apiv2",
                    )
                    agent_info: dict | WorkerInfo = await asyncio.wait_for(
                        asyncio.to_thread(worker.get_info),
                        timeout=timeout_seconds,
                    )
                if isinstance(agent_info, WorkerInfo):
                    return None
                logger.info(f"get_ddf_agents: worker.get_info() for '{model_id}' = {json.dumps(agent_info, ensure_ascii=False)}")
                agent_info.update({"mode": "ddf"})
                agent_info.update({"owner": agent_info.get("author")})
                if agent_info.get("name") in agents_name_old:
                    agent_info.update({"id": agents_name_old[agent_info.get("name")]["id"]})
                else:
                    agent_info.update({"id": str(uuid.uuid4())})
                return agent_info
            except Exception:
                return None

        model_ids = [model.id for model in models.data if model.id != "hepai/custom-model"]
        if model_ids:
            fetched_agents = await asyncio.gather(*(_fetch_model_info(model_id) for model_id in model_ids))
        else:
            fetched_agents = []
        agents = [agent for agent in fetched_agents if agent]

        # 保持用户体验：刷新失败时不要把已有列表变为空
        if not agents and agents_old:
            agents = agents_old
        
        # Update cache
        if response.status and response.data:
            # Update existing record
            if user_ddf_agents is not None and agents != agents_old:
                user_ddf_agents.agents = agents
                db.upsert(user_ddf_agents)
        else:
            # Create new record
            new_user_ddf_agents = UserDDFAgents(
                user_id=user_id,
                agents=agents
            )
            db.upsert(new_user_ddf_agents)
            
        return {"status": True, "data": agents}
    
    except Exception as e:
        logger.warning("Failed to refresh DDF agents for user %s: %s", user_id, str(e))
        return {"status": True, "data": agents_old}

async def get_user_remote_agents(user_id: str, db: DatabaseManager = None) -> Dict:
    '''
    获取用户保存的远程智能体列表
    '''
    try:
        agents_list = []
        # DEFAULT_REMOTE_AGENTS = os.getenv("DEFAULT_REMOTE_AGENTS", None)
        # if DEFAULT_REMOTE_AGENTS:
        #     with open(DEFAULT_REMOTE_AGENTS, 'r', encoding='utf-8') as f:
        #         default_agents =  json.load(f)
        #         agents_list.extend(default_agents)

        response = db.get(UserRemoteAgents, filters={"user_id": user_id})

        if response.status and response.data:
            user_agents = response.data[0]
            agents_list.extend(user_agents.agents or [])
            return {"status": True, "data":  agents_list}
        else:
            return {"status": True, "data": agents_list}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


async def get_user_agents(
    user_id: str,
    authorization: str = Header(...),
    is_refresh: bool = False,
    db: DatabaseManager = None,
    user_source: str | None = None,
) -> Dict:
    '''
    获取用户保存的智能体列表，统一的数据格式为agent_mode_config：
    {
        "mode": "remote/ddf/custom/besiii/mamagentic-one",
        "config":{
            "xxx": "xxx"
        },
        "xxx": "xxx"
    }
    
    前端拿到后请直接将该字段传入/ws/run_id的settings_config的agent_mode_config字段中，后端做解析
    
    包括:
    1. mode="remote"
        {
            "mode": "remote",
            "config":{
                "name": "智能后端启动的名称",
                "api_key": "访问后端智能体的API Key",
                "base_url": "访问后端智能体的URL"
            },
            "xxx": "描述/examples等其它参数"
        }

    2. mode="ddf"
        {
            "mode": "ddf",
            "config":{
                "name": "智能后端启动的名称",
                "api_key": "前端的API Key",
                "base_url": "https://aiapi.ihep.ac.cn/apiv2"
            },
            "xxx": "描述/example等其它参数"
        }

    3. mode="custom"，该数据结构应该是前端传入
        {
            "mode": "custom",
            "config": {
                "model_client": {
                    "base_url":"https://aiapi.ihep.ac.cn/apiv2",
                    "api_key":"hepai模式时默认为空，千万不要加空格",
                    "model": "hepai自动获取，其他用户填写"
                    },
                "ragflow_configs": {
                    "ragflow_url":"https://ragflow.ihep.ac.cn",
                    "ragflow_token":"ragflow-I1OWE2N2U0NTE5ODExZjA5NzgyMDI0Mm",
                    "dataset_ids":[ "注：根据用户选择获取对应ID", "***"]
                    },
                "mcp_sse_list": [
                        {
                            "url": "https://example.com/sse",
                            "token": "默认为None或者空"，
                            "headers": {"**","用户自定义的json字段，默认为{}"},
                            "timeout": 默认为20,
                            "sse_read_timeout":默认为300,
                            }
                    ]
        }
    '''
    
    agents_list = []
    # 获取默认的远程智能体
    agents_list.extend(
        get_default_agent_mode_config(user_id=user_id, user_source=user_source)
    )

    # 获取用户的DDF智能体
    agents = await get_ddf_agents(user_id = user_id, authorization = authorization, is_refresh = is_refresh, db=db)
    agents = agents["data"]
    for agent in agents:
        if not agent.get("config"):
            agent.update(
                {"config": {
                    "name": agent.get("name"),
                    "url": "https://aiapi.ihep.ac.cn/apiv2",
                }})
        if not agent.get("id"):
            agent.update({"id": str(uuid.uuid4())})
    agents_list.extend(agents)

    # 获取用户的remote/custom智能体
    agents = await get_user_remote_agents(user_id = user_id, db=db)
    agents = agents["data"]
    for agent in agents:
        if agent.get("mode")=="remote" and not agent.get("config"):
            agent.update(
                {"config": {
                    "name": agent.get("name"),
                    "url": agent.get("url"),
                }})
        if not agent.get("id"):
            agent.update({"id": str(uuid.uuid4())})
    agents_list.extend(agents)

    # Mark featured/default agent flags for UI consumption
    _mark_featured_and_default_agents(agents_list)

    # 刷新进入UserAgents
    response = db.get(UserAgents, filters={"user_id": user_id})
    if response.status and response.data:
        user_agents: UserAgents = response.data[0]
        user_agents.agents = agents_list
    else:
        user_agents = UserAgents(
            user_id=user_id,
            agents=agents_list
        )
    db.upsert(user_agents)
    return {"status": True, "data": agents_list}
