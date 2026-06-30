from .app_worker import DrSaiAPP

import os
from typing import (
    Union,
    List,
    Dict,
    Any,
    AsyncGenerator,
    Mapping,
    )
from loguru import logger
import traceback
from dataclasses import dataclass, field
from fastapi import FastAPI
import uvicorn, asyncio
from autogen_agentchat.base import TaskResult
from autogen_agentchat.base import (
    ChatAgent,
    Team)
from autogen_agentchat.ui import Console
from pathlib import Path
import inspect

from hepai import HRModel, HModelConfig, HWorkerConfig, HWorkerAPP
import hepai

from drsai.modules.managers.messages import (
    BaseChatMessage,
    AgentLogEvent,
)
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.agents.skills_agent.managers import ScheduledTaskManager, TaskNotification
from drsai.modules.managers.user_profile import UserApiKeyManager, CredentialStore
from autogen_agentchat.base import (
    ChatAgent,
    Team,)
from drsai.configs import CONST

from drsai.utils.utils import (
    auto_worker_address, 
    upload_to_hepai_filesystem, 
    decompress_state, compress_state)
from drsai.modules.managers.datamodel import Thread
import json

here = Path(__file__).parent.resolve()

############################################
# Dr.Sai application
############################################

async def start_console(
        task: str,
        agent_factory: callable = None, 
        agent: ChatAgent|Team = None, 
        init_kwargs: Dict = {},
        close_kwargs: Dict = {},
        ) -> Union[None, TaskResult]:
    """
    启动aotugen原生多智能体运行方式和多智能体逻辑
    args:
        task: str, 任务内容
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        agent: AssistantAgent|BaseGroupChat, 已创建的AssistantAgent/BaseGroupChat实例
        **kwargs: 其他参数
    """
    try:
        if agent is None:
            agent: ChatAgent|Team = (
                await agent_factory() 
                if asyncio.iscoroutinefunction(agent_factory)
                else agent_factory()
            )
        if hasattr(agent, "lazy_init"):
            await agent.lazy_init(**init_kwargs)
        stream = agent._model_client_stream if not isinstance(agent, Team) else agent._participants[0]._model_client_stream
        if stream:
            await Console(agent.run_stream(task=task))
            return 
        else:
            result:TaskResult = await agent.run(task=task)
            return result
    except Exception as e:
        logger.error(f"Error in a_drsai_ui_completions: {e}")
        traceback.print_exc()
    finally:
        if hasattr(agent, "close"):
            await agent.close(**close_kwargs)


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

    task_work_dir = Path(base_dir) / "scheduled_tasks"
    task_work_dir.mkdir(parents=True, exist_ok=True)

    # 创建 API Key 管理器
    credential_store = CredentialStore(base_dir=Path(base_dir))
    api_key_manager = UserApiKeyManager(base_dir=Path(base_dir))

    # 将统一的 CredentialStore 注入 GfsProvisioner 单例
    from drsai.modules.managers.gfs.provisioner import GfsProvisioner
    GfsProvisioner.set_credential_store(credential_store)

    # 创建 agent_executor 函数（流式写入版本）
    async def agent_executor(user_id: str, session_id: str, prompt: str, output_file: Path, execution_context: dict = None) -> str:
        """定时任务的 Agent 执行器（流式写入版本）"""
        agent = None
        ctx = execution_context or {}
        try:
            # 从 UserApiKeyManager 获取用户的 API Key
            api_key = api_key_manager.get_api_key(user_id)

            if not api_key:
                error_msg = f"❌ 无法执行定时任务：用户 `{user_id}` 未配置 API Key。\n\n请先登录系统并正常使用。"
                logger.warning(f"API Key not found for user: {user_id}")

                # 写入错误到文件
                with open(output_file, 'a', encoding='utf-8') as f:
                    f.write(error_msg)

                return error_msg

            # 使用 agent_factory 创建专用的 agent 实例
            # ── Pass through execution_context as extra_params (design-20260623 §4.3.3) ──
            extra_params = {
                k: v for k, v in ctx.items()
                if k != "defult_config_name" and v is not None
            }
            agent_factory_params = dict(
                api_key=api_key,
                thread_id=session_id,
                user_id=user_id,
                db_manager=db_manager,
                defult_config_name=ctx.get("defult_config_name"),
            )
            # Merge non-protected extra params (inspect.signature filtering)
            if extra_params:
                sig = inspect.signature(agent_factory)
                factory_params_set = set(sig.parameters.keys())
                for k, v in extra_params.items():
                    if k in factory_params_set and k not in agent_factory_params:
                        agent_factory_params[k] = v
            agent = await agent_factory(**agent_factory_params) if inspect.iscoroutinefunction(agent_factory) else agent_factory(**agent_factory_params)

            # 加载历史状态（继承记忆）
            response = db_manager.get(
                Thread,
                filters={"user_id": user_id, "thread_id": session_id},
                return_json=False,
            )
            if response.status and response.data:
                thread_obj = response.data[0]
                if thread_obj.state:
                    try:
                        if isinstance(thread_obj.state, str):
                            state_dict = decompress_state(thread_obj.state)
                        else:
                            state_dict = thread_obj.state
                        await agent.load_state(state_dict)
                        logger.info(f"Loaded history state for scheduled task: user={user_id}, session={session_id}")
                    except Exception as e:
                        logger.warning(f"Failed to load state for scheduled task: {e}")

            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()

            # 流式写入输出文件
            result_messages = []
            message_count = 0

            with open(output_file, 'a', encoding='utf-8') as f:
                async for message in agent.run_stream(task=prompt):
                    if hasattr(message, 'content') and isinstance(message.content, str):
                        content = message.content
                        result_messages.append(content)

                        # 实时写入
                        f.write(content)
                        f.flush()

                        message_count += 1

            # 保存状态到数据库（记忆持久化）
            if hasattr(agent, "save_state"):
                try:
                    state_dict = await agent.save_state()
                    state_compressed = compress_state(state_dict)
                    resp = db_manager.get(
                        Thread,
                        filters={"user_id": user_id, "thread_id": session_id},
                        return_json=False,
                    )
                    if resp.status and resp.data:
                        thread_obj = resp.data[0]
                        thread_obj.state = state_compressed
                    else:
                        thread_obj = Thread(
                            user_id=user_id,
                            thread_id=session_id,
                            state=state_compressed,
                        )
                    db_manager.upsert(thread_obj)
                    logger.info(f"Saved state for scheduled task: session={session_id}")
                except Exception as e:
                    logger.warning(f"Failed to save state for scheduled task: {e}")

            if hasattr(agent, "close"):
                await agent.close()

            total_chars = sum(len(msg) for msg in result_messages)
            return f"任务执行完成：共 {message_count} 条消息，{total_chars} 字符"

        except Exception as e:
            logger.error(f"Agent executor error: {e}")

            # 写入错误到文件
            try:
                with open(output_file, 'a', encoding='utf-8') as f:
                    f.write(f"\n\n**执行异常:** {str(e)}\n")
            except:
                pass

            # 异常时也尝试保存状态
            if agent and hasattr(agent, "save_state"):
                try:
                    state_dict = await agent.save_state()
                    state_compressed = compress_state(state_dict)
                    resp = db_manager.get(
                        Thread,
                        filters={"user_id": user_id, "thread_id": session_id},
                        return_json=False,
                    )
                    if resp.status and resp.data:
                        thread_obj = resp.data[0]
                        thread_obj.state = state_compressed
                    else:
                        thread_obj = Thread(
                            user_id=user_id,
                            thread_id=session_id,
                            state=state_compressed,
                        )
                    db_manager.upsert(thread_obj)
                except Exception:
                    pass

            if agent and hasattr(agent, "close"):
                try:
                    await agent.close()
                except:
                    pass
            raise

    # ✅ 多通道通知分发器（run_backend 模式暂无微信，预留扩展）
    _backend_notification_channels: list = []

    async def on_backend_task_notification(notification):
        """多通道通知分发：遍历所有已注册的通道回调"""
        for channel in _backend_notification_channels:
            try:
                await channel(notification)
            except Exception as e:
                logger.error(f"Notification channel error: {e}")

    # 创建 ScheduledTaskManager
    task_manager = ScheduledTaskManager(
        work_dir=task_work_dir,
        agent_executor=agent_executor,
        on_notification=on_backend_task_notification,
    )
    drsaiapp._task_manager = task_manager

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
    await task_manager.start()
    try:
        await server.serve()
    except asyncio.CancelledError:
        await server.shutdown()
    finally:
        # 关闭定时任务管理器
        await task_manager.stop()
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
    

    permissions: dict = field(default_factory=lambda: {}, metadata={"help": "Model's permissions, e.g., {'groups': ['default'], 'users': ['a', 'b'], 'owner': 'c'}"})
    description: str = field(default='This is Dr.Sai multi agents system', metadata={"help": "Model's description"})
    author: str = field(default=None, metadata={"help": "Model's author"})
    daemon: bool = field(default=False, metadata={"help": "Run as daemon"})
    type: str = field(default="agent", metadata={"help": "Worker's type"})
    debug: bool = field(default=False, metadata={"help": "Debug mode"})
    _metadata: dict = field(default_factory=dict, metadata={"help": "Additional metadata for worker/model"})


class DrSaiWorkerModel(HRModel):  # Define a custom worker model inheriting from HRModel.
    # _info 默认值，缺省时自动填充
    _DEFAULT_INFO: dict = {
        "logo": "https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
        "examples": [],
        "agent_config": {},
        "defult_config_name": None,
    }

    def __init__(
            self,
            config: DrSaiModelConfig,
            worker_config: DrSaiWorkerConfig,
            worker_info: Dict[str, Any] | None = None,
            close_agent_on_finish: bool = True,
            drsaiapp: DrSaiAPP = None,  # 传入DrSaiAPP实例
            ):
        super().__init__(config=config)

        self.drsai: DrSaiAPP = drsaiapp

        # 构建 _info：以 worker_info 为主，缺省字段从 config/worker_config/_DEFAULT_INFO 补齐
        self._info: Dict[str, Any] = {
            "name": config.name,
            "description": worker_config.description,
            "version": config.version,
            "author": worker_config.author,
        }
        if worker_info:
            self._info.update(worker_info)
        # 用默认值补齐未提供的字段
        for k, v in self._DEFAULT_INFO.items():
            self._info.setdefault(k, v)
        # 同步 worker_info 中的 name/description/version/author 回 config/worker_config（以防只传了 worker_info）
        if worker_info:
            if "name" in worker_info:
                config.name = worker_info["name"]
            if "version" in worker_info:
                config.version = worker_info["version"]
            if "description" in worker_info:
                worker_config.description = worker_info["description"]
            if "author" in worker_info:
                worker_config.author = worker_info["author"]

        self.drsai._info = self._info
        self._close_agent_on_finish = close_agent_on_finish

        
    @HRModel.remote_callable
    async def get_info(self) -> Dict[str, str]:
       return self._info
    
    @HRModel.remote_callable
    async def a_get_agents_info(self, chat_id: str) -> List[Dict[str, Any]]:
        agent: Team|ChatAgent = self.drsai.agent_instance.get(chat_id, None)
        return await self.drsai.get_agents_info(agent=agent)
    
    @HRModel.remote_callable
    async def lazy_init(self, chat_id: str, api_key: str, run_info: Dict[str, str], stream: bool = True, **kwargs) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance.get(chat_id, None)
            if agent is None:
                extra_params = {
                    k: v for k, v in kwargs.items()
                    if k != "defult_config_name" and v is not None
                }
                agent = await self.drsai._create_agent_instance(
                    api_key=api_key, 
                    thread_id=chat_id, 
                    user_id=run_info.get("email"), 
                    stream=stream,
                    defult_config_name=kwargs.get("defult_config_name", None),
                    extra_params=extra_params if extra_params else None,
                    )
            message = await agent.lazy_init(api_key=api_key, thread_id=chat_id, run_info=run_info, **kwargs)
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
            if self._close_agent_on_finish:
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
    async def load_state(self, chat_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
        try:
            agent: Team|ChatAgent = self.drsai.agent_instance[chat_id]
            await agent.load_state(state=state)
            return {"status": True, "message": ""}
        except Exception as e:
            return {"status": False, "message": f"load_state error: {e}"}

    def _get_switchable_agents(self, agent: Team | ChatAgent) -> List[ChatAgent]:
        """Return agents that can switch model client in a session/team."""
        if hasattr(agent, "switch_model"):
            return [agent]  # type: ignore[list-item]
        participants = getattr(agent, "_participants", None) or []
        return [p for p in participants if hasattr(p, "switch_model")]

    @HRModel.remote_callable
    async def get_current_model(self, chat_id: str) -> Dict[str, Any]:
        """Get current session-local model alias and available aliases."""
        try:
            agent: Team | ChatAgent | None = self.drsai.agent_instance.get(chat_id)
            if agent is None:
                return {
                    "status": False,
                    "message": f"Agent session not found: {chat_id}",
                    "defult_config_name": None,
                    "available": [],
                }

            switchable_agents = self._get_switchable_agents(agent)
            target = switchable_agents[0] if switchable_agents else agent
            llm_mode_config = getattr(target, "_llm_mode_config", None) or {}
            return {
                "status": True,
                "message": "",
                "defult_config_name": getattr(target, "_defult_config_name", None),
                "available": sorted(llm_mode_config.keys()),
            }
        except Exception as e:
            logger.exception("get_current_model error")
            return {
                "status": False,
                "message": f"get_current_model error: {e}",
                "defult_config_name": None,
                "available": [],
            }

    @HRModel.remote_callable
    async def switch_model(
        self,
        chat_id: str,
        defult_config_name: str | None = None,
        default_config_name: str | None = None,
    ) -> Dict[str, Any]:
        """Switch the internal LLM model for an existing agent session.

        `defult_config_name` keeps compatibility with the existing Dr.Sai API
        typo. `default_config_name` is accepted as an alias for new clients.
        The switch is session-local and does not update any global config file.
        """
        alias = defult_config_name or default_config_name
        try:
            if not alias:
                return {
                    "status": False,
                    "message": "defult_config_name/default_config_name is required",
                    "defult_config_name": None,
                }

            agent: Team | ChatAgent | None = self.drsai.agent_instance.get(chat_id)
            if agent is None:
                return {
                    "status": False,
                    "message": f"Agent session not found: {chat_id}. Please call lazy_init first.",
                    "defult_config_name": None,
                }

            async def _switch_one(a: ChatAgent, model_alias: str) -> str:
                set_fn = getattr(a, "_set_model_client", None)
                if set_fn is None:
                    raise RuntimeError(
                        f"Agent {getattr(a, 'name', '<unknown>')} has no _set_model_client"
                    )

                llm_mode_config = getattr(a, "_llm_mode_config", None) or {}
                if llm_mode_config and model_alias not in llm_mode_config:
                    available = ", ".join(sorted(llm_mode_config.keys()))
                    raise ValueError(
                        f"Unknown defult_config_name: {model_alias}. Available aliases: {available}"
                    )

                new_client = set_fn(model_alias)
                if not hasattr(a, "switch_model"):
                    raise RuntimeError(
                        f"Agent {getattr(a, 'name', '<unknown>')} does not support switch_model"
                    )
                await a.switch_model(new_client)  # type: ignore[attr-defined]
                a._defult_config_name = model_alias  # type: ignore[attr-defined]
                return model_alias

            switchable_agents = self._get_switchable_agents(agent)
            if not switchable_agents:
                return {
                    "status": False,
                    "message": "Current agent does not support switch_model and has no switchable participants",
                    "defult_config_name": None,
                }

            switched = []
            for switchable_agent in switchable_agents:
                await _switch_one(switchable_agent, alias)
                switched.append(getattr(switchable_agent, "name", switchable_agent.__class__.__name__))

            # Keep a team/session level marker for introspection when possible.
            try:
                agent._defult_config_name = alias  # type: ignore[attr-defined]
            except Exception:
                pass

            return {
                "status": True,
                "message": f"Model switched to {alias}",
                "defult_config_name": alias,
                "switched": switched,
            }
        except Exception as e:
            logger.exception("switch_model error")
            return {
                "status": False,
                "message": f"switch_model error: {e}",
                "defult_config_name": None,
            }

    @HRModel.remote_callable
    async def a_chat_completions(self, *args, **kwargs) -> AsyncGenerator:
        return self.drsai.a_drsai_ui_completions(*args, **kwargs)
    
    @HRModel.remote_callable
    async def chat_completions(self, *args, **kwargs) -> AsyncGenerator:
        return self.drsai.a_start_chat_completions(*args, **kwargs)


async def run_worker(
    agent_factory: callable,
    *,
    # ── Worker 展示信息（→ DrSaiWorkerModel._info）──
    # 传入 dict 后，下面的旧参数(agent_name/description/version/logo/examples/
    # agent_config/defult_config_name/author/permission) 将被忽略
    worker_info: Dict[str, Any] | None = None,
    # ── 服务配置 ──
    host: str | None = None,
    port: int | None = None,
    no_register: bool | None = None,
    controller_address: str = "https://aiapi.ihep.ac.cn",
    # ── DB 配置 ──
    drsai_dir: str | None = None,
    engine_uri: str | None = None,
    base_dir: str | None = None,
    auto_upgrade: bool = False,
    # ── 功能开关 ──
    close_agent_on_finish: bool = True,
    enable_openwebui_pipeline: bool = False,
    link_wechat: bool = False,
    join_topics: List[str] | None = None,
    metadata: dict[str, Any] | None = None,
    close_kwargs: dict[str, Any] | None = None,
    # ── 透传给 DrSaiAPP / agent_factory ──
    **kwargs,
):
    '''
    启动HepAI-Worker-Style-API后端服务

    Args:
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例

        worker_info: dict, Worker 展示/元信息，直接流入 DrSaiWorkerModel._info。
            支持的 key（均可选，缺省时从 config/worker_config 或默认值补齐）::

                {
                    "name": "My Dr.Sai",            # 智能体名称（→ model_args.name）
                    "description": "...",           # 描述（→ worker_args.description）
                    "version": "0.1.0",             # 版本（→ model_args.version）
                    "author": "user@ihep.ac.cn",    # 作者（→ worker_args.author）
                    "logo": "https://...",          # logo URL 或本地文件路径
                    "examples": [...],              # 示例列表
                    "agent_config": {...},          # LLM 模式配置
                    "defult_config_name": "...",    # 默认模型名
                    # 可自由扩展，所有 key 都会进入 _info
                }

            向后兼容：如果 worker_info 为 None，则自动从 kwargs 中 pop 旧参数
            (agent_name / description / version / logo / examples / agent_config /
            defult_config_name / author / permission) 构建 worker_info。

        host: 后端服务 host
        port: 后端服务 port
        no_register: 是否不注册到控制器
        controller_address: 控制器地址
        drsai_dir: 数据库目录
        engine_uri: 数据库 URI
        base_dir: 基础目录
        auto_upgrade: 是否自动升级数据库
        close_agent_on_finish: 会话结束后是否关闭 agent
        enable_openwebui_pipeline: 是否启动 OpenWebUI pipelines
        link_wechat: 是否启动微信 Bot
        join_topics: join_topics 列表
        metadata: worker 额外 metadata
        close_kwargs: agent close 时的额外参数
        **kwargs: 透传给 DrSaiAPP / agent_factory
    '''
    model_args_obj: DrSaiModelConfig = DrSaiModelConfig
    worker_args_obj: DrSaiWorkerConfig = DrSaiWorkerConfig
    model_args, worker_args = hepai.parse_args((model_args_obj, worker_args_obj))

    # ════════════════════════════════════════════════════════════════════
    # 1. 构建 worker_info（向后兼容旧参数）
    # ════════════════════════════════════════════════════════════════════
    if worker_info is None:
        # ── 旧模式：从 kwargs 中逐个 pop ──
        worker_info = {}

        agent_name: str = kwargs.pop("agent_name", None)
        if agent_name is not None:
            worker_info["name"] = agent_name

        author: str = kwargs.pop("author", None)
        if author is not None:
            worker_info["author"] = author

        description: str = kwargs.pop("description", None)
        if description is not None:
            worker_info["description"] = description

        version: str = kwargs.pop("version", None)
        if version is not None:
            worker_info["version"] = version

        logo: str = kwargs.pop("logo", None)
        if logo is not None:
            worker_info["logo"] = logo

        examples: List[str] = kwargs.pop("examples", None)
        if examples is not None:
            worker_info["examples"] = examples

        agent_config: Dict[str, Any] = kwargs.pop("agent_config", None)
        if agent_config is not None:
            worker_info["agent_config"] = agent_config

        defult_config_name: str | None = kwargs.pop("defult_config_name", None)
        if defult_config_name is not None:
            worker_info["defult_config_name"] = defult_config_name

        logger.debug("run_worker: worker_info built from legacy kwargs (backward compat)")
    else:
        logger.debug(f"run_worker: worker_info provided explicitly, keys={list(worker_info.keys())}")

    # ── permission 特殊处理（不进入 _info，写入 worker_args.permissions）──
    permission: str | dict = kwargs.pop("permission", None)
    if permission is not None:
        if isinstance(permission, dict):
            groups = "groups: " + permission.get('groups', "default")
            users = "users: " + ", ".join(permission.get('users', []))
            owner = "owner: " + permission.get('owner', "")
            worker_args.permissions = "; ".join([groups, users, owner])
        else:
            worker_args.permissions = permission

    # ════════════════════════════════════════════════════════════════════
    # 2. 同步 worker_info → model_args / worker_args / env
    # ════════════════════════════════════════════════════════════════════
    if "name" in worker_info and worker_info["name"] is not None:
        model_args.name = worker_info["name"]
        os.environ['AGNET_NAME'] = worker_info["name"]

    if "version" in worker_info and worker_info["version"] is not None:
        model_args.version = worker_info["version"]

    if "author" in worker_info and worker_info["author"] is not None:
        worker_args.author = worker_info["author"]

    if "description" in worker_info and worker_info["description"] is not None:
        worker_args.description = worker_info["description"]
    else:
        worker_args.description = "A Dr.Sai multi agents system"

    # logo 本地文件上传
    logo_val = worker_info.get("logo")
    if logo_val and os.path.exists(str(logo_val)):
        logo_path = Path(logo_val)
        if logo_path.is_file():
            file_obj = upload_to_hepai_filesystem(str(logo_path))
            worker_info["logo"] = file_obj["url"]

    # ════════════════════════════════════════════════════════════════════
    # 3. 服务配置
    # ════════════════════════════════════════════════════════════════════
    if host is not None:
        worker_args.host = host

    if port is not None:
        worker_args.port = port
        os.environ['BACKEND_PORT'] = str(port)

    if no_register is not None:
        worker_args.no_register = no_register

    worker_args.controller_address = controller_address

    # ════════════════════════════════════════════════════════════════════
    # 4. DB 配置
    # ════════════════════════════════════════════════════════════════════
    drsai_dir = drsai_dir or CONST.FS_DIR
    engine_uri = engine_uri or f"sqlite:///{drsai_dir}/drsai.db"
    base_dir = base_dir or drsai_dir
    db_manager = DatabaseManager(
        engine_uri=engine_uri,
        base_dir=base_dir
    )
    init_response = db_manager.initialize_database(auto_upgrade=auto_upgrade)
    assert init_response.status, init_response.message
    kwargs.update({"db_manager": db_manager})

    # ════════════════════════════════════════════════════════════════════
    # 5. metadata / join_topics
    # ════════════════════════════════════════════════════════════════════
    if metadata is not None:
        worker_args._metadata.update(metadata)

    if join_topics is not None:
        worker_args._metadata.update({"join_topics": join_topics})

    if close_kwargs is None:
        close_kwargs = {}

    print(model_args)
    print()
    print(worker_args)
    print()

    drsaiapp = DrSaiAPP(
        agent_factory = agent_factory,
        **kwargs
        )

    # 初始化定时任务管理器
    task_work_dir = Path(base_dir) / "scheduled_tasks"
    task_work_dir.mkdir(parents=True, exist_ok=True)

    # 创建 API Key 管理器
    credential_store = CredentialStore(base_dir=Path(base_dir))
    api_key_manager = UserApiKeyManager(base_dir=Path(base_dir))

    # 将统一的 CredentialStore 注入 GfsProvisioner 单例
    from drsai.modules.managers.gfs.provisioner import GfsProvisioner
    GfsProvisioner.set_credential_store(credential_store)

    # 创建 agent_executor 函数（流式写入版本）
    async def agent_executor(user_id: str, session_id: str, prompt: str, output_file: Path, execution_context: dict = None) -> str:
        """
        定时任务的 Agent 执行器（流式写入版本）

        Args:
            user_id: 用户ID
            session_id: 会话ID (thread_id)
            prompt: 要执行的提示词
            output_file: 输出文件路径（用于流式写入）
            execution_context: 执行上下文（per-task 配置，如 defult_config_name）

        Returns:
            执行结果摘要
        """
        agent = None
        ctx = execution_context or {}
        try:
            # 从 UserApiKeyManager 获取用户的 API Key
            api_key = api_key_manager.get_api_key(user_id)

            if not api_key:
                error_msg = f"❌ 无法执行定时任务\n\n"
                error_msg += f"**原因**: 用户 `{user_id}` 未配置 API Key\n\n"
                error_msg += f"**解决方法**: 请先登录系统并正常使用，API Key 会自动保存\n"

                logger.warning(f"API Key not found for user: {user_id}")

                # 写入错误信息到输出文件
                with open(output_file, 'a', encoding='utf-8') as f:
                    f.write(error_msg)

                return error_msg

            # 从 execution_context 获取 per-task 配置，fallback 到全局 worker_info
            config_name = ctx.get("defult_config_name", worker_info.get("defult_config_name"))

            # 使用 agent_factory 创建专用的 agent 实例
            extra_params = {
                k: v for k, v in ctx.items()
                if k != "defult_config_name" and v is not None
            }
            params = dict(
                api_key=api_key,
                thread_id=session_id,
                user_id=user_id,
                db_manager=db_manager,
                defult_config_name=config_name,
            )
            # Merge non-protected extra params (inspect.signature filtering)
            if extra_params:
                sig = inspect.signature(agent_factory)
                factory_params_set = set(sig.parameters.keys())
                for k, v in extra_params.items():
                    if k in factory_params_set and k not in params:
                        params[k] = v
            agent: ChatAgent | Team = (
                await agent_factory(**params)
                if inspect.iscoroutinefunction(agent_factory)
                else (agent_factory(**params))
            )

            # 加载历史状态（继承记忆）
            response = db_manager.get(
                Thread,
                filters={"user_id": user_id, "thread_id": session_id},
                return_json=False,
            )
            if response.status and response.data:
                thread_obj = response.data[0]
                if thread_obj.state:
                    try:
                        if isinstance(thread_obj.state, str):
                            state_dict = decompress_state(thread_obj.state)
                        else:
                            state_dict = thread_obj.state
                        await agent.load_state(state_dict)
                        logger.info(f"Loaded history state for scheduled task: user={user_id}, session={session_id}")
                    except Exception as e:
                        logger.warning(f"Failed to load state for scheduled task: {e}")

            # 初始化 agent
            if hasattr(agent, "lazy_init"):
                await agent.lazy_init()

            # 执行任务并流式写入输出文件
            result_messages = []
            message_count = 0

            # 以追加模式打开文件，实时写入
            with open(output_file, 'a', encoding='utf-8') as f:
                async for message in agent.run_stream(task=prompt):
                    # 收集并实时写入消息
                    if isinstance(message, AgentLogEvent) or isinstance(message, BaseChatMessage):
                        content = ""
                        if isinstance(message, AgentLogEvent):
                            content = f"{message.title}"
                        elif isinstance(message.content, str):
                            content = message.content
                        result_messages.append(content)

                        # 立即写入文件
                        f.write(content+"\n\n")
                        f.flush()  # 强制刷新到磁盘
                        message_count += 1

                        # 每10条消息输出一次日志
                        if message_count % 10 == 0:
                            logger.debug(f"Task {session_id}: Written {message_count} messages")

            # 保存状态到数据库（记忆持久化）
            if hasattr(agent, "save_state"):
                try:
                    state_dict = await agent.save_state()
                    state_compressed = compress_state(state_dict)
                    resp = db_manager.get(
                        Thread,
                        filters={"user_id": user_id, "thread_id": session_id},
                        return_json=False,
                    )
                    if resp.status and resp.data:
                        thread_obj = resp.data[0]
                        thread_obj.state = state_compressed
                    else:
                        thread_obj = Thread(
                            user_id=user_id,
                            thread_id=session_id,
                            state=state_compressed,
                        )
                    db_manager.upsert(thread_obj)
                    logger.info(f"Saved state for scheduled task: session={session_id}")
                except Exception as e:
                    logger.warning(f"Failed to save state for scheduled task: {e}")

            # 关闭 agent
            if hasattr(agent, "close"):
                await agent.close()

            # 返回执行摘要
            total_chars = sum(len(msg) for msg in result_messages)
            summary = f"任务执行完成：共 {message_count} 条消息，{total_chars} 字符"
            logger.info(f"Task completed: {summary}")

            return summary if result_messages else "任务执行完成，但没有输出内容。"

        except Exception as e:
            error_msg = f"执行错误: {str(e)}"
            logger.error(f"Agent executor error for task (user={user_id}, session={session_id}): {e}")

            # 写入错误到文件
            try:
                with open(output_file, 'a', encoding='utf-8') as f:
                    f.write(f"\n\n**执行异常:** {error_msg}\n")
            except:
                pass

            # 异常时也尝试保存状态
            if agent and hasattr(agent, "save_state"):
                try:
                    state_dict = await agent.save_state()
                    state_compressed = compress_state(state_dict)
                    resp = db_manager.get(
                        Thread,
                        filters={"user_id": user_id, "thread_id": session_id},
                        return_json=False,
                    )
                    if resp.status and resp.data:
                        thread_obj = resp.data[0]
                        thread_obj.state = state_compressed
                    else:
                        thread_obj = Thread(
                            user_id=user_id,
                            thread_id=session_id,
                            state=state_compressed,
                        )
                    db_manager.upsert(thread_obj)
                except Exception:
                    pass

            if agent and hasattr(agent, "close"):
                try:
                    await agent.close()
                except:
                    pass
            raise

    # ✅ 通知消息格式化函数（各推送通道共用）
    def _format_notification_text(notification) -> str:
        """将 TaskNotification 格式化为人类可读的推送文本"""
        status_icon = {"success": "✅", "error": "❌", "timeout_partial": "⏱️"}.get(
            notification.status, "❓"
        )
        status_text = {
            "success": "成功",
            "error": "失败",
            "timeout_partial": "超时(部分结果已保存)",
        }.get(notification.status, notification.status)

        text = f"{status_icon} 定时任务通知\n\n"
        text += f"任务：{notification.task_name}\n"
        text += f"状态：{status_text}\n"
        text += f"时间：{notification.timestamp}\n"
        if notification.summary:
            text += f"\n{notification.summary}\n"
        if notification.output_file:
            text += f"\n💡 可使用定时任务管理工具的 `read_output` 查看详细结果\n"
        return text

    # ✅ 多通道通知分发器（可变列表，支持延迟注册）
    _notification_channels: list = []

    async def on_task_notification(notification):
        """多通道通知分发：遍历所有已注册的通道回调"""
        for channel in _notification_channels:
            try:
                await channel(notification)
            except Exception as e:
                logger.error(f"Notification channel error: {e}")

    # 创建 ScheduledTaskManager 并传入 agent_executor + on_notification
    task_manager = ScheduledTaskManager(
        work_dir=task_work_dir,
        agent_executor=agent_executor,
        on_notification=on_task_notification,
    )
    drsaiapp._task_manager = task_manager

    model = DrSaiWorkerModel(
        config=model_args,
        worker_config=worker_args,
        worker_info=worker_info,
        close_agent_on_finish=close_agent_on_finish,
        drsaiapp=drsaiapp,
    )

    # ── WeChat Bot 集成 ────────────────────────────────────────────────────────
    _wechat_tasks: list[asyncio.Task] = []
    if link_wechat:
        from drsai.configs.constant import WECHAT_DIR
        from .wechat.wechat_login import login_wechat_main, load_credentials
        from .wechat.session_manager import SessionManager
        from .wechat.wechat_bot import WeChatBot
        from .wechat.idle_monitor import idle_monitor

        wechat_dir = WECHAT_DIR
        if base_dir != CONST.FS_DIR:
            wechat_dir  = os.path.join(base_dir, "wechat")
            os.makedirs(wechat_dir, exist_ok=True)
        creds_file = os.path.join(wechat_dir, "credentials.json")

        # 1. QR 扫码登录 + HEPAI_API_KEY 录入（交互式，阻塞直到扫码完成）
        await login_wechat_main(creds_file = creds_file)
        creds = load_credentials(creds_file = creds_file)
        api_key = creds.get("hepai_api_key") or os.environ.get("HEPAI_API_KEY", "")

        # 2. 初始化会话管理器和 Bot
        sessions_file = os.path.join(wechat_dir, "sessions.json")
        session_mgr = SessionManager(sessions_file)
        bot = WeChatBot(
            model=model,
            creds=creds,
            api_key=api_key,
            session_manager=session_mgr,
        )

        # 3. 启动后台任务（与 uvicorn 共享同一 event loop）
        _wechat_tasks.append(asyncio.create_task(bot.run(), name="wechat_bot"))
        _wechat_tasks.append(asyncio.create_task(
            idle_monitor(model, session_mgr), name="wechat_idle_monitor"
        ))

        # ✅ 4. 注册微信推送通道到通知分发器
        async def wechat_push_channel(notification: TaskNotification):
            """微信推送通道：将定时任务通知主动推送给微信用户"""
            text = _format_notification_text(notification)
            await bot.push_notification(notification.user_id, text)

        _notification_channels.append(wechat_push_channel)
        print("微信 Bot 已启动，发送 /help 查看命令列表。")

    enable_pipeline: bool = enable_openwebui_pipeline
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
        host=worker_args.host,
        port=worker_args.port
    )
    server = uvicorn.Server(config)
    # 在现有事件循环中启动服务
    worker_address = auto_worker_address(worker_address='auto', host=worker_args.host, port=worker_args.port)
    print(f"#####################Your Agent Server is ready!######################")
    print(f"Enable HepAI worker `{agent_name}` with URL: `{worker_address}/apiv2`")
    if enable_pipeline:
        print(f"Enable OpenWebUI pipelines URL: `{worker_address}/pipelines` with API-KEY: `{owebui_pipeline_app.api_key}`")
    print(f"#####################################################################")
    await task_manager.start()
    try:
        await server.serve()
    finally:
        # 关闭微信后台任务
        for task in _wechat_tasks:
            task.cancel()
        if _wechat_tasks:
            await asyncio.gather(*_wechat_tasks, return_exceptions=True)
        # 关闭定时任务管理器
        await task_manager.stop()
        # 关闭数据库连接
        await db_manager.close()
        for agent in model.drsai.agent_instance:
            if hasattr(agent, "close"):
                await agent.close(**close_kwargs)


