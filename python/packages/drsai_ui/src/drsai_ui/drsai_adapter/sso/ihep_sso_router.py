# -*- coding: utf-8 -*-
"""
Created on Wed Nov 20 08:24:18 2024

@author: pc
"""

import os
import secrets
from urllib.parse import urlencode
from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import FastAPI, Depends, Request, HTTPException, APIRouter, status
from starlette.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
import uvicorn
import httpx
import json
from .jwt import create_jwt_token, AccessToken, AccessTokenData
from datetime import timedelta

from  drsai_ui.ui_backend.backend.web.deps import get_db
from drsai_ui.ui_backend.backend.datamodel.db import AgentModeSettings, AgentModeConfig, UserAgents
from drsai_ui.agent_factory.agent_mode_cofigs import (
    get_agent_mode_config, 
    get_default_agent_mode_config,
    get_agents_mode
    )
from dataclasses import dataclass, field, asdict
# import gradio as gr
from dotenv import load_dotenv
load_dotenv()
from loguru import logger


ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30
SECONDS_OF_ONE_DAY = 24 * 60 * 60
logger = logger.bind(name="SSO")

@dataclass
class IhepSSOConfig:
    name: str = "ihepsso"
    client_id: str = field(default_factory=lambda: os.getenv("IHEP_SSO_APP_KEY"))
    client_secret: str = field(default_factory=lambda: os.getenv("IHEP_SSO_APP_SECRET"))
    redirect_uri: str = field(default_factory=lambda: os.getenv("IHEP_SSO_REDIRECT_URI"))

    authorize_url: str = field(default="https://login.ihep.ac.cn/oauth2/authorize", metadata={"description": "ihep oauth authorize_url"})
    access_token_url: str = field(default="https://login.ihep.ac.cn/oauth2/token", metadata={"description": "ihep oauth access_token_url"})
    theme: str = field(default="full", metadata={"description": "ihep oauth theme"})


    api_base_url: str = field(default=None, init=False)
    meddleware_secret: str = field(default=None, init=False)

    def __post_init__(self):
        SERVICE_MODE = os.getenv("SERVICE_MODE", None)
        if not self.client_id:
            if SERVICE_MODE == "PROD":
                raise ValueError("IHEP_SSO_APP_KEY is not set, please set it in .env file")
            else:
                self.client_id = "<enter your key here>"
            # logger.warning("IHEP_SSO_APP_KEY is not set, please set it in .env file if you want to use SSO")
        if not self.client_secret:
            if SERVICE_MODE == "PROD":
                raise ValueError("IHEP_SSO_APP_SECRET is not set, please set it in .env file")
            else:
                self.client_secret = "<enter your secret here>"
            # logger.warning("IHEP_SSO_APP_SECRET is not set, please set it in .env file if you want to use SSO")
        if not self.redirect_uri:
            if SERVICE_MODE == "PROD":
                raise ValueError("IHEP_SSO_REDIRECT_URI is not set, please set it in .env file")
            else:
                self.redirect_uri = "https://login.ihep.ac.cn/umt/callback"
            # logger.warning("IHEP_SSO_REDIRECT_URI is not set, please set it in .env file if you want to use SSO")

        self.api_base_url = self.redirect_uri.split("/umt")[0]
        self.meddleware_secret = self.get_middleware_secret()

    @classmethod
    def get_middleware_secret(cls):
        def _random_secret():
            import secrets
            return secrets.token_urlsafe(32)
        secreate = os.environ.get('SECRET_KEY') or _random_secret()
        return secreate
    

@dataclass
class UserInfo:
    username: str = field(default=None, metadata={"description": "用户姓名"})
    email: str = field(default=None, metadata={"description": "用户邮箱"})
    type: str = field(default=None, metadata={"description": "用户类型, inside"})
    umt_id: str = field(default=None, metadata={"description": "用户的统一认证ID"})

    def to_dict(self):
        return asdict(self)

## 配置OAuth2客户端 ## 
oauth = OAuth()
oauth_config = IhepSSOConfig()

oauth.register(
    name=oauth_config.name,
    client_id=oauth_config.client_id,
    client_secret=oauth_config.client_secret,
    access_token_url=oauth_config.access_token_url,
    authorize_url=oauth_config.authorize_url,
    # api_base_url=oauth_config.api_base_url,
    client_kwargs={
        "theme": oauth_config.theme,
        "redirect_uri": oauth_config.redirect_uri,
    },
)


