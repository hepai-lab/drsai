# api/routes/settings.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
import re

from ...datamodel import Settings
from ..deps import get_db

router = APIRouter()


@router.get("/")
async def get_settings(user_id: str, db=Depends(get_db)) -> Dict:
    try:
        response = db.get(Settings, filters={"user_id": user_id})
        if not response.status or not response.data:
            # create a default settings
            from .....drsai_adapter.singleton import personal_key_config_fetcher as fetcher

            config = fetcher.get_default_config(username=user_id)
            # config = {}
            default_settings = Settings(user_id=user_id, config=config)
            db.upsert(default_settings)
            response = db.get(Settings, filters={"user_id": user_id})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/")
async def update_settings(settings: Settings, db=Depends(get_db)) -> Dict:
    
    if settings.config:
        # 检查自动获取个人密钥的占位符并替换为实际的个人密钥
        model_configs = settings.config.get("model_configs", "")
        
        placeholder_pattern = r'\{\{AUTO_PERSONAL_KEY_FOR_DR_SAI\}\}'
        
        if re.search(placeholder_pattern, model_configs):
            try:
                from .....drsai_adapter.singleton import personal_key_config_fetcher as fetcher
                new_api_key = fetcher.get_personal_key(username=settings.user_id)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"Failed to fetch personal API-KEY for {settings.user_id}") from e
    
            new_model_configs = re.sub(placeholder_pattern, new_api_key, model_configs)
            settings.config["model_configs"] = new_model_configs
        
    
    response = db.upsert(settings)
    if not response.status:
        raise HTTPException(status_code=400, detail=response.message)
    return {"status": True, "data": response.data}
