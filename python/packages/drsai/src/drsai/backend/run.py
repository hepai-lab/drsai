from .app_worker import DrSaiAPP

import os
from typing import (
    Union, 
    List, 
    Dict, 
    Any,
    AsyncGenerator
    )
from dataclasses import dataclass, field
from fastapi import FastAPI
import uvicorn, asyncio
from autogen_agentchat.base import TaskResult
from autogen_agentchat.base import (
    ChatAgent, 
    Team)
from autogen_agentchat.ui import Console
from pathlib import Path

from hepai import HRModel, HModelConfig, HWorkerConfig, HWorkerAPP
import hepai

from drsai.modules.managers.database import DatabaseManager
from autogen_agentchat.base import (
    ChatAgent, 
    Team,)
from drsai.configs import CONST

from drsai.utils.utils import auto_worker_address

here = Path(__file__).parent.resolve()

############################################
# Dr.Sai application
############################################

async def start_console(
        task: str,
        agent_factory: callable = None, 
        agent: ChatAgent|Team = None, 
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
        agent: ChatAgent|Team = (
            await agent_factory() 
            if asyncio.iscoroutinefunction(agent_factory)
            else agent_factory()
        )

    stream = agent._model_client_stream if not isinstance(agent, Team) else agent._participants[0]._model_client_stream
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
        engine_uri: str = None,  # 数据库uri
        base_dir: str = None,  # 数据库目录
        auto_upgrade: bool = False,  # 是否自动升级数据库
        enable_openwebui_pipeline: bool = False,  # 是否启动openwebui pipelines
        agnet_name: str = "Dr.Sai",  # 智能体的名称
        pipelines_dir: str = None,  # openwebui pipelines目录
        history_mode: str = "backend",  # 历史消息的加载模式，可选值：backend、frontend 默认backend
        use_api_key_mode: str = "frontend",  # api key的使用模式，可选值：frontend、backend 默认frontend， 调试模式下建议设置为backend
    '''
    host: str =  kwargs.pop("host", "0.0.0.0")
    port: int =  kwargs.pop("port", 42801)
    engine_uri = kwargs.pop('engine_uri', None) or f"sqlite:///{CONST.FS_DIR}/drsai.db"
    base_dir = kwargs.pop('base_dir', None) or CONST.FS_DIR
    db_manager = DatabaseManager(
        engine_uri = engine_uri,
        base_dir = base_dir
    )
    auto_upgrade = kwargs.pop('auto_upgrade', False)
    init_response = db_manager.initialize_database(auto_upgrade=auto_upgrade)
    assert init_response.status, init_response.message
    kwargs.update({"db_manager": db_manager})

    enable_pipeline: bool = kwargs.pop("enable_openwebui_pipeline", False)
    drsaiapp = DrSaiAPP(
        agent_factory = agent_factory,
        **kwargs
        )
    if enable_pipeline:
        os.environ['BACKEND_PORT'] = str(port)
        agnet_name = kwargs.pop("agnet_name", "Dr.Sai")
        os.environ['AGNET_NAME'] = agnet_name
        pipelines_dir = kwargs.pop("pipelines_dir", None)
        if pipelines_dir is not None:
            os.environ['PIPELINES_DIR'] = pipelines_dir
            pipelines_dir = os.getenv('PIPELINES_DIR')
            if not os.path.exists(pipelines_dir):
                print(f"PIPELINES_DIR {pipelines_dir} not exists!")
            else:
                print(f"Set PIPELINES_DIR to {pipelines_dir}")

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
    finally:
        # 关闭数据库连接
        await db_manager.close()


@dataclass
class DrSaiModelConfig(HModelConfig):
    name: str = field(default="drsai/besiii", metadata={"help": "Model's name"})
    permission: Union[str, Dict] = field(default=None, metadata={"help": "Model's permission, separated by ;, e.g., 'groups: all; users: a, b; owner: c', will inherit from worker permissions if not setted"})
    version: str = field(default="2.0", metadata={"help": "Model's version"})
    
@dataclass
class DrSaiWorkerConfig(HWorkerConfig):
    host: str = field(default="0.0.0.0", metadata={"help": "Worker's address, enable to access from outside if set to `0.0.0.0`, otherwise only localhost can access"})
    port: int = field(default=42801, metadata={"help": "Worker's port, default is None, which means auto start from `auto_start_port`"})
    auto_start_port: int = field(default=42801, metadata={"help": "Worker's start port, only used when port is set to `auto`"})
    route_prefix: str = field(default="/apiv2", metadata={"help": "Route prefix for worker"})
    # controller_address: str = field(default="https://aiapi001.ihep.ac.cn", metadata={"help": "The address of controller"})
    controller_address: str = field(default="http://localhost:42601", metadata={"help": "The address of controller"})
    
    controller_prefix: str = field(default="/apiv2", metadata={"help": "Controller's route prefix"})
    no_register: bool = field(default=True, metadata={"help": "Do not register to controller"})
    

    permissions: str = field(default='groups: payg; users: admin, xiongdb@ihep.ac.cn, ddf_free; owner: xiongdb@ihep.ac.cn', metadata={"help": "Model's permissions, separated by ;, e.g., 'groups: default; users: a, b; owner: c'"})
    description: str = field(default='This is Dr.Sai multi agents system', metadata={"help": "Model's description"})
    author: str = field(default=None, metadata={"help": "Model's author"})
    daemon: bool = field(default=False, metadata={"help": "Run as daemon"})
    type: str = field(default="agent", metadata={"help": "Worker's type"})
    debug: bool = field(default=True, metadata={"help": "Debug mode"})
    _metadata: dict = field(default_factory=dict, metadata={"help": "Additional metadata for worker/model"})


class DrSaiWorkerModel(HRModel):  # Define a custom worker model inheriting from HRModel.
    def __init__(
            self, 
            config: DrSaiModelConfig,
            worker_config: DrSaiWorkerConfig,
            logo: str = "https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            drsaiapp: DrSaiAPP = None # 传入DrSaiAPP实例
            ):
        super().__init__(config=config)

        # if drsaiapp is not None and isinstance(drsaiapp, type):
        #     self.drsai = drsaiapp()  # Instantiate the DrSaiAPP instance.
        # else:
        #     self.drsai = drsaiapp or DrSaiAPP()  # Instantiate the DrSaiAPP instance.
        # pass
        self.drsai: DrSaiAPP = drsaiapp
        self._info = {
            "name": config.name, 
            "description": worker_config.description, 
            "version": config.version, 
            "author": worker_config.author, 
            "logo": logo,
            } 
        self.drsai._info = self._info

        
    @HRModel.remote_callable
    async def get_info(self) -> Dict[str, str]:
       return self._info
    
    @HRModel.remote_callable
    async def a_get_agents_info(self, chat_id: str) -> List[Dict[str, Any]]:
        agent: Team|ChatAgent = self.drsai.agent_instance.get(chat_id, None)
        return await self.drsai.get_agents_info(agent=agent)
    
    @HRModel.remote_callable
    async def lazy_init(self, chat_id: str, api_key: str, run_info: Dict[str, str]) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance.get(chat_id, None)
            if agent is None:
                agent = await self.drsai._create_agent_instance(api_key=api_key, thread_id=chat_id, user_id=run_info.get("email"),)
                self.drsai.agent_instance[chat_id] = agent
            message = await agent.lazy_init(api_key=api_key, thread_id=chat_id, run_info=run_info)
            return {"status": True, "message": message}
        except Exception as e:
            return {"status": False, "message": f"Lazy init error: {e}"}
    
    @HRModel.remote_callable
    async def pause(self, chat_id: str) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            message = await agent.pause()
            if message is None:
                message = ""
            return {"status": True, "message": message}
        except Exception as e:
            return {"status": False, "message": f"Pause error: {e}"}
    
    @HRModel.remote_callable
    async def pause_long_task(self, chat_id: str) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            if hasattr(agent, "long_task_pause"):
                await agent.long_task_pause()  # type: ignore
            return {"status": True, "message": ""}
        except Exception as e:
            return {"status": False, "message": f"Pause long task error: {e}"}
    
    @HRModel.remote_callable
    async def resume(self, chat_id: str) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            await agent.resume()
            return {"status": True, "message": ""}
        except Exception as e:
            return {"status": False, "message": f"Resume error: {e}"}
    
    @HRModel.remote_callable
    async def close(self, chat_id: str) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            await agent.close()
            self.drsai.agent_instance.pop(chat_id, None)
            return {"status": True, "message": ""}
        except Exception as e:
            return {"status": False, "message": f"Close error: {e}"}
        
    @HRModel.remote_callable
    async def save_state(self, chat_id: str) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            await agent.save_state()
            return {"status": True, "message": ""}
        except Exception as e:
            return {"status": False, "message": f"save_state error: {e}"}
    
    @HRModel.remote_callable
    async def load_state(self, chat_id: str) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            await agent.load_state()
            return {"status": True, "message": ""}
        except Exception as e:
            return {"status": False, "message": f"load_state error: {e}"}

    @HRModel.remote_callable
    async def a_chat_completions(self, *args, **kwargs) -> AsyncGenerator:
        return self.drsai.a_drsai_ui_completions(*args, **kwargs)
    
    @HRModel.remote_callable
    async def chat_completions(self, *args, **kwargs) -> AsyncGenerator:
        return self.drsai.a_start_chat_completions(*args, **kwargs)


async def run_worker(agent_factory: callable, **kwargs):
    '''
    启动HepAI-Worker-Style-API后端服务
    args:
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        agent_name: str = , "Dr.Sai" ,  # 智能体的名称
        description: str = , "Dr.Sai is a helpful assistant." ,  # 智能体的描述
        version: str = , "0.1.0" ,  # 智能体的版本
        logo: str = , "https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview" ,  # 智能体的logo
        host: str = , "0.0.0.0" ,  # 后端服务host
        port: int = 42801,  # 后端服务port
        no_register: bool = False,  # 是否注册到控制器
        controller_address: str = "https://aiapi.ihep.ac.cn",  # 控制器地址
        engine_uri: str = "sqlite:///~/drsai/drsai.db" # 智能体数据库地址
        base_dir: str = "~/drsai", # 数据库目录
        history_mode: str = "backend",  # 历史消息的加载模式，可选值：backend、frontend 默认backend
        use_api_key_mode: str = "frontend",  # api key的使用模式，可选值：frontend、backend 默认frontend， 调试模式下建议设置为backend
        enable_pipeline: bool = False,  # 是否启动openwebui pipelines
        join_topics: List[str] = [],  # 是否为智能体添加默认的join_topics
    '''
    model_args_obj: DrSaiModelConfig = DrSaiModelConfig
    worker_args_obj: DrSaiWorkerConfig = DrSaiWorkerConfig
    model_args, worker_args = hepai.parse_args((model_args_obj, worker_args_obj))

    agent_name: str = kwargs.pop("agent_name", None)
    if agent_name is not None:
        model_args.name = agent_name
        os.environ['AGNET_NAME'] = agent_name
    
    author: str = kwargs.pop("author", "IsYourBaby")
    worker_args.author = author

    permission: str|dict = kwargs.pop("permission", None)
    if permission is not None:
        if isinstance(permission, dict):
            groups = "groups: " + permission.get('groups', "default")
            users = "users: " + ", ".join(permission.get('users', []))
            owner = "owner: " + permission.get('owner', "")
            worker_args.permissions = "; ".join([groups, users, owner])
        else:
            worker_args.permissions = permission
    
    description: str = kwargs.pop("description", "A Dr.Sai multi agents system")
    worker_args.description = description

    version: str = kwargs.pop("version", None)
    if version is not None:
        model_args.version = version
    
    logo: str = kwargs.pop("logo", 'https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview')

    host: str =  kwargs.pop("host", None)
    if host is not None:
        worker_args.host = host

    port: int =  kwargs.pop("port", None)
    if port is not None:
        worker_args.port = port
        os.environ['BACKEND_PORT'] = str(port)
    
    engine_uri = kwargs.pop('engine_uri', None) or f"sqlite:///{CONST.FS_DIR}/drsai.db"
    base_dir = kwargs.pop('base_dir', None) or CONST.FS_DIR
    db_manager = DatabaseManager(
        engine_uri = engine_uri,
        base_dir = base_dir
    )
    auto_upgrade = kwargs.pop('auto_upgrade', False)
    init_response = db_manager.initialize_database(auto_upgrade=auto_upgrade)
    assert init_response.status, init_response.message
    kwargs.update({"db_manager": db_manager})

    no_register: bool =  kwargs.pop("no_register", None)
    if no_register is not None:
        worker_args.no_register = no_register

    controller_address: str =  kwargs.pop("controller_address", "https://aiapi.ihep.ac.cn")
    worker_args.controller_address = controller_address

    # TODO: ADD METADATA for worker config
    _metadata: dict[str, Any] = kwargs.pop("metadata", None)
    if _metadata is not None:
       worker_args._metadata.update(_metadata)

    join_topics: List[str]|None = kwargs.pop("join_topics", None)
    if join_topics is not None:
        worker_args._metadata.update({"join_topics": join_topics})
    

    print(model_args)
    print()
    print(worker_args)
    print()

    drsaiapp = DrSaiAPP(
        agent_factory = agent_factory,
        **kwargs
        )
    
    model = DrSaiWorkerModel(
        config=model_args, 
        worker_config=worker_args, 
        logo=logo, 
        drsaiapp=drsaiapp)

    enable_pipeline: bool = kwargs.pop("enable_openwebui_pipeline", False)
    if enable_pipeline:
        pipelines_dir = kwargs.pop("pipelines_dir", None)
        if pipelines_dir is not None:
            os.environ['PIPELINES_DIR'] = pipelines_dir
            pipelines_dir = os.getenv('PIPELINES_DIR')
            if not os.path.exists(pipelines_dir):
                print(f"PIPELINES_DIR {pipelines_dir} not exists!")
            else:
                print(f"Set PIPELINES_DIR to {pipelines_dir}")
        # 通过Pipeline适配OpenWebUI
        from .owebui_pipeline.api import app as owebui_pipeline_app
        from .owebui_pipeline.api import lifespan as owebui_lifespan
        # 实例化HWorkerAPP
        app: FastAPI = HWorkerAPP(
            model, worker_config=worker_args,
            lifespan=owebui_lifespan,
            )  # Instantiate the APP, which is a FastAPI application.
        app.mount("/pipelines", app=owebui_pipeline_app)
        
    else:
        app: FastAPI = HWorkerAPP(
            model, worker_config=worker_args
            )
    
    app.include_router(model.drsai.router)
    
    print(app.worker.get_worker_info(), flush=True)
    # # 启动服务
    # uvicorn.run(self.app, host=self.app.host, port=self.app.port)
    # 创建uvicorn配置和服务实例
    config = uvicorn.Config(
        app, 
        host=worker_args.host,  # 确保这里使用的是正确的host参数
        port=worker_args.port   # 确保这里使用的是正确的port参数
    )
    server = uvicorn.Server(config)
    # 在现有事件循环中启动服务
    worker_address = auto_worker_address(worker_address='auto', host=worker_args.host, port=worker_args.port)
    print(f"#####################Your Agent Server is ready!######################")
    print(f"Enable HepAI worker URL: `{worker_address}/apiv2`")
    if enable_pipeline:
        print(f"Enable OpenWebUI pipelines URL: `{worker_address}/pipelines` with API-KEY: `{owebui_pipeline_app.api_key}`")
    print(f"#####################################################################")
    try:
        await server.serve()
    finally:
        # 关闭数据库连接
        await db_manager.close()


