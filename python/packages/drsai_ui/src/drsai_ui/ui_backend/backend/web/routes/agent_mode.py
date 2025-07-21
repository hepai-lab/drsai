# api/routes/settings.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException

from ...datamodel.db import AgentModeSettings, AgentModeConfig
from ...datamodel.types import AgentModeSetting, Agent_mode
from ..deps import get_db
from .....agent_factory.agent_mode_cofigs import get_agent_mode_config

router = APIRouter()


@router.get("/")
async def get_agent_mode_settings(user_id: str, db=Depends(get_db)) -> Dict:
    try:
        response = db.get(AgentModeSettings, filters={"user_id": user_id})
        if not response.status or not response.data:
            # create a default settings
            config_dict = get_agent_mode_config(user_id=user_id)
            # Convert dict to AgentModeSetting, only use fields defined in Agent_mode
            agent_modes = []
            for mode in config_dict["agent_modes"]:
                # Only extract fields that are defined in Agent_mode
                mode_data = {
                    "mode": mode["mode"],
                    "name": mode["name"], 
                    "description": mode["description"]
                }
                agent_modes.append(Agent_mode(**mode_data))
            config = AgentModeSetting(agent_modes=agent_modes)
            default_settings = AgentModeSettings(user_id=user_id, config=config.model_dump())
            db.upsert(default_settings)
            response = db.get(AgentModeSettings, filters={"user_id": user_id})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.post("/")
async def update_agent_mode_settings(mode_config: dict, db=Depends(get_db)) -> Dict:
    try:
        default_settings = AgentModeConfig(
            user_id=mode_config.get("user_id"), 
            mode=mode_config.get("mode"),
            config=mode_config.get("config", {}))
        db.upsert(default_settings)
        response = db.get(AgentModeConfig, filters={"user_id": mode_config.get("user_id"), "mode": mode_config.get("mode")})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get("/config")
async def get_agent_mode_config_route(user_id: str, mode: str, db=Depends(get_db)) -> Dict:
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