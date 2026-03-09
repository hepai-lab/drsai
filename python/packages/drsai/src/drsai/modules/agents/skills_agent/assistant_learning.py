
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

import asyncio, traceback, json
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
from drsai.modules.components.skills import SkillLoader
from .managers.operater_funs import get_operator_funcs
from .managers.todo_manager import TodoManager
from .managers.user_profile_manager import UserProfileManager
from .managers.task_planner import TaskPlanner, TaskPlan
from .managers.memory_manager import LongTermMemoryManager
from drsai.configs.constant import RUNS_DIR

class EdgeAgentConfig(DrSaiAgentConfig):
    skills_dir: str
    executor: ComponentModel
    work_dir: str
    sub_agent_config: Dict | None

class EdgeAgent(DrSaiAgent):
    """
    EdgeAgent - 专业科学数据智能分析智能体

    核心能力:
    1. 任务规划与分解
    2. 多任务进度管理
    3. 智能工具/Skills/子智能体调用
    4. 长期记忆与学习
    5. 错误处理与用户交互
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
        skills_dir: str | None = None,
        skills_loader: SkillLoader | None = None,
        work_dir: str | None = None,
        executor: CodeExecutor | None = None,
        sub_agent_config: Dict | None = None,
        max_turn_count: int = 20,
        memory_function: Callable | None = None,
        reply_function: Callable | None = None,
        db_manager: DatabaseManager | None = None,
        thread_id: str | None = None,
        user_id: str | None = None,
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

        if not work_dir:
            if self._db_manager:
                DEFAULT_RUN_DIR: Path = self._db_manager.schema_manager.base_dir / "runs"
                self._work_dir = DEFAULT_RUN_DIR
            else:
                self._work_dir = Path(RUNS_DIR)
        else:
            self._work_dir = Path(work_dir)
        if not self._work_dir.exists():
            self._work_dir.mkdir(parents=True)

        # === initial UserProfileManager ===
        self._user_profile_manager = UserProfileManager(
            work_dir=self._work_dir,
            user_id=self._user_id,
        )

        # 获取用户画像并更新系统消息
        user_context = self._user_profile_manager.get_agent_system_prompt()
        if user_context and system_message:
            # 合并系统消息和用户上下文
            enhanced_system_message = f"""{system_message}

