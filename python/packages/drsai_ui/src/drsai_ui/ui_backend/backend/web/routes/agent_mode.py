# api/routes/settings.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException

from ...datamodel.db import AgentModeSettings, AgentModeConfig
from ..deps import get_db
from .....agent_factory.agent_mode_cofigs import get_agent_mode_config

router = APIRouter()


@router.get("/")
async def get_agent_mode_settings(user_id: str, db=Depends(get_db)) -> Dict:
    try:
        response = db.get(AgentModeSettings, filters={"user_id": user_id})
        if not response.status or not response.data:
            # create a default settings
            config = get_agent_mode_config(user_id=user_id)
            # config = {}
            default_settings = AgentModeSettings(user_id=user_id, config=config)
            db.upsert(default_settings)
            response = db.get(AgentModeSettings, filters={"user_id": user_id})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.post("/")
async def update_agent_mode_settings(mode_config: AgentModeConfig, db=Depends(get_db)) -> Dict:
    try:
        default_settings = AgentModeConfig(
            user_id=mode_config.user_id, 
            mode=mode_config.mode,
            config=mode_config.config)
        db.upsert(default_settings)
        response = db.get(AgentModeConfig, filters={"user_id": mode_config.user_id, "mode": mode_config.mode})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get("/{mode}")
async def update_agent_mode_settings(mode: str, user_id: str, db=Depends(get_db)) -> Dict:
    try:
        response = db.get(AgentModeConfig, filters={"user_id": user_id, "mode": mode})
        if not response.status or not response.data:
            # create a default settings
            default_settings = AgentModeConfig(user_id=user_id, mode="besiii", config={})
            db.upsert(default_settings)
        response = db.get(AgentModeConfig, filters={"user_id": user_id, "mode": mode})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e