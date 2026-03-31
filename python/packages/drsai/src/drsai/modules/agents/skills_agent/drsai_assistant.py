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

from drsai import CancellationToken, FunctionCall
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
from ..drsai_worker_agent import HepAIWorkerAgent
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
    AgentLogEvent,
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
)
from drsai.modules.components.skills import SkillLoader
from drsai.utils.utils import download_file_from_url_or_base64, fix_and_parse_json
from .managers.get_managers_tools import (
    get_agent_skills_tool,
    get_subagent_tools,
    get_todo_manager_tool,
    create_local_venv,
)

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

    TODO: 核心能力:
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
        # skills and executor
        skills_dir: Optional[str | List[str]] = None,
        work_dir: str | None = None,
        only_in_workspace: bool = True,
        extra_work_dirs: List[str] | None = None,
        executor: CodeExecutor | None = None,
        sub_agent_config: Dict = {},
        max_turn_count: int = 20,
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
        )

        self._developer_system_message = system_message

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
        
        # === basic tools ===
        self._only_in_workspace = only_in_workspace
        self._extra_work_dirs = extra_work_dirs
        self._basic_funcs: List[Callable] = get_operator_funcs(
            work_dir, 
            only_in_workspace=self._only_in_workspace,
            extra_dirs = self._extra_work_dirs,
            )
        self._basic_funcs_names = [func.__name__ for func in self._basic_funcs]
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
        self._model_context = DrSaiChatCompletionContext(
            agent_name=self._user_profile_manager.agent_name,
            model_client=self._model_client,
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
        funcs = [self._model_context.retrieve_from_memory, self._model_context.summry_conversation_to_memory]
        for func in funcs:
            self._tools.append(FunctionTool(func, description=func.__doc__))
                
        # === skills ===
        self._skills_dir = skills_dir
        if self._user_profile_manager.first_time_setup and self._skills_dir:
            src_dirs = self._skills_dir if isinstance(self._skills_dir, list) else [self._skills_dir]
            dst_root = self._user_profile_manager.skills_dir
            for src_dir in src_dirs:
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

    def update_system_prompt(self, additional_prompt: str = "") -> str:
        """获取agent描述、用户画像并更新系统消息"""
        user_context = self._user_profile_manager.get_agent_system_prompt()
        enhanced_system_message = self._developer_system_message
        if user_context and self._developer_system_message:
            # 合并系统消息和用户上下文
            enhanced_system_message = f"""{self._developer_system_message}

{user_context}

Current Session_ID is {self._thread_id}
"""
        enhanced_system_message += additional_prompt
        self._system_messages = [SystemMessage(content=enhanced_system_message)]
    
    def update_user_skills(self) -> SkillLoader:
        """加载/更新用户技能"""
        skills_loader = None
        # 首先尝试从用户的skills目录加载
        user_skills_dir = self._user_profile_manager.skills_dir
        if user_skills_dir.exists() and list(user_skills_dir.glob("*/SKILL.md")):
            skills_loader = SkillLoader(skills_dir=str(user_skills_dir))
        # # 再从指定的skills目录加载
        # if self._skills_dir:
        #     if not skills_loader:
        #         skills_loader = SkillLoader(skills_dir=self._skills_dir)
        #     else:
        #         skills_loader.add_skills_by_dir(skills_dir=self._skills_dir)
        # 获取技能描述
        if skills_loader and skills_loader.skills:
            self._agent_skills_tools = [get_agent_skills_tool(descriptions=skills_loader.get_descriptions())]
        else:
            self._agent_skills_tools = []
        return skills_loader
    
    async def update_user_tools(self) -> str:
        """将用户的自定义配置工具接入到agent中"""
        user_mcp_tools = []
        user_local_tools = []
        tools_config = self._user_profile_manager.load_user_tools_config()
        for tool in tools_config:
            try:
                if tool.get("type") == "mcp-std":
                    config = tool.get("config")
                    if "command" in config and "args" in config:
                        std_mcp_tools = await mcp_server_tools(StdioServerParams(
                            command=config["command"],
                            args=config["args"]
                        ))
                        user_mcp_tools.extend(std_mcp_tools)
                elif tool.get("type") == "mcp-sse":
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
                    user_local_tools.append(str(config)+"\n")

            except Exception as e:
                # print(f"Error loading tool: {e}")
                pass

        self._workbench._tools = self._tools + user_mcp_tools
        self._tools_names = [tool.name for tool in self._workbench._tools ]

        if user_local_tools:
            user_local_tools_prompt = "The info about the user's local function is as follows. When needed, you can execute it on the command line using `run_bash` tool\n\n"
            user_local_tools_prompt += "\n".join(user_local_tools)
        else:
            user_local_tools_prompt = ""
        return user_local_tools_prompt
    
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
                        attached_files_json = msg.metadata.get("attached_files")
                        if attached_files_json:
                            attached_files = json.loads(attached_files_json)
                            for file in attached_files:
                                download_file_from_url_or_base64(
                                    file_info = file, 
                                    save_path = f"{self._user_profile_manager.download_dir}/{file['name']}")
                        settings_config = msg.metadata.get("settings_config")
                        if settings_config:
                            settings_config = json.loads(settings_config)
                            default_config_name = settings_config.get("defult_config_name")
                            llm_name = self._llm_mode_config.get(default_config_name)
                            if llm_name != self._model_client._create_args["model"] and self._set_model_client:
                                self._model_client = self._set_model_client(default_config_name)
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

            # initialize the learning memory document
            if self._user_profile_manager.first_time_setup:
                self._learning_document_id = await self._model_context.create_new_session_document(dataset_id = self._learning_dataset_id, create_type="learning_memory" )
                self._user_profile_manager.update_document_ids(thread_id=self._user_id, document_id=self._learning_document_id)
            # create the new session document
            if self._memory_document_id is None:
                self._memory_document_id = await self._model_context.create_new_session_document(
                    user_id = self._user_id,
                    thread_id = self._thread_id,
                    work_dir = self._work_dir,
                )
                self._user_profile_manager.update_document_ids(thread_id=self._thread_id, document_id=self._memory_document_id)
                self._model_context._document_id = self._memory_document_id


            # load/update tools only if TOOLS_CONFIG.json changed
            tools_changed = self._file_changed(self._user_profile_manager.tools_config_path)
            if tools_changed:
                self._cached_tools_prompt = await self.update_user_tools()

            # update system prompt if AGENTS.md or tools prompt changed
            if tools_changed or self._file_changed(self._user_profile_manager.agents_md):
                self.update_system_prompt(additional_prompt=self._cached_tools_prompt)

            # load/update skills only if skills directories changed
            skills_changed = self._file_changed(self._user_profile_manager.skills_dir)
            if self._skills_dir:
                extra_dirs = self._skills_dir if isinstance(self._skills_dir, list) else [self._skills_dir]
                skills_changed = skills_changed or any(self._file_changed(Path(d)) for d in extra_dirs)
            if skills_changed or self._cached_skills_loader is None:
                self._cached_skills_loader = self.update_user_skills()
            skills_loader = self._cached_skills_loader

            # load/update subagents only if SUBAGENT_CONFIG.json changed
            if self._file_changed(self._user_profile_manager.subagent_config_path):
                self.update_user_subagents()

            # manager ToolSchema
            manager_tools = self._update_user_config_tools+self._agent_skills_tools+self._subagent_tools+self._todo_tools

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
                
                # handle tool call
                for i in range(len(model_result.content)):
                    # argument = json.loads(model_result.content[i].arguments)
                    argument = fix_and_parse_json(model_result.content[i].arguments)
                    if isinstance(argument, str):
                        await model_context.add_message(FunctionExecutionResultMessage(
                            content=[FunctionExecutionResult(
                                content = argument,
                                name = tool_name,
                                call_id = call_id,
                                is_error = False,
                            ),]
                        ))
                        continue

                    tool_name = model_result.content[i].name
                    call_id = model_result.content[i].id
                    if tool_name == "TodoWrite":
                        async for message in self.handle_todo_write(
                            argument = argument,
                            tool_name = tool_name,
                            call_id = call_id,
                            agent_name = agent_name, 
                            model_context = model_context):
                            if isinstance(message, StopMessage):
                                yield Response(
                                    chat_message=message,
                                    inner_messages=inner_messages,
                                )
                                return
                            yield message
                    elif tool_name == "Task":
                        async for message in self.handle_subagent_repsonse(
                            agent_name = agent_name,
                            model_client = model_client,
                            model_client_stream = model_client_stream,
                            model_context = model_context,
                            argument = argument,
                            tool_name = tool_name,
                            call_id = call_id,
                            cancellation_token = cancellation_token,
                            output_content_type = output_content_type,
                        ):
                            if isinstance(message, StopMessage):
                                yield Response(
                                    chat_message=message,
                                    inner_messages=inner_messages,
                                )
                                return
                            yield message
                    elif tool_name == "Skill":
                        skill_content = skills_loader.run_skill(argument["skill"])
                        # await model_context.add_message(
                        #     UserMessage(
                        #         content=f"Skill for {argument["skill"]}: {skill_content}",
                        #         source="user",
                        #     )
                        # )
                        await model_context.add_message(FunctionExecutionResultMessage(
                            content=[FunctionExecutionResult(
                                content = f"Skill for {argument["skill"]}:\n\n {skill_content}",
                                name = tool_name,
                                call_id = call_id,
                                is_error = False,
                            ),]
                        ))
                        yield AgentLogEvent(
                            title=f"I am reading skill: {argument["skill"]}.",
                            source=agent_name, 
                            content=str(argument), 
                            content_type="tools")
                        yield ToolCallSummaryMessage(
                            content=f"<think>Skill for {argument["skill"]}:\n\n {skill_content}</think>\n",
                            source=agent_name,
                        )
                    elif tool_name in self._tools_names:
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
                        ):
                            if self.is_paused:
                                raise asyncio.CancelledError()
                            if isinstance(message, Response):
                                # yield ModelClientStreamingChunkEvent(content="<think>", source=agent_name)
                                # yield ModelClientStreamingChunkEvent(content=str(message.chat_message.content), source=agent_name)
                                # yield ModelClientStreamingChunkEvent(content="</think>\n", source=agent_name)
                                yield message.chat_message
                            else:
                                yield message
                            
                        break
                    elif tool_name == "UpdateUserConfig":
                        update_message = self._user_profile_manager.update_user_config(**argument)
                        # await model_context.add_message(
                        #     UserMessage(
                        #         content=update_message,
                        #         source="user",
                        #     )
                        # )
                        await model_context.add_message(FunctionExecutionResultMessage(
                            content=[FunctionExecutionResult(
                                content = update_message,
                                name = tool_name,
                                call_id = call_id,
                                is_error = False,
                            ),]
                        ))
                        agent_name = self._user_profile_manager.agent_name
                        yield AgentLogEvent(
                            title=f"I am updating user's config.",
                            source=agent_name, 
                            content=str(argument), 
                            content_type="tools")
                    else:
                        await model_context.add_message(FunctionExecutionResultMessage(
                            content=[FunctionExecutionResult(
                                content = f"Unknown tool: {model_result.content[i].name}",
                                name = tool_name,
                                call_id = call_id,
                                is_error = False,
                            ),]
                        ))
                        # await model_context.add_message(
                        #     UserMessage(
                        #         content=f"Unknown tool: {model_result.content[i].name}",
                        #         source="user",
                        #     )
                        # )

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
            # save/update the conversation to {worker_dir}/memories
            if isinstance(self._model_context, DrSaiChatCompletionContext):
                if self._model_context._rag_flow_manager:
                    await self._model_context.upload_conversation_to_ragflow()
                self._model_context._current_messages = []
                current_session_memory = self._model_context._history_messages
                # TODO: use updates instead of full writes
                self._user_profile_manager.save_session_memory(current_session_memory)
                

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

        if isinstance(model_context, DrSaiChatCompletionContext):
            all_messages = await model_context.get_messages(cancellation_token = cancellation_token)
        else:
            all_messages = await model_context.get_messages()
        
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
    
    @classmethod
    async def _process_model_result(
        cls,
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
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Handle final or partial responses from model_result, including tool calls, handoffs,
        and reflection if needed.
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

        # STEP 4B: Execute tool calls
        executed_calls_and_results = await asyncio.gather(
            *[
                cls._execute_tool_call(
                    tool_call=call,
                    workbench=workbench,
                    handoff_tools=handoff_tools,
                    agent_name=agent_name,
                    cancellation_token=cancellation_token,
                )
                for call in model_result.content
            ]
        )
        exec_results = [result for _, result in executed_calls_and_results]
        await model_context.add_message(FunctionExecutionResultMessage(content=exec_results))
        normal_tool_calls = [(call, result) for call, result in executed_calls_and_results if call.name not in handoffs]
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

            # Get agent
            if sub_agent_name in self._user_sub_agents:
                sub_agent = self._user_sub_agents[sub_agent_name]
                description=self._sub_agent_config[sub_agent_name].get("description", "")
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
                        model_client=model_client,
                        model_client_stream=model_client_stream,
                        output_content_type=output_content_type,)
                elif sub_agent_type == "HepAIWorkerAgent":
                    model_remote_configs = sub_agent.get("model_remote_configs")
                    url = model_remote_configs.get("url", "https://aiapi.ihep.ac.cn/apiv2")
                    name = model_remote_configs.get("name")
                    subagent = HepAIWorkerAgent(
                        name=sub_agent_name,
                        description=description,
                        model_remote_configs={
                            "url": url,
                            "api_key": self._model_client._client.api_key,
                            "name": name
                        },
                        chat_id=self._thread_id,
                        run_info={"name": self._user_profile_manager.user_name, "email": self._user_id},

                    )

            
            # Process task
            #  TODO: handle turn count fro multi-turn task.
            # turn_count = 0
            # while turn_count < self._max_turn_count:
            #     turn_count += 1
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

    # TODO: handle user tools and evenroment

    # TODO: handle skills and self-learning -> # TODO: 支持动态获取skills

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
