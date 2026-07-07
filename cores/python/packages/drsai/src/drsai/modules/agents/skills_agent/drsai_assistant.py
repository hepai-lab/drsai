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
    # Mapping,
    # TYPE_CHECKING,
    )
import json, re, uuid, shutil, copy
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
from drsai.modules.agents import RemoteAgent

from drsai.modules.agents import HepAIWorkerAgent
from drsai.modules.components import (
    ComponentModel,
)
from drsai.modules.components.model_client import ChatCompletionClient, HepAIChatCompletionClient
from drsai.modules.components.model_context import (
    BufferedChatCompletionContext,
    ChatCompletionContext,
    DrSaiChatCompletionContext,
    DrSaiSQLiteChatCompletionContext
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
from .managers import ScheduledTask, ScheduleType, TaskStatus
from .daemon_subagent import DaemonSubagent

# ── Built-in subagent definitions ──────────────────────────────────────────
BUILTIN_SUBAGENTS: Dict[str, Dict[str, Any]] = {
    "explore": {
        "name": "explore",
        "type": "DrSaiAgent",
        "description": "Read-only code explorer. Search, read, and analyze code without modifying anything.",
        "prompt": (
            "You are a read-only code explorer. "
            "Use Glob, Grep, and Read tools to find and analyze code. "
            "NEVER use Write, Edit, Bash, or any tool that modifies files or executes commands. "
            "Return a clear, structured summary of your findings."
        ),
        "tools": ["run_read", "run_glob", "run_grep"],
        "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
        "max_turns": 200,
        "timeout": 3600,
        "role": "leaf",
    },
    # "plan": {
    #     "name": "plan",
    #     "type": "DrSaiAgent",
    #     "description": "Planning agent for software architecture and design. Read-only, no file modifications.",
    #     "prompt": (
    #         "You are a software architect and planning specialist. "
    #         "Analyze requirements, codebases, and produce detailed, actionable plans. "
    #         "You can READ files but NEVER modify them. "
    #         "Structure your output with clear, numbered steps."
    #     ),
    #     "tools": ["run_read", "run_glob", "run_grep"],
    #     "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
    #     "mode": "multi",
    #     "max_turns": 10,
    #     "timeout": 600,
    #     "role": "leaf",
    # },
    "general": {
        "name": "general",
        "type": "DrSaiAgent",
        "description": "General-purpose subagent for complex tasks requiring full tool access.",
        "prompt": (
            "You are a capable subagent. Complete the assigned task thoroughly. "
            "Use available tools as needed. Return a clear, concise summary when done."
        ),
        "tools": "*",
        "disallowed_tools": ["Delegate", "ScheduledTaskManager", "UpdateUserConfig"],
        "max_turns": 200,
        "timeout": 3600,
        "role": "leaf",
    },
}

# ── Default tool blocklist for all subagents ───────────────────────────────
_DEFAULT_DISALLOWED_FOR_SUBAGENTS: set = {
    "Delegate",
    "ScheduledTaskManager",
    "UpdateUserConfig",
}

_READONLY_DISALLOWED_TOOLS: set = _DEFAULT_DISALLOWED_FOR_SUBAGENTS | {
    "run_write",
    "run_edit",
    "run_bash",
    "run_bash_background",
}


class DelegateDepthExceededError(Exception):
    """Raised when subagent delegation depth exceeds the maximum."""
    pass


class DrSaiAssistantConfig(DrSaiAgentConfig):
    skills_dir: Optional[str | List[str]]
    work_dir: str | None
    storage_dir: str | None  # Internal storage dir (overrides work_dir/user_id computation)
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
    context_type: str  # "ragflow" | "sqlite"
    llm_max_retries: int  # Max retries for LLM call failures / empty output
    llm_retry_base_delay: float  # Base delay (seconds) between retries (exponential backoff)
    

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
        tools: Optional[List[BaseTool[Any, Any] | Callable[..., Any] | Callable[..., Awaitable[Any]]]] = None,
        workbench: Optional[Workbench] = None,
        handoffs: List[HandoffBase | str] | None = None,
        model_context: Optional[ChatCompletionContext] = None,
        description: str = "An agent that provides assistance with ability to use tools.",
        system_message: (
            str | None
        ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
        model_client_stream: bool = True,
        reflect_on_tool_use: Optional[bool] = None,
        tool_call_summary_format: str = "{result}",
        tool_call_summary_prompt: Optional[bool] = None,
        output_content_type: Optional[type[BaseModel]] = None,
        output_content_type_format: Optional[str] = None,
        memory: Optional[Sequence[Memory]]= None,
        metadata:Optional[ Dict[str, str]] = None,
        # drsaiAgent specific
        memory_function: Optional[Callable] = None,
        reply_function: Optional[Callable] = None,
        db_manager: Optional[DatabaseManager] = None,
        thread_id: Optional[str] = None,
        user_id: Optional[str] = None,
        set_model_client: Optional[Callable] = None,
        llm_mode_config: Dict = {},
        defult_config_name: Optional[str] = None,
        # basic tools and userprofile config
        work_dir: Optional[str] = None,
        storage_dir: Optional[str] = None,
        only_system_message: bool = False,
        is_powershell: Optional[bool] = None,
        allolow_dangrous_cmd: bool = False,
        allolow_basic_tools: Optional[List[str]] = None,
        only_in_workspace: bool = True,
        extra_work_dirs: Optional[List[str]] = None,
        # skills, executor, sub_agents
        skills_dir: Optional[str | List[str]] = [],
        executor: CodeExecutor | None = None,
        sub_agent_config: Dict = {},
        max_agent_concurrent: int = 10,
        # task loop and memory
        max_turn_count: int = 500,
        token_limit: int = 50000,
        rag_flow_url: Optional[str] = None,
        rag_flow_token: Optional[str] = None,
        memory_dataset_id: Optional[str] = None,
        learning_dataset_id: Optional[str] = None,
        # context type selection
        context_type: str = "sqlite",  # "ragflow" or "sqlite"
        # LLM retry configuration
        llm_max_retries: int = 10,  # Max retries on model error or empty output
        llm_retry_base_delay: float = 2.0,  # Base delay (s) for exponential backoff
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

        # Injected prompt slots (set by inject_system_prompt or /inject command)
        self._injected_prefix: str = ""
        self._injected_suffix: str = ""
        self._project_instructions: str = ""  # 项目级指令 (DRSAI.md/CLAUDE.md)

        # === workspace for assistant ===
        # storage_dir: explicit internal storage path (used by CLI where work_dir=cwd but configs stored elsewhere)
        # When storage_dir is provided, _work_dir = storage_dir (no user_id appending)
        # Otherwise, _work_dir = work_dir / user_id (or RUNS_DIR / user_id if work_dir not set)
        if storage_dir:
            self._work_dir = Path(storage_dir)
        elif not work_dir:
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

        # === curated memory (hermes-style MEMORY.md / USER.md entries) ===
        from drsai.modules.components.memory import CuratedMemoryStore
        self._curated_memory = CuratedMemoryStore(
            memory_path=self._user_profile_manager.memorie_path,
            user_path=self._user_profile_manager.user_md,
        )
        try:
            self._curated_memory.load_from_disk()
        except Exception as e:
            logger.warning(f"Failed to load curated memory: {e}")

        # combine system messages
        self._only_system_message = only_system_message
        if not self._only_system_message:
            user_sys_prompt = self._user_profile_manager.get_agent_system_prompt()
            memory_block = self._curated_memory.system_prompt_block()
            enhanced_system_message = f"""{self._developer_system_message}\n{user_sys_prompt}\n
Current Session_ID is {self._thread_id}"""
            if memory_block:
                enhanced_system_message += f"\n\n{memory_block}"
        else:
            enhanced_system_message = self._developer_system_message
        self._system_messages = [SystemMessage(content=enhanced_system_message)]

        # === basic tools ===
        self._only_in_workspace = only_in_workspace
        self._extra_work_dirs = extra_work_dirs
        if is_powershell is None:
            self._is_powershell = bool(_detect_powershell())
        else:
            self._is_powershell = is_powershell

        # ── Skill-Scoped Tool Elevation (design-20260623 §2.2) ──
        # Keep ALL basic functions; visibility is controlled dynamically
        # rather than by hard-filtering in __init__.
        self._all_basic_funcs: List[Callable] = get_operator_funcs(
            work_dir,
            thread_id=self._thread_id,
            only_in_workspace=self._only_in_workspace,
            extra_dirs=self._extra_work_dirs,
            is_powershell=self._is_powershell,
            allolow_dangrous_cmd=allolow_dangrous_cmd,
            storage_dir=storage_dir,
        )
        # Names of toggle helper functions that should NOT be registered as LLM tools
        _TOGGLE_FUNC_NAMES = {"set_workspace_restriction", "get_workspace_status", "set_dangerous_allowed", "get_dangerous_status"}
        # Store toggle helpers separately for CLI access (not registered as LLM tools)
        self._workspace_toggle_funcs = [
            func for func in self._all_basic_funcs if func.__name__ in _TOGGLE_FUNC_NAMES
        ]
        # All basic tools (full set, always available for Skill elevation)
        self._all_basic_tools: List[FunctionTool] = [
            FunctionTool(func, description=func.__doc__)
            for func in self._all_basic_funcs
            if func.__name__ not in _TOGGLE_FUNC_NAMES
        ]

        # Default visible set: None = full access (admin), list = whitelist (user)
        if allolow_basic_tools is None:
            self._default_visible_tools: List[FunctionTool] = list(self._all_basic_tools)
        else:
            self._default_visible_tools = [
                t for t in self._all_basic_tools if t.name in allolow_basic_tools
            ]

        # Skill elevation state (populated at runtime by _process_model_result)
        self._elevated_tools: List[FunctionTool] = []
        self._elevated_tool_names: set = set()
        self._allolow_basic_tools_config = allolow_basic_tools

        # Initialize self._tools with the default visible set
        self._tools.extend(self._default_visible_tools)

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
        independent_model_client._model_info = copy.deepcopy(model_client._model_info)
        self._model_context = self._create_context(
            model_context=model_context,
            context_type=context_type,
            independent_model_client=independent_model_client,
            db_manager=db_manager,
        )
        self._register_context_tools()
                
        # === skills ===
        # 将 skills_dir 规范化为非空字符串列表，过滤掉 None/空字符串
        if isinstance(skills_dir, list):
            self._skills_dir = [d for d in skills_dir if d]
        elif skills_dir:
            self._skills_dir = [skills_dir]
        else:
            self._skills_dir = []
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
        # Merge builtins first, then user config (user overrides builtins)
        self._user_sub_agents.update(BUILTIN_SUBAGENTS)
        self._user_sub_agents.update(sub_agent_config)
        self._subagent_tools = []

        # === delegation control ===
        self._delegate_depth: int = 0
        self._max_delegate_depth: int = 1
        self._max_agent_concurrent: int = max_agent_concurrent
        self._subagent_timeout: int = 600
        self._cleanup_subagent_messages: bool = True

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
        self._skip_startup_checks: bool = False

        # === LLM retry configuration ===
        self._llm_max_retries = llm_max_retries
        self._llm_retry_base_delay = llm_retry_base_delay

    def _create_context(
        self,
        model_context: Optional[ChatCompletionContext],
        context_type: str,
        independent_model_client: ChatCompletionClient,
        db_manager: Optional[Any] = None,
    ) -> ChatCompletionContext:
        """
        创建或返回 ChatCompletionContext 实例。
        
        优先级：
        1. 如果已传入 model_context，直接使用
        2. 根据 context_type 创建对应类型的 Context
        """
        # 1. 如果已传入 model_context，直接使用
        if model_context is not None:
            self._context_type = "custom"
            return model_context
        
        # 2. 根据 context_type 创建
        if context_type == "sqlite":
            self._context_type = "sqlite"
            return DrSaiSQLiteChatCompletionContext(
                agent_name=self._user_profile_manager.agent_name,
                model_client=independent_model_client,
                db_manager=db_manager,
                thread_id=self._thread_id,
                user_id=self._user_id,
                token_limit=self._token_limit,
            )
        elif context_type == "buffered":
            # Pure in-memory context (e.g., for single-round subagents)
            self._context_type = "buffered"
            return BufferedChatCompletionContext(buffer_size=50)
        else:
            # 默认使用 RAGFlow 上下文
            self._context_type = "ragflow"
            return self._create_ragflow_context(independent_model_client)

    def _create_ragflow_context(self, model_client: ChatCompletionClient) -> "DrSaiChatCompletionContext":
        """创建 RAGFlow ChatCompletionContext"""
        ctx = DrSaiChatCompletionContext(
            agent_name=self._user_profile_manager.agent_name,
            model_client=model_client,
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
        if not ctx._rag_flow_manager:
            raise ValueError("RAGFlowManager is not initialized in DrSaiChatCompletionContext")
        return ctx

    def _register_context_tools(self) -> None:
        """根据 context 类型注册相应的工具

        对子智能体场景安全：如果工具名已存在于 ``self._tools`` 中则跳过,
        避免从父智能体继承工具后又重复添加（DrSaiAgent.__init__ 的唯一性
        检查只能覆盖传入 tools 参数，检测不到此处的追加）。
        """
        existing_names = {t.name for t in self._tools}

        funcs = [
            self._user_profile_manager.read_session_memory_by_index,  # TODO: 后面进行测试修正
        ]

        if hasattr(self._model_context, 'retrieve_from_memory'):
            funcs.append(self._model_context.retrieve_from_memory)
        if hasattr(self._model_context, 'summry_conversation_to_memory'):
            funcs.append(self._model_context.summry_conversation_to_memory)

        for func in funcs:
            if func and callable(func):
                tool_name = getattr(func, '__name__', '')
                if tool_name not in existing_names:
                    self._tools.append(FunctionTool(func, description=func.__doc__ or str(func)))
                    existing_names.add(tool_name)

        # === curated memory tool (hermes-style add/replace/remove/read) ===
        if "memory" not in existing_names and getattr(self, "_curated_memory", None):
            store = self._curated_memory
            import json as _json

            def memory(
                action: str,
                target: str = "memory",
                content: str = "",
                old_text: str = "",
            ) -> str:
                """Persistent curated memory across sessions. Two stores: ``memory`` (your agent notes — environment facts, conventions, things learned about the project) and ``user`` (the user profile — preferences, habits, what they care about).

                ``action`` selects the operation:
                  - ``add``: append a new entry to MEMORY.md. ``content`` required.
                  - ``replace``: find an entry containing ``old_text`` and replace it with ``content``. Both required.
                  - ``remove``: delete the entry containing ``old_text``. ``old_text`` required.
                  - ``read``: list current entries (or USER.md text when ``target=user``).
                  - ``write_user``: overwrite USER.md with ``content``. Only valid when ``target=user``.

                Stores are bounded (MEMORY.md ≤ 2200 chars, USER.md ≤ 1375 chars). Failed mutations return an error JSON with the current usage. Entries injected into the system prompt at session start — mid-session writes update the file but NOT the live prompt (preserves prefix cache).

                Returns a JSON string with the result.
                """
                target = (target or "memory").lower()
                if target not in ("memory", "user"):
                    return _json.dumps({"success": False, "error": "target must be 'memory' or 'user'"})

                if action == "add":
                    if target == "user":
                        return _json.dumps({"success": False, "error": "USER.md does not support add — use action=write_user."})
                    return _json.dumps(store.add_entry(content))

                if action == "replace":
                    if target == "user":
                        return _json.dumps(store.write_user(content))
                    return _json.dumps(store.replace_by_text(old_text, content))

                if action == "remove":
                    if target == "user":
                        return _json.dumps({"success": False, "error": "USER.md does not support remove — use write_user with empty content to clear."})
                    return _json.dumps(store.remove_by_text(old_text))

                if action == "read":
                    if target == "user":
                        return _json.dumps({"success": True, "content": store.read_user(), "charCount": len(store.read_user()), "charLimit": store.user_char_limit})
                    entries = store.list_entries()
                    return _json.dumps({
                        "success": True,
                        "entries": entries,
                        "charCount": store.char_counts()["memory"],
                        "charLimit": store.memory_char_limit,
                    })

                if action == "write_user":
                    return _json.dumps(store.write_user(content))

                return _json.dumps({"success": False, "error": f"Unknown action '{action}'. Use add/replace/remove/read/write_user."})

            self._tools.append(FunctionTool(memory, description=memory.__doc__ or "memory tool"))
            existing_names.add("memory")

    def set_task_manager(self, task_manager):
        """设置定时任务管理器实例
        
        支持两种类型：
        - ScheduledTaskManager (本地): 任务在当前进程执行
        - RemoteScheduledTaskManager (远程): 任务委托给 worker 进程执行
        """
        self._task_manager = task_manager
        self._scheduled_task_tools = [get_scheduled_task_tool()]
    
    def _is_remote_task_manager(self) -> bool:
        """判断当前 task_manager 是否为远程代理"""
        from .managers import RemoteScheduledTaskManager
        return isinstance(self._task_manager, RemoteScheduledTaskManager)

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
        except OSError as e:
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
        """Initialize learning memory and session documents on first use.

        Only applicable when using RAGFlow-based context (DrSaiChatCompletionContext).
        SQLite-based context (DrSaiSQLiteChatCompletionContext) doesn't need document initialization.
        """
        # Skip document initialization for SQLite context (no RAGFlow)
        if not hasattr(self._model_context, '_rag_flow_manager') or self._model_context._rag_flow_manager is None:
            return

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
                subagent_config_path = self._user_profile_manager.subagent_config_path
                try:
                    current_content = subagent_config_path.read_text(encoding='utf-8')
                except Exception:
                    current_content = "(unable to read file)"
                warnings.append(
                    f"⚠️ **子智能体配置加载失败 / Subagent Config Load Error**\n\n"
                    f"**错误 / Error:** `{subagent_error}`\n\n"
                    f"**配置文件路径 / Config file path:**\n"
                    f"`{subagent_config_path}`\n\n"
                    f"**当前文件内容 / Current file content:**\n"
                    f"```json\n{current_content}\n```\n\n"
                    f"**正确的格式 / Expected format** — 以智能体名称为 key 的扁平对象:\n"
                    f"```json\n"
                    f'{{\n'
                    f'  "MyAgent": {{\n'
                    f'    "type": "DrSaiAgent",\n'
                    f'    "description": "描述此智能体的用途",\n'
                    f'    "prompt": "系统提示词",\n'
                    f'    "tools": "*"\n'
                    f'  }}\n'
                    f'}}\n'
                    f"```\n\n"
                    f"**请立即使用 `run_write` 工具修正上述配置文件，然后继续回答用户的问题。**\n"
                    f"**Please use the `run_write` tool to fix the config file above, then proceed to answer the user's request.**"
                )

        return warnings

    def update_system_prompt(self, additional_prompt: str = "") -> str:
        """获取agent描述、用户画像并更新系统消息
        
        保持与 inject_system_prompt() 的层级一致：
            ① prefix          — session级覆盖
            ② developer_msg   — 硬编码基础提示词
            ③ user_sys_prompt — 全局用户级 (AGENTS.md)
            ④ project_instr   — 项目级 (DRSAI.md/CLAUDE.md)
            ⑤ Session_ID      — 固定标识行
            ⑥ suffix          — session级覆盖
            additional_prompt  — 工具提示词（在 ⑥ 之后追加）
        """
        user_sys_prompt = self._user_profile_manager.get_agent_system_prompt()
        memory_block = (
            self._curated_memory.system_prompt_block()
            if getattr(self, "_curated_memory", None)
            else ""
        )
        parts = []
        if self._injected_prefix:
            parts.extend([self._injected_prefix, ""])
        if self._developer_system_message:
            parts.extend([self._developer_system_message, ""])
        if user_sys_prompt:
            parts.extend([user_sys_prompt, ""])
        if memory_block:
            parts.extend([memory_block, ""])
        if self._project_instructions:
            parts.extend([self._project_instructions, ""])
        parts.append(f"Current Session_ID is {self._thread_id}")
        if self._injected_suffix:
            parts.extend(["", self._injected_suffix])
        if additional_prompt:
            parts.extend(["", additional_prompt])
        enhanced_system_message = "\n".join(parts).strip()
        self._system_messages = [SystemMessage(content=enhanced_system_message)]

    def inject_system_prompt(
        self,
        prefix: str = "",
        suffix: str = "",
        project_instructions: Optional[str] = None,
    ) -> None:
        """动态注入额外提示词到 system message。

        系统提示词层级（从上到下，越靠后 LLM 越重视）:
            ① prefix          — session级覆盖 (plan_mode 等)
            ② developer_msg   — 硬编码基础提示词
            ③ user_sys_prompt — 全局用户级 (AGENTS.md，来自 workspace)
            ④ project_instr   — 🆕 项目级 (DRSAI.md/CLAUDE.md，来自 cwd 向上遍历)
            ⑤ Session_ID      — 固定标识行
            ⑥ suffix          — session级覆盖 (/inject suffix)

        Args:
            prefix: 要添加到 system message 开头的前缀提示词
            suffix: 要添加到 system message 结尾的后缀提示词
            project_instructions: 项目级指令内容。
                None 表示保持当前的 _project_instructions 不变（推荐用于
                只更新 prefix/suffix 的场景，如 /plan_mode、/inject 命令）。
                空字符串 "" 表示清除项目级指令。
                非空字符串表示设置新的项目级指令。
        """
        self._injected_prefix = prefix
        self._injected_suffix = suffix
        # None → 保持不变；"" → 清除；非空 → 设置新值
        if project_instructions is not None:
            self._project_instructions = project_instructions

        user_sys_prompt = self._user_profile_manager.get_agent_system_prompt()
        memory_block = (
            self._curated_memory.system_prompt_block()
            if getattr(self, "_curated_memory", None)
            else ""
        )

        parts = []
        if prefix:
            parts.extend([prefix, ""])
        if self._developer_system_message:
            parts.extend([self._developer_system_message, ""])
        if user_sys_prompt:
            parts.extend([user_sys_prompt, ""])
        if memory_block:
            parts.extend([memory_block, ""])
        if self._project_instructions:
            parts.extend([self._project_instructions, ""])
        parts.append(f"Current Session_ID is {self._thread_id}")
        if suffix:
            parts.extend(["", suffix])

        self._system_messages = [SystemMessage(content="\n".join(parts).strip())]

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
    
    def update_user_subagents(self) -> str | None:
        """Update user subagents (merge builtins with user config).

        User config overrides builtin definitions with the same name.

        Also injects running daemon processes as available subagents
        (key = ``daemon:<name>``, type = ``DaemonAgent``) so they can be
        targeted via /agent and the Delegate tool.

        Returns:
            Error message string if loading failed, None on success.
        """
        try:
            subagents_config = self._user_profile_manager.load_subagents_config()
            if not isinstance(subagents_config, dict):
                return (
                    f"SUBAGENT_CONFIG.json must be a JSON object (dict), "
                    f"got {type(subagents_config).__name__}."
                )
            # Reset to builtins, then apply user overrides
            self._user_sub_agents.clear()
            self._user_sub_agents.update(BUILTIN_SUBAGENTS)
            self._user_sub_agents.update(self._sub_agent_config) 
            self._user_sub_agents.update(subagents_config)

            # ── Inject running daemons ──────────────────────────────────
            try:
                from drsai.backend.daemon.pid_manager import list_daemons
                for d in list_daemons():
                    if d.get("alive"):
                        daemon_key = f"daemon:{d['name']}"
                        self._user_sub_agents[daemon_key] = {
                            "type": "DaemonAgent",
                            "description": f"后台常驻 Daemon [{d['name']}] — pid={d.get('pid')}, port={d.get('ws_port')}",
                            "tools": ["*"],
                            "role": "leaf",
                            "timeout": 600,
                            # Daemon-specific fields
                            "daemon_name": d["name"],
                            "daemon_ws_port": d.get("ws_port"),
                            "daemon_api_token": d.get("api_token"),
                        }
            except Exception:
                logger.debug("Daemon injection skipped (daemon module not available)", exc_info=True)
            # ─────────────────────────────────────────────────────────────

            if self._user_sub_agents:
                self._sub_agent_descriptions = self.get_subagent_descriptions(sub_agent_config = self._user_sub_agents)
                self._subagent_tools = [
                    get_subagent_tools(
                        sub_agents=list(self._user_sub_agents.keys()),
                        description=self._sub_agent_descriptions)]
            else:
                self._sub_agent_descriptions = ""
                self._subagent_tools = []
            return None
        except Exception as e:
            logger.error(f"Failed to update user subagents: {e}")
            logger.error(traceback.format_exc())
            return str(e)

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

    # ── Skill-Scoped Tool Elevation helpers (design-20260623 §2.2) ──────────
    def _clear_elevated_tools(self):
        """Clear Skill-elevated tools and restore default permission level.

        Called at:
        - on_messages_stream entry: clears residual tools from previous turn
        - pure-text response: task turn ended, downgrade permissions
        """
        if not self._elevated_tools:
            return
        _shared = self._workbench._tools is self._tools
        for tool in self._elevated_tools:
            # Remove from self._tools (primary list)
            if tool in self._tools:
                self._tools.remove(tool)
            # Remove from workbench only if it's a separate list object
            if not _shared and tool in self._workbench._tools:
                self._workbench._tools.remove(tool)
        self._elevated_tools.clear()
        self._elevated_tool_names.clear()
        logger.debug("Skill elevated tools cleared — default permission restored")

    def _elevate_tools_for_skill(self, required_tools: list, skill_name: str = ""):
        """Elevate basic tools required by a Skill.

        Only operates in restricted mode (allolow_basic_tools is not None).
        In admin mode (allolow_basic_tools=None) all tools are already visible.
        """
        if self._allolow_basic_tools_config is None:
            # Admin mode: all tools already visible, no elevation needed
            return
        if not required_tools:
            return
        for tool in self._all_basic_tools:
            if tool.name in required_tools and tool.name not in self._elevated_tool_names:
                self._elevated_tools.append(tool)
                self._elevated_tool_names.add(tool.name)
                self._tools.append(tool)
                # Only append to workbench if it's a separate list object
                if self._workbench._tools is not self._tools:
                    self._workbench._tools.append(tool)
                    
        if self._elevated_tools:
            logger.info(
                f"Skill '{skill_name}' elevated tools: "
                f"{[t.name for t in self._elevated_tools]}"
            )

    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Process the incoming messages with the assistant agent and yield events/responses as they happen.
        """
        # ── Entry security check: clear residual elevated tools from previous turn ──
        self._clear_elevated_tools()

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
                notifications: List[TaskNotification] = await self._task_manager.get_pending_notifications(self._user_id)
                if notifications:
                    yield await self._emit_notification(self._format_task_notifications(notifications))

            # initialize memory documents
            await self._init_memory_documents()

            # config reload checks — warnings injected into context and yielded to user
            if not getattr(self, '_skip_startup_checks', False):
                for warning in await self._run_startup_checks():
                    yield await self._emit_notification(warning)
            skills_loader = self._cached_skills_loader

            # manager ToolSchema
            manager_tools = self._update_user_config_tools+self._agent_skills_tools+self._subagent_tools+self._todo_tools+self._scheduled_task_tools

            # count the number of tools (only for DrSaiChatCompletionContext which has _tool_schema)
            if hasattr(self._model_context, '_tool_schema'):
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

            # Check if there's a default subagent set for this thread.
            # Priority: in-memory _thread_state (set via set_state_value / slash cmd)
            # fallback: THREAD_CONFIG.json persisted value.
            # Using _thread_state as primary source avoids cross-session races that
            # can occur when multiple sessions share the same THREAD_CONFIG.json file.
            default_subagent_name = (
                (self._thread_state.get("default_subagent") if isinstance(getattr(self, "_thread_state", None), dict) else None)
                or self._user_profile_manager.get_default_subagent(self._thread_id)
            )
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
            llm_retry_count = 0  # Track retries across the current turn
            while turn_count < self._max_turn_count:

                # Sanitize messages to handle orphaned tool results / missing stubs
                # This prevents tool_call_id mismatches after model switches
                await self._sanitize_api_messages()

                # ── LLM call with retry logic ──────────────────────────────
                model_result = None
                llm_retry_count = 0
                _chunks_yielded = False  # track whether we already streamed chunks to the user

                while llm_retry_count <= self._llm_max_retries:
                    try:
                        _chunks_yielded = False
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
                                # Yield streaming chunks immediately for zero-latency UX
                                yield inference_output
                                _chunks_yielded = True

                        assert model_result is not None, "No model result was produced."

                        # ── Check for empty text output ─────────────────────
                        if isinstance(model_result.content, str) and not model_result.content.strip():
                            # Empty output — treat as a retriable failure
                            if llm_retry_count < self._llm_max_retries:
                                llm_retry_count += 1
                                delay = min(self._llm_retry_base_delay * (2 ** (llm_retry_count - 1)), 60)
                                logger.warning(
                                    f"[LLM Retry] Empty output (attempt {llm_retry_count}/{self._llm_max_retries}), "
                                    f"retrying in {delay:.1f}s…"
                                )
                                yield AgentLogEvent(
                                    source="system",
                                    title="LLM Retry",
                                    content=f"⚠️ 模型输出为空，正在重试 ({llm_retry_count}/{self._llm_max_retries})，等待 {delay:.1f}s…",
                                    send_level=Send_level.WARNING,
                                )
                                await asyncio.sleep(delay)
                                # Do NOT add empty output to context — just retry
                                model_result = None
                                continue
                            else:
                                # Exhausted retries for empty output
                                logger.error(
                                    f"[LLM Retry] Empty output after {self._llm_max_retries} retries"
                                )
                                # Set model_result to None so the post-loop guard
                                # (if model_result is None) yields the error Response
                                # instead of treating empty content as a valid reply.
                                model_result = None
                                break

                        # ── Success — break retry loop ──
                        break  # exit retry while-loop

                    except asyncio.CancelledError:
                        raise  # propagate cancellation, no retry

                    except Exception as llm_err:
                        # ── Fast-path: if the cancellation token is already
                        #    cancelled (e.g. user pressed Ctrl+C), bail out
                        #    immediately instead of entering the retry loop.
                        if cancellation_token.is_cancelled():
                            raise asyncio.CancelledError()

                        # ── Model API error — retriable ──────────────────────
                        if llm_retry_count < self._llm_max_retries:
                            llm_retry_count += 1
                            delay = min(self._llm_retry_base_delay * (2 ** (llm_retry_count - 1)), 60)
                            logger.warning(
                                f"[LLM Retry] Model call failed: {llm_err} "
                                f"(attempt {llm_retry_count}/{self._llm_max_retries}), "
                                f"retrying in {delay:.1f}s…"
                            )
                            retry_msg = (
                                f"⚠️ 模型调用失败: {type(llm_err).__name__}: {llm_err}\n"
                                f"正在重试 ({llm_retry_count}/{self._llm_max_retries})，等待 {delay:.1f}s…"
                            )
                            if _chunks_yielded:
                                # Partial text was already shown — inform user it may be incomplete
                                retry_msg = (
                                    f"⚠️ 以上输出因模型调用中断可能不完整。"
                                    f"错误: {type(llm_err).__name__}: {llm_err}\n"
                                    f"正在重试 ({llm_retry_count}/{self._llm_max_retries})，等待 {delay:.1f}s…\n"
                                    f"────────────────────────────────"
                                )
                            yield AgentLogEvent(
                                source="system",
                                title="LLM Retry",
                                content=retry_msg,
                                send_level=Send_level.WARNING,
                            )
                            await asyncio.sleep(delay)
                            # Do NOT add error to context — just retry
                            continue
                        else:
                            # Exhausted retries — re-raise to outer except handler
                            logger.error(
                                f"[LLM Retry] Model call failed after {self._llm_max_retries} retries: {llm_err}"
                            )
                            raise

                # ── Post-retry: handle the final model_result ─────────────────
                if model_result is None:
                    # All retries produced empty output
                    yield Response(
                        chat_message=TextMessage(
                            content="❌ 模型多次返回空输出，请稍后重试或创建新会话。\n"
                                    "The model returned empty output after multiple retries. "
                                    "Please try again later or start a new session.",
                            source=agent_name,
                            metadata={"internal": "no"},
                        ),
                        inner_messages=inner_messages,
                    )
                    return

                # --- NEW: If the model produced a hidden "thought," yield it as an event ---
                if model_result.thought:
                    thought_event = ThoughtEvent(content=model_result.thought, source=agent_name)
                    yield thought_event
                    inner_messages.append(thought_event)

                # Add the assistant message to the model context (including thought if present)
                # For DeepSeek V4: thought contains the reasoning_content that will be used for API replay
                await model_context.add_message(
                    AssistantMessage(
                        content=model_result.content,
                        source=self._name,
                        thought=getattr(model_result, "thought", None),
                    )
                )
                
                # If direct text response (string)
                if isinstance(model_result.content, str):
                    # ── Pure-text reply = task turn ended → downgrade elevated tools ──
                    self._clear_elevated_tools()
                    # At this point non-empty strings already passed the retry check above
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
            # Do NOT add error to chat history — retry logic in the loop already
            # handled retriable failures.  If we reach here the error is fatal.
            yield Response(
                chat_message=TextMessage(
                    content=f"❌ 执行任务时发生错误: {type(e).__name__}: {e}\n\n"
                            f"模型调用已重试 {self._llm_max_retries} 次仍然失败。请检查网络连接或模型配置后重试。\n"
                            f"An error occurred after {self._llm_max_retries} retries: {e}",
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

            # Save conversation on response completion
            if self._context_type == "ragflow" and hasattr(self._model_context, '_current_messages'):
                # RAGFlow: background upload + file save
                current_messages = self._model_context._current_messages
                history_messages = getattr(self._model_context, '_history_messages', [])
                rag_manager = getattr(self._model_context, '_rag_flow_manager', None)
                user_profile_manager = self._user_profile_manager

                self._model_context._current_messages = []

                async def background_save():
                    if rag_manager:
                        try:
                            await self._model_context.upload_conversation_to_ragflow(current_messages=current_messages)
                        except Exception as e:
                            logger.warning(f"RAGFlow upload failed: {e}")

                    if history_messages:
                        try:
                            await asyncio.to_thread(user_profile_manager.save_session_memory, history_messages)
                        except Exception as e:
                            logger.warning(f"Session save failed: {e}")

                asyncio.create_task(background_save())

            elif self._context_type == "sqlite":
                # SQLite: flush pending messages to ensure persistence
                if hasattr(self._model_context, '_flush_to_db'):
                    self._model_context._flush_to_db()
                

    async def _get_messages_with_compression_notification(
        self,
        model_context: ChatCompletionContext,
        cancellation_token: CancellationToken = None,
    ) -> AsyncGenerator[Union[List[LLMMessage], AgentLogEvent, int], None]:
        """
        Get messages from context with compression notification support.

        Yields:
            AgentLogEvent: Notification events during compression
            List[LLMMessage]: Final list of messages
            int: Prompt token count (for usage tracking)
        """
        prompt_tokens = 0
        
        # 只有支持 token 计数和压缩的 context 类型才进行压缩检查
        if hasattr(model_context, '_token_count') and hasattr(model_context, '_token_limit'):
            prompt_tokens = model_context._token_count
            
            if model_context._token_limit and prompt_tokens > model_context._token_limit:
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

            if model_context._token_limit and prompt_tokens > model_context._token_limit:
                # Notify completion
                yield AgentLogEvent(
                    source="system",
                    title="Memory Compression Complete",
                    content="对话记忆压缩完成，继续处理您的请求...",
                    send_level=Send_level.INFO
                )

            yield all_messages
            yield prompt_tokens
        else:
            all_messages = await model_context.get_messages()
            yield all_messages
            yield prompt_tokens

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
        prompt_tokens = 0
        async for item in self._get_messages_with_compression_notification(
            model_context, cancellation_token
        ):
            if isinstance(item, list):
                all_messages = item
            elif isinstance(item, int):
                # Get prompt token count from message compression
                prompt_tokens = item
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
                prompt_tokens=prompt_tokens,  # Pass calculated prompt tokens
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
                # Fix CreateResult.usage if prompt_tokens is 0 (API may return 0)
                if isinstance(chunk, CreateResult) and chunk.usage and chunk.usage.prompt_tokens == 0 and prompt_tokens > 0:
                    chunk.usage.prompt_tokens = prompt_tokens
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
        """Handle default subagent mode — route all messages to the configured subagent.

        Now uses the unified _execute_subagent for consistent isolation,
        timeout, depth check, and context management.
        """
        # Extract user prompt from messages
        prompt = messages[-1].content if messages else ""

        async for message in self._execute_subagent(
            sub_agent_name=default_subagent_name,
            prompt=prompt,
            cancellation_token=cancellation_token,
        ):
            if isinstance(message, Response):
                # Add subagent response to model context.
                # source must satisfy assert_valid_name (^[a-zA-Z0-9_-]+$);
                # sanitize the original key which may contain spaces.
                safe_src = re.sub(r'[^a-zA-Z0-9_\-]', '_', default_subagent_name).strip('_') or 'subagent'
                content = str(message.chat_message.content)
                if not content.strip():
                    content = f"[{default_subagent_name}] returned an empty response."
                await model_context.add_message(
                    AssistantMessage(
                        content=content,
                        source=safe_src,
                    )
                )
                yield message
                return
            yield message

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

            # Save the selected subagent to thread config.
            # Also write to in-memory _thread_state so on_messages_stream reads
            # the correct value without file-level cross-session races.
            try:
                if not isinstance(getattr(self, "_thread_state", None), dict):
                    self._thread_state = {}
                self._thread_state["default_subagent"] = argument
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
                current_subagent = (
                    (self._thread_state.get("default_subagent") if isinstance(getattr(self, "_thread_state", None), dict) else None)
                    or self._user_profile_manager.get_default_subagent(self._thread_id)
                )

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
                # Also clear in-memory _thread_state
                if isinstance(getattr(self, "_thread_state", None), dict):
                    self._thread_state.pop("default_subagent", None)

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

        # ── Pre-scan: collect Delegate calls for potential parallel execution ──
        delegate_indices: Dict[int, Dict[str, Any]] = {}
        for idx, tool_call in enumerate(model_result.content):
            if tool_call.name == "Delegate":
                try:
                    args = fix_and_parse_json(tool_call.arguments)
                    if not isinstance(args, str):
                        delegate_indices[idx] = args
                except Exception:
                    pass  # parse error → handled in normal loop below

        # ── Parallel path: >=2 Delegates in same turn → run concurrently ──
        if len(delegate_indices) >= 2:
            yield AgentLogEvent(
                title=f"Running {len(delegate_indices)} subagents in parallel...",
                source=agent_name,
                content="",
                content_type="tools",
            )

            # Build parallel task list
            parallel_tasks = []
            for idx, args in delegate_indices.items():
                tool_call = model_result.content[idx]
                parallel_tasks.append((
                    tool_call.id,
                    args["agent_type"],
                    args["prompt"],
                    args.get("context"),
                    None,  # mode removed; placeholder for backward compat
                ))

            # Execute in parallel; capture subagent_result messages for exec_results
            parallel_results: Dict[str, str] = {}
            async for message in self._execute_subagents_parallel(
                delegate_calls=parallel_tasks,
                cancellation_token=cancellation_token,
                max_concurrent=self._max_agent_concurrent,
            ):
                # Collect final results from metadata-tagged messages
                if isinstance(message, TextMessage):
                    meta = getattr(message, "metadata", None) or {}
                    if meta.get("subagent_result"):
                        parallel_results[meta["subagent_result"]] = message.content or ""
                yield message

            # Build exec_results with actual subagent outputs
            for idx, args in delegate_indices.items():
                tool_call = model_result.content[idx]
                result_content = parallel_results.get(
                    args["agent_type"],
                    f"Subagent '{args['agent_type']}' completed (no output captured).",
                )
                exec_results.append(FunctionExecutionResult(
                    content=result_content,
                    name="Delegate",
                    call_id=tool_call.id,
                    is_error=False,
                ))

        # ── Main loop: process remaining tools (incl. single Delegate) ──
        for idx, tool_call in enumerate(model_result.content):
            # Skip Delegates already handled by parallel batch
            if len(delegate_indices) >= 2 and idx in delegate_indices:
                continue
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

                    # ── Skill-Scoped Tool Elevation (design-20260623 §2.2.3) ──
                    # Elevate basic tools declared in SKILL.md required_tools
                    skill_meta = skills_loader.skills.get(arguments["skill"], {})
                    required_tools = skill_meta.get("required_tools", [])
                    if required_tools:
                        self._elevate_tools_for_skill(required_tools, arguments["skill"])

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
                        content=f"Skill for {arguments['skill']}:\n\n {skill_content}\n",
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
                    # Inject auto-correction warning prefix if present
                    warning_prefix = (self._todo_manager._last_warning + "\n\n") if self._todo_manager._last_warning else ""
                    exec_results.append(FunctionExecutionResult(
                        content=warning_prefix + self._todo_manager.get_task_prompt(),
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))
                    # Yield text message immediately for user visibility
                    yield TextMessage(
                        content=warning_prefix + todo_list,
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

            elif tool_name == "Delegate":
                # Subagent delegation — unified via _execute_subagent
                try:
                    sub_agent_name = arguments["agent_type"]
                    prompt = arguments["prompt"]
                    context = arguments.get("context")

                    task_result_content = ""
                    async for message in self._execute_subagent(
                        sub_agent_name=sub_agent_name,
                        prompt=prompt,
                        context=context,
                        cancellation_token=cancellation_token,
                    ):
                        if isinstance(message, Response):
                            task_result_content = str(message.chat_message.content)
                            yield message.chat_message
                            break
                        yield message

                    exec_results.append(FunctionExecutionResult(
                        content=task_result_content,
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    ))

                except Exception as e:
                    logger.exception(f"Error executing Delegate tool: {e}")
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
                    return
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

                    is_remote = self._is_remote_task_manager()
                    tm = self._task_manager
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
                        task_id = await tm.add_task(task)
                        result_content = f"✅ 定时任务创建成功！\n\n"
                        result_content += f"**任务ID:** `{task_id}`\n"
                        result_content += f"**任务名称:** {task.task_name}\n"
                        result_content += f"**调度类型:** {task.schedule_type}\n"
                        result_content += f"**调度配置:** {task.schedule_config}\n"
                        result_content += f"**下次执行:** {task.next_run}\n"
                        if is_remote:
                            result_content += "\n💡 任务在后台 worker 进程中执行，CLI 关闭不影响任务运行。\n"

                    elif operation == "list":
                        session_id = arguments.get("session_id")
                        status = TaskStatus(arguments["status"]) if arguments.get("status") else None
                        tasks = await tm.list_tasks(
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
                        task = await tm.get_task(task_id)
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
                        success = await tm.remove_task(task_id)
                        if success:
                            result_content = f"✅ 任务已删除(Task deleted successfully): `{task_id}`。\n\n"
                        else:
                            result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"

                    elif operation == "toggle":
                        task_id = arguments["task_id"]
                        enabled = arguments["enabled"]
                        task = await tm.get_task(task_id)
                        if task is None:
                            result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"
                        else:
                            new_status = TaskStatus.ENABLED if enabled else TaskStatus.DISABLED
                            await tm.update_task_status(task_id, new_status)
                            result_content = f"✅ 任务已{'启用' if enabled else '禁用'}: `{task_id}`"
                            result_content += f"Task {'enabled' if enabled else 'disabled'} successfully\n\n."

                    elif operation == "get_results":
                        task_id = arguments["task_id"]
                        limit = arguments.get("limit", 10)
                        results = await tm.get_task_results(task_id, limit=limit)
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
                        outputs = await tm.get_task_outputs(task_id, limit=limit)
                        if not outputs:
                            result_content = f"任务 `{task_id}` 没有输出文件(No output files)。\n\n"
                        elif is_remote and outputs and outputs[0].get("error"):
                            # 远程模式下输出文件在 worker 服务器上，无法直接读取
                            result_content = f"💡 远程模式下，输出文件保存在 worker 服务器上。\n\n"
                            result_content += f"请通过 worker 的 Web UI 查看，或使用 `get_results` 查看执行摘要。\n\n"
                            results = await tm.get_task_results(task_id, limit=limit)
                            if results:
                                result_content += f"最近执行摘要：\n\n"
                                for i, res in enumerate(results, 1):
                                    result_content += f"{i}. **{res.start_time}** — {res.status}\n"
                                    if res.result_content:
                                        result_content += f"   结果: {res.result_content[:200]}...\n"
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
                        if is_remote:
                            result_content = f"❌ 远程模式下不支持直接读取输出文件。\n\n"
                            result_content += f"输出文件保存在 worker 服务器上，请通过 worker 的 Web UI 查看。\n\n."
                        else:
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
                    content="The results of execution:\n "+tool_call_summary+"\n",
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
    
    # ── Subagent Infrastructure ─────────────────────────────────────────────

    def _make_subagent_thread_id(self, sub_agent_name: str) -> str:
        """Generate a unique thread_id for a subagent.

        Format: {parent_thread_id}/sub/{agent_name}/{6-char uuid}
        Example: a1b2c3d4/sub/explore/x7k9p2
        """
        short_id = uuid.uuid4().hex[:6]
        return f"{self._thread_id}/sub/{sub_agent_name}/{short_id}"

    def _check_delegate_depth(self) -> None:
        """Raise DelegateDepthExceededError if max depth exceeded."""
        if self._delegate_depth >= self._max_delegate_depth:
            raise DelegateDepthExceededError(
                f"⚠️ Cannot delegate further: max depth ({self._max_delegate_depth}) "
                f"exceeded (current: {self._delegate_depth}). "
                f"This subagent is at the deepest allowed level."
            )

    def _get_tools_for_subagent(self, sub_agent_name: str) -> list:
        """Filter tools for subagent using allowlist + blocklist.

        Default blocklist prevents recursive delegation, config mutation,
        and scheduled task side effects. explore/plan types additionally
        block all write/edit/exec tools.
        """
        cfg = self._user_sub_agents.get(sub_agent_name, {})
        agent_type = cfg.get("type", "DrSaiAgent")

        # Determine blocklist by agent type
        if agent_type in ("explore", "plan"):
            disallowed = _READONLY_DISALLOWED_TOOLS
        else:
            disallowed = _DEFAULT_DISALLOWED_FOR_SUBAGENTS.copy()

        # Merge user-defined disallowed tools
        disallowed |= set(cfg.get("disallowed_tools", []))

        # Leaf role always blocks Delegate
        if cfg.get("role", "leaf") == "leaf":
            disallowed.add("Delegate")

        # Apply allowlist
        allowed = cfg.get("tools", "*")
        if allowed == "*":
            tools = list(self._tools) if hasattr(self, '_tools') else []
        else:
            tools = [
                t for t in (getattr(self, '_workbench', None) and self._workbench._tools or [])
                if t.name in allowed
            ]

        return [t for t in tools if t.name not in disallowed]

    async def _create_independent_model_client(self) -> ChatCompletionClient:
        """Create an independent model_client copy for subagent use.

        Creates a new instance with its own underlying httpx.AsyncClient so that
        subagent.close() does not affect the parent's HTTP connections.

        Uses raw config for HepAIChatCompletionClient to avoid
        ``dump_component``/``load_component`` losing the HepAI type
        (HepAIChatCompletionClient inherits ``component_provider_override`` from
        OpenAIChatCompletionClient, so ``load_component`` would instantiate an
        OpenAIChatCompletionClient instead).
        """
        if self._model_client is None:
            raise ValueError("Parent model_client is not initialized")

        # HepAI client: preserve the subclass type via raw config
        try:
            from hepai.agents.modules.components.LLMClient import (
                HepAIChatCompletionClient,
            )
            if isinstance(self._model_client, HepAIChatCompletionClient):
                raw = getattr(self._model_client, '_raw_config', {}).copy()
                independent = HepAIChatCompletionClient(**raw)
                independent._model_info = copy.deepcopy(self._model_client._model_info)
                return independent
        except ImportError:
            pass

        # Default path (works for all Component-based clients)
        model_config = self._model_client.dump_component()
        independent = ChatCompletionClient.load_component(model_config)
        independent._model_info = copy.deepcopy(self._model_client._model_info)
        return independent

    async def _create_local_subagent(
        self,
        sub_agent_name: str,
    ) -> "DrSaiAssistant":
        """Create a local DrSaiAssistant subagent instance.

        Key isolation guarantees:
        - thread_id = {parent}/sub/{name}/{uuid}  (independent)
        - SQLite context with isolated thread_id
        - only_system_message=True skips UserProfileManager
        - Reuses db_manager connection but writes to different thread_id
        """
        cfg = self._user_sub_agents.get(sub_agent_name, {})
        max_turns = cfg.get("max_turns", 10)

        # Build isolated thread_id
        sub_thread_id = self._make_subagent_thread_id(sub_agent_name)

        # Build temporary system prompt
        sub_prompt = cfg.get("prompt", "")
        sub_system = (
            f"You are a {sub_agent_name} subagent at {self._work_dir}.\n\n"
            f"{sub_prompt}\n\n"
            f"Complete the task and return a clear, concise summary."
        )

        # Get filtered tools for subagent
        tools = self._get_tools_for_subagent(sub_agent_name)

        # Independent model_client
        independent_model_client = await self._create_independent_model_client()

        # Always use SQLite context (isolated thread_id in shared DB)
        model_context_arg = None
        context_type_arg = "sqlite"

        subagent = DrSaiAssistant(
            name=sub_agent_name,
            model_client=independent_model_client,
            model_client_stream=True,
            tools=tools,
            system_message=sub_system,
            only_system_message=True,            # skip UserProfileManager
            max_turn_count=max_turns,
            model_context=model_context_arg,
            # Identity
            thread_id=sub_thread_id,
            user_id=self._user_id,
            # Workspace
            work_dir=str(self._work_dir),
            storage_dir=str(self._work_dir),
            only_in_workspace=False,
            # Database (shared connection, isolated thread_id)
            db_manager=self._db_manager,
            context_type=context_type_arg,
            # Safety
            allolow_dangrous_cmd=True,
            allolow_basic_tools=[],              # ← prevent get_operator_funcs tools
            sub_agent_config={},                 # no nested subagents
            skills_dir=[],
        )

        # Inject depth
        subagent._delegate_depth = self._delegate_depth + 1

        # Subagent isolation: prevent _run_startup_checks from reloading
        # configs and injecting unwanted tools (MCP, Delegate, skills).
        subagent._skip_startup_checks = True
        # Clear manager tools to prevent TodoWrite, UpdateUserConfig,
        # Delegate etc. from leaking into API calls.
        subagent._todo_tools = []
        subagent._update_user_config_tools = []
        subagent._scheduled_task_tools = []
        subagent._subagent_tools = []
        subagent._agent_skills_tools = []
        subagent._user_sub_agents = {}

        await subagent.lazy_init()
        return subagent

    async def _create_remote_subagent(
        self,
        sub_agent_name: str,
    ) -> "HepAIWorkerAgent":
        """Create a remote HepAIWorkerAgent subagent instance.

        Remote subagents manage their own thread/session on the server side.
        We pass chat_id (parent thread_id) for correlation.
        """
        cfg = self._user_sub_agents.get(sub_agent_name, {})
        remote_configs = cfg.get("model_remote_configs", {})

        subagent = HepAIWorkerAgent(
            name="Remote_Subagent",
            description=cfg.get("description", ""),
            model_remote_configs={
                "url": remote_configs.get("url", "https://aiapi.ihep.ac.cn/apiv2"),
                "api_key": self._model_client._client.api_key if self._model_client else None,
                "name": remote_configs.get("name", sub_agent_name),
            },
            chat_id=self._thread_id,
            run_info={
                "name": getattr(self._user_profile_manager, 'user_id', ''),
                "email": self._user_id,
            },
        )

        await subagent.lazy_init()
        return subagent

    async def _create_daemon_subagent(
        self,
        sub_agent_name: str,
    ) -> "DaemonSubagent":
        """Create a DaemonSubagent wrapper for a running daemon process.

        The daemon must already be running (started via ``drsai daemon start``).
        Communication happens over WebSocket JSON-RPC.

        Args:
            sub_agent_name: The full subagent key (e.g. ``daemon:default``).
        """

        cfg = self._user_sub_agents.get(sub_agent_name, {})
        daemon_name = cfg.get("daemon_name", "default")
        ws_port = cfg.get("daemon_ws_port")
        api_token = cfg.get("daemon_api_token")

        if not ws_port or not api_token:
            raise ValueError(
                f"Daemon '{daemon_name}' state is incomplete: "
                f"ws_port={ws_port}, token={'***' if api_token else 'MISSING'}"
            )

        # 连接复用：优先从连接池获取已有的 DaemonSubagent
        pooled = DaemonSubagent.get_from_pool(ws_port, api_token)
        if pooled is not None:
            logger.debug(
                "Reusing pooled DaemonSubagent for %s (ws_port=%s)",
                daemon_name, ws_port,
            )
            return pooled

        subagent = DaemonSubagent(
            name=f"daemon:{daemon_name}",
            ws_port=ws_port,
            api_token=api_token,
            daemon_name=daemon_name,
        )
        # 放入连接池供后续复用
        DaemonSubagent.put_to_pool(subagent)
        return subagent

    @staticmethod
    def _build_subagent_messages(
        prompt: str,
        work_dir: str,
        context: str | None = None,
    ) -> List[TextMessage]:
        """Build minimal task messages for subagent (Hermes-style).

        Only passes task + optional context + work directory.
        Does NOT pass parent conversation history.

        Args:
            prompt: The task description.
            work_dir: Work directory path.
            context: Optional background information.
        """
        content = f"Your task:\n\n{prompt}"
        if context:
            content = f"Background context:\n{context}\n\n{content}"
        content += f"\n\nWork directory: {work_dir}"

        return [TextMessage(content=content, source="user")]

    @staticmethod
    def _tag_message(
        message: "BaseAgentEvent | BaseChatMessage",
        sub_agent_name: str,
    ) -> "BaseAgentEvent | BaseChatMessage":
        """Tag a message with subagent source for display differentiation.

        ``message.source`` is validated by ``autogen_ext`` before every LLM
        call (``assert_valid_name``: only ``[a-zA-Z0-9_-]`` allowed).
        Sanitize ``sub_agent_name`` before embedding it so that names like
        ``"RongZai Agent"`` (with a space) don't cause a ValueError on the
        next parent-agent LLM call.
        """
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', sub_agent_name).strip('_') or 'subagent'
        if hasattr(message, 'source'):
            src = message.source or ""
            if not src:
                message.source = f"sub:{safe_name}"
            elif not src.startswith("sub:"):
                message.source = f"sub:{safe_name}/{src}"
        return message

    async def _safe_close_subagent(self, subagent, sub_agent_name: str) -> None:
        """Safely close a subagent and optionally clean up its DB messages."""
        try:
            await subagent.close()
        except Exception as e:
            logger.warning(f"Error closing subagent {sub_agent_name}: {e}")

        # Optionally clean up SQLite messages for multi-mode subagents
        if self._cleanup_subagent_messages and hasattr(subagent, '_context_type'):
            if getattr(subagent, '_context_type', None) == "sqlite":
                try:
                    await self._delete_subagent_messages(subagent._thread_id)
                except Exception as e:
                    logger.warning(
                        f"Failed to clean up subagent messages "
                        f"{subagent._thread_id}: {e}"
                    )

    async def _delete_subagent_messages(self, thread_id: str) -> None:
        """Delete all SessionMessage rows for a subagent thread_id."""
        from drsai.modules.managers.datamodel.db import SessionMessage
        if not self._db_manager:
            return
        try:
            self._db_manager.delete(
                model_class=SessionMessage,
                filters={"thread_id": thread_id},
            )
        except Exception as e:
            logger.warning(f"Failed to clean up messages for {thread_id}: {e}")

    async def _execute_subagent(
        self,
        sub_agent_name: str,
        prompt: str,
        context: str | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """Unified subagent execution entry point.

        Called by both _process_model_result (Delegate tool)
        and _handle_default_subagent_mode.

        Args:
            sub_agent_name: Subagent type name (explore, plan, general, ...).
            prompt: Task description.
            context: Optional background information.
            cancellation_token: Cancellation token for early termination.
        """
        # 1. Depth check
        self._check_delegate_depth()

        # 2. Create subagent (remote / daemon if config type indicates it)
        cfg = self._user_sub_agents.get(sub_agent_name, {})
        agent_type = cfg.get("type", "DrSaiAgent")
        if agent_type in ("HepAIWorkerAgent", "RemoteAgent"):
            subagent = await self._create_remote_subagent(sub_agent_name)
        elif agent_type == "DaemonAgent":
            subagent = await self._create_daemon_subagent(sub_agent_name)
        else:
            subagent = await self._create_local_subagent(sub_agent_name)

        # 3. Build task messages (Hermes-style: no parent history)
        task_messages = self._build_subagent_messages(
            prompt=prompt,
            work_dir=str(self._work_dir),
            context=context,
        )

        # 4. Execute with timeout — IMPORTANT: give each subagent its OWN
        #    CancellationToken to prevent close() from cancelling the parent's
        #    shared token (which would kill sibling parallel subagents).
        timeout = cfg.get("timeout", self._subagent_timeout)
        parent_ct = cancellation_token or CancellationToken()
        ct = CancellationToken()  # subagent-own token

        try:
            # Propagate cancellation from parent to subagent via a watcher.
            async def _watch_parent_cancel(parent: CancellationToken, child: CancellationToken):
                try:
                    while not parent.is_cancelled():
                        await asyncio.sleep(0.1)
                finally:
                    child.cancel()

            watcher = asyncio.create_task(_watch_parent_cancel(parent_ct, ct))

            try:
                async with asyncio.timeout(timeout):
                    async for message in subagent.on_messages_stream(
                        messages=task_messages,
                        cancellation_token=ct,
                    ):
                        # Tag for display
                        yield self._tag_message(message, sub_agent_name)

                        if isinstance(message, Response):
                            break  # subagent done

                        # Check pause/cancel
                        if getattr(self, 'is_paused', False) or ct.is_cancelled():
                            break
            finally:
                watcher.cancel()
                try:
                    await watcher
                except asyncio.CancelledError:
                    pass

        except asyncio.TimeoutError:
            logger.warning(f"Subagent '{sub_agent_name}' timed out after {timeout}s")
            yield TextMessage(
                content=(
                    f"⚠️ Subagent '{sub_agent_name}' timed out after {timeout}s.\n"
                    f"Try breaking the task into smaller steps or using multi mode."
                ),
                source="system",
            )
        except DelegateDepthExceededError as e:
            yield TextMessage(content=str(e), source="system")
        finally:
            await self._safe_close_subagent(subagent, sub_agent_name)

    async def _execute_subagents_parallel(
        self,
        delegate_calls: List[tuple],
        cancellation_token: CancellationToken,
        max_concurrent: int = 3,
        **common_kwargs,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """Execute multiple Delegate calls in parallel via asyncio.Queue merge.

        Each subagent runs in its own Task; outputs are merged through a shared
        Queue and yielded in arrival order.  A Semaphore caps concurrency.

        After all subagents complete, their final results are yielded as
        SubagentResult messages keyed by agent name, so the caller can
        populate exec_results with real content.
        """
        queue: asyncio.Queue = asyncio.Queue()
        semaphore = asyncio.Semaphore(max_concurrent)
        total = len(delegate_calls)
        done_count = 0
        _DONE = object()

        # Collect per-subagent final results
        subagent_results: Dict[str, str] = {}

        async def run_one(call_id, sub_agent_name, prompt, context):
            async with semaphore:
                last_content = ""
                try:
                    async for msg in self._execute_subagent(
                        sub_agent_name=sub_agent_name,
                        prompt=prompt,
                        context=context,
                        cancellation_token=cancellation_token,
                        **common_kwargs,
                    ):
                        # Track last text content for result collection
                        if isinstance(msg, TextMessage):
                            last_content = msg.content or ""
                        elif isinstance(msg, Response):
                            last_content = str(getattr(msg, 'chat_message', msg).content) if hasattr(msg, 'chat_message') else ""
                        await queue.put((sub_agent_name, msg))
                except Exception as e:
                    last_content = f"Error: {e}"
                    await queue.put((sub_agent_name, TextMessage(
                        content=f"⚠️ [{sub_agent_name}] {e}",
                        source="system",
                    )))
                finally:
                    # Store final result before signaling done
                    subagent_results[sub_agent_name] = last_content
                    await queue.put((None, _DONE))

        # Launch all tasks
        tasks = []
        for call_id, sub_agent_name, prompt, context, mode in delegate_calls:
            tasks.append(
                asyncio.create_task(
                    run_one(call_id, sub_agent_name, prompt, context)
                )
            )

        # Consume merged stream
        while done_count < total:
            name, message = await queue.get()
            if message is _DONE:
                done_count += 1
                continue
            yield self._tag_message(message, name) if name else message

        # Ensure all tasks complete
        await asyncio.gather(*tasks, return_exceptions=True)

        # Yield collected results for the caller
        for sub_agent_name, content in subagent_results.items():
            safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', sub_agent_name).strip('_') or 'subagent'
            yield TextMessage(
                content=f"[{sub_agent_name}] {content}",
                source=f"sub:{safe_name}",
                metadata={"subagent_result": sub_agent_name},
            )

    # ── End Subagent Infrastructure ─────────────────────────────────────────

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
            model_config = model_client.dump_component()
            independent_model_client = ChatCompletionClient.load_component(model_config)
            independent_model_client._model_info = copy.deepcopy(model_client._model_info)

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
        """Handle subagent execution — now delegates to unified _execute_subagent.

        Maintained for backward compatibility with assistant_skill.py.
        """
        prompt = argument["prompt"]
        sub_agent_name = argument["agent_type"]
        context = argument.get("context")

        async for message in self._execute_subagent(
            sub_agent_name=sub_agent_name,
            prompt=prompt,
            context=context,
            cancellation_token=cancellation_token,
        ):
            if isinstance(message, Response):
                yield message.chat_message
                await model_context.add_message(FunctionExecutionResultMessage(
                    content=[FunctionExecutionResult(
                        content=str(message.chat_message.content),
                        name=tool_name,
                        call_id=call_id,
                        is_error=False,
                    )]
                ))
                return
            yield message

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
            # Inject auto-correction warning prefix if present
            warning_prefix = (self._todo_manager._last_warning + "\n\n") if self._todo_manager._last_warning else ""
            # add message to model_context with user source
            await model_context.add_message(FunctionExecutionResultMessage(
                content=[FunctionExecutionResult(
                    content = warning_prefix + self._todo_manager.get_task_prompt(),
                    name = tool_name,
                    call_id = call_id,
                    is_error = False,
                ),]
            ))
            # send text message to save to db in drsai ui
            yield TextMessage(
                content=warning_prefix + todo_list,
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

            is_remote = self._is_remote_task_manager()
            tm = self._task_manager
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
                task_id = await tm.add_task(task)
                result_content = f"✅ 定时任务创建成功！\n\n"
                result_content += f"**任务ID:** `{task_id}`\n"
                result_content += f"**任务名称:** {task.task_name}\n"
                result_content += f"**调度类型:** {task.schedule_type}\n"
                result_content += f"**调度配置:** {task.schedule_config}\n"
                result_content += f"**下次执行:** {task.next_run}\n"
                if is_remote:
                    result_content += "\n💡 任务在后台 worker 进程中执行，CLI 关闭不影响任务运行。\n"

            elif operation == "list":
                # 列出任务
                session_id = argument.get("session_id")
                status = TaskStatus(argument["status"]) if argument.get("status") else None
                tasks = await tm.list_tasks(
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
                task = await tm.get_task(task_id)
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
                success = await tm.remove_task(task_id)
                if success:
                    result_content = f"✅ 任务已删除(Task deleted successfully): `{task_id}`。\n\n"
                else:
                    result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"

            elif operation == "toggle":
                # 启用/禁用任务
                task_id = argument["task_id"]
                enabled = argument["enabled"]
                task = await tm.get_task(task_id)
                if task is None:
                    result_content = f"❌ 任务不存在(Task not found): `{task_id}`。\n\n"
                else:
                    new_status = TaskStatus.ENABLED if enabled else TaskStatus.DISABLED
                    await tm.update_task_status(task_id, new_status)
                    result_content = f"✅ 任务已{'启用' if enabled else '禁用'}: `{task_id}`"
                    result_content += f"Task {'enabled' if enabled else 'disabled'} successfully\n\n."

            elif operation == "get_results":
                # 查询执行历史
                task_id = argument["task_id"]
                limit = argument.get("limit", 10)
                results = await tm.get_task_results(task_id, limit=limit)
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
                outputs = await tm.get_task_outputs(task_id, limit=limit)
                if not outputs:
                    result_content = f"任务 `{task_id}` 没有输出文件(No output files)。\n\n"
                elif is_remote and outputs and outputs[0].get("error"):
                    # 远程模式下输出文件在 worker 服务器上，无法直接读取
                    result_content = f"💡 远程模式下，输出文件保存在 worker 服务器上。\n\n"
                    result_content += f"请通过 worker 的 Web UI 查看，或使用 `get_results` 查看执行摘要。\n\n"
                    results = await tm.get_task_results(task_id, limit=limit)
                    if results:
                        result_content += f"最近执行摘要：\n\n"
                        for i, res in enumerate(results, 1):
                            result_content += f"{i}. **{res.start_time}** — {res.status}\n"
                            if res.result_content:
                                result_content += f"   结果: {res.result_content[:200]}...\n"
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
                if is_remote:
                    result_content = f"❌ 远程模式下不支持直接读取输出文件。\n\n"
                    result_content += f"输出文件保存在 worker 服务器上，请通过 worker 的 Web UI 查看。\n\n."
                else:
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
            storage_dir=str(self._work_dir),  # storage_dir = _work_dir (already includes user_id)
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
            storage_dir=config.storage_dir,
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
