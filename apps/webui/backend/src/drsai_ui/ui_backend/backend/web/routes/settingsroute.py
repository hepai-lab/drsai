# api/routes/settings.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException, status
import re

from ...datamodel import Settings
from ..deps import get_db
from .....drsai_adapter.sso.jwt import get_current_user_id
from ..auth_source import get_user_source
from ..settings_store import (
    extract_model_api_key,
    replace_model_api_key,
    stored_key_is_shared_env_key,
    upsert_settings_by_user_id,
)

from .....drsai_adapter.singleton import personal_key_config_fetcher as fetcher
from .....drsai_adapter.personal_config_fetcher import uses_shared_api_key

router = APIRouter()


def _heal_shared_env_key(db, settings: Settings, user_id: str, user_source: str | None) -> Settings:
    """Replace a copied process HEPAI_API_KEY with this user's HepAI personal key."""
    if uses_shared_api_key(user_source):
        return settings
    config = settings.config if isinstance(settings.config, dict) else {}
    model_configs = config.get("model_configs") or ""
    if not stored_key_is_shared_env_key(model_configs):
        return settings
    old_key = extract_model_api_key(model_configs)
    if not old_key:
        return settings
    try:
        new_key = fetcher.get_personal_key(username=user_id, user_source=user_source)
    except (ValueError, RuntimeError):
        return settings
    if not new_key or new_key == old_key:
        return settings
    config = dict(config)
    config["model_configs"] = replace_model_api_key(model_configs, old_key, new_key)
    settings.config = config
    upsert_settings_by_user_id(db, settings)
    return settings


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
        # science_user / user_agent: always regenerate settings to ensure the shared API key
        if uses_shared_api_key(user_source):
            config = fetcher.get_default_config(username=user_id, user_source=user_source)
            default_settings = Settings(user_id=user_id, config=config)
            upsert_settings_by_user_id(db, default_settings)
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
            default_settings = Settings(user_id=user_id, config=config)
            upsert_settings_by_user_id(db, default_settings)
            response = db.get(Settings, filters={"user_id": user_id})
        settings = response.data[0]
        settings = _heal_shared_env_key(db, settings, user_id, user_source)
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
        
    
    response = upsert_settings_by_user_id(db, settings)
    if not response.status:
        raise HTTPException(status_code=400, detail=response.message)
    return {"status": True, "data": response.data}