{user_context}
"""
            self._system_messages = [SystemMessage(content=enhanced_system_message)]

        # basic tools
        self._basic_funcs: List[Callable] = get_operator_funcs(work_dir)
        self._basic_funcs_names = [func.__name__ for func in self._basic_funcs]
        for func in self._basic_funcs:
            self._tools.append(FunctionTool(func, description=func.__doc__))
        self._workbench._tools = self._tools

        # skills - 优先从用户目录加载
        if skills_loader:
            self._skills_loader = skills_loader
        else:
            # 首先尝试从用户的skills目录加载
            user_skills_dir = self._user_profile_manager.skills_dir
            if user_skills_dir.exists() and list(user_skills_dir.glob("*/SKILL.md")):
                self._skills_loader = SkillLoader(skills_dir=str(user_skills_dir))
            elif skills_dir:
                self._skills_loader = SkillLoader(skills_dir=skills_dir)
            else:
                # 创建空的skills loader
                user_skills_dir.mkdir(parents=True, exist_ok=True)
                self._skills_loader = SkillLoader(skills_dir=str(user_skills_dir))

        if self._skills_loader.skills:
            self._agent_skills_tools = [self.get_agent_skills_tools()]
        else:
            self._agent_skills_tools = []

        # executor
        self._executor = executor
        
        # sub_agent_config
        self._sub_agent_config = sub_agent_config
        if self._sub_agent_config:
            self._subagent_tools = []
        else:
            self._subagent_descriptions  = self.get_subagent_descriptions()
            self._subagent_tools = [self.get_subagent_tools()]
        

        # max_turn_count
        self._max_turn_count = max_turn_count

        #  todo manager
        self._todo_manager = TodoManager()
        self._todo_tools = [self.get_todo_manager_tools()]

        # 初始化实例变量供edge_agent_core使用
        self._current_plan = None
        self._task_planner = None
        self._memory_manager = None

    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        EdgeAgent的主消息处理循环
        使用EdgeAgentCore的完整任务规划和执行逻辑
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

        # Set up background task to monitor the pause event and cancel the task if paused.
        async def monitor_pause() -> None:
            await self._paused.wait()
            self.is_paused = True

        monitor_pause_task = asyncio.create_task(monitor_pause())
        inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
        try:
            # Gather all relevant state here
            agent_name = self.name
            model_context = self._model_context
            memory = self._memory
            system_messages = self._system_messages
            workbench = self._workbench
            handoff_tools = self._handoff_tools
            handoffs = self._handoffs
            manager_tools = self._agent_skills_tools+self._todo_tools+self._subagent_tools
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

            # 获取最后一条消息
            last_message = messages[-1]
            logger.info(f"Received message from {last_message.source}")

            # === 阶段1: 判断消息来源和类型 ===
            if last_message.source == "user":
                # 首次用户请求 → 任务规划阶段
                yield await self._handle_initial_user_request(
                    last_message=last_message,
                    agent_name=agent_name,
                    model_context=model_context,
                    cancellation_token=cancellation_token,
                    inner_messages=inner_messages,
                )
                return

            elif last_message.source == "user_proxy":
                # 用户对计划的反馈 → 执行或重新规划
                async for event in self._handle_user_feedback(
                    last_message=last_message,
                    agent_name=agent_name,
                    model_context=model_context,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    cancellation_token=cancellation_token,
                    inner_messages=inner_messages,
                ):
                    if self.is_paused:
                        raise asyncio.CancelledError()
                    yield event
                return

        except asyncio.CancelledError:
            # If the task is cancelled, we respond with a message.
            yield Response(
                chat_message=TextMessage(
                    content="The task was cancelled by the user.",
                    source=self.name,
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
                    source=self.name
                )
            )
            yield Response(
                chat_message=TextMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name,
                    metadata={"internal": "no"},
                ),
                inner_messages=inner_messages,
            )
        finally:
            # Cancel the monitor task.
            try:
                monitor_pause_task.cancel()
                await monitor_pause_task
            except asyncio.CancelledError:
                pass
    
    def get_todo_manager_tools(self, strict: bool = False,) -> ToolSchema:
        parameters = ParametersSchema(
            type="object",
            properties={
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"]
                            },
                            # "activeForm": {"type": "string"},
                        },
                    },
                },
            },
            required=["content", "status"], # , "activeForm"
            additionalProperties=False,
        )
        tool_schema = ToolSchema(
            name="TodoWrite",
            description="Create/Update task list.",
            parameters=parameters,
            strict=strict,
        )
        return tool_schema
    
    def get_subagent_tools(self, strict: bool = False,) -> ToolSchema:
        parameters = ParametersSchema(
            type="object",
            properties={
                "description": {
                    "type": "string",
                    "description":  "Short task description (3-5 words)"
                },
                "prompt": {
                    "type": "string",
                    "description": "The specific tasks that need to be executed by the sub agent. If the tasks include code blocks, files, etc. that need to be executed, they must be filled in completely."
                },
                "agent_type": {
                    "type": "string",
                    "enum": list(self._sub_agent_config.keys())
                },
            },
            required=["description", "prompt", "agent_type"],
            additionalProperties=False,
        )
        tool_schema = ToolSchema(
            name="Task",
            description=f"Spawn a subagent for a focused subtask.\n\nAgent types:\n{self._subagent_descriptions}",
            parameters=parameters,
            strict=strict,
        )
        return tool_schema
    
    def get_subagent_descriptions(self) -> str:
        """Generate agent type descriptions for system prompt."""
        return "\n".join(
            f"- {name}: {cfg['description']}"
            for name, cfg in self._sub_agent_config.items()
        )

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

    async def _handle_initial_user_request(
        self,
        last_message: BaseChatMessage,
        agent_name: str,
        model_context,
        cancellation_token: CancellationToken,
        inner_messages: List,
    ) -> Response:
        """
        处理用户的初始请求 - 任务规划阶段
        """
        # 获取用户请求
        user_request = last_message.content
        if hasattr(last_message, 'metadata'):
            user_request = last_message.metadata.get("user_request", user_request)

        # logger.info(f"Handling initial user request: {user_request[:100]}...")

        # 初始化任务规划器
        task_planner = TaskPlanner(
            agent_name=agent_name,
            model_client=self._model_client,
            skills_description=self._skills_loader.get_descriptions() if hasattr(self, '_skills_loader') else None,
            enable_skills_for_planning=True,
        )

        # 初始化记忆管理器
        memory_manager = LongTermMemoryManager(
            user_profile_manager=self._user_profile_manager,
            model_context=model_context,
            session_id=self._thread_id,
        )

        # 保存到实例变量供后续使用
        self._task_planner = task_planner
        self._memory_manager = memory_manager

        # 开始会话记录
        memory_manager.start_session(user_request=user_request, needs_plan=True)

        # 检索相关历史记忆(可选,用于辅助规划)
        # await memory_manager.inject_relevant_memories_to_context(
        #     keywords=self._extract_keywords_from_request(user_request),
        #     limit=2
        # )

        # 生成任务规划
        task_plan: TaskPlan = await task_planner.analyze_and_plan(
            user_request=user_request,
            model_context=model_context,
            cancellation_token=cancellation_token,
            use_skills_context=True,  # 使用skills上下文辅助规划
        )

        # 保存计划到记忆
        memory_manager.set_task_plan(task_plan.model_dump())

        # 发送计划给用户
        plan_message = await task_planner.send_plan_to_user(
            task_plan=task_plan,
            agent_name=agent_name,
        )

        # 保存当前计划到实例变量
        self._current_plan = task_plan

        return Response(
            chat_message=plan_message,
            inner_messages=inner_messages,
        )

    async def _handle_user_feedback(
        self,
        last_message: BaseChatMessage,
        agent_name: str,
        model_context,
        model_client,
        model_client_stream: bool,
        cancellation_token: CancellationToken,
        inner_messages: List,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        处理用户对计划的反馈
        """
        try:
            # 解析用户反馈
            feedback = self._task_planner.parse_user_feedback(last_message)

            if not feedback.get("accepted"):
                # 用户拒绝计划或提供了修改意见
                if feedback.get("feedback"):
                    # 根据反馈重新规划
                    revised_plan = await self._task_planner.replan_with_feedback(
                        original_plan=self._current_plan,
                        user_feedback=feedback["feedback"],
                        model_context=model_context,
                        cancellation_token=cancellation_token,
                    )

                    # 更新计划
                    self._current_plan = revised_plan
                    self._memory_manager.set_task_plan(revised_plan.model_dump())

                    # 发送新计划
                    plan_message = await self._task_planner.send_plan_to_user(
                        task_plan=revised_plan,
                        agent_name=agent_name,
                    )

                    yield Response(
                        chat_message=plan_message,
                        inner_messages=inner_messages,
                    )
                else:
                    # 用户直接拒绝,没有提供反馈
                    yield Response(
                        chat_message=TextMessage(
                            content="Understood. Please let me know how you'd like to proceed.",
                            source=agent_name,
                            metadata={"internal": "no", "type": "final_answer"},
                        ),
                        inner_messages=inner_messages,
                    )
                return

            # 用户接受计划 → 开始执行
            # 如果用户修改了计划,使用修改后的
            if feedback.get("plan"):
                modified_plan = feedback["plan"]
                self._current_plan.steps = modified_plan.get("steps", self._current_plan.steps)
                self._memory_manager.set_task_plan(self._current_plan.model_dump())

            # 执行任务
            async for event in self._execute_task_plan(
                agent_name=agent_name,
                model_context=model_context,
                model_client=model_client,
                model_client_stream=model_client_stream,
                cancellation_token=cancellation_token,
                inner_messages=inner_messages,
            ):
                yield event

        except Exception as e:
            logger.exception(f"Error handling user feedback")
            yield Response(
                chat_message=TextMessage(
                    content=f"Error processing feedback: {e}",
                    source=agent_name,
                    metadata={"internal": "no", "type": "final_answer"},
                ),
                inner_messages=inner_messages,
            )

    async def _execute_task_plan(
        self,
        agent_name: str,
        model_context,
        model_client,
        model_client_stream: bool,
        cancellation_token: CancellationToken,
        inner_messages: List,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        执行任务计划 - 核心执行循环
        """
        plan = self._current_plan
        steps = plan.steps
        plan_length = len(steps)

        logger.info(f"Starting task execution with {plan_length} steps")

        # 初始化TodoManager
        todo_items = [
            {
                "content": step.get("title", f"Step {i+1}"),
                "status": "pending",
            }
            for i, step in enumerate(steps)
        ]

        # 更新todo list
        todo_list = self._todo_manager.update(todo_items)
        yield ModelClientStreamingChunkEvent(
            content=f"Task Plan:\n{todo_list}\n\n",
            source=agent_name,
        )

        # 按步骤执行
        for step_index, step in enumerate(steps):
            if self.is_paused:
                raise asyncio.CancelledError()

            # 更新todo状态为in_progress
            todo_items[step_index]["status"] = "in_progress"
            self._todo_manager.update(todo_items)

            # 发送步骤执行状态
            status_message = await self._task_planner.send_step_execution_status(
                step_index=step_index,
                step=step,
                plan_length=plan_length,
                agent_name=agent_name,
                progress_summary=f"Executing: {step.get('title')}",
            )
            yield status_message

            # 执行步骤
            try:
                async for event in self._execute_single_step(
                    step_index=step_index,
                    step=step,
                    agent_name=agent_name,
                    model_context=model_context,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    cancellation_token=cancellation_token,
                ):
                    yield event

                # 步骤完成
                todo_items[step_index]["status"] = "completed"
                self._todo_manager.update(todo_items)

            except Exception as e:
                logger.error(f"Error in step {step_index}: {e}")

                # 记录错误
                self._memory_manager.add_error_record({
                    "type": "StepExecutionError",
                    "message": str(e),
                    "step": step_index,
                    "solution": "Attempted auto-recovery or user intervention",
                })

                # 尝试请求用户帮助
                yield ModelClientStreamingChunkEvent(
                    content=f"\n⚠️ Error in step {step_index + 1}: {e}\n",
                    source=agent_name,
                )
                yield ModelClientStreamingChunkEvent(
                    content="Please provide guidance on how to proceed, or I can try an alternative approach.\n\n",
                    source=agent_name,
                )

                # 标记步骤为失败但继续(可以改为等待用户输入)
                todo_items[step_index]["status"] = "completed"
                self._todo_manager.update(todo_items)

        # 所有步骤完成
        self._memory_manager.set_final_result("All tasks completed successfully")
        self._memory_manager.save_current_session()

        final_message = TextMessage(
            content="✅ All tasks have been completed!\n\n" + self._memory_manager.get_session_summary(),
            source=agent_name,
            metadata={"internal": "no", "type": "final_answer"},
        )

        yield Response(
            chat_message=final_message,
            inner_messages=inner_messages,
        )

    async def _execute_single_step(
        self,
        step_index: int,
        step: Dict[str, Any],
        agent_name: str,
        model_context,
        model_client,
        model_client_stream: bool,
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """
        执行单个任务步骤

        这里需要智能地决定:
        1. 是否需要加载skill
        2. 是否需要调用tool
        3. 是否需要spawn子智能体
        """
        step_title = step.get("title", f"Step {step_index + 1}")
        step_details = step.get("details", "")
        tool_or_skill = step.get("tool_or_skill")

        yield ModelClientStreamingChunkEvent(
            content=f"### {step_title}\n{step_details}\n\n",
            source=agent_name,
        )

        # 构建步骤执行的prompt
        step_prompt = f"""Execute the following task step:

**Step {step_index + 1}: {step_title}**

Details: {step_details}

{"Suggested tool/skill: " + tool_or_skill if tool_or_skill else ""}

Please execute this step using available tools, skills, or spawn a subagent if needed.
Report the results clearly.
"""

        # 将步骤作为用户消息添加到上下文
        await model_context.add_message(
            UserMessage(content=step_prompt, source="system")
        )

        # 调用LLM执行步骤(这里会自动tool calling)
        turn_count = 0
        max_turns = 5  # 每个步骤最多5轮

        while turn_count < max_turns:
            turn_count += 1

            model_result = None
            async for inference_output in self._call_llm(
                model_client=model_client,
                model_client_stream=model_client_stream,
                system_messages=self._system_messages,
                model_context=model_context,
                workbench=self._workbench,
                handoff_tools=self._handoff_tools,
                manager_tools=self._agent_skills_tools + self._todo_tools + self._subagent_tools,
                agent_name=agent_name,
                cancellation_token=cancellation_token,
                output_content_type=self._output_content_type,
            ):
                if isinstance(inference_output, CreateResult):
                    model_result = inference_output
                else:
                    yield inference_output

            assert model_result is not None

            # 处理thought
            if model_result.thought:
                yield ThoughtEvent(content=model_result.thought, source=agent_name)

            # 添加assistant消息
            await model_context.add_message(
                AssistantMessage(
                    content=model_result.content,
                    source=agent_name,
                    thought=getattr(model_result, "thought", None),
                )
            )

            # 如果是文本响应,步骤完成
            if isinstance(model_result.content, str):
                # 记录步骤执行结果
                self._memory_manager.add_execution_step(
                    step_index=step_index,
                    step_title=step_title,
                    tool_or_skill_used=tool_or_skill,
                    action_details=step_details,
                    result=model_result.content[:500],  # 截取前500字符
                )
                break

            # 否则是tool calls - 处理工具调用
            tool_call_msg = ToolCallRequestEvent(
                content=model_result.content,
                source=agent_name,
                models_usage=model_result.usage,
            )
            yield tool_call_msg

            # 执行工具调用
            async for message in self._handle_tool_calls(
                tool_calls=model_result.content,
                agent_name=agent_name,
                model_context=model_context,
                model_client=model_client,
                model_client_stream=model_client_stream,
                cancellation_token=cancellation_token,
            ):
                yield message

    async def _handle_tool_calls(
        self,
        tool_calls: List,
        agent_name: str,
        model_context,
        model_client,
        model_client_stream: bool,
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage, None]:
        """
        处理工具调用 - 支持Tool, TodoWrite, Skill, Task(subagent)
        """
        for tool_call in tool_calls:
            argument = json.loads(tool_call.arguments)
            tool_name = tool_call.name

            # 记录工具使用
            self._memory_manager.record_tool_usage(tool_name)

            if tool_name == "TodoWrite":
                async for msg in self.handle_todo_write(
                    argument=argument,
                    agent_name=agent_name,
                    model_context=model_context,
                ):
                    yield msg

            elif tool_name == "Skill":
                # 加载skill
                skill_name = argument.get("skill")
                self._memory_manager.record_skill_loaded(skill_name)

                skill_content = self._skills_loader.run_skill(skill_name)
                await model_context.add_message(
                    UserMessage(
                        content=f"Skill '{skill_name}' loaded:\n{skill_content}",
                        source="system",
                    )
                )
                yield ModelClientStreamingChunkEvent(
                    content=f"📚 Loaded skill: {skill_name}\n",
                    source=agent_name,
                )

            elif tool_name == "Task":
                # 调用子智能体
                agent_type = argument.get("agent_type")
                self._memory_manager.record_subagent_spawned(agent_type)

                async for msg in self.handle_subagent_repsonse(
                    agent_name=agent_name,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    model_context=model_context,
                    argument=argument,
                    cancellation_token=cancellation_token,
                    output_content_type=self._output_content_type,
                ):
                    yield msg

            elif tool_name in self._basic_funcs_names:
                # 调用基础工具(run_bash, run_read, etc.)
                async for msg in self._process_model_result(
                    model_result=CreateResult(content=[tool_call], usage=None),
                    inner_messages=[],
                    cancellation_token=cancellation_token,
                    agent_name=agent_name,
                    system_messages=self._system_messages,
                    model_context=model_context,
                    workbench=self._workbench,
                    handoff_tools=self._handoff_tools,
                    handoffs=self._handoffs,
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    reflect_on_tool_use=self._reflect_on_tool_use,
                    tool_call_summary_format=self._tool_call_summary_format,
                    tool_call_summary_prompt=self._tool_call_summary_prompt,
                    output_content_type=self._output_content_type,
                    format_string=self._output_content_type_format,
                ):
                    yield msg

            else:
                # 未知工具
                await model_context.add_message(
                    UserMessage(
                        content=f"Unknown tool: {tool_name}",
                        source="system",
                    )
                )

    def _extract_keywords_from_request(self, user_request: str) -> List[str]:
        """从用户请求中提取关键词(简单实现)"""
        # 这里可以使用更复杂的NLP方法
        # 简单实现:提取长度>3的单词
        words = user_request.split()
        keywords = [w for w in words if len(w) > 3][:5]  # 最多5个关键词
        return keywords


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

    # TODO: handle Task
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

    # TODO: handle TodoWrite
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

    def _to_config(self) -> EdgeAgentConfig:
        """Convert the assistant agent to a declarative config."""

        return EdgeAgentConfig(
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
            db_manager_config=self._db_manager.dump_component(),
            thread_id=self._thread_id,
            user_id=self._user_id,
            skills_dir=self._skills_dir,
        )
    
    @classmethod
    def _from_config(
        cls, config: EdgeAgentConfig, 
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
            memory_function=memory_function,
            reply_function=reply_function,
            db_manager=db_manager,
            thread_id=config.thread_id,
            user_id=config.user_id,
            skills_dir=config.skills_dir,
            **kwargs,
        )
