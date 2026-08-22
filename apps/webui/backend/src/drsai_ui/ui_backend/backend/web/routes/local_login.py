# api/routes/local_login.py
from typing import Dict
from datetime import timedelta
import re

from fastapi import APIRouter, Depends, HTTPException
import hashlib

from ...datamodel.db import Userinfo
from ...datamodel.db import UserRole
from ..deps import get_db
from ..auth_source import record_auth_source
from ...datamodel.db import UserAgents, AgentModeSettings

from .....agent_factory.agent_mode_cofigs import (
    get_agent_mode_config, 
    get_default_agent_mode_config,
    get_user_agents,
    get_agents_mode,
    )
from datetime import timedelta
from .....drsai_adapter.sso.jwt import create_jwt_token

router = APIRouter()


def hash_password(password: str) -> str:
    """使用SHA256哈希密码"""
    return hashlib.sha256(password.encode()).hexdigest()


def validate_password_strength(password: str, user_id: str) -> tuple[bool, str]:
    """
    校验密码强度。
    规则：
      - 长度 ≥ 12 位
      - 包含 ≥3 种：小写字母、大写字母、数字、特殊符号
      - 拒绝含 user_id 全拼或常见日期格式（YYYYMMDD、YYYY-MM-DD）
    返回 (is_valid, error_message)
    """
    if len(password) < 12:
        return False, "密码长度至少为12位"

    types = 0
    if re.search(r"[a-z]", password):
        types += 1
    if re.search(r"[A-Z]", password):
        types += 1
    if re.search(r"\d", password):
        types += 1
    if re.search(r"[^a-zA-Z\d]", password):
        types += 1
    if types < 3:
        return False, "密码需包含大小写字母、数字、特殊符号中至少3种"

    if user_id.lower() in password.lower():
        return False, "密码不能包含用户名全拼"

    if re.search(r"\d{4}-?\d{2}-?\d{2}", password):
        return False, "密码不能包含生日格式日期"

    return True, ""


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

        # 校验密码强度
        valid, error_msg = validate_password_strength(password, user_id)
        if not valid:
            raise HTTPException(status_code=400, detail=error_msg)

        # 创建新用户，密码进行哈希加密
        hashed_password = hash_password(password)
        new_user = Userinfo(
            user_id=user_id,
            password=hashed_password,
            meta={"auth_source": "local"},
        )
        result = db.upsert(new_user)

        if not result.status:
            raise HTTPException(status_code=500, detail="Failed to create user")

        # Bootstrap admin: if INITIAL_ADMIN_USER_ID matches, mark as admin.
        # If env not set, do NOT auto-promote.
        try:
            import os
            initial_admin = os.getenv("INITIAL_ADMIN_USER_ID")
            if initial_admin and initial_admin == user_id:
                roles = db.get(UserRole, filters={"user_id": user_id}, return_json=False)
                if roles.status and roles.data:
                    role: UserRole = roles.data[0]
                    role.is_admin = True
                    db.upsert(role)
                else:
                    db.upsert(UserRole(user_id=user_id, is_admin=True))
        except Exception:
            # If role bootstrap fails, user creation still succeeds.
            pass

        return {"status": True, "message": "User created successfully", "data": {"user_id": user_id}}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/")
async def update_user_info(user_id: str, old_password: str, new_password: str, db=Depends(get_db)) -> Dict:
    '''
    更新用户密码
    '''
    try:
        # 查找用户
        response = db.get(Userinfo, filters={"user_id": user_id})
        if not response.status or not response.data:
            raise HTTPException(status_code=404, detail="User not found")

        user = response.data[0]

        # 验证旧密码
        if user.password != hash_password(old_password):
            raise HTTPException(status_code=401, detail="Old password is incorrect")

        # 校验新密码强度
        valid, error_msg = validate_password_strength(new_password, user_id)
        if not valid:
            raise HTTPException(status_code=400, detail=error_msg)

        # 更新密码
        user.password = hash_password(new_password)
        result = db.upsert(user)
        if not result.status:
            raise HTTPException(status_code=500, detail="Failed to update password")

        return {"status": True, "data": {"user_id": user_id}}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.post('/login')
async def local_login(user_id: str, password: str, db=Depends(get_db)) -> Dict:
    '''
    用户登录
    '''
    try:
        # 统一错误提示，防止用户枚举
        AUTH_FAILED_DETAIL = "用户名或密码错误"

        # 查找用户
        response = db.get(Userinfo, filters={"user_id": user_id})
        if not response.status or not response.data:
            # 用户不存在时也做一次哈希，防止时间差攻击
            hash_password(password)
            raise HTTPException(status_code=401, detail=AUTH_FAILED_DETAIL)

        user = response.data[0]

        # 验证密码
        user_id = str(user_id)
        password = str(password)
        hashed_password = hash_password(password)
        if user.password != hashed_password:
            raise HTTPException(status_code=401, detail=AUTH_FAILED_DETAIL)

        record_auth_source(db, user_id, "local")

        response = db.get(AgentModeSettings, filters={"user_id": user_id})
        if not response.status or not response.data:
            # 将默认的配置存储进入对应的数据库
            agents_list = get_default_agent_mode_config(user_id)
            db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
            db.upsert(UserAgents(user_id=user_id, agents=agents_list))

        # Auto-provision GFS on login (silent failures — login succeeds either way).
        try:
            from .gfs_utils import ensure_gfs_provisioned
            await ensure_gfs_provisioned(db, user_id)
        except Exception as e:
            import logging as _logging
            _logging.getLogger(__name__).error(f"GFS auto-provision dispatch failed for {user_id}: {e}")

        # 本地登录开发用 —— token 十年有效，不做 refresh
        access_token = create_jwt_token(
            data={"sub": user_id},
            expires_delta=timedelta(days=3650),
        )
            
        return {
            "status": True,
            "message": "Login successful",
            "data": {
                "user_id": user_id,
                "access_token": access_token.access_token,
            },
        }

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