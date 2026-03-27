from typing import Dict, List, Any  
import asyncio, os, json
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



def get_agent_mode_config(
        user_id: str,
) -> list[dict[str, str]]:
    return [
      { 
            "id": "010022126sdfnjsdnqw",
            "mode": "magentic-one", 
            "name": "Dr.Sai General", 
            "description": "Dr.Sai通用智能体，适用于多种任务", 
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
    if DEFAULT_REMOTE_AGENTS:
        with open(DEFAULT_REMOTE_AGENTS, 'r', encoding='utf-8') as f:
            default_agents = json.load(f)
            for agent in default_agents:
                if not agent.get("config"):
                    agent.update({"config": {
                        "name": agent.get("name"),
                        "url": agent.get("url"),
                        "apiKey": agent.get("apiKey"),
                        }})
                if not agent.get("id"):
                    agent.update({"id": str(uuid.uuid4())})
            agents_list.extend(default_agents)
    
    if not DEFAULT_REMOTE_AGENTS:
        default_agents_mode = get_agent_mode_config(user_id=user_id)
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid.uuid4())
        agents_list.extend(default_agents_mode) 
    return agents_list

async def get_agents_mode(user_id: str, db:DatabaseManager) -> Dict:
    '''
    获取侧边栏的 mode 配置
    '''
    
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
    return {"status": True, "data": settings}
    

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
