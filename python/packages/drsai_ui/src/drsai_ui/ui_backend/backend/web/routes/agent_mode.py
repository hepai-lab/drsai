# api/routes/settings.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException

from ...datamodel.db import AgentModeSettings, AgentModeConfig, UserAgents
from ..deps import get_db
from .....agent_factory.agent_mode_cofigs import (
    get_agent_mode_config, 
    get_default_agent_mode_config)

import uuid

router = APIRouter()


@router.get("/")
async def get_agents_mode(user_id: str, db=Depends(get_db)) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    try:
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
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/")
async def update_agents_mode(user_id: str, id: str, db=Depends(get_db)) -> Dict:
    '''
    插入用户新的 agent mode 配置
    '''
    try:
        response = db.get(UserAgents, filters={"user_id": user_id})
        if response.status and response.data:
            user_agents: UserAgents = response.data[0]
        else:
            raise HTTPException(status_code=500, detail="Failed to find user's agents")
        agents_list = user_agents.agents
        upsert_agent = None
        for agent in agents_list:
            if agent.get("id") == id:
                upsert_agent = agent
                break
        if not upsert_agent:
            raise HTTPException(status_code=500, detail="Failed to find agent")

        response = db.get(AgentModeSettings, filters={"user_id": user_id}, return_json = False)
        if not response.status or not response.data:
            raise HTTPException(status_code=404, detail="User's AgentModeSettings not found")
        AgentsMode: AgentModeSettings = response.data[0]
        AgentsMode.agents_mode.append(upsert_agent)
        response = db.upsert(AgentsMode)
        if not response.status:
            raise HTTPException(status_code=500, detail="Failed to update AgentModeSettings")
        return {"status": True, "data": response.data}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.delete("/")
async def delete_agents_mode(user_id: str, id: str, db=Depends(get_db)) -> Dict:
    try:
        response = db.get(AgentModeSettings, filters={"user_id": user_id}, return_json = False)
        if not response.status or not response.data:
            raise HTTPException(status_code=404, detail="User's AgentModeSettings not found")
        AgentsMode: AgentModeSettings = response.data[0]
        for i, agent_mode in enumerate(AgentsMode.agents_mode):
            if agent_mode.get("id") == id:
                AgentsMode.agents_mode.pop(i)
                break
        response = db.upsert(AgentsMode)
        if not response.status:
            raise HTTPException(status_code=500, detail="Failed to update AgentModeSettings")
        return {"status": True, "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get("/config")
async def get_agent_mode_config_route(user_id: str, mode: str, db=Depends(get_db)) -> Dict:
    '''
    获取用户的 agent mode 配置
    '''
    try:
        response = db.get(AgentModeConfig, filters={"user_id": user_id, "mode": mode})
        if not response.status or not response.data:
            # create a default settings
            default_settings = AgentModeConfig(user_id=user_id, mode=mode, config={})
            db.upsert(default_settings)
        response = db.get(AgentModeConfig, filters={"user_id": user_id, "mode": mode})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e