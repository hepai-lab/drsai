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
import os, json, sys, uuid
import asyncio
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
    AssistantMessage,
    UserMessage,
    SystemMessage,
    LLMMessage
    )
from drsai.modules.baseagent.drsaiagent import DrSaiAgentConfig
from drsai.modules.baseagent import CodeExecutorAgent, CodeExecutor
from drsai.modules.components import (
    ComponentModel,
)
from drsai.modules.components.model_client import ChatCompletionClient
from drsai.modules.components.model_context import (
    ChatCompletionContext,
)
from drsai.modules.components.memory import Memory
from drsai.modules.components.tool import (
    BaseTool, 
    FunctionTool, 
    Workbench,
    ToolSchema,
    ParametersSchema,
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
from drsai.modules.agents.skills_agent import (
    UserProfileManager,
    TodoManager,
    get_operator_funcs,
)
from drsai.modules.components.skills import SkillLoader
from .managers.get_managers_tools import (
    get_agent_skills_tool,
    get_subagent_tools,
    get_todo_manager_tool,
)

class DrSaiAssistantConfig(DrSaiAgentConfig):
    skills_dir: Optional[str | List[str]]
    executor: ComponentModel
    work_dir: str
    sub_agent_config: Dict | None
    max_turn_count: int

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
        # skills and executor
        skills_dir: Optional[str | List[str]] = None,
        skills_loader: SkillLoader | None = None,
        work_dir: str | None = None,
        executor: CodeExecutor | None = None,
        sub_agent_config: Dict | None = None,
        max_turn_count: int = 20,
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
        )

        # === workspace for assistant ===
        if not work_dir:
            if self._db_manager:
                DEFAULT_RUN_DIR: Path = self._db_manager.schema_manager.base_dir / "runs"
                self._work_dir = DEFAULT_RUN_DIR / self._user_id
            else:
                self._work_dir = Path(RUNS_DIR) / self._user_id
        else:
            self._work_dir = Path(work_dir)
        if not self._work_dir.exists():
            self._work_dir.mkdir(parents=True)

        # === initial UserProfileManager ===
        self._user_profile_manager = UserProfileManager(
            agent_name=self._name,
            work_dir=self._work_dir,
            user_id=self._user_id,
        )
        # self.user_config_tools = [self._user_profile_manager.get_update_user_profile_tool()]
        self.update_user_config_tools = [self._user_profile_manager.get_user_config_tool()]
        # 获取agent描述、用户画像并更新系统消息
        user_context = self._user_profile_manager.get_agent_system_prompt()
        if user_context and system_message:
            # 合并系统消息和用户上下文
            enhanced_system_message = f"""{system_message}

{user_context}
"""
            self._system_messages = [SystemMessage(content=enhanced_system_message)]

        # === basic tools ===
        self._basic_funcs: List[Callable] = get_operator_funcs(work_dir)
        self._basic_funcs_names = [func.__name__ for func in self._basic_funcs]
        for func in self._basic_funcs:
            self._tools.append(FunctionTool(func, description=func.__doc__))
        self._workbench._tools = self._tools

        # === skills ===
        self._skills_loader: Optional[SkillLoader] = None
        if skills_loader:
            self._skills_loader = skills_loader
        else:
            # 首先尝试从用户的skills目录加载
            user_skills_dir = self._user_profile_manager.skills_dir
            if user_skills_dir.exists() and list(user_skills_dir.glob("*/SKILL.md")):
                self._skills_loader = SkillLoader(skills_dir=str(user_skills_dir))
            # 再从指定的skills目录加载
            if skills_dir:
                if not self._skills_loader:
                    self._skills_loader = SkillLoader(skills_dir=skills_dir)
                else:
                    self._skills_loader.add_skills_by_dir(skills_dir=skills_dir)
        # 获取技能描述
        if self._skills_loader.skills:
            self._agent_skills_tools = [get_agent_skills_tool(descriptions=self._skills_loader.get_descriptions())]
        else:
            self._agent_skills_tools = []

        # === executor ===
        self._executor = executor
        
        # === sub_agent_config ===
        self._sub_agent_config = sub_agent_config
        if self._sub_agent_config:
            self._subagent_descriptions = self.get_subagent_descriptions()
            self._subagent_tools = [
                get_subagent_tools(
                    sub_agents=list(self._sub_agent_config.keys()),
                    description=self._subagent_descriptions)]
        else:
            self._subagent_descriptions = ""
            self._subagent_tools = []

        # === todo manager ===
        self._todo_manager = TodoManager()
        self._todo_tools = [get_todo_manager_tool()]

        # 初始化实例变量供edge_agent_core使用
        # self._current_plan = None
        # self._task_planner = None
        # self._memory_manager = None

        # === manager ToolSchema ===
        self.manager_tools = self.update_user_config_tools+self._agent_skills_tools+self._subagent_tools+self._todo_tools

        # max_turn_count
        self._max_turn_count = max_turn_count

    def get_subagent_descriptions(self) -> str:
        """Generate agent type descriptions for system prompt."""
        return "\n".join(
            f"- {name}: {cfg['description']}"
            for name, cfg in self._sub_agent_config.items()
        )
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
            # Gather all relevant state here
            agent_name = self._user_profile_manager.agent_name
            model_context = self._model_context
            memory = self._memory
            system_messages = self._system_messages
            workbench = self._workbench
            handoff_tools = self._handoff_tools
            handoffs = self._handoffs
            manager_tools = self.manager_tools
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
                        source=agent_name,
                        thought=getattr(model_result, "thought", None),
                    )
                )
                
                # If direct text response (string)
                if isinstance(model_result.content, str):
                    reponse = await self.handle_str_reponse(
                            model_result = model_result,
                            agent_name = agent_name,
                            format_string = format_string,
                            inner_messages = inner_messages,
                            output_content_type = output_content_type,)
                    
                    yield reponse
                    return

                # Otherwise, we have function calls
                assert isinstance(model_result.content, list) and all(
                    isinstance(item, FunctionCall) for item in model_result.content
                )
                
                # Log ToolCallRequestEvent
                tool_call_msg = ToolCallRequestEvent(
                    content=model_result.content,
                    source=agent_name,
                    models_usage=model_result.usage,
                )
                logger.debug(tool_call_msg)
                tools_name = [tool.name for tool in model_result.content] 
                yield AgentLogEvent(
                    title="I am using tools: " + " ".join(tools_name),
                    source=agent_name, 
                    content=str(tool_call_msg.content), 
                    content_type="tools")
                inner_messages.append(tool_call_msg)
                yield tool_call_msg

                # handle tool call
                for i in range(len(model_result.content)):
                    argument = json.loads(model_result.content[i].arguments)
                    tool_name = model_result.content[i].name
                    if tool_name == "TodoWrite":
                        async for message in self.handle_todo_write(
                            argument = argument,
                            agent_name = agent_name, 
                            model_context = model_context):
                            if isinstance(message, StopMessage):
                                yield message
                                return
                            yield message
                    elif tool_name == "Task":
                        async for message in self.handle_subagent_repsonse(
                            agent_name = agent_name,
                            model_client = model_client,
                            model_client_stream = model_client_stream,
                            model_context = model_context,
                            argument = argument,
                            cancellation_token = cancellation_token,
                            output_content_type = output_content_type,
                        ):
                            if isinstance(message, StopMessage):
                                yield message
                                return
                            yield message
                    elif tool_name == "Skill":
                        skill_content = self._skills_loader.run_skill(argument["skill"])
                        await model_context.add_message(
                            UserMessage(
                                content=f"Skill for {argument["skill"]}: {skill_content}",
                                source="user",
                            )
                        )
                    elif tool_name in self._basic_funcs_names:
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
                                yield message.chat_message
                                # repetitive addition
                                # await model_context.add_message(
                                #     UserMessage(
                                #         content=message.chat_message.content,
                                #         source="user",
                                #     )
                                # )
                            else:
                                yield message
                    elif tool_name == "UpdateUserConfig":
                        self._user_profile_manager.update_user_config(**argument)
                    else:
                        await model_context.add_message(
                            UserMessage(
                                content=f"Unknown tool: {argument["name"]}",
                                source="user",
                            )
                        )

                turn_count += 1
            
            if self._user_profile_manager.first_time_setup:
                yield TextMessage(
                    content="\n\n(●'◡'●)如果您需要调整我的名称、我对您的称呼、您涉及领域，请告诉我，我来调整(If you need to adjust my name, how I address you, or your field of expertise, please let me know, and I will make the changes).",
                    source=agent_name,
                    metadata={"internal": "no"},
                )
                self._user_profile_manager.first_time_setup = False

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
            # logger.error(f"Error in {self.name}: {e}")
            logger.exception(f"Error in {self.name}")
            # add to chat history
            await model_context.add_message(
                AssistantMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self._user_profile_manager.agent_name
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
            pass

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
        allowed = self._sub_agent_config.get(agent_type, {}).get("tools", "*")
        if allowed == "*":
            return self._tools
        return [t for t in self._tools if t.name in allowed]

    async def handle_subagent_repsonse(
        self,
        agent_name: str,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        argument:Dict[str, Any],
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """
        Sub agent can actuate the sub task.

        The types of sub agent:
        1. code_executor
        2. normal drsai agent
        """
        try:
            description, prompt, agent_type = argument["description"], argument["prompt"], argument["agent_type"]

            # get sub agent system prompt
            sub_system = f"""You are a {agent_type} subagent at {self._work_dir}.

    {self._sub_agent_config[agent_type].get("prompt", "")}

    Complete the task and return a clear, concise summary."""
            
            # construct task messages
            task_messages: Sequence[BaseChatMessage] = []
            task_messages.append(TextMessage(content=f"Current task: \n\n{prompt}", source="user"))
            llm_messages = await model_context.get_messages()
            backgroud_message = "Below are the historical chat records between the user and various intelligent assistants, which can be referenced when executing the current task.\n\n"
            for llm_message in llm_messages:
                if isinstance(llm_message, UserMessage) or isinstance(llm_message, AssistantMessage):
                    backgroud_message += f"{llm_message.source}: {llm_message.content}\n\n"
            task_messages.append(TextMessage(content=backgroud_message, source="user"))

            #  TODO: handle turn count fro multi-turn task.
            # turn_count = 0
            # while turn_count < self._max_turn_count:
            #     turn_count += 1
        
            if agent_type == "coder_executor":
                subagent = CodeExecutorAgent(
                    name=agent_type,
                    code_executor=self._executor,
                    model_client_stream=model_client_stream,
                )
            else:
                tools = self.get_tools_for_agent(agent_type)
                description=self._sub_agent_config[agent_type].get("description", "")
                subagent = DrSaiAgent(
                    name=agent_type,
                    system_message=sub_system,
                    description=description,
                    tools=tools,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    output_content_type=output_content_type,)
            
            async for message in subagent.on_messages_stream(messages=task_messages, cancellation_token=cancellation_token):
                if isinstance(message, Response):
                    yield message.chat_message
                    await model_context.add_message(
                        UserMessage(
                            content=message.chat_message.content,
                            source="user",
                        )
                    )
                    return
                yield message

        except Exception as e:
            logger.exception(f"Error in {self.name}")
            yield ModelClientStreamingChunkEvent(
                content=str(e)+"\n\n",
                source=self.name,
            )
            await model_context.add_message(
                UserMessage(
                    content=str(e),
                    source="user",
                )
            )
            yield StopMessage(
                content=str(e),
                source=agent_name,
            )

    async def handle_todo_write(
        self,
        argument: Dict[str, Any],
        agent_name: str,
        model_context: ChatCompletionContext,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        try:
            todo_list = self._todo_manager.update(argument["items"])
            # send stream message
            yield ModelClientStreamingChunkEvent(
                content=todo_list+"\n\n",
                source=self.name,
            )
            # add message to model_context with user source
            await model_context.add_message(
                UserMessage(
                    content=self._todo_manager.get_task_prompt(),
                    source="user",
                )
            )
            # send text message to save to db in drsai ui
            yield TextMessage(
                content=todo_list,
                source=agent_name,
            )
        except Exception as e:
            logger.exception(f"Error in {self.name}")
            yield ModelClientStreamingChunkEvent(
                content=str(e)+"\n\n",
                source=self.name,
            )
            await model_context.add_message(
                UserMessage(
                    content=str(e),
                    source="user",
                )
            )
            yield StopMessage(
                content=str(e),
                source=agent_name,
            )

    # TODO: handle system messages update

    # TODO: handle user profile update

    # TODO: handle user tools and evenroment

    # TODO: handle skills and self-learning -> # TODO: 支持动态获取skills

    # TODO: fixed the config
    # def _to_config(self) -> DrSaiAssistantConfig:
    #     """Convert the assistant agent to a declarative config."""

    #     return DrSaiAssistantConfig(
    #         name=self.name,
    #         model_client=self._model_client.dump_component(),
    #         tools=None,  # versionchanged:: v0.5.5  Now tools are not serialized, Cause they are part of the workbench.
    #         workbench=self._workbench.dump_component() if self._workbench else None,
    #         handoffs=list(self._handoffs.values()) if self._handoffs else None,
    #         model_context=self._model_context.dump_component(),
    #         memory=[memory.dump_component() for memory in self._memory] if self._memory else None,
    #         description=self.description,
    #         system_message=self._system_messages[0].content
    #         if self._system_messages and isinstance(self._system_messages[0].content, str)
    #         else None,
    #         model_client_stream=self._model_client_stream,
    #         reflect_on_tool_use=self._reflect_on_tool_use,
    #         tool_call_summary_format=self._tool_call_summary_format,
    #         tool_call_summary_prompt=self._tool_call_summary_prompt,
    #         structured_message_factory=self._structured_message_factory.dump_component()
    #         if self._structured_message_factory
    #         else None,
    #         metadata=self._metadata,
    #         db_manager_config=self._db_manager.dump_component(),
    #         thread_id=self._thread_id,
    #         user_id=self._user_id,
    #         skills_dir=self._skills_dir,
    #     )
    
    # @classmethod
    # def _from_config(
    #     cls, config: DrSaiAssistantConfig, 
    #     db_manager: DatabaseManager,
    #     memory_function: Callable = None,
    #     reply_function: Callable = None,
    #     **kwargs,
    #     ) -> Self:
    #     """Create an assistant agent from a declarative config."""
    #     if config.structured_message_factory:
    #         structured_message_factory = StructuredMessageFactory.load_component(config.structured_message_factory)
    #         format_string = structured_message_factory.format_string
    #         output_content_type = structured_message_factory.ContentModel

    #     else:
    #         format_string = None
    #         output_content_type = None

    #     return cls(
    #         name=config.name,
    #         model_client=ChatCompletionClient.load_component(config.model_client),
    #         workbench=Workbench.load_component(config.workbench) if config.workbench else None,
    #         handoffs=config.handoffs,
    #         model_context=ChatCompletionContext.load_component(config.model_context) if config.model_context else None,
    #         tools=[BaseTool.load_component(tool) for tool in config.tools] if config.tools else None,
    #         memory=[Memory.load_component(memory) for memory in config.memory] if config.memory else None,
    #         description=config.description,
    #         system_message=config.system_message,
    #         model_client_stream=config.model_client_stream,
    #         reflect_on_tool_use=config.reflect_on_tool_use,
    #         tool_call_summary_format=config.tool_call_summary_format,
    #         tool_call_summary_prompt=config.tool_call_summary_prompt,
    #         output_content_type=output_content_type,
    #         output_content_type_format=format_string,
    #         metadata=config.metadata,
    #         memory_function=memory_function,
    #         reply_function=reply_function,
    #         db_manager=db_manager,
    #         thread_id=config.thread_id,
    #         user_id=config.user_id,
    #         skills_dir=config.skills_dir,
    #         **kwargs,
    #     )
