from drsai import DrSai
import os, sys
from pathlib import Path
here = Path(__file__).parent
from typing import Generator, Optional, Union, Dict, Any
from fastapi import FastAPI, Request, Header
from fastapi.responses import StreamingResponse # , HTMLResponse, FileResponse, JSONResponse, PlainTextResponse
from fastapi import FastAPI, HTTPException #, Form, File, UploadFile, Response
from fastapi import APIRouter # , Query
# from pydantic import BaseModel
import traceback
import inspect
from collections.abc import AsyncGenerator

try:
    from drsai.version import __version__
except:
    sys.path.append(str(here.parent.parent))
    from drsai.version import __version__

from loguru import logger
logger = logger.bind(name="app_worker.py")

class DrSaiAPP(DrSai):
    '''
    chat/completion:路由,直接处理聊天和自动回复请求。
    该路由接收前端页面的请求，并返回相应的回复。
    该路由的请求参数包括:
    - messages: 输入的消息列表

    OpenAI Assistants格式的标准接口的DrSai后端服务:
    该后端服务通过http请求或者hepai的openai assistants格式的标准接口api, 提供Dr.Sai多智能体后端服务。
    包括:
    1. Assistants-相关接口，包括创建、获取、删除、更新助手。用于对接前后端Agents设置和前端页面的交互。
    2. Threads-相关接口，包括创建、获取、删除、更新会话。用于对接前端页面的会话交互。
    3. Runs-相关接口，包括创建、获取、删除、更新运行。用于对接前端页面的运行交互。

    '''
    app = FastAPI(docs_url="/docs", redoc_url=None)
    router = APIRouter(prefix="/apiv2", tags=["openai_style_api"])
    
    def __init__(self, **kwargs):

        super(DrSaiAPP, self).__init__(**kwargs)

        self._init_router()
        self.app.include_router(DrSaiAPP.router)

        self._info = {}
        self._task_manager = None  # 由 run.py 在启动时注入 ScheduledTaskManager
    
    def _init_router(self):

        # 测试路由
        DrSaiAPP.router.get("/")(self.index)
        DrSaiAPP.router.get("/models")(self.list_models)

        # chat/completion路由
        DrSaiAPP.router.post("/chat/completions")(self.a_chat_completions)
        # TODO: 增加支持pause/resume/close会话的接口

        # agents/groupchat测试路由
        DrSaiAPP.router.get("/agents/get_info")(self.a_get_agents_info)
        DrSaiAPP.router.post("/agents/test_api")(self.a_agents_test_api)
        DrSaiAPP.router.get("/agents/list_agents")(self.a_list_agents)

        # 定时任务路由
        DrSaiAPP.router.post("/scheduled_tasks")(self.create_scheduled_task)
        DrSaiAPP.router.get("/scheduled_tasks")(self.list_scheduled_tasks)
        DrSaiAPP.router.delete("/scheduled_tasks/{task_id}")(self.delete_scheduled_task)
        DrSaiAPP.router.patch("/scheduled_tasks/{task_id}/toggle")(self.toggle_scheduled_task)
        DrSaiAPP.router.get("/scheduled_tasks/{task_id}/results")(self.get_task_results)



    #### --- 关于DrSai的路由 --- ####
    async def index(self, request: Request):
        return f"Hello, world! This is DrSai WebUI {__version__}"
    
    async def list_models(self, request: Request):

        agents_info = await self.get_agents_info()
        models_data = []
        for index, agent_info in enumerate(agents_info):
            agent_name = agent_info.get("name", "unknown")
            models_data.append({
                "id": agent_name,
                "object": "agent",
                "created": None,
                "owned_by": None
                })
        models = {
            "object": "list",
            "data": models_data
            }
        return models
    
    async def a_list_agents(self, request: Request):
        models_data = [{
                "id": self._info["name"],
                "object": "agent",
                "owner": self._info["author"],
                "description": self._info["description"],
                "version": self._info["version"],
                }]
        
        models = {
            "object": "list",
            "data": models_data
            }
        return models
    
    ### --- 关于chat_completions的路由 --- ###
    async def a_chat_completions(self, request: Request):

        headers = request.headers
        if not isinstance(headers, dict):
            headers = dict(headers)
        authorization = headers.get("authorization", None)
        if authorization:
            apikey = authorization.split(" ")[-1]
        else:
            apikey = None

        # apikey = headers.get("authorization").split(" ")[-1]
        params = await request.json()
        params.update({"apikey": apikey})
        if "messages" not in params or "model" not in params:
            raise HTTPException(status_code=400, detail="messages and model must be required, see https://platform.openai.com/docs/api-reference/chat")
        # return self.try_except_raise_http_exception(
        #     self.a_start_chat_completions, **params
        #     )
        return await self.try_except_raise_http_exception(
            self.a_start_chat_completions, **params
            )
    
     ### --- 关于agents/groupchat的测试路由 --- ###
    async def a_get_agents_info(self, request: Request) -> list[dict[str, Any]]:
        """
        获取agents/groupchat的相关信息
        """
        headers = request.headers
        if not isinstance(headers, dict):
            headers = dict(headers)
        authorization = headers.get("authorization", None)
        if authorization:
            apikey = authorization.split(" ")[-1]
        else:
            apikey = None
            
        if apikey != self.drsai_test_api_key:
            return {"error": "Invalid drsai_test_api_key"}
        
        return await self.try_except_raise_http_exception(
            self.get_agents_info,
        )

    async def a_agents_test_api(self, request: Request):
        """
        groupchat/agents的测试端口
        """
        headers = request.headers
        if not isinstance(headers, dict):
            headers = dict(headers)
        authorization = headers.get("authorization", None)
        if authorization:
            apikey = authorization.split(" ")[-1]
        else:
            apikey = None

        # apikey = headers.get("authorization").split(" ")[-1]
        params = await request.json()
        params.update({"apikey": apikey})
        if "messages" not in params or "model" not in params:
            raise HTTPException(status_code=400, detail="messages and model must be required, see https://platform.openai.com/docs/api-reference/chat")
        # return self.try_except_raise_http_exception(
        #     self.a_start_chat_completions, **params
        #     )
        return await self.try_except_raise_http_exception(
            self.test_agents, **params
            )

    ### --- 定时任务接口 --- ###

    def _get_task_manager(self):
        """获取 ScheduledTaskManager 实例 (由 run.py 在 server 启动前赋值)"""
        if self._task_manager is None:
            raise HTTPException(status_code=503, detail="ScheduledTaskManager not initialized")
        return self._task_manager

    async def create_scheduled_task(self, request: Request):
        """
        创建定时任务
        POST /apiv2/scheduled_tasks
        """
        try:
            from drsai.modules.agents.skills_agent.managers import (
                ScheduledTask, ScheduleType
            )
            body = await request.json()
            task = ScheduledTask(
                user_id=body["user_id"],
                session_id=body["session_id"],
                task_name=body["task_name"],
                task_description=body.get("task_description"),
                prompt=body["prompt"],
                schedule_type=ScheduleType(body["schedule_type"]),
                schedule_config=body["schedule_config"],
                max_retries=body.get("max_retries", 3),
                timeout=body.get("timeout", 300),
                save_history=body.get("save_history", True),
            )
            task_manager = self._get_task_manager()
            task_id = task_manager.add_task(task)
            return {"status": "ok", "task_id": task_id, "next_run": task.next_run}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    async def list_scheduled_tasks(self, request: Request, user_id: str, session_id: Optional[str] = None):
        """
        获取用户的定时任务列表
        GET /apiv2/scheduled_tasks?user_id=xxx&session_id=xxx
        """
        try:
            task_manager = self._get_task_manager()
            tasks = task_manager.list_tasks(user_id=user_id, session_id=session_id)
            return {"status": "ok", "tasks": [t.model_dump() for t in tasks]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def delete_scheduled_task(self, request: Request, task_id: str):
        """
        删除定时任务
        DELETE /apiv2/scheduled_tasks/{task_id}
        """
        try:
            task_manager = self._get_task_manager()
            success = task_manager.remove_task(task_id)
            if not success:
                raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
            return {"status": "ok", "task_id": task_id}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def toggle_scheduled_task(self, request: Request, task_id: str):
        """
        启用/禁用定时任务
        PATCH /apiv2/scheduled_tasks/{task_id}/toggle
        Body: {"enabled": true/false}
        """
        try:
            from drsai.modules.agents.skills_agent.managers import TaskStatus
            body = await request.json()
            enabled = body.get("enabled", True)
            task_manager = self._get_task_manager()
            task = task_manager.get_task(task_id)
            if task is None:
                raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
            new_status = TaskStatus.ENABLED if enabled else TaskStatus.DISABLED
            task_manager.update_task_status(task_id, new_status)
            return {"status": "ok", "task_id": task_id, "enabled": enabled}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def get_task_results(self, request: Request, task_id: str, limit: int = 10):
        """
        获取任务历史执行结果
        GET /apiv2/scheduled_tasks/{task_id}/results?limit=10
        """
        try:
            task_manager = self._get_task_manager()
            results = task_manager.get_task_results(task_id, limit=limit)
            return {"status": "ok", "task_id": task_id, "results": [r.model_dump() for r in results]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    ### --- 其它函数 --- ####
    async def try_except_raise_http_exception(self, func, *args, **kwargs):  # 改为异步函数
        """智能捕获函数内部raise的异常，转换为HTTPException返回，支持同步/异步函数"""
        try:
            # 判断是否是异步函数
            if inspect.iscoroutinefunction(func):
                res = await func(*args, **kwargs)  # 异步函数需要await
            else:
                res = func(*args, **kwargs)  # 同步函数直接调用

            # 处理同步/异步生成器
            if isinstance(res, (AsyncGenerator, Generator)):  # 同时检查两种生成器
                return StreamingResponse(res)
            return res
    
        except Exception as e:
            tb_str = traceback.format_exception(*sys.exc_info())
            tb_str = "".join(tb_str)
            logger.debug(f"Error: {e}.\nTraceback: {tb_str}")

            e_class = e.__class__.__name__
            error_mapping = {
                "ModuleNotFoundError": 404,
                "NotImplementedError": 501,
                "ValueError": 400,
                "TypeError": 400,
                "KeyError": 400,
                "AttributeError": 400,
                "HTTPException": 400,
                "AssertionError": 400,
                "PermissionError": 403,
                "FileNotFoundError": 404,
                "OSError": 500,
                "RuntimeError": 500,
                # 添加更多映射...
            }
            status_code = error_mapping.get(e_class, 400)
            raise HTTPException(
                status_code=status_code,
                detail=f'{e_class}("{str(e)}")'
            )
