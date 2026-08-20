# api/routes/settings.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException, status
import re

from ...datamodel import Settings
from ..deps import get_db
from .....drsai_adapter.sso.jwt import get_current_user_id
from ..auth_source import get_user_source

from .....drsai_adapter.singleton import personal_key_config_fetcher as fetcher

router = APIRouter()


@router.get("/")
async def get_settings(
    user_id: str,
    db=Depends(get_db),
    current_user: str = Depends(get_current_user_id),
) -> Dict:
    # 越权校验：当前登录用户只能访问自己的 settings
    if current_user != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    try:
        user_source = get_user_source(db, user_id)
        response = db.get(Settings, filters={"user_id": user_id})
        # science_user: always regenerate settings to ensure the shared API key
        if user_source == "science_user":
            config = fetcher.get_default_config(username=user_id, user_source=user_source)
            default_settings = Settings(user_id=user_id, config=config)
            db.upsert(default_settings)
            response = db.get(Settings, filters={"user_id": user_id})
        elif not response.status or not response.data:
            # create a default settings
            try:
                config = fetcher.get_default_config(username=user_id)
            except ValueError as e:
                # Non-SSO / unrecognized users may not have a default personal-key config.
                # This is an expected business case, so return a 4xx (not a 500).
                raise HTTPException(
                    status_code=404,
                    detail=f"settings not available for user_id={user_id} (user not found or not SSO user)",
                ) from e
            # config = {}
            default_settings = Settings(user_id=user_id, config=config)
            db.upsert(default_settings)
            response = db.get(Settings, filters={"user_id": user_id})
        settings = response.data[0]
        return {"status": True, "data": settings}
    
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/")
async def update_settings(
    settings: Settings,
    db=Depends(get_db),
    current_user: str = Depends(get_current_user_id),
) -> Dict:
    # 越权校验：当前登录用户只能更新自己的 settings
    if current_user != settings.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    
    if settings.config:
        user_source = get_user_source(db, settings.user_id)
        model_configs = settings.config.get("model_configs", "")
        
        placeholder_pattern = r'\{\{AUTO_PERSONAL_KEY_FOR_DR_SAI\}\}'
        
        if re.search(placeholder_pattern, model_configs):
            try:
                new_api_key = fetcher.get_personal_key(
                    username=settings.user_id, user_source=user_source
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"Failed to fetch personal API-KEY for {settings.user_id}") from e
    
            new_model_configs = re.sub(placeholder_pattern, new_api_key, model_configs)
            settings.config["model_configs"] = new_model_configs
        
    
    response = db.upsert(settings)
    if not response.status:
        raise HTTPException(status_code=400, detail=response.message)
    return {"status": True, "data": response.data}
