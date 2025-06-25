from .app_worker import DrSaiAPP

import os
from typing import Union
from fastapi import FastAPI
import uvicorn, asyncio
from autogen_agentchat.base import TaskResult
from autogen_agentchat.teams import BaseGroupChat
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.ui import Console
from pathlib import Path


here = Path(__file__).parent.resolve()

############################################
# Dr.Sai application
############################################

async def start_console(
        task: str,
        agent_factory: callable = None, 
        agent: AssistantAgent|BaseGroupChat = None, 
        **kwargs) -> Union[None, TaskResult]:
    """
    启动aotugen原生多智能体运行方式和多智能体逻辑
    args:
        task: str, 任务内容
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        agent: AssistantAgent|BaseGroupChat, 已创建的AssistantAgent/BaseGroupChat实例
        **kwargs: 其他参数
    """

    if agent is None:
        agent: AssistantAgent | BaseGroupChat = (
            await agent_factory() 
            if asyncio.iscoroutinefunction(agent_factory)
            else agent_factory()
        )

    stream = agent._model_client_stream if not isinstance(agent, BaseGroupChat) else agent._participants[0]._model_client_stream
    if stream:
        await Console(agent.run_stream(task=task))
        return 
    else:
        result:TaskResult = await agent.run(task=task)
        return result

async def run_console(agent_factory: callable, task: str, **kwargs) -> Union[None, TaskResult]:
    '''
    启动OpenAI-Style-API后端服务
    args:
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        task: str, 任务内容
        **kwargs: 其他参数
    '''

    result = await start_console(task=task, agent_factory=agent_factory, **kwargs)
    if result is not None:
        print(result)
        return result

async def run_backend(agent_factory: callable, **kwargs):
    '''
    启动OpenAI-Style-API后端服务
    args:
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        host: str = , "0.0.0.0" ,  # 后端服务host
        port: int = 42801,  # 后端服务port
        enable_openwebui_pipeline: bool = False,  # 是否启动openwebui pipelines
        pipelines_dir: str = None,  # openwebui pipelines目录
        history_mode: str = "backend",  # 历史消息的加载模式，可选值：backend、frontend 默认backend
        use_api_key_mode: str = "frontend",  # api key的使用模式，可选值：frontend、backend 默认frontend， 调试模式下建议设置为backend
    '''
    host: str =  kwargs.pop("host", "0.0.0.0")
    port: int =  kwargs.pop("port", 42801)
    os.environ['BACKEND_PORT'] = str(port)

    enable_pipeline: bool = kwargs.pop("enable_openwebui_pipeline", False)

    pipelines_dir = kwargs.pop("pipelines_dir", None)
    if pipelines_dir is not None:
        os.environ['PIPELINES_DIR'] = pipelines_dir
        pipelines_dir = os.getenv('PIPELINES_DIR')
        if not os.path.exists(pipelines_dir):
            print(f"PIPELINES_DIR {pipelines_dir} not exists!")
        else:
            print(f"Set PIPELINES_DIR to {pipelines_dir}")
    
    drsaiapp = DrSaiAPP(
        agent_factory = agent_factory,
        **kwargs
        )
    
    if enable_pipeline:
        from contextlib import asynccontextmanager
        # 通过Pipeline适配OpenWebUI
        from .owebui_pipeline.api import app as owebui_pipeline_app
        from .owebui_pipeline.api import lifespan as owebui_lifespan
        
        drsaiapp.app.mount("/pipelines", app=owebui_pipeline_app)
        main_lifespan = getattr(drsaiapp.app.router, "lifespan_context", None)

        # 创建组合生命周期上下文
        @asynccontextmanager
        async def combined_lifespan(app: FastAPI):
            # 执行主应用初始化（如果存在）
            if main_lifespan:
                async with main_lifespan(app):
                    # 执行子应用生命周期
                    async with owebui_lifespan(app):
                        yield
            else:
                # 仅执行子应用生命周期
                async with owebui_lifespan(app):
                    yield
        
        # 重写主应用生命周期
        drsaiapp.app.router.lifespan_context = combined_lifespan

    config = uvicorn.Config(
        app=drsaiapp.app,
        host=host,
        port=port,
        loop="asyncio"
    )
    server = uvicorn.Server(config)
    # 在现有事件循环中启动服务
    if enable_pipeline:
        print(f"Enable OpenWebUI pipelines: `http://{host}:{port}/pipelines` with API-KEY: `{owebui_pipeline_app.api_key}`")
    try:
        await server.serve()
    except asyncio.CancelledError:
        await server.shutdown()