router = APIRouter()

def _make_state() -> str:
    return secrets.token_urlsafe(32)

def get_user(request: Request):
    user = request.session.get('user')
    if user:
        return user
    return None

@router.get('/')
def index(user: dict = Depends(get_user)):
    if user:  # ④ 登录后，有用户信息，跳转到主界面
        return RedirectResponse(url='/')
    else: # 如果没有登录，跳转到统一认证登录页面
        return RedirectResponse(url='/sso-login')

@router.get('/logout')
async def logout(request: Request):
    # ⑥ 点击登出按钮，清除session的user
    request.session.pop('user', None)
    
    # TODO: 清除cookie中的token
    response = RedirectResponse(url='/')
    response.delete_cookie("refresh-token")  # 删除refresh token cookie
    response.delete_cookie("api-key")  # 删除api key cookie
    logger.info("User logged out successfully.")

    # return RedirectResponse(url='/')
    return response

@router.get('/callback')
async def auth(request: Request, db=Depends(get_db)):
    # ③ 统一认证回调
    code = request.query_params.get('code')
    if code is None:
        error = request.query_params.get('error_description')
        raise HTTPException(status_code=400, detail=f"Failed to fetch code, error: {error}")
    payload = { 
        "client_id": oauth_config.client_id,
        "client_secret": oauth_config.client_secret,
        "grant_type":"authorization_code",
        "redirect_uri": oauth_config.redirect_uri,
        "code":code
        }
    async with httpx.AsyncClient() as client:
            response = await client.post(
                oauth_config.access_token_url,
                data=payload
            )
    response.raise_for_status()
    jsonInfo = response.json()
    
    userdata = json.loads(jsonInfo.get("userInfo"))
    user = UserInfo(
        username=userdata["truename"].strip(),
        email=userdata['cstnetId'],
        type=userdata['type'],
        umt_id=userdata['umtId']
        )
    # print(f'SSO authed user: {user_info}')

    # request.session['user'] = user_info.to_dict()  # 把用户信息保存到session中
    
    logger.info(f'SSO authed user: {user}')
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_jwt_token(data={"sub": user.username}, expires_delta=access_token_expires)

    
    # redirect_url = f"{request.base_url}auth?token={access_token.access_token}&username={user.username}"
    redirect_url = f"{request.base_url}auth?token={access_token.access_token}&username={user.email}"
    # redirect_url = 'https://drsai.ihep.ac.cn/auth?token=xxx&username=xxx'
    response = RedirectResponse(url=redirect_url)

    refresh_token = create_jwt_token(
        data={"sub": user.username},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )

    response.set_cookie(
        key="refresh-token",
        value=refresh_token.access_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * SECONDS_OF_ONE_DAY,
        expires=REFRESH_TOKEN_EXPIRE_DAYS * SECONDS_OF_ONE_DAY,
    )
    
    response.set_cookie(
        key="api-key",
        value="sk-1234567890abcdef",  # 这里可以设置一个API密钥
        httponly=True,
    )

    # 更新用户的默认智能体配置
    user_id = userdata['cstnetId']
    response_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not response_agent.status or not response_agent.data:
        # 将默认的配置存储进入对应的数据库
        agents_list = get_default_agent_mode_config(user_id)
        db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
        db.upsert(UserAgents(user_id=user_id, agents=agents_list))

    return response
    # return RedirectResponse(url='/umt/')  # 回调首页，可以自己改回调页面

@router.get('/login')
async def login():
    """Initiate IHEP SSO login — redirects user to IHEP authorization page"""
    if not oauth_config.client_id or oauth_config.client_id == "<enter your key here>":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="IHEP SSO is not configured. Please set IHEP_SSO_APP_KEY and IHEP_SSO_APP_SECRET.",
        )

    params = {
        "client_id": oauth_config.client_id,
        "redirect_uri": oauth_config.redirect_uri,
        "response_type": "code",
        "state": _make_state(),
    }
    auth_url = f"{oauth_config.authorize_url}?{urlencode(params)}"
    return RedirectResponse(url=auth_url)



if __name__ == '__main__':
    ## 配置fastapi app ##
    app = FastAPI()
    app.add_middleware(SessionMiddleware, secret_key=oauth_config.meddleware_secret)
    app.include_router(router, prefix="/umt")
    uvicorn.run(app, host="0.0.0.0", port=7860) # 修改自己的ip地址和端口
