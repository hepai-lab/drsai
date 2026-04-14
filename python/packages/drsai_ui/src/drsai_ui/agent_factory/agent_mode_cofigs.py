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

def _builtin_drsai_general_enabled() -> bool:
    """
    Whether to inject the built-in "Dr.Sai General" agent into the agent list.

    By default it's enabled for backwards-compatibility. Downstream users who
    fork/use the source can disable it to avoid the frontend's hard-coded
    Dr.Sai General login-default preference.
    """
    return not _truthy_env(os.getenv("DRSUI_DISABLE_BUILTIN_DRSAI_GENERAL"))


def _mark_featured_and_default_agents(agents: List[Dict[str, Any]]) -> None:
    """
    Add UI-related flags to agent dicts.

    Environment overrides (optional):
    - DRSUI_FEATURED_AGENT_ID / _NAME / _OWNER: match rule for "featured" agent
    - DRSUI_DISABLE_BUILTIN_FEATURED: if true, disables built-in Dr.Sai General fallback
    - DRSUI_DISABLE_BUILTIN_DRSAI_GENERAL: if true, do not inject builtin Dr.Sai General
    """
    featured_id = os.getenv("DRSUI_FEATURED_AGENT_ID")
    featured_name = os.getenv("DRSUI_FEATURED_AGENT_NAME")
    featured_owner = os.getenv("DRSUI_FEATURED_AGENT_OWNER")
    disable_builtin = _truthy_env(os.getenv("DRSUI_DISABLE_BUILTIN_FEATURED"))

    # Built-in fallback (current official featured agent)
    builtin_name = "Dr.Sai General"
    builtin_owner = "xiongdb@ihep.ac.cn"

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

        if disable_builtin:
            return False
        return a_name == builtin_name and a_owner == builtin_owner.lower()

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



_BUILTIN_DRSAI_GENERAL_ID = "eab8c9e8-e5be-4bb2-9dd8-0fdc6938e357"


def _builtin_drsai_general_json_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "builtin_drsai_general.json"


def load_builtin_drsai_general_agent() -> Dict[str, Any]:
    """Canonical Dr.Sai General (ddf) row for DB / API; shipped as package data."""
    with open(_builtin_drsai_general_json_path(), encoding="utf-8") as f:
        return json.load(f)


def append_builtin_drsai_general_if_missing(agents_list: List[Dict[str, Any]]) -> None:
    if not _builtin_drsai_general_enabled():
        return
    if any(str(a.get("id")) == _BUILTIN_DRSAI_GENERAL_ID for a in agents_list):
        return
    agents_list.append(load_builtin_drsai_general_agent())


def ensure_user_agents_list_has_builtin(agents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return a copy of agents with builtin Dr.Sai General appended if absent (by id)."""
    out = list(agents or [])
    append_builtin_drsai_general_if_missing(out)
    return out


def get_agent_mode_config(
        user_id: str,
) -> list[dict[str, str]]:
    return [
      { 
            "id": "010022126sdfnjsdnqw",
            "mode": "magentic-one", 
            "name": "Dr.Sai WebSurfer",
            "description": "Dr.Sai网页浏览智能体，适用于自动操控网页、文件等任务。", 
            "config":{}, 
            "type": "default", 
            "examples": ["Search arXiv for the latest papers on computer use agents","检索arXiv上关于计算机使用智能体的最新进展",]
      },
      {
            "id": "121532415mlnmjhg",
            "mode": "besiii", 
            "name": "Dr.Sai BESIII", 
            "description": "BESIII实验专用智能体，专为高能物理实验优化", 
            "config":{}, 
            "type": "default", 
            "examples": [
                  "帮我测量psi(4260) -> pi+ pi- [J/psi -> mu+ mu-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（mumu）的不变质量。先规划后执行。",
                  "帮我测量Psip -> pi+ pi- [J/psi -> Lambda Lambdabar]过程在3.686GeV能量点上的截面,并且绘制Lambda的能量分布。先规划后执行。",
                  "帮我测量Jpsi to eta [phi -> K+ K-]过程在3.097 GeV能量点上的截面,并且绘制eta的动量分布。先规划后执行。",]
           
      },
    ]


def get_default_agent_mode_config(user_id: str) -> List[Dict[str, Any]]:
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
    append_builtin_drsai_general_if_missing(agents_list)
    return agents_list

async def get_agents_mode(user_id: str, db:DatabaseManager) -> Dict:
    '''
    获取侧边栏的 mode 配置
    '''
    from drsai_ui.agent_factory.org_agent_merge import merge_sidebar_agents_mode

    response = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not response.status or not response.data:
        # create a default agents_mode
        default_agents_mode = get_default_agent_mode_config(user_id=user_id)
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid.uuid4())
        settings = AgentModeSettings(user_id=user_id, agents_mode=default_agents_mode)
        db.upsert(settings)
    else:
        settings = response.data[0]

    merged = merge_sidebar_agents_mode(db, user_id, list(settings.agents_mode or []))
    payload = settings.model_dump(mode="json")
    payload["agents_mode"] = merged
    return {"status": True, "data": payload}
    

async def get_ddf_agents(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db: DatabaseManager = None) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    try:
        # Check cache first
        response = db.get(UserDDFAgents, filters={"user_id": user_id})
        
        agents_name_old = {}
        if response.status and response.data:
            user_ddf_agents: UserDDFAgents = response.data[0]
            agents_old = user_ddf_agents.agents or []
            agents_name_old = {agent["name"]: agent for agent in agents_old}
            if not is_refresh:
                # Check if cache is still valid (less than 2 hours old)
                if user_ddf_agents.updated_at:
                    time_diff = datetime.now() - user_ddf_agents.updated_at.replace(tzinfo=None)
                    if time_diff < timedelta(hours=2):
                        # Return cached data
                        return {"status": True, "data": agents_old}

        # Extract API key from Authorization header (Bearer format)
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Invalid authorization header format")
        
        apikey = authorization[7:]  # Remove "Bearer " prefix

        client = HepAI(
            api_key=apikey,
            base_url="https://aiapi.ihep.ac.cn/apiv2"
        )
        models = client.agents.list()
        
        agents = []
        for model in models.data:
            if model.id != "hepai/custom-model":
                try:
                    model = HRModel.connect(
                        name=model.id, 
                        api_key=apikey,
                        base_url="https://aiapi.ihep.ac.cn/apiv2",
                    )
                    # agent_info: dict|WorkerInfo = model.get_info()
                    agent_info: dict|WorkerInfo = await asyncio.wait_for(
                            asyncio.to_thread(
                                model.get_info
                            ),
                            timeout=5.0
                        )
                    if isinstance(agent_info, WorkerInfo):
                        pass
                        # agent_info = agent_info.to_dict()
                        # agent_info.update({"owner": agent_info["resource_info"][0]["owned_by"]})
                    else:
                        agent_info.update({"mode": "ddf"})
                        agent_info.update({"owner": agent_info["author"]})
                        if agent_info.get("name") in agents_name_old:
                            agent_info.update({"id": agents_name_old[agent_info.get("name")]["id"]})
                        else:
                            agent_info.update({"id": str(uuid.uuid4())})
                        agents.append(agent_info)
                except Exception as e:
                    pass
        
        # Update cache
        if response.status and response.data:
            # Update existing record
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
        # raise HTTPException(status_code=500, detail=str(e)) from e
        return {"status": True, "data": []}

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


async def get_user_agents(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db: DatabaseManager = None) -> Dict:
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
    agents_list.extend(get_default_agent_mode_config(user_id=user_id))

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
