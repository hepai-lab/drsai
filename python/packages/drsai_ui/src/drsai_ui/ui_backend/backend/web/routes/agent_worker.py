from typing import Dict
import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
# from openai import OpenAI
from hepai import HepAI
from hepai import HRModel
from hepai.components.haiddf.worker._related_class import WorkerInfo
from ...datamodel.db import UserAgents, UserDDFAgents


from ..deps import get_db

import uuid

router = APIRouter()


@router.get("/ddf_agents")
async def get_ddf_agents(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db=Depends(get_db)) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    try:
        # Check cache first
        response = db.get(UserDDFAgents, filters={"user_id": user_id})
        if response.status and response.data:
            user_ddf_agents: UserDDFAgents = response.data[0]
            if not is_refresh:
                # Check if cache is still valid (less than 2 hours old)
                if user_ddf_agents.updated_at:
                    time_diff = datetime.now() - user_ddf_agents.updated_at.replace(tzinfo=None)
                    if time_diff < timedelta(hours=2):
                        # Return cached data
                        return {"status": True, "data": user_ddf_agents.agents or []}

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

class RemoteAgentTestRequest(BaseModel):
    user_id: str
    base_url: str
    model_name: str
    api_key: str

@router.post("/remote_url/test")
async def test_remote_agent(
    request: RemoteAgentTestRequest) -> Dict:
    '''
    测试远程智能体连接并获取智能体信息
    '''
    try:
        agents = {}

        # 使用用户提供的远程 API key 连接远程智能体
        worker = HRModel.connect(
                name=request.model_name,
                api_key=request.api_key,
                base_url=request.base_url,
            )
        agent_info: dict = worker.get_info()

        # 安全地处理 owner 字段
        if "author" in agent_info:
            agent_info.update({"owner": agent_info["author"]})
        else:
            agent_info.update({"owner": "Unknown"})

        return {"status": True, "data": agent_info}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

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
        agent_id: str|None = saved_agent_config.get("id")
        if agent_id is None:
            saved_agent_config.update({"id": str(uuid.uuid4())})

        # 获取用户现有的远程智能体配置
        response = db.get(UserAgents, filters={"user_id": request.user_id})
        if response.status and response.data:
            # 用户已有配置，更新现有配置
            user_agents: UserAgents = response.data[0]
            agents_list = user_agents.agents or []
            for agent in agents_list:
                if agent["id"] == agent_id:
                    agents_list.remove(agent)
                    break
            agents_list.append(saved_agent_config)
            user_agents.agents = agents_list
            db.upsert(user_agents)
        else:
            # 用户没有配置，创建新配置
            agents_list = [saved_agent_config]
            user_agents = UserAgents(
                user_id=request.user_id,
                agents=agents_list
            )
            db.upsert(user_agents)

        return {"status": True, "message": "智能体配置保存/更新成功"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get("/remote_agent/list")
async def get_user_remote_agents(user_id: str, db=Depends(get_db)) -> Dict:
    '''
    获取用户保存的远程智能体列表
    '''
    try:
        response = db.get(UserAgents, filters={"user_id": user_id})

        if response.status and response.data:
            user_agents = response.data[0]
            return {"status": True, "data": user_agents.agents or {}}
        else:
            return {"status": True, "data": {}}

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
        response = db.get(UserAgents, filters={"user_id": request.user_id})

        if response.status and response.data:
            user_agents: UserAgents = response.data[0]
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