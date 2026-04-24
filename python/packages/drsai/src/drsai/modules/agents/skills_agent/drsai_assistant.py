from typing import (
    AsyncGenerator, 
    List, 
    Sequence, 
    Dict, 
    Any, 
    Callable, 
    Awaitable, 
    Union, 
    Optional, 
    Tuple,
    Self,
    Mapping,
    )
import os, json, sys, uuid, shutil
import asyncio, traceback
from pydantic import BaseModel
from pathlib import Path
from loguru import logger

from autogen_core import CancellationToken, FunctionCall
from drsai.modules.baseagent import (
    DrSaiAgent, 
    HandoffBase, 
    Response, 
    TaskResult, 
    CreateResult,
    FunctionExecutionResultMessage,
    FunctionExecutionResult,
    AssistantMessage,
    UserMessage,
    SystemMessage,
    LLMMessage
    )
from drsai.modules.baseagent.drsaiagent import DrSaiAgentConfig
from drsai.modules.baseagent import CodeExecutorAgent, CodeExecutor
from drsai.modules.agents import RemoteAgent, HepAIWorkerAgent
from drsai.modules.components import (
    ComponentModel,
)
from drsai.modules.components.model_client import ChatCompletionClient, HepAIChatCompletionClient
from drsai.modules.components.model_context import (
    ChatCompletionContext,
    DrSaiChatCompletionContext,
)
from drsai.modules.components.memory import Memory
from drsai.modules.components.tool import (
    BaseTool, 
    FunctionTool, 
    Workbench,
    ToolSchema,
    ParametersSchema,
    StdioServerParams,
    SseServerParams,
    mcp_server_tools
    )
from drsai.modules.managers.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    TextMessage,
    StopMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
    UserInputRequestedEvent,
    ThoughtEvent,
    AgentLogEvent,Send_level,
    StructuredMessage,
    StructuredMessageFactory,
    MultiModalMessage,
    Image,
)
from drsai.modules.managers.database import DatabaseManager
from drsai.configs.constant import RUNS_DIR
from .managers import (
    UserProfileManager,
    TodoManager,
    get_operator_funcs,
    _detect_powershell,
)
from drsai.modules.components.skills import SkillLoader
from drsai.utils.utils import download_file_from_url_or_base64, fix_and_parse_json
from .managers.get_managers_tools import (
    get_agent_skills_tool,
    get_subagent_tools,
    get_todo_manager_tool,
    create_local_venv,
)
from .managers.get_scheduled_task_tools import get_scheduled_task_tool
from .managers.scheduled_task_manager import (
    TaskNotification,
)
from .utils.utils import HELP_TEXT


class DrSaiAssistantConfig(DrSaiAgentConfig):
    skills_dir: Optional[str | List[str]]
    work_dir: str | None
    only_in_workspace: bool
    extra_work_dirs: List[str]
    executor: ComponentModel
    sub_agent_config: Dict
    max_turn_count: int
    token_limit: int
    rag_flow_url: str
    rag_flow_token: str
    memory_dataset_id: str
    learning_dataset_id: str
    

class DrSaiAssistant(DrSaiAgent):
    """
    专业科学数据智能分析智能体

    核心能力:
    1. 用户个人画像/提示词/其他配置的动态更新
    2. 任务规划与分解
    3. 多任务进度管理
    3. 智能工具/Skills/子智能体调用与动态更新
    4. 记忆注入机制与长期记忆
    5. 自我被动学习与skill转化
    6. 错误处理与用户交互
    """

    def __init__(
        self,
        name: str,
        *,
        model_client: ChatCompletionClient = None,
        tools: List[BaseTool[Any, Any] | Callable[..., Any] | Callable[..., Awaitable[Any]]] | None = None,
        workbench: Workbench | None = None,
        handoffs: List[HandoffBase | str] | None = None,
        model_context: ChatCompletionContext | None = None,
        description: str = "An agent that provides assistance with ability to use tools.",
        system_message: (
            str | None
        ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
        model_client_stream: bool = True,
        reflect_on_tool_use: bool | None = None,
        tool_call_summary_format: str = "{result}",
        tool_call_summary_prompt: str| None = None,
        output_content_type: type[BaseModel] | None = None,
        output_content_type_format: str | None = None,
        memory: Sequence[Memory] | None = None,
        metadata: Dict[str, str] | None = None,
        # drsaiAgent specific
        memory_function: Callable | None = None,
        reply_function: Callable | None = None,
        db_manager: DatabaseManager | None = None,
        thread_id: str | None = None,
        user_id: str | None = None,
        set_model_client: Callable | None = None,
        llm_mode_config: Dict = {},
        defult_config_name: str | None = None,
        # basic tools and userprofile config
        work_dir: str | None = None,
        only_system_message: bool = False,
        is_powershell: bool = False,
        allolow_dangrous_cmd: bool = False,
        allolow_basic_tools: Optional[List[str]] = None,
        only_in_workspace: bool = True,
        extra_work_dirs: List[str] | None = None,
        # skills, executor, sub_agents
        skills_dir: Optional[str | List[str]] = [],
        executor: CodeExecutor | None = None,
        sub_agent_config: Dict = {},
        # task loop and memory
        max_turn_count: int = 200,
        token_limit: int = 50000,
        rag_flow_url: str | None = None,
        rag_flow_token: str | None = None,
        memory_dataset_id: str | None = None,
        learning_dataset_id: str| None = None,
    ):
        super().__init__(
            name=name,
            model_client=model_client,
            tools=tools,
            workbench=workbench,
            handoffs=handoffs,
            model_context=model_context,
            description=description,
            system_message=system_message,
            model_client_stream=model_client_stream,
            reflect_on_tool_use=reflect_on_tool_use,
            tool_call_summary_format=tool_call_summary_format,
            tool_call_summary_prompt=tool_call_summary_prompt,
            output_content_type=output_content_type,
            output_content_type_format=output_content_type_format,
            memory=memory,
            metadata=metadata,
            memory_function=memory_function,
            reply_function=reply_function,
            db_manager=db_manager,
            thread_id=thread_id,
            user_id=user_id,
            set_model_client=set_model_client,
            llm_mode_config=llm_mode_config,
            defult_config_name=defult_config_name,
        )

        self._developer_system_message = system_message or ""

        # === workspace for assistant ===
        if not work_dir:
            if self._db_manager:
                DEFAULT_RUN_DIR: Path = self._db_manager.schema_manager.base_dir / "runs"
                self._work_dir = DEFAULT_RUN_DIR / self._user_id
            else:
                self._work_dir = Path(RUNS_DIR) / self._user_id
        else:
            self._work_dir = Path(work_dir) / self._user_id
        if not self._work_dir.exists():
            self._work_dir.mkdir(parents=True)

        # === initial UserProfileManager ===
        self._user_profile_manager = UserProfileManager(
            agent_name=self._name,
            work_dir=self._work_dir,
            user_id=self._user_id,
            thread_id=self._thread_id,
        )
        self._update_user_config_tools = [self._user_profile_manager.get_user_config_tool()]
        # combine system messages
        self._only_system_message = only_system_message
        if not self._only_system_message:
            user_sys_prompt = self._user_profile_manager.get_agent_system_prompt()
            enhanced_system_message = f"""{self._developer_system_message}\n{user_sys_prompt}\n
Current Session_ID is {self._thread_id}"""
        else:
            enhanced_system_message = self._developer_system_message
        self._system_messages = [SystemMessage(content=enhanced_system_message)]

        # === basic tools ===
        self._only_in_workspace = only_in_workspace
        self._extra_work_dirs = extra_work_dirs
        # self._is_powershell = is_powershell
        # if _detect_powershell() is not None:
        #     self._is_powershell = True
        self._basic_funcs: List[Callable] = get_operator_funcs(
            work_dir, 
            thread_id=self._thread_id,
            only_in_workspace=self._only_in_workspace,
            extra_dirs = self._extra_work_dirs,
            is_powershell=is_powershell,
            allolow_dangrous_cmd=allolow_dangrous_cmd
            )
        if allolow_basic_tools is not None:
            self._basic_funcs = [func for func in self._basic_funcs if func.__name__ in allolow_basic_tools]
        # self._basic_funcs_names = [func.__name__ for func in self._basic_funcs]
        for func in self._basic_funcs:
            self._tools.append(FunctionTool(func, description=func.__doc__))

        # === model context ===
        self._token_limit = token_limit
        self._rag_flow_url = rag_flow_url
        self._rag_flow_token = rag_flow_token
        self._memory_dataset_id = memory_dataset_id
        self._learning_dataset_id = learning_dataset_id or memory_dataset_id
        self._memory_document_id = self._user_profile_manager.get_document_ids(self._thread_id)
        self._learning_document_id = self._user_profile_manager.get_document_ids(self._user_id)
        # memory manager
        model_config = model_client.dump_component()
        independent_model_client = ChatCompletionClient.load_component(model_config)
        independent_model_client._model_info = model_client._model_info
        self._model_context = DrSaiChatCompletionContext(
            agent_name=self._user_profile_manager.agent_name,
            model_client=independent_model_client,
            user_id=self._user_id,
            thread_id=self._thread_id,
            work_dir=self._work_dir,
            token_limit=self._token_limit,
            rag_flow_url=self._rag_flow_url,
            rag_flow_token=self._rag_flow_token,
            dataset_id=self._memory_dataset_id,
            document_id=self._memory_document_id,
            learning_dataset_id=self._learning_dataset_id,
            learning_document_id=self._learning_document_id,
        )
        if not self._model_context._rag_flow_manager:
            raise ValueError("RAGFlowManager is not initialized in DrSaiChatCompletionContext")
        funcs = [
            self._model_context.retrieve_from_memory,
            self._model_context.summry_conversation_to_memory,
            self._user_profile_manager.read_session_memory_by_index, # TODO: 后面进行测试修正
        ]
        for func in funcs:
            self._tools.append(FunctionTool(func, description=func.__doc__))
                
        # === skills ===
        self._skills_dir = skills_dir if isinstance(skills_dir, list) else [skills_dir]
        if self._user_profile_manager.first_time_setup and self._skills_dir:
            dst_root = self._user_profile_manager.skills_dir
            for src_dir in self._skills_dir:
                src_path = Path(src_dir)
                for skill_folder in src_path.iterdir():
                    if skill_folder.is_dir():
                        dst = dst_root / skill_folder.name
                        if not dst.exists():
                            shutil.copytree(skill_folder, dst)
        self._agent_skills_tools = []

        # === executor ===
        self._local_executor = executor
        
        # === sub_agent_config ===
        self._sub_agent_config = sub_agent_config
        self._user_sub_agents = {}
        self._user_sub_agents.update(sub_agent_config)
        self._subagent_tools = []

        # === todo manager ===
        self._todo_manager = TodoManager()
        self._todo_tools = [get_todo_manager_tool()]

        # === scheduled task manager ===
        # 注意: task_manager 实例会在 run.py 中创建并注入到 app._task_manager
        # DrSaiAssistant 通过 app 访问，而不是直接持有实例
        # self._scheduled_task_tools = [get_scheduled_task_tool()]
        self._scheduled_task_tools = []
        self._task_manager = None  # 将在 lazy_init 或 set_task_manager 中设置

        # 初始化实例变量供edge_agent_core使用
        # self._current_plan = None
        # self._task_planner = None
        # self._memory_manager = None

        # max_turn_count
        self._max_turn_count = max_turn_count

        # config file mtime cache for lazy reloading
        self._config_mtimes: Dict[str, float] = {}
        self._cached_tools_prompt: str = ""
        self._cached_skills_loader = None

    def set_task_manager(self, task_manager):
        """设置定时任务管理器实例"""
        self._task_manager = task_manager
        self._scheduled_task_tools = [get_scheduled_task_tool()]

    def _format_task_notifications(self, notifications: List[TaskNotification]) -> str:
        """格式化定时任务完成通知"""
        text = "## 定时任务执行通知\n\n"
        for n in notifications:
            icon = {"success": "✅", "error": "❌", "timeout_partial": "⏱️"}.get(n.status, "❓")
            text += f"- {icon} **{n.task_name}** (`{n.task_id}`)\n"
            text += f"  状态: {n.status} | 时间: {n.timestamp}\n"
            if n.output_file:
                text += f"  输出: `{n.output_file}`\n"
            text += "\n"
        text += "💡 可使用定时任务管理工具的 `read_output` 操作查看详细输出内容。\n"
        return text

    def _file_changed(self, path: Path) -> bool:
        """Check if a file/dir has been modified since last check, updating the cached mtime."""
        try:
            mtime = path.stat().st_mtime
        except FileNotFoundError:
            return True
        key = str(path)
        if self._config_mtimes.get(key) != mtime:
            self._config_mtimes[key] = mtime
            return True
        return False

    async def _emit_notification(self, content: str) -> TextMessage:
        """Yield a notification to the user and inject it into the model context."""
        await self._model_context.add_message(
            UserMessage(source="system", content=f"[System Notification]\n{content}")
        )
        return TextMessage(
            content=content,
            source=self._user_profile_manager.agent_name,
            metadata={"internal": "no"},
        )

    async def _init_memory_documents(self) -> None:
        """Initialize learning memory and session documents on first use."""
        if self._user_profile_manager.first_time_setup:
            self._learning_document_id = await self._model_context.create_new_session_document(
                dataset_id=self._learning_dataset_id, create_type="learning_memory"
            )
            self._user_profile_manager.update_document_ids(
                thread_id=self._user_id, document_id=self._learning_document_id
            )
        if self._memory_document_id is None:
            self._memory_document_id = await self._model_context.create_new_session_document(
                user_id=self._user_id,
                thread_id=self._thread_id,
                work_dir=self._work_dir,
            )
            self._user_profile_manager.update_document_ids(
                thread_id=self._thread_id, document_id=self._memory_document_id
            )
            self._model_context._document_id = self._memory_document_id

    async def _run_startup_checks(self) -> List[str]:
        """Reload configs if changed; return list of warning messages (side-effects: update caches)."""
        warnings = []

        # load/update tools only if TOOLS_CONFIG.json changed
        tools_changed = self._file_changed(self._user_profile_manager.tools_config_path)
        if tools_changed:
            tools_prompt, tool_errors = await self.update_user_tools()
            if tool_errors:
                error_details = "\n".join(f"  - {err}" for err in tool_errors)
                warnings.append(
                    f"⚠️ **工具配置加载警告 / Tool Config Loading Warning**\n\n"
                    f"部分工具配置加载失败,已跳过这些工具:\n"
                    f"Some tool configurations failed to load and were skipped:\n\n"
                    f"{error_details}\n\n"
                    f"💡 请检查 `TOOLS_CONFIG.json` 文件格式是否正确。\n"
                    f"💡 Please check if `TOOLS_CONFIG.json` format is correct.\n\n"
                    f"✅ 其他工具已正常加载,系统将继续运行。\n"
                    f"✅ Other tools loaded successfully, system will continue."
                )
            self._cached_tools_prompt = tools_prompt

        # update system prompt if AGENTS.md or tools prompt changed
        if not self._only_system_message and (tools_changed or self._file_changed(self._user_profile_manager.agents_md)):
            try:
                self.update_system_prompt(additional_prompt=self._cached_tools_prompt)
            except Exception as e:
                logger.error(f"Failed to update system prompt from AGENTS.md: {e}")
                logger.error(traceback.format_exc())
                warnings.append(
                    f"⚠️ **配置文件加载警告 / Config Loading Warning**\n\n"
                    f"无法加载智能体配置文件 `AGENTS.md`:\n"
                    f"Failed to load agent config `AGENTS.md`:\n\n"
                    f"```\n{str(e)}\n```\n\n"
                    f"将继续使用之前的系统提示词。\n"
                    f"Continuing with previous system prompt.\n\n"
                    f"💡 请检查 `AGENTS.md` 文件是否存在且格式正确。\n"
                    f"💡 Please check if `AGENTS.md` exists and is properly formatted."
                )

        # load/update skills only if skills directories changed
        skills_changed = self._file_changed(self._user_profile_manager.skills_dir)
        if self._skills_dir:
            skills_changed = skills_changed or any(self._file_changed(Path(d)) for d in self._skills_dir)
        if skills_changed or self._cached_skills_loader is None:
            skills_loader, skill_error = self.update_user_skills()
            if skill_error:
                warnings.append(
                    f"⚠️ **技能配置加载警告 / Skills Config Loading Warning**\n\n"
                    f"无法加载技能配置:\n"
                    f"Failed to load skills configuration:\n\n"
                    f"```\n{skill_error}\n```\n\n"
                    f"将继续使用之前的技能配置。\n"
                    f"Continuing with previous skills configuration.\n\n"
                    f"💡 请检查 skills 目录下的 SKILL.md 文件格式。\n"
                    f"💡 Please check SKILL.md files in the skills directory."
                )
                if self._cached_skills_loader is None:
                    self._agent_skills_tools = []
            else:
                self._cached_skills_loader = skills_loader

        # load/update subagents only if SUBAGENT_CONFIG.json changed
        if self._file_changed(self._user_profile_manager.subagent_config_path):
            subagent_error = self.update_user_subagents()
            if subagent_error:
                warnings.append(
                    f"⚠️ **子智能体配置加载警告 / Subagent Config Loading Warning**\n\n"
                    f"无法加载子智能体配置文件 `SUBAGENT_CONFIG.json`:\n"
                    f"Failed to load subagent config `SUBAGENT_CONFIG.json`:\n\n"
                    f"```\n{subagent_error}\n```\n\n"
                    f"将继续使用之前的子智能体配置。\n"
                    f"Continuing with previous subagent configuration.\n\n"
                    f"💡 请检查 `SUBAGENT_CONFIG.json` 文件格式是否正确。\n"
                    f"💡 Please check if `SUBAGENT_CONFIG.json` format is correct."
                )

        return warnings

    def update_system_prompt(self, additional_prompt: str = "") -> str:
        """获取agent描述、用户画像并更新系统消息"""
        user_sys_prompt = self._user_profile_manager.get_agent_system_prompt()
        enhanced_system_message = f"""{self._developer_system_message}\n\n{user_sys_prompt}\n
Current Session_ID is {self._thread_id}"""
        enhanced_system_message += additional_prompt
        self._system_messages = [SystemMessage(content=enhanced_system_message)]
    
    def update_user_skills(self) -> Tuple[Optional[SkillLoader], Optional[str]]:
        """加载/更新用户技能

        Returns:
            Tuple[Optional[SkillLoader], Optional[str]]: (skills_loader, error_message)
        """
        skills_loader = None
        error_msg = None

        try:
            user_skills_dir = self._user_profile_manager.skills_dir

            # 1. 先检查并同步系统skill目录到用户skill目录
            if self._skills_dir:
                for system_skills_dir in self._skills_dir:
                    system_path = Path(system_skills_dir)
                    if not system_path.exists():
                        continue
                    for skill_folder in system_path.iterdir():
                        if not skill_folder.is_dir():
                            continue
                        skill_file = skill_folder / "SKILL.md"
                        if not skill_file.exists():
                            continue
                        user_skill_folder = user_skills_dir / skill_folder.name
                        user_skill_file = user_skill_folder / "SKILL.md"
                        should_update = False
                        if not user_skill_file.exists():
                            should_update = True
                        else:
                            system_mtime = skill_file.stat().st_mtime
                            user_mtime = user_skill_file.stat().st_mtime
                            if system_mtime > user_mtime:
                                should_update = True

                        if should_update:
                            if user_skill_folder.exists():
                                shutil.rmtree(user_skill_folder)
                            shutil.copytree(skill_folder, user_skill_folder)
                            logger.info(f"Updated skill '{skill_folder.name}' from system to user directory")

            # 2. 然后从用户的skills目录加载
            if user_skills_dir.exists() and list(user_skills_dir.glob("*/SKILL.md")):
                skills_loader = SkillLoader(skills_dir=str(user_skills_dir))

            if skills_loader and skills_loader.skills:
                self._agent_skills_tools = [get_agent_skills_tool(descriptions=skills_loader.get_descriptions())]
            else:
                self._agent_skills_tools = []

        except Exception as e:
            error_msg = f"Failed to load skills: {str(e)}"
            logger.error(f"Error in update_user_skills: {e}")
            logger.error(traceback.format_exc())
            # 保持之前的工具配置
            self._agent_skills_tools = [] if not hasattr(self, '_agent_skills_tools') else self._agent_skills_tools

        return skills_loader, error_msg
    
    async def update_user_tools(self) -> Tuple[str, List[str]]:
        """将用户的自定义配置工具接入到agent中

        Returns:
            Tuple[str, List[str]]: (user_local_tools_prompt, error_messages)
        """
        user_mcp_tools = []
        user_local_tools = []
        error_messages = []

        try:
            tools_config = self._user_profile_manager.load_user_tools_config()
        except Exception as e:
            error_msg = f"Failed to load TOOLS_CONFIG.json: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            error_messages.append(error_msg)
            # 返回空配置
            return "", error_messages

        # 逐个加载工具，收集错误但不中断
        for idx, tool in enumerate(tools_config):
            tool_type = tool.get("type", "unknown")
            try:
                if tool_type == "mcp-std":
                    config = tool.get("config")
                    if "command" in config and "args" in config:
                        std_mcp_tools = await mcp_server_tools(StdioServerParams(
                            command=config["command"],
                            args=config["args"]
                        ))
                        user_mcp_tools.extend(std_mcp_tools)
                    else:
                        error_messages.append(f"Tool #{idx+1} (mcp-std): Missing 'command' or 'args' in config")
                elif tool_type == "mcp-sse":
                    config = tool.get("config")
                    if "url" in config:
                        sse_mcp_tools = await mcp_server_tools(SseServerParams(
                            url=config["url"],
                            headers = config.get("headers", None),
                            timeout=config.get("timeout", float(20)),
                            sse_read_timeout=config.get("sse_read_timeout", float(300)),
                        ))
                        user_mcp_tools.extend(sse_mcp_tools)
                    else:
                        error_messages.append(f"Tool #{idx+1} (mcp-sse): Missing 'url' in config")
                else:
                    config = tool.get("config")
                    user_local_tools.append(str(config)+"\n")

            except Exception as e:
                error_msg = f"Tool #{idx+1} ({tool_type}): {str(e)}"
                logger.warning(f"Error loading tool: {error_msg}")
                error_messages.append(error_msg)
                # 继续加载其他工具

        # 更新工具列表
        self._workbench._tools = self._tools + user_mcp_tools
        self._tools_names = [tool.name for tool in self._workbench._tools ]

        # 生成本地工具提示
        if user_local_tools:
            user_local_tools_prompt = "The info about the user's local function is as follows. When needed, you can execute it on the command line using `run_bash` tool\n\n"
            user_local_tools_prompt += "\n".join(user_local_tools)
        else:
            user_local_tools_prompt = ""

        return user_local_tools_prompt, error_messages
    
    def get_subagent_descriptions(self, sub_agent_config: dict) -> str:
        """Generate agent type descriptions for system prompt."""
        return "\n".join(
            f"- {name}: {cfg['description']}"
            for name, cfg in sub_agent_config.items()
        )
    
    def update_user_subagents(self):
        """Update user subagents."""
        subagents_config = self._user_profile_manager.load_subagents_config()
        self._user_sub_agents.update(subagents_config)

        if self._user_sub_agents:
            self._sub_agent_descriptions = self.get_subagent_descriptions(sub_agent_config = self._user_sub_agents)
            self._subagent_tools = [
                get_subagent_tools(
                    sub_agents=list(self._user_sub_agents.keys()),
                    description=self._sub_agent_descriptions)]
        else:
            self._sub_agent_descriptions = ""
            self._subagent_tools = []

    async def run_stream(
        self,
        *,
        task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | TaskResult, None]:
        """Run the agent with the given task and return a stream of messages
        and the final task result as the last item in the stream."""
        if cancellation_token is None:
            cancellation_token = CancellationToken()
        self._cancellation_token = cancellation_token
        input_messages: List[BaseChatMessage] = []
        output_messages: List[BaseAgentEvent | BaseChatMessage] = []
        if task is None:
            pass
        elif isinstance(task, str):
            text_msg = TextMessage(content=task, source="user", metadata={"internal": "yes"})
            # text_msg = TextMessage(content=task, source="user")
            input_messages.append(text_msg)
            output_messages.append(text_msg)
            yield text_msg
        elif isinstance(task, BaseChatMessage):
            task.metadata["internal"] = "yes"
            input_messages.append(task)
            output_messages.append(task)  
            yield task
        else:
            if not task:
                raise ValueError("Task list cannot be empty.")
            for msg in task:
                if isinstance(msg, BaseChatMessage):
                    msg.metadata["internal"] = "yes"
                    input_messages.append(msg)
                    output_messages.append(msg)
                    try:
                        files=[]
                        attached_files_json = msg.metadata.get("attached_files") or msg.metadata.get("files")
                        if attached_files_json:
                            attached_files = json.loads(attached_files_json)
                            for file in attached_files:
                                download_file_from_url_or_base64(
                                    file_info = file, 
                                    save_path = f"{self._user_profile_manager.download_dir}/{file['name']}")
                                files.append(f"{self._user_profile_manager.download_dir}/{file['name']}")
                        if files:
                            msg.content = msg.content + "\nThe files uploaded by the user are as follows:\n" + "\n".join(files)
                        # 由于不同模型的tool call格式的限制，不允许在同一个session中切换模型
                        # settings_config = msg.metadata.get("settings_config")
                        # if settings_config:
                        #     settings_config = json.loads(settings_config)
                        #     default_config_name = settings_config.get("defult_config_name")
                        #     llm_name = self._llm_mode_config.get(default_config_name)
                        #     if llm_name != self._model_client._create_args["model"] and self._set_model_client:
                        #         self._model_client = self._set_model_client(default_config_name)
                    except Exception as e:
                        logger.error(f"Error processing message metadata: {e}")
                    yield msg
                else:
                    raise ValueError(f"Invalid message type in sequence: {type(msg)}")
        async for message in self.on_messages_stream(input_messages, cancellation_token):
            if isinstance(message, Response):
                yield message.chat_message
                output_messages.append(message.chat_message)
                yield TaskResult(messages=output_messages)
            else:
                yield message
                if isinstance(message, ModelClientStreamingChunkEvent):
                    # Skip the model client streaming chunk events.
                    continue
                output_messages.append(message)
                
    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Process the incoming messages with the assistant agent and yield events/responses as they happen.
        """

        # monitor the pause event
        if self.is_paused:
            yield Response(
                chat_message=TextMessage(
                    content=f"The {self.name} is paused.",
                    source=self.name,
                    metadata={"internal": "yes"},
                )
            )
            return

        inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
        try:
            # task completion notifications
            if self._task_manager:
                notifications:List[TaskNotification] = self._task_manager.get_pending_notifications(self._user_id)
                if notifications:
                    yield await self._emit_notification(self._format_task_notifications(notifications))

            # initialize memory documents
            await self._init_memory_documents()

            # config reload checks — warnings injected into context and yielded to user
            for warning in await self._run_startup_checks():
                yield await self._emit_notification(warning)
            skills_loader = self._cached_skills_loader

            # manager ToolSchema
            manager_tools = self._update_user_config_tools+self._agent_skills_tools+self._subagent_tools+self._todo_tools+self._scheduled_task_tools

            # count the number of tools
            if isinstance(self._model_context, DrSaiChatCompletionContext):
                self._model_context._tool_schema = await self._workbench.list_tools()
                self._model_context._tool_schema += manager_tools

            # Gather all relevant state here
            agent_name = self._user_profile_manager.agent_name
            model_context = self._model_context
            memory = self._memory
            system_messages = self._system_messages
            workbench = self._workbench
            handoff_tools = self._handoff_tools
            handoffs = self._handoffs
            model_client = self._model_client
            model_client_stream = self._model_client_stream
            reflect_on_tool_use = self._reflect_on_tool_use
            tool_call_summary_format = self._tool_call_summary_format
            output_content_type = self._output_content_type
            format_string = self._output_content_type_format
            
            # Add new user/handoff messages to the model context
            await self._add_messages_to_context(
                model_context=model_context,
                messages=messages,
            )

            # check commands mode
            last_message_content = messages[-1].content
            if self.is_commands_mode(last_message_content):
                async for message in self.on_messages_stream_commands(
                    last_message_content = last_message_content,
                ):
                    yield message
                return

            # Check if there's a default subagent set for this thread
            default_subagent_name = self._user_profile_manager.get_default_subagent(self._thread_id)
            if default_subagent_name and default_subagent_name in self._user_sub_agents:
                # Route to default subagent
                async for message in self._handle_default_subagent_mode(
                    messages=messages,
                    default_subagent_name=default_subagent_name,
                    agent_name=agent_name,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    model_context=model_context,
                    cancellation_token=cancellation_token,
                    output_content_type=output_content_type,
                ):
                    yield message
                # Always return after handling default subagent (success or error)
                return

            # TODO: Update model context with any relevant memory -> When? How?

            turn_count = 0
            max_empty_turn = 3 
            empty_turn_count = 0
            while turn_count < self._max_turn_count:
                
                model_result = None
                async for inference_output in self._call_llm(
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    system_messages=system_messages,
                    model_context=model_context,
                    workbench=workbench,
                    handoff_tools=handoff_tools,
                    manager_tools=manager_tools,
                    agent_name=agent_name,
                    cancellation_token=cancellation_token,
                    output_content_type=output_content_type,
                ):
                    if self.is_paused:
                        raise asyncio.CancelledError()
                    
                    if isinstance(inference_output, CreateResult):
                        model_result = inference_output
                    else:
                        # Streaming chunk event
                        yield inference_output

                assert model_result is not None, "No model result was produced."

                # --- NEW: If the model produced a hidden "thought," yield it as an event ---
                if model_result.thought:
                    thought_event = ThoughtEvent(content=model_result.thought, source=agent_name)
                    yield thought_event
                    inner_messages.append(thought_event)

                # Add the assistant message to the model context (including thought if present)  
                await model_context.add_message(
                    AssistantMessage(
                        content=model_result.content,
                        source=self._name,
                        thought=getattr(model_result, "thought", None),
                    )
                )
                
                # If direct text response (string)
                if isinstance(model_result.content, str):

                    if not model_result.content and empty_turn_count < max_empty_turn:
                        empty_turn_count += 1
                        await self._model_context.add_message(
                            UserMessage(
                                content=f"Your reply is empty. Please continue with the task above.",
                                source="user"
                            )
                        )
                        continue
                    elif not model_result.content and empty_turn_count >= max_empty_turn:
                        model_result.content = "The response is empty. Please try again or create a new session."
                    else:
                        empty_turn_count = 0

                    reponse = await self.handle_str_reponse(
                        model_result = model_result,
                        agent_name = agent_name,
                        format_string = format_string,
                        inner_messages = inner_messages,
                        output_content_type = output_content_type,)
                    if self._user_profile_manager.first_time_setup:
                        yield TextMessage(
                            content="\n\n(●'◡'●)如果您需要调整我的名称、我对您的称呼、您涉及领域，请告诉我，我来调整(If you need to adjust my name, how I address you, or your field of expertise, please let me know, and I will make the changes).",
                            source=agent_name,
                            metadata={"internal": "no"},
                        )
                        self._user_profile_manager.first_time_setup = False
                    yield reponse
                    break

                # Otherwise, we have function calls
                assert isinstance(model_result.content, list) and all(
                    isinstance(item, FunctionCall) for item in model_result.content
                )

                # Process all tool calls through unified _process_model_result
                async for message in self._process_model_result(
                    model_result=model_result,
                    inner_messages=inner_messages,
                    cancellation_token=cancellation_token,
                    agent_name=agent_name,
                    system_messages=system_messages,
                    model_context=model_context,
                    workbench=workbench,
                    handoff_tools=handoff_tools,
                    handoffs=handoffs,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    reflect_on_tool_use=reflect_on_tool_use,
                    tool_call_summary_format=tool_call_summary_format,
                    tool_call_summary_prompt=self._tool_call_summary_prompt,
                    output_content_type=output_content_type,
                    format_string=format_string,
                    skills_loader=skills_loader,
                ):
                    if isinstance(message, Response):
                        yield message.chat_message
                    else:
                        yield message

                turn_count += 1
                if turn_count >= self._max_turn_count:
                    yield Response(
                        chat_message=TextMessage(
                            content="\n\n(●'◡'●)抱歉，已达最大的任务循环次数，触发了保护措施，请重新调整您的询问方式或者更具体的告诉您的助手应该怎么做。",
                            source=agent_name,
                            metadata={"internal": "no"},
                        inner_messages=inner_messages,
                    ))
                    return

        except asyncio.CancelledError:
            # If the task is cancelled, we respond with a message.
            yield Response(
                chat_message=TextMessage(
                    content="The task was cancelled by the user.",
                    source=self._user_profile_manager.agent_name,
                    metadata={"internal": "yes"},
                ),
                inner_messages=inner_messages,
            )
        except Exception as e:
            logger.error(f"Error in {self._user_profile_manager.agent_name}: {e}")
            logger.error(traceback.format_exc())
            # add to chat history
            await self._model_context.add_message(
                UserMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self._name
                )
            )
            yield Response(
                chat_message=TextMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self._user_profile_manager.agent_name,
                    metadata={"internal": "no"},
                ),
                inner_messages=inner_messages,
            )
        finally:

            # if the last message is a tool call, we need to repair it
            msgs = self._model_context._messages
            if msgs and isinstance(msgs[-1], AssistantMessage):
                last = msgs[-1]
                if isinstance(last.content, list) and all(
                    isinstance(c, FunctionCall) for c in last.content
                ):
                    logger.info("Repairing unpaired tool_call after pause/cancel")
                    await self._model_context.add_message(
                        FunctionExecutionResultMessage(content=[
                            FunctionExecutionResult(
                                content=f"{fc.name} was cancelled.",
                                name=fc.name,
                                call_id=fc.id,
                                is_error=False,
                            ) for fc in last.content
                        ])
                    )

            # save/update the conversation to {worker_dir}/memories
            if isinstance(self._model_context, DrSaiChatCompletionContext):
                if self._model_context._rag_flow_manager:
                    await self._model_context.upload_conversation_to_ragflow()
                self._model_context._current_messages = []
                current_session_memory = self._model_context._history_messages
                # TODO: 周期性总结用户的对话，形成一个总结
                self._user_profile_manager.save_session_memory(current_session_memory)
                

    async def _get_messages_with_compression_notification(
        self,
        model_context: ChatCompletionContext,
        cancellation_token: CancellationToken = None,
    ) -> AsyncGenerator[Union[List[LLMMessage], AgentLogEvent], None]:
        """
        Get messages from context with compression notification support.

        Yields:
            AgentLogEvent: Notification events during compression
            List[LLMMessage]: Final list of messages
        """
        if isinstance(model_context, DrSaiChatCompletionContext):
            # Check if compression is needed
            messages = list(model_context._messages)
            token_count = model_context._model_client.count_tokens(
                messages,
                tools=model_context._tool_schema
            )

            if model_context._token_limit and token_count > model_context._token_limit:
                # Notify frontend that compression is starting
                yield AgentLogEvent(
                    source="system",
                    title="Memory Compression",
                    content="正在压缩对话记忆以优化性能，这可能需要几分钟时间，请稍候...",
                    send_level=Send_level.INFO
                )

            # Get messages (compression will happen if needed)
            all_messages = await model_context.get_messages(
                cancellation_token=cancellation_token
            )

            if model_context._token_limit and token_count > model_context._token_limit:
                # Notify completion
                yield AgentLogEvent(
                    source="system",
                    title="Memory Compression Complete",
                    content="对话记忆压缩完成，继续处理您的请求...",
                    send_level=Send_level.INFO
                )

            yield all_messages
        else:
            all_messages = await model_context.get_messages()
            yield all_messages

    async def _call_llm(
        self,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
        manager_tools: List[ToolSchema],
        agent_name: str,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
        """
        Perform a model inference and yield either streaming chunk events or the final CreateResult.
        """

        # Get messages with compression notification
        all_messages = None
        async for item in self._get_messages_with_compression_notification(
            model_context, cancellation_token
        ):
            if isinstance(item, list):
                all_messages = item
            else:
                # Yield notification events
                yield item

        if all_messages is None:
            raise ValueError("Failed to get messages from context")
        
        llm_messages: List[LLMMessage] = self._get_compatible_context(model_client=model_client, messages=system_messages + all_messages)

        # 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        if self._memory_function is not None:
            llm_messages = await self._call_memory_function(llm_messages, model_client, cancellation_token, agent_name)

        all_tools = (await workbench.list_tools()) + handoff_tools + manager_tools
        # model_result: Optional[CreateResult] = None
        if self._reply_function is not None:
            # 自定义的reply_function，用于自定义对话回复的定制
            async for chunk in self._call_reply_function(
                llm_messages, 
                model_client = model_client, 
                workbench=workbench,
                handoff_tools=handoff_tools,
                tools = all_tools,
                agent_name=agent_name, 
                cancellation_token=cancellation_token,
                db_manager=self._db_manager,
            ):
                # if isinstance(chunk, CreateResult):
                #     model_result = chunk
                yield chunk
        else:
           async for chunk in self.call_llm(
                agent_name = agent_name,
                model_client = model_client,
                llm_messages = llm_messages, 
                tools = all_tools, 
                model_client_stream = model_client_stream,
                cancellation_token = cancellation_token,
                output_content_type = output_content_type,
           ):
               yield chunk
    
    async def _handle_default_subagent_mode(
        self,
        messages: List[BaseChatMessage],
        default_subagent_name: str,
        agent_name: str,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Handle default subagent mode for the current thread.
        Routes all messages to the configured default subagent.
        """
        subagent = None
        try:
            # Get sub agent system prompt
            sub_system = f"""You are a {default_subagent_name} subagent at {self._work_dir}.

{self._user_sub_agents[default_subagent_name].get("prompt", "")}

Complete the task and return a clear, concise summary."""

            # Get subagent instance
            subagent = await self.get_sub_agent_instance(
                sub_agent_name=default_subagent_name,
                model_client=model_client,
                model_client_stream=model_client_stream,
                sub_system=sub_system,
                output_content_type=output_content_type,
            )

            # # Construct task messages with background context
            # task_messages: List[BaseChatMessage] = []
            # llm_messages = await model_context.get_messages()

            # # Add background context (limited to recent messages to avoid too much context)
            # background_message = "Below are the recent chat records for context:\n\n"
            # for llm_message in llm_messages[-10:]:  # Only last 10 messages
            #     if isinstance(llm_message, (UserMessage, AssistantMessage)):
            #         background_message += f"{llm_message.source}: {llm_message.content}\n\n"

            # task_messages.append(TextMessage(content=background_message, source="user"))

            # Process with subagent
            async for message in subagent.on_messages_stream(
                messages=messages,
                cancellation_token=cancellation_token
            ):
                if isinstance(message, Response):
                    # Add subagent response to model context
                    await model_context.add_message(
                        AssistantMessage(
                            content=str(message.chat_message.content),
                            source=default_subagent_name,
                        )
                    )
                    yield message
                yield message

        except Exception as e:
            logger.error(f"Error routing to default subagent {default_subagent_name}: {e}")
            logger.error(traceback.format_exc())
            yield Response(
                chat_message=TextMessage(
                    content=f"⚠️ 使用默认子智能体 **{default_subagent_name}** 时出错:\n\n```\n{str(e)}\n```\n\n💡 使用 `/agent clear` 清除默认子智能体设置。\n\n---\n\n⚠️ Error using default subagent **{default_subagent_name}**:\n\n```\n{str(e)}\n```\n\n💡 Use `/agent clear` to clear default subagent setting.",
                    source=agent_name,
                    metadata={"internal": "no"},
                )
            )
        finally:
            # 确保无论如何都要关闭 subagent，防止资源泄漏
            if subagent:
                try:
                    await subagent.close()
                    logger.debug(f"Successfully closed subagent: {default_subagent_name}")
                except Exception as close_error:
                    logger.warning(f"Error closing subagent {default_subagent_name}: {close_error}")

    def is_commands_mode(self, text: str) -> bool:
        """Check if the message is a command."""
        text = str(text).strip().lower()
        if text in ["/help", "/agents", "/agent clear", "/agent reset"]:
            return True
        elif text.startswith("/agent "):
            return True
        return False

    def extract_command(self, text: str) -> Tuple[str, str]:
        """Extract command type and argument from text.

        Returns:
            Tuple[str, str]: (command_type, argument)
        """
        text = str(text).strip()
        if text.lower() == "/help":
            return "help", ""
        elif text.lower() == "/agents":
            return "agents", ""
        elif text.lower() in ["/agent clear", "/agent reset"]:
            return "agent_clear", ""
        elif text.lower().startswith("/agent "):
            # Extract agent name after /agent
            parts = text.split(maxsplit=1)
            agent_name = parts[1] if len(parts) > 1 else ""
            return "agent", agent_name.strip()
        return "unknown", ""
    async def on_messages_stream_commands(
        self,
        last_message_content: str 
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """Handle command-based interactions."""
        # Get the last message content
        last_message_content = str(last_message_content).strip()

        # Extract command
        command_type, argument = self.extract_command(last_message_content)
        agent_name = self._user_profile_manager.agent_name

        if command_type == "help":
            # Display help text
            yield Response(
                chat_message=TextMessage(
                    content=HELP_TEXT,
                    source=agent_name,
                    metadata={"internal": "no"},
                )
            )

        elif command_type == "agents":
            # Display available subagents
            if not self._user_sub_agents:
                response_text = "当前没有可用的子智能体。\n\nNo subagents available."
            else:
                response_text = "可用的子智能体列表：\n\nAvailable subagents:\n\n"
                for name, config in self._user_sub_agents.items():
                    description = config.get("description", "No description")
                    response_text += f"- **{name}**: {description}\n"
                response_text += "\n使用 `/agent <agent_name>` 切换到指定的子智能体。\n\nUse `/agent <agent_name>` to switch to a specific subagent."

            yield Response(
                chat_message=TextMessage(
                    content=response_text,
                    source=agent_name,
                    metadata={"internal": "no"},
                )
            )

        elif command_type == "agent":
            # Switch to specified subagent
            if not argument:
                yield Response(
                    chat_message=TextMessage(
                        content="请指定子智能体名称。例如：`/agent code_executor`\n\nPlease specify the subagent name. Example: `/agent code_executor`",
                        source=agent_name,
                        metadata={"internal": "no"},
                    )
                )
                return

            if argument not in self._user_sub_agents:
                available_agents = ", ".join(self._user_sub_agents.keys())
                yield Response(
                    chat_message=TextMessage(
                        content=f"子智能体 `{argument}` 不存在。\n\n可用的子智能体: {available_agents}\n\nSubagent `{argument}` not found.\n\nAvailable subagents: {available_agents}",
                        source=agent_name,
                        metadata={"internal": "no"},
                    )
                )
                return

            # Save the selected subagent to thread config
            try:
                self._user_profile_manager.set_default_subagent(self._thread_id, argument)

                description = self._user_sub_agents[argument].get("description", "")
                response_text = f"✅ 已为当前会话设置默认子智能体: **{argument}**\n\n"
                response_text += f"📝 描述: {description}\n\n"
                response_text += f"💡 从现在开始，此会话中的所有消息都将由 **{argument}** 子智能体处理。\n\n"
                response_text += f"🔄 使用 `/agent clear` 可以取消此设置。\n\n"
                response_text += f"---\n\n"
                response_text += f"✅ Default subagent set for current session: **{argument}**\n\n"
                response_text += f"📝 Description: {description}\n\n"
                response_text += f"💡 From now on, all messages in this session will be handled by **{argument}**.\n\n"
                response_text += f"🔄 Use `/agent clear` to cancel this setting."

                yield Response(
                    chat_message=TextMessage(
                        content=response_text,
                        source=agent_name,
                        metadata={"internal": "no"},
                    )
                )
            except Exception as e:
                logger.error(f"Error saving thread config: {e}")
                yield Response(
                    chat_message=TextMessage(
                        content=f"保存配置时出错: {str(e)}\n\nError saving configuration: {str(e)}",
                        source=agent_name,
                        metadata={"internal": "no"},
                    )
                )

        elif command_type == "agent_clear":
            # Clear default subagent for current thread
            try:
                current_subagent = self._user_profile_manager.get_default_subagent(self._thread_id)

                if not current_subagent:
                    yield Response(
                        chat_message=TextMessage(
                            content="当前会话没有设置默认子智能体。\n\nNo default subagent is currently set for this session.",
                            source=agent_name,
                            metadata={"internal": "no"},
                        )
                    )
                    return

                self._user_profile_manager.clear_default_subagent(self._thread_id)

                response_text = f"✅ 已取消当前会话的默认子智能体设置（之前为: **{current_subagent}**）\n\n"
                response_text += f"💡 现在将恢复使用主智能体 **{agent_name}** 处理消息。\n\n"
                response_text += f"---\n\n"
                response_text += f"✅ Default subagent cleared (was: **{current_subagent}**)\n\n"
                response_text += f"💡 Now returning to main agent **{agent_name}**."

                yield Response(
                    chat_message=TextMessage(
                        content=response_text,
                        source=agent_name,
                        metadata={"internal": "no"},
                    )
                )
            except Exception as e:
                logger.error(f"Error clearing thread config: {e}")
                yield Response(
                    chat_message=TextMessage(
                        content=f"清除配置时出错: {str(e)}\n\nError clearing configuration: {str(e)}",
                        source=agent_name,
                        metadata={"internal": "no"},
                    )
                )
        else:
            yield Response(
                chat_message=TextMessage(
                    content=f"未知命令。使用 `/help` 查看可用命令。\n\nUnknown command. Use `/help` to see available commands.",
                    source=agent_name,
                    metadata={"internal": "no"},
                )
            )

    async def _process_model_result(
        self,
        model_result: CreateResult,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        cancellation_token: CancellationToken,
        agent_name: str,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
        handoffs: Dict[str, HandoffBase],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        reflect_on_tool_use: bool,
        tool_call_summary_format: str,
        tool_call_summary_prompt: str | None,
        output_content_type: type[BaseModel] | None,
        format_string: str | None = None,
        skills_loader: SkillLoader | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Handle final or partial responses from model_result, including tool calls, handoffs,
        and reflection if needed. Now supports all special tools.
        """

        tool_call_msg = ToolCallRequestEvent(
            content=model_result.content,
            source=agent_name,
            models_usage=model_result.usage,
        )
        inner_messages.append(tool_call_msg)
        logger.debug(tool_call_msg)
        yield tool_call_msg
        tools_name = [tool.name for tool in model_result.content]
        yield AgentLogEvent(
            title="I am using tools: " + " ".join(tools_name),
            source=agent_name,
            content=str(tool_call_msg.content),
            content_type="tools")

        # STEP 4B: Execute tool calls with special tool handling
        exec_results: List[FunctionExecutionResult] = []

        for idx, tool_call in enumerate(model_result.content):
            tool_name = tool_call.name
            call_id = tool_call.id

            # Check for pause/cancellation before executing each tool
            if self.is_paused or cancellation_token.is_cancelled():
                # Add cancellation result for current and all remaining tools
                for remaining_tool in model_result.content[idx:]:
                    exec_results.append(FunctionExecutionResult(
                        content=f"{remaining_tool.name} was cancelled.",
                        name=remaining_tool.name,
                        call_id=remaining_tool.id,
                        is_error=False,
                    ))
                break

            # Parse arguments
            try:
                arguments = fix_and_parse_json(tool_call.arguments)
                if isinstance(arguments, str):
                    # JSON parsing error
                    exec_results.append(FunctionExecutionResult(
                        content=arguments,
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))
                    continue
            except Exception as e:
                exec_results.append(FunctionExecutionResult(
                    content=f"Error parsing arguments: {e}",
                    name=tool_name,
                    call_id=call_id,
                    is_error=True,
                ))
                continue

            # Handle special tools
            if tool_name == "Skill":
                # Skill tool handling
                try:
                    if skills_loader is None:
                        raise ValueError("Skills loader not available")
                    skill_content = skills_loader.run_skill(arguments["skill"])
                    exec_results.append(FunctionExecutionResult(
                        content=f"Skill for {arguments['skill']}:\n\n {skill_content}",
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))
                    # Yield events immediately for real-time feedback
                    yield AgentLogEvent(
                        title=f"I am reading skill: {arguments['skill']}.",
                        source=agent_name,
                        content=str(arguments),
                        content_type="tools"
                    )
                    yield ToolCallSummaryMessage(
                        content=f"<think>Skill for {arguments['skill']}:\n\n {skill_content}</think>\n",
                        source=agent_name,
                    )
                except Exception as e:
                    logger.exception(f"Error executing Skill tool: {e}")
                    exec_results.append(FunctionExecutionResult(
                        content=f"Error: {str(e)}",
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))

            elif tool_name == "TodoWrite":
                # TodoWrite tool handling
                try:
                    todo_list = self._todo_manager.update(arguments["items"])
                    exec_results.append(FunctionExecutionResult(
                        content=self._todo_manager.get_task_prompt(),
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))
                    # Yield text message immediately for user visibility
                    yield TextMessage(
                        content=todo_list,
                        source=agent_name,
                        metadata={"interal": "no"},
                    )
                except Exception as e:
                    logger.exception(f"Error executing TodoWrite tool: {e}")
                    exec_results.append(FunctionExecutionResult(
                        content=str(e),
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))
                    yield TextMessage(
                        content=str(e) + "\n\n",
                        source=agent_name,
                        metadata={"interal": "no"},
                    )
                    yield StopMessage(
                        content=str(e),
                        source=agent_name,
                    )
                    # Early return on critical error
                    return

            elif tool_name == "Task":
                # Subagent Task tool handling
                try:
                    description, prompt, sub_agent_name = arguments["description"], arguments["prompt"], arguments["agent_type"]

                    # Get sub agent system prompt
                    sub_system = f"""You are a {sub_agent_name} subagent at {self._work_dir}.

    {self._user_sub_agents[sub_agent_name].get("prompt", "")}

    Complete the task and return a clear, concise summary."""

                    # Construct task messages
                    task_messages: Sequence[BaseChatMessage] = []
                    llm_messages = await model_context.get_messages()
                    backgroud_message = "Below are the historical chat records between the user and various intelligent assistants, which can be referenced when executing the current task.\n\n"
                    for llm_message in llm_messages:
                        if isinstance(llm_message, UserMessage) or isinstance(llm_message, AssistantMessage):
                            backgroud_message += f"{llm_message.source}: {llm_message.content}\n\n"
                    task_messages.append(TextMessage(content=backgroud_message, source="user"))
                    task_messages.append(TextMessage(content=f"Current task: \n\n{prompt}", source="user"))

                    # Execute subagent
                    subagent = await self.get_sub_agent_instance(
                        sub_agent_name=sub_agent_name,
                        model_client=model_client,
                        model_client_stream=model_client_stream,
                        sub_system=sub_system,
                        output_content_type=output_content_type,
                    )

                    task_result_content = ""
                    # Stream subagent messages immediately for real-time feedback
                    async for message in subagent.on_messages_stream(messages=task_messages, cancellation_token=cancellation_token):
                        if isinstance(message, Response):
                            task_result_content = str(message.chat_message.content)
                            yield message.chat_message
                            break
                        yield message  # Yield immediately for streaming experience

                    # Add result
                    exec_results.append(FunctionExecutionResult(
                        content=task_result_content,
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))

                    # Close subagent
                    try:
                        await subagent.close()
                    except Exception as close_error:
                        logger.warning(f"Error closing subagent {sub_agent_name}: {close_error}")

                except Exception as e:
                    logger.exception(f"Error executing Task tool: {e}")
                    exec_results.append(FunctionExecutionResult(
                        content=f"Error: {str(e)}",
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))
                    yield TextMessage(
                        content=str(e) + "\n\n",
                        source=agent_name,
                        metadata={"interal": "no"},
                    )
                    yield StopMessage(
                        content=str(e),
                        source=agent_name,
                    )
                    # Early return on critical error
                    return

            elif tool_name == "UpdateUserConfig":
                # UpdateUserConfig tool handling
                try:
                    update_message = self._user_profile_manager.update_user_config(**arguments)
                    exec_results.append(FunctionExecutionResult(
                        content=update_message,
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))
                    # Yield log event immediately
                    yield AgentLogEvent(
                        title=f"I am updating user's config.",
                        source=agent_name,
                        content=str(arguments),
                        content_type="tools"
                    )
                except Exception as e:
                    logger.exception(f"Error executing UpdateUserConfig tool: {e}")
                    exec_results.append(FunctionExecutionResult(
                        content=f"Error: {str(e)}",
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))

            elif tool_name == "ScheduledTaskManager":
                # ScheduledTaskManager tool handling
                try:
                    from .managers import ScheduledTask, ScheduleType, TaskStatus

                    if self._task_manager is None:
                        error_msg = "定时任务管理器未初始化。请联系管理员(ScheduledTaskManager not initialized.)。\n\n"
                        exec_results.append(FunctionExecutionResult(
                            content=error_msg,
                            name=tool_name,
                            call_id=call_id,
                            is_error=True,
                        ))
                        yield TextMessage(
                            content=error_msg,
                            source=agent_name,
                            metadata={"internal": "no"},
                        )
                        continue

                    operation = arguments.get("operation")
                    result_content = ""

                    if operation == "create":
                        execution_context = {
                            "defult_config_name": getattr(self, '_defult_config_name', None),
                        }
                        task = ScheduledTask(
                            user_id=self._user_id,
                            session_id=self._thread_id,
                            task_name=arguments["task_name"],
                            task_description=arguments.get("task_description"),
                            prompt=arguments["prompt"],
                            schedule_type=ScheduleType(arguments["schedule_type"]),
                            schedule_config=arguments["schedule_config"],
                            timeout=arguments.get("timeout", 300),
                            save_history=arguments.get("save_history", True),
                            execution_context=execution_context,
                        )
                        task_id = self._task_manager.add_task(task)
                        result_content = f"✅ 定时任务创建成功！\n\n"
                        result_content += f"**任务ID:** `{task_id}`\n"
                        result_content += f"**任务名称:** {task.task_name}\n"
                        result_content += f"**调度类型:** {task.schedule_type}\n"
                        result_content += f"**调度配置:** {task.schedule_config}\n"
                        result_content += f"**下次执行:** {task.next_run}\n"

                    elif operation == "list":
                        session_id = arguments.get("session_id")
                        status = TaskStatus(arguments["status"]) if arguments.get("status") else None
                        tasks = self._task_manager.list_tasks(
                            user_id=self._user_id,
                            session_id=session_id,
                            status=status
                        )
                        if not tasks:
                            result_content = "当前没有定时任务(No scheduled tasks)。\n\n"
                        else:
                            result_content = f"共有 {len(tasks)} 个定时任务：\n\n"
                            for task in tasks:
                                result_content += f"- **{task.task_name}** (`{task.task_id}`)\n"
                                result_content += f"  - 状态: {task.status.value}\n"
                                result_content += f"  - 调度: {task.schedule_type.value} - {task.schedule_config}\n"
                                result_content += f"  - 下次执行: {task.next_run or '无'}\n"
                                result_content += f"  - 执行次数: {task.run_count}\n\n"

                    elif operation == "get":
                        task_id = arguments["task_id"]
                        task = self._task_manager.get_task(task_id)
                        if task is None:
                            result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"
                        else:
                            result_content = f"## 任务详情\n\n"
                            result_content += f"**任务ID:** `{task.task_id}`\n"
                            result_content += f"**任务名称:** {task.task_name}\n"
                            result_content += f"**任务描述:** {task.task_description or '无'}\n"
                            result_content += f"**提示词:** {task.prompt}\n"
                            result_content += f"**调度类型:** {task.schedule_type.value}\n"
                            result_content += f"**调度配置:** {task.schedule_config}\n"
                            result_content += f"**状态:** {task.status.value}\n"
                            result_content += f"**创建时间:** {task.created_at}\n"
                            result_content += f"**上次执行:** {task.last_run or '从未执行'}\n"
                            result_content += f"**下次执行:** {task.next_run or '无'}\n"
                            result_content += f"**执行次数:** {task.run_count}\n"
                            result_content += f"**错误次数:** {task.error_count}\n"
                            if task.last_error:
                                result_content += f"**最后错误:** {task.last_error}\n"

                    elif operation == "delete":
                        task_id = arguments["task_id"]
                        success = self._task_manager.remove_task(task_id)
                        if success:
                            result_content = f"✅ 任务已删除(Task deleted successfully): `{task_id}`。\n\n"
                        else:
                            result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"

                    elif operation == "toggle":
                        task_id = arguments["task_id"]
                        enabled = arguments["enabled"]
                        task = self._task_manager.get_task(task_id)
                        if task is None:
                            result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"
                        else:
                            new_status = TaskStatus.ENABLED if enabled else TaskStatus.DISABLED
                            self._task_manager.update_task_status(task_id, new_status)
                            result_content = f"✅ 任务已{'启用' if enabled else '禁用'}: `{task_id}`"
                            result_content += f"Task {'enabled' if enabled else 'disabled'} successfully\n\n."

                    elif operation == "get_results":
                        task_id = arguments["task_id"]
                        limit = arguments.get("limit", 10)
                        results = self._task_manager.get_task_results(task_id, limit=limit)
                        if not results:
                            result_content = f"任务 `{task_id}` 没有执行历史(No execution history)。\n\n"
                        else:
                            result_content = f"任务 `{task_id}` 的执行历史（最近 {len(results)} 次）：\n\n"
                            for i, res in enumerate(results, 1):
                                result_content += f"{i}. **{res.start_time}**\n"
                                result_content += f"   - 状态: {res.status}\n"
                                result_content += f"   - 耗时: {res.duration:.2f}秒\n"
                                if res.error_message:
                                    result_content += f"   - 错误: {res.error_message}\n"
                                result_content += "\n"

                    elif operation == "get_outputs":
                        task_id = arguments["task_id"]
                        limit = arguments.get("limit", 10)
                        outputs = self._task_manager.get_task_outputs(task_id, limit=limit)
                        if not outputs:
                            result_content = f"任务 `{task_id}` 没有输出文件(No output files)。\n\n"
                        else:
                            result_content = f"任务 `{task_id}` 的输出文件（最近 {len(outputs)} 个）：\n\n"
                            for i, output in enumerate(outputs, 1):
                                result_content += f"{i}. **{output['timestamp']}**\n"
                                result_content += f"   - 文件: `{output['file_path']}`\n"
                                result_content += f"   - 大小: {output['size']} bytes\n"
                                result_content += f"   - 修改时间: {output['mtime']}\n\n"
                            result_content += "\n💡 使用 `read_output` 操作读取文件内容。\n"

                    elif operation == "read_output":
                        file_path = arguments["file_path"]
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                content = f.read()
                            result_content = f"## 输出文件内容\n\n**文件:** `{file_path}`\n\n---\n\n{content}"
                        except FileNotFoundError:
                            result_content = f"❌ 文件不存在(File not found): `{file_path}`\n\n."
                        except Exception as e:
                            result_content = f"❌ 读取文件失败(Failed to read file): {str(e)}\n\n."

                    else:
                        result_content = f"❌ 未知操作(Unknown operation): {operation}\n\n."

                    # Add result
                    exec_results.append(FunctionExecutionResult(
                        content=result_content,
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))
                    # Yield text message immediately for user visibility
                    yield TextMessage(
                        content=result_content,
                        source=agent_name,
                        metadata={"internal": "no"},
                    )

                except Exception as e:
                    logger.exception(f"Error executing ScheduledTaskManager tool: {e}")
                    error_content = f"❌ 执行定时任务操作失败(Failed to execute scheduled task operation): {str(e)}\n\n"
                    exec_results.append(FunctionExecutionResult(
                        content=error_content,
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))
                    yield TextMessage(
                        content=error_content,
                        source=agent_name,
                        metadata={"internal": "no"},
                    )

            else:
                # Normal tool execution through workbench or handoff
                try:
                    _, result = await self._execute_tool_call(
                        tool_call=tool_call,
                        workbench=workbench,
                        handoff_tools=handoff_tools,
                        agent_name=agent_name,
                        cancellation_token=cancellation_token,
                    )
                    exec_results.append(result)
                except Exception as e:
                    logger.exception(f"Error executing tool {tool_name}: {e}")
                    exec_results.append(FunctionExecutionResult(
                        content=f"Error: {str(e)}",
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ))

        # Add all execution results to model context (ensures tool calls and results are paired)
        await model_context.add_message(FunctionExecutionResultMessage(content=exec_results))

        # Generate tool call summary for non-handoff tools
        normal_tool_calls = [(call, result) for call, result in zip(model_result.content, exec_results)
                            if call.name not in handoffs]
        tool_call_summaries: List[str] = []
        for tool_call, tool_call_result in normal_tool_calls:
            tool_call_summaries.append(
                tool_call_summary_format.format(
                    tool_name=tool_call.name,
                    arguments=tool_call.arguments,
                    result=tool_call_result.content,
                )
            )
        tool_call_summary = "\n".join(tool_call_summaries)
        yield Response(
                chat_message=ToolCallSummaryMessage(
                    content="<think>The results of execution:\n " + tool_call_summary + "</think>\n",
                    source=agent_name,
                ),
                inner_messages=inner_messages,
            )

    async def handle_str_reponse(
            self,
            model_result: CreateResult,
            agent_name: str,
            format_string: str | None,
            inner_messages: List[BaseAgentEvent | BaseChatMessage],
            output_content_type: type[BaseModel] | None,
    ) -> Response:

        if output_content_type:
            content = output_content_type.model_validate_json(model_result.content)
            return Response(
                chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
                    content=content,
                    source=agent_name,
                    models_usage=model_result.usage,
                    format_string=format_string,
                ),
                inner_messages=inner_messages,
            )
        else:
            return Response(
                chat_message=TextMessage(
                    content=model_result.content,
                    source=agent_name,
                    models_usage=model_result.usage,
                ),
                inner_messages=inner_messages,
            )
    
    def get_tools_for_agent(self, agent_type: str) -> list:
        """Filter tools based on agent type."""
        allowed = self._user_sub_agents.get(agent_type, {}).get("tools", "*")
        if allowed == "*":
            return self._tools
        return [t for t in self._workbench._tools if t.name in allowed]

    async def get_sub_agent_instance(
            self,
            sub_agent_name: str,
            model_client: ChatCompletionClient,
            model_client_stream: bool = True,
            sub_system: Optional[str] = None,
            output_content_type: type[BaseModel] | None = None,
            ) -> DrSaiAgent:
        """
        获取子智能体实例

        注意: 此方法会为子智能体创建独立的 model_client 副本,
        避免子智能体关闭时影响全局的 model_client
        """
        # 为子智能体创建独立的 model_client 副本
        # 使用 dump_component 和 load_component 来创建深拷贝
        independent_model_client = None
        if model_client is not None:
            try:
                model_config = model_client.dump_component()
                independent_model_client = ChatCompletionClient.load_component(model_config)
                independent_model_client._model_info = model_client._model_info
            except Exception as e:
                logger.warning(f"Failed to create independent model_client for subagent {sub_agent_name}: {e}")
                logger.warning("Falling back to shared model_client (may cause issues when subagent is closed)")
                independent_model_client = model_client

        # Get agent
        if sub_agent_name in self._user_sub_agents:
            sub_agent = self._user_sub_agents[sub_agent_name]
            description=self._user_sub_agents[sub_agent_name].get("description", "")
            sub_agent_type = sub_agent.get("type")
            if sub_agent_type == "CodeExecutorAgent":
                venv_path = sub_agent.get("venv_path")
                if venv_path:
                    executor = create_local_venv(work_dir=venv_path)
                else:
                    executor = self._local_executor or create_local_venv(work_dir=self._user_profile_manager.tmp_dir)
                subagent = CodeExecutorAgent(
                    name=sub_agent_name,
                    code_executor=executor,
                    model_client_stream=model_client_stream,
                )
            elif sub_agent_type == "DrSaiAgent":
                tools = self.get_tools_for_agent(sub_agent_name)
                subagent = DrSaiAgent(
                    name=sub_agent_name,
                    system_message=sub_system,
                    description=description,
                    tools=tools,
                    model_client=independent_model_client,
                    model_client_stream=model_client_stream,
                    output_content_type=output_content_type,)
            elif sub_agent_type == "HepAIWorkerAgent":
                model_remote_configs = sub_agent.get("model_remote_configs")
                url = model_remote_configs.get("url", "https://aiapi.ihep.ac.cn/apiv2")
                name = model_remote_configs.get("name")
                # 使用原始 model_client 获取 api_key,因为这里只是读取配置,不会造成关闭问题
                api_key = model_client._client.api_key if model_client else None
                subagent = HepAIWorkerAgent(
                    name=sub_agent_name,
                    description=description,
                    model_remote_configs={
                        "url": url,
                        "api_key": api_key,
                        "name": name
                    },
                    chat_id=self._thread_id,
                    run_info={"name": self._user_profile_manager.user_id, "email": self._user_id},

                )
            elif sub_agent_type == "RemoteAgent":
                model_remote_configs = sub_agent.get("model_remote_configs", {})
                subagent = RemoteAgent(
                    name=sub_agent_name,
                    description=description,
                    model_remote_configs=model_remote_configs.copy() # 创建配置副本，避免原始配置被修改
                )
            await subagent.lazy_init()
            return subagent
        else:
            raise ValueError(f"Sub agent {sub_agent_name} not found")
        
    async def handle_subagent_repsonse(
        self,
        agent_name: str,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        argument:Dict[str, Any],
        tool_name: str,
        call_id: str,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """
        Sub agent can actuate the sub task.

        The types of sub agent:
        1. code_executor
        2. normal drsai agent
        3. worker agent
        """
        subagent = None
        try:
            description, prompt, sub_agent_name = argument["description"], argument["prompt"], argument["agent_type"]

            # get sub agent system prompt
            sub_system = f"""You are a {sub_agent_name} subagent at {self._work_dir}.

    {self._user_sub_agents[sub_agent_name].get("prompt", "")}

    Complete the task and return a clear, concise summary."""

            # construct task messages
            task_messages: Sequence[BaseChatMessage] = []
            llm_messages = await model_context.get_messages()
            # TODO: compress the background messages using  LLM
            backgroud_message = "Below are the historical chat records between the user and various intelligent assistants, which can be referenced when executing the current task.\n\n"
            for llm_message in llm_messages:
                if isinstance(llm_message, UserMessage) or isinstance(llm_message, AssistantMessage):
                    backgroud_message += f"{llm_message.source}: {llm_message.content}\n\n"
            task_messages.append(TextMessage(content=backgroud_message, source="user"))
            task_messages.append(TextMessage(content=f"Current task: \n\n{prompt}", source="user"))

            # Process task
            #  TODO: handle turn count fro multi-turn task.
            # turn_count = 0
            # while turn_count < self._max_turn_count:
            #     turn_count += 1
            subagent = await self.get_sub_agent_instance(
                sub_agent_name = sub_agent_name,
                model_client = model_client,
                model_client_stream = model_client_stream,
                sub_system = sub_system,
                output_content_type = output_content_type,
            )
            async for message in subagent.on_messages_stream(messages=task_messages, cancellation_token=cancellation_token):
                if isinstance(message, Response):
                    yield message.chat_message
                    # await model_context.add_message(
                    #     UserMessage(
                    #         content=str(message.chat_message.content),
                    #         source="user",
                    #     )
                    # )
                    await model_context.add_message(FunctionExecutionResultMessage(
                        content=[FunctionExecutionResult(
                            content = str(message.chat_message.content),
                            name = tool_name,
                            call_id = call_id,
                            is_error = False,
                        ),]
                    ))
                    return
                yield message

        except Exception as e:
            logger.exception(f"Error in {self.name}")
            yield ModelClientStreamingChunkEvent(
                content=str(e)+"\n\n",
                source=self.name,
            )
            # await model_context.add_message(
            #     UserMessage(
            #         content=str(e),
            #         source="user",
            #     )
            # )
            await model_context.add_message(FunctionExecutionResultMessage(
                content=[FunctionExecutionResult(
                    content = str(e),
                    name = tool_name,
                    call_id = call_id,
                    is_error = True,
                ),]
            ))
            yield StopMessage(
                content=str(e),
                source=agent_name,
            )
        finally:
            # 确保无论如何都要关闭 subagent，防止资源泄漏
            if subagent:
                try:
                    await subagent.close()
                    logger.debug(f"Successfully closed subagent: {sub_agent_name}")
                except Exception as close_error:
                    logger.warning(f"Error closing subagent {sub_agent_name}: {close_error}")

    async def handle_todo_write(
        self,
        argument: Dict[str, Any],
        tool_name: str,
        call_id: str,
        agent_name: str,
        model_context: ChatCompletionContext,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        try:
            todo_list = self._todo_manager.update(argument["items"])
            # send stream message
            # yield ModelClientStreamingChunkEvent(
            #     content=todo_list+"\n\n",
            #     source=self._user_profile_manager.agent_name,
            # )
            # add message to model_context with user source
            await model_context.add_message(FunctionExecutionResultMessage(
                content=[FunctionExecutionResult(
                    content = self._todo_manager.get_task_prompt(),
                    name = tool_name,
                    call_id = call_id,
                    is_error = False,
                ),]
            ))
            # await model_context.add_message(
            #     UserMessage(
            #         content=self._todo_manager.get_task_prompt(),
            #         source="user",
            #     )
            # )
            # send text message to save to db in drsai ui
            yield TextMessage(
                content=todo_list,
                source=self._user_profile_manager.agent_name,
                metadata={"interal": "no"},
            )
        except Exception as e:
            logger.exception(f"Error in {self.name}")
            yield TextMessage(
                content=str(e)+"\n\n",
                source=self._user_profile_manager.agent_name,
                metadata={"interal": "no"},
            )
            # await model_context.add_message(
            #     UserMessage(
            #         content=str(e),
            #         source="user",
            #     )
            # )
            await model_context.add_message(FunctionExecutionResultMessage(
                content=[FunctionExecutionResult(
                    content = str(e),
                    name = tool_name,
                    call_id = call_id,
                    is_error = True,
                ),]
            ))
            yield StopMessage(
                content=str(e),
                source=agent_name,
            )

    async def handle_scheduled_task(
        self,
        argument: Dict[str, Any],
        tool_name: str,
        call_id: str,
        agent_name: str,
        model_context: ChatCompletionContext,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """
        处理定时任务管理操作
        """
        try:
            from .managers import ScheduledTask, ScheduleType, TaskStatus

            if self._task_manager is None:
                error_msg = "定时任务管理器未初始化。请联系管理员(ScheduledTaskManager not initialized.)。\n\n"
                await model_context.add_message(FunctionExecutionResultMessage(
                    content=[FunctionExecutionResult(
                        content=error_msg,
                        name=tool_name,
                        call_id=call_id,
                        is_error=True,
                    ),]
                ))
                yield TextMessage(
                    content=error_msg,
                    source=agent_name,
                    metadata={"internal": "no"},
                )
                return

            operation = argument.get("operation")
            result_content = ""

            if operation == "create":
                # 创建新任务，捕获当前用户会话的执行上下文
                execution_context = {
                    "defult_config_name": getattr(self, '_defult_config_name', None),
                }
                task = ScheduledTask(
                    user_id=self._user_id,
                    session_id=self._thread_id,
                    task_name=argument["task_name"],
                    task_description=argument.get("task_description"),
                    prompt=argument["prompt"],
                    schedule_type=ScheduleType(argument["schedule_type"]),
                    schedule_config=argument["schedule_config"],
                    timeout=argument.get("timeout", 300),
                    save_history=argument.get("save_history", True),
                    execution_context=execution_context,
                )
                task_id = self._task_manager.add_task(task)
                result_content = f"✅ 定时任务创建成功！\n\n"
                result_content += f"**任务ID:** `{task_id}`\n"
                result_content += f"**任务名称:** {task.task_name}\n"
                result_content += f"**调度类型:** {task.schedule_type}\n"
                result_content += f"**调度配置:** {task.schedule_config}\n"
                result_content += f"**下次执行:** {task.next_run}\n"

            elif operation == "list":
                # 列出任务
                session_id = argument.get("session_id")
                status = TaskStatus(argument["status"]) if argument.get("status") else None
                tasks = self._task_manager.list_tasks(
                    user_id=self._user_id,
                    session_id=session_id,
                    status=status
                )
                if not tasks:
                    result_content = "当前没有定时任务(No scheduled tasks)。\n\n"
                else:
                    result_content = f"共有 {len(tasks)} 个定时任务：\n\n"
                    for task in tasks:
                        result_content += f"- **{task.task_name}** (`{task.task_id}`)\n"
                        result_content += f"  - 状态: {task.status.value}\n"
                        result_content += f"  - 调度: {task.schedule_type.value} - {task.schedule_config}\n"
                        result_content += f"  - 下次执行: {task.next_run or '无'}\n"
                        result_content += f"  - 执行次数: {task.run_count}\n\n"

            elif operation == "get":
                # 查询任务详情
                task_id = argument["task_id"]
                task = self._task_manager.get_task(task_id)
                if task is None:
                    result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"
                else:
                    result_content = f"## 任务详情\n\n"
                    result_content += f"**任务ID:** `{task.task_id}`\n"
                    result_content += f"**任务名称:** {task.task_name}\n"
                    result_content += f"**任务描述:** {task.task_description or '无'}\n"
                    result_content += f"**提示词:** {task.prompt}\n"
                    result_content += f"**调度类型:** {task.schedule_type.value}\n"
                    result_content += f"**调度配置:** {task.schedule_config}\n"
                    result_content += f"**状态:** {task.status.value}\n"
                    result_content += f"**创建时间:** {task.created_at}\n"
                    result_content += f"**上次执行:** {task.last_run or '从未执行'}\n"
                    result_content += f"**下次执行:** {task.next_run or '无'}\n"
                    result_content += f"**执行次数:** {task.run_count}\n"
                    result_content += f"**错误次数:** {task.error_count}\n"
                    if task.last_error:
                        result_content += f"**最后错误:** {task.last_error}\n"

            elif operation == "delete":
                # 删除任务
                task_id = argument["task_id"]
                success = self._task_manager.remove_task(task_id)
                if success:
                    result_content = f"✅ 任务已删除(Task deleted successfully): `{task_id}`。\n\n"
                else:
                    result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"

            elif operation == "toggle":
                # 启用/禁用任务
                task_id = argument["task_id"]
                enabled = argument["enabled"]
                task = self._task_manager.get_task(task_id)
                if task is None:
                    result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"
                else:
                    new_status = TaskStatus.ENABLED if enabled else TaskStatus.DISABLED
                    self._task_manager.update_task_status(task_id, new_status)
                    result_content = f"✅ 任务已{'启用' if enabled else '禁用'}: `{task_id}`"
                    result_content += f"Task {'enabled' if enabled else 'disabled'} successfully\n\n."

            elif operation == "get_results":
                # 查询执行历史
                task_id = argument["task_id"]
                limit = argument.get("limit", 10)
                results = self._task_manager.get_task_results(task_id, limit=limit)
                if not results:
                    result_content = f"任务 `{task_id}` 没有执行历史(No execution history)。\n\n"
                else:
                    result_content = f"任务 `{task_id}` 的执行历史（最近 {len(results)} 次）：\n\n"
                    for i, res in enumerate(results, 1):
                        result_content += f"{i}. **{res.start_time}**\n"
                        result_content += f"   - 状态: {res.status}\n"
                        result_content += f"   - 耗时: {res.duration:.2f}秒\n"
                        if res.error_message:
                            result_content += f"   - 错误: {res.error_message}\n"
                        result_content += "\n"

            elif operation == "get_outputs":
                # 获取输出文件列表
                task_id = argument["task_id"]
                limit = argument.get("limit", 10)
                outputs = self._task_manager.get_task_outputs(task_id, limit=limit)
                if not outputs:
                    result_content = f"任务 `{task_id}` 没有输出文件(No output files)。\n\n"
                else:
                    result_content = f"任务 `{task_id}` 的输出文件（最近 {len(outputs)} 个）：\n\n"
                    for i, output in enumerate(outputs, 1):
                        result_content += f"{i}. **{output['timestamp']}**\n"
                        result_content += f"   - 文件: `{output['file_path']}`\n"
                        result_content += f"   - 大小: {output['size']} bytes\n"
                        result_content += f"   - 修改时间: {output['mtime']}\n\n"
                    result_content += "\n💡 使用 `read_output` 操作读取文件内容。\n"

            elif operation == "read_output":
                # 读取输出文件
                file_path = argument["file_path"]
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    result_content = f"## 输出文件内容\n\n**文件:** `{file_path}`\n\n---\n\n{content}"
                except FileNotFoundError:
                    result_content = f"❌ 文件不存在(File not found): `{file_path}`\n\n."
                except Exception as e:
                    result_content = f"❌ 读取文件失败(Failed to read file): {str(e)}\n\n."

            else:
                result_content = f"❌ 未知操作(Unknown operation): {operation}\n\n."

            # 添加结果到上下文
            await model_context.add_message(FunctionExecutionResultMessage(
                content=[FunctionExecutionResult(
                    content=result_content,
                    name=tool_name,
                    call_id=call_id,
                    is_error=False,
                ),]
            ))

            # 发送事件日志
            yield AgentLogEvent(
                title=f"执行定时任务操作: {operation}",
                source=agent_name,
                content=str(argument),
                content_type="tools"
            )

            # 发送结果消息
            yield TextMessage(
                content=result_content,
                source=agent_name,
                metadata={"internal": "no"},
            )

        except Exception as e:
            logger.exception(f"Error in handle_scheduled_task")
            error_msg = f"❌ 定时任务操作失败: {str(e)}\n\nScheduled task operation failed."
            await model_context.add_message(FunctionExecutionResultMessage(
                content=[FunctionExecutionResult(
                    content=error_msg,
                    name=tool_name,
                    call_id=call_id,
                    is_error=True,
                ),]
            ))
            yield TextMessage(
                content=error_msg,
                source=agent_name,
                metadata={"internal": "no"},
            )

    # TODO: fixed the config
    def _to_config(self) -> DrSaiAssistantConfig:
        """Convert the assistant agent to a declarative config."""

        return DrSaiAssistantConfig(
            name=self.name,
            model_client=self._model_client.dump_component(),
            tools=None,  # versionchanged:: v0.5.5  Now tools are not serialized, Cause they are part of the workbench.
            workbench=self._workbench.dump_component() if self._workbench else None,
            handoffs=list(self._handoffs.values()) if self._handoffs else None,
            model_context=self._model_context.dump_component(),
            memory=[memory.dump_component() for memory in self._memory] if self._memory else None,
            description=self.description,
            system_message=self._system_messages[0].content
            if self._system_messages and isinstance(self._system_messages[0].content, str)
            else None,
            model_client_stream=self._model_client_stream,
            reflect_on_tool_use=self._reflect_on_tool_use,
            tool_call_summary_format=self._tool_call_summary_format,
            tool_call_summary_prompt=self._tool_call_summary_prompt,
            structured_message_factory=self._structured_message_factory.dump_component()
            if self._structured_message_factory
            else None,
            metadata=self._metadata,
            # drsaiAgent specific
            db_manager_config=self._db_manager.dump_component(),
            thread_id=self._thread_id,
            user_id=self._user_id,
            # skills and executor
            skills_dir=self._skills_dir,
            work_dir=self._work_dir,
            only_in_workspace=self._only_in_workspace,
            extra_work_dirs=self._extra_work_dirs,
            executor=self._local_executor.dump_component(),
            sub_agent_config=self._sub_agent_config,
            max_turn_count=self._max_turn_count,
            token_limit=self._token_limit,
            rag_flow_url=self._rag_flow_url,
            rag_flow_token=self._rag_flow_token,
            memory_dataset_id=self._memory_dataset_id,
            learning_dataset_id=self._learning_dataset_id,
        )
    
    @classmethod
    def _from_config(
        cls, config: DrSaiAssistantConfig, 
        db_manager: DatabaseManager,
        memory_function: Callable = None,
        reply_function: Callable = None,
        **kwargs,
        ) -> Self:
        """Create an assistant agent from a declarative config."""
        if config.structured_message_factory:
            structured_message_factory = StructuredMessageFactory.load_component(config.structured_message_factory)
            format_string = structured_message_factory.format_string
            output_content_type = structured_message_factory.ContentModel

        else:
            format_string = None
            output_content_type = None

        return cls(
            name=config.name,
            model_client=ChatCompletionClient.load_component(config.model_client),
            workbench=Workbench.load_component(config.workbench) if config.workbench else None,
            handoffs=config.handoffs,
            model_context=ChatCompletionContext.load_component(config.model_context) if config.model_context else None,
            tools=[BaseTool.load_component(tool) for tool in config.tools] if config.tools else None,
            memory=[Memory.load_component(memory) for memory in config.memory] if config.memory else None,
            description=config.description,
            system_message=config.system_message,
            model_client_stream=config.model_client_stream,
            reflect_on_tool_use=config.reflect_on_tool_use,
            tool_call_summary_format=config.tool_call_summary_format,
            tool_call_summary_prompt=config.tool_call_summary_prompt,
            output_content_type=output_content_type,
            output_content_type_format=format_string,
            metadata=config.metadata,
            # drsaiAgent specific
            memory_function=memory_function,
            reply_function=reply_function,
            db_manager=db_manager,
            thread_id=config.thread_id,
            user_id=config.user_id,
            # skills and executor
            skills_dir=config.skills_dir,
            work_dir=config.work_dir,
            only_in_workspace=config.only_in_workspace,
            extra_work_dirs=config.extra_work_dirs,
            executor=CodeExecutor.load_component(config.executor),
            sub_agent_config = config.sub_agent_config,
            max_turn_count = config.max_turn_count,
            token_limit = config.token_limit,
            rag_flow_url = config.rag_flow_url,
            rag_flow_token = config.rag_flow_token,
            memory_dataset_id = config.memory_dataset_id,
            learning_dataset_id = config.learning_dataset_id,
            **kwargs,
        )
