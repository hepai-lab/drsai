# api/routes/local_login.py
from typing import Dict
from fastapi import APIRouter, Depends, HTTPException
import hashlib

from ...datamodel.db import Userinfo
from ..deps import get_db
from ...datamodel.db import UserAgents, AgentModeSettings

from .....agent_factory.agent_mode_cofigs import (
    get_default_agent_mode_config)

router = APIRouter()


def hash_password(password: str) -> str:
    """使用SHA256哈希密码"""
    return hashlib.sha256(password.encode()).hexdigest()


@router.post("/")
async def create_new_user(user_id: str, password: str, db=Depends(get_db)) -> Dict:
    '''
    创建新用户
    '''
    try:
        # 检查用户是否已存在
        response = db.get(Userinfo, filters={"user_id": user_id})
        if response.status and response.data:
            raise HTTPException(status_code=400, detail="User already exists")

        # 创建新用户，密码进行哈希加密
        hashed_password = hash_password(password)
        new_user = Userinfo(user_id=user_id, password=hashed_password)
        result = db.upsert(new_user)

        if not result.status:
            raise HTTPException(status_code=500, detail="Failed to create user")

        return {"status": True, "message": "User created successfully", "data": {"user_id": user_id}}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/")
async def update_user_info(user_id: str, old_password: str, new_password: str, db=Depends(get_db)) -> Dict:
    '''
    TODO: 更新用户密码
    '''
    try:
        # response = db.get(AgentModeSettings, filters={"user_id": user_id}, return_json = False)
        # if not response.status or not response.data:
        #     raise HTTPException(status_code=404, detail="User's AgentModeSettings not found")
        # AgentsMode: AgentModeSettings = response.data[0]
        # agent_mode_config["agent_mode_config"]["id"] = str(uuid.uuid4())
        # AgentsMode.agents_mode.append(agent_mode_config["agent_mode_config"])
        # response = db.upsert(AgentsMode)
        # if not response.status:
        #     raise HTTPException(status_code=500, detail="Failed to update AgentModeSettings")
        # return {"status": True, "data": response.data}
        return {"status": True, "data": {}}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.post('/login')
async def local_login(user_id: str, password: str, db=Depends(get_db)) -> Dict:
    '''
    用户登录
    '''
    try:
        # 查找用户
        response = db.get(Userinfo, filters={"user_id": user_id})
        if not response.status or not response.data:
            raise HTTPException(status_code=404, detail="User not found")

        user = response.data[0]

        # 验证密码
        user_id = str(user_id)
        password = str(password)
        hashed_password = hash_password(password)
        if user.password != hashed_password:
            raise HTTPException(status_code=401, detail="Invalid password")
        
        # 将默认的配置存储进入对应的数据库
        agents_list = get_default_agent_mode_config(user_id)
        db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
        db.upsert(UserAgents(user_id=user_id, agents=agents_list))
        return {"status": True, "message": "Login successful", "data": {"user_id": user_id}}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get('/logout')
async def local_logout(user_id: str, password: str, db=Depends(get_db)) -> Dict:
    '''
    TODO: 用户登出
    '''
    try:
        return {"status": True, "data": {}}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e