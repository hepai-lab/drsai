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

import asyncio
from loguru import logger
import warnings
import inspect
import json
import os

from pydantic import BaseModel, Field

from autogen_core import (
    CancellationToken, 
    FunctionCall, 
    ComponentModel,
    Component
    )
from autogen_core.tools import (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolSchema)
from autogen_core.memory import Memory
from autogen_core.model_context import (
    ChatCompletionContext,
    UnboundedChatCompletionContext
    )
from autogen_core.models import (
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResultMessage,
    FunctionExecutionResult,
    LLMMessage,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    RequestUsage,
    ModelFamily,
)

from autogen_agentchat.agents import AssistantAgent, BaseChatAgent
from autogen_agentchat.state import AssistantAgentState, BaseState
from autogen_agentchat.agents._assistant_agent import AssistantAgentConfig
from autogen_agentchat.base import Handoff as HandoffBase
from autogen_agentchat.base import Response, TaskResult
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
    UserInputRequestedEvent,
    ThoughtEvent,
    StructuredMessage,
    StructuredMessageFactory,
    # MultiModalMessage,
    Image,
)
from autogen_agentchat.utils import remove_images
from drsai import HepAIChatCompletionClient
from drsai.modules.managers.database import DatabaseManager, DatabaseManagerConfig
from drsai import DrSaiStaticWorkbench
from drsai.modules.managers.messages.agent_messages import(
    AgentLongTaskMessage,
    LongTaskQueryMessage,
    AgentLogEvent,
    ToolLongTaskEvent,
)
from drsai.modules.components.task_manager.base_task_system import TaskStatus


class DrSaiAgentConfig(BaseModel):
    """The declarative configuration for the assistant agent."""

    name: str
    model_client: ComponentModel
    tools: List[ComponentModel] | None = None
    workbench: ComponentModel | None = None
    handoffs: List[HandoffBase | str] | None = None
    model_context: ComponentModel | None = None
    memory: List[ComponentModel] | None = None
    description: str
    system_message: str | None = None
    model_client_stream: bool = False
    reflect_on_tool_use: bool
    tool_call_summary_format: str
    tool_call_summary_prompt: str| None = None,
    metadata: Dict[str, str] | None = None
    structured_message_factory: ComponentModel | None = None
    db_manager_config: DatabaseManagerConfig | None = None

class DrSaiAgentState(BaseState):
    """State for an assistant agent."""

    llm_context: Mapping[str, Any] = Field(default_factory=lambda: dict([("messages", [])]))
    type: str = Field(default="AssistantAgentState")


class DrSaiAgent(BaseChatAgent, Component[DrSaiAgentConfig]):
    """Agent based on autogen_agentchat AssistantAgent."""

    component_config_schema = DrSaiAgentConfig
    component_provider_override = "drsai.modules.baseagent.drsaiagent.AssistantAgent"
    
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
        memory_function: Callable = None,
        # allow_reply_function: bool = False,
        reply_function: Callable = None,
        db_manager: DatabaseManager = None,
        thread_id: str = None,
        user_id: str = None,
        **kwargs,
            ):
        '''
        memory_function: 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        reply_function: 自定义的reply_function，用于自定义对话回复的定制
        db_manager: 数据库管理器
        thread_id: 前端当前会话的id
        user_id: 用户id
        '''
        
        super().__init__(name=name, description=description)
        if not model_client:
            if os.environ.get("HEPAI_API_KEY"):
                model_client = HepAIChatCompletionClient(model="openai/gpt-4o", api_key=os.environ.get("HEPAI_API_KEY"))
            else:
                raise ValueError("Please provide a model_client.")
        self._metadata = metadata or {}
        self._model_client = model_client
        self._model_client_stream = model_client_stream
        self._output_content_type: type[BaseModel] | None = output_content_type
        self._output_content_type_format = output_content_type_format
        self._structured_message_factory: StructuredMessageFactory | None = None
        if output_content_type is not None:
            self._structured_message_factory = StructuredMessageFactory(
                input_model=output_content_type, format_string=output_content_type_format
            )

        self._memory = None
        if memory is not None:
            if isinstance(memory, list):
                self._memory = memory
            else:
                raise TypeError(f"Expected Memory, List[Memory], or None, got {type(memory)}")

        self._system_messages: List[SystemMessage] = []
        if system_message is None:
            self._system_messages = []
        else:
            self._system_messages = [SystemMessage(content=system_message)]
        self._tools: List[BaseTool[Any, Any]] = []
        if tools is not None:
            if model_client.model_info["function_calling"] is False:
                raise ValueError("The model does not support function calling.")
            for tool in tools:
                if isinstance(tool, BaseTool):
                    self._tools.append(tool)
                elif callable(tool):
                    if hasattr(tool, "__doc__") and tool.__doc__ is not None:
                        description = tool.__doc__
                    else:
                        description = ""
                    self._tools.append(FunctionTool(tool, description=description))
                else:
                    raise ValueError(f"Unsupported tool type: {type(tool)}")
        # Check if tool names are unique.
        tool_names = [tool.name for tool in self._tools]
        if len(tool_names) != len(set(tool_names)):
            raise ValueError(f"Tool names must be unique: {tool_names}")

        # Handoff tools.
        self._handoff_tools: List[BaseTool[Any, Any]] = []
        self._handoffs: Dict[str, HandoffBase] = {}
        if handoffs is not None:
            if model_client.model_info["function_calling"] is False:
                raise ValueError("The model does not support function calling, which is needed for handoffs.")
            for handoff in handoffs:
                if isinstance(handoff, str):
                    handoff = HandoffBase(target=handoff)
                if isinstance(handoff, HandoffBase):
                    self._handoff_tools.append(handoff.handoff_tool)
                    self._handoffs[handoff.name] = handoff
                else:
                    raise ValueError(f"Unsupported handoff type: {type(handoff)}")
        # Check if handoff tool names are unique.
        handoff_tool_names = [tool.name for tool in self._handoff_tools]
        if len(handoff_tool_names) != len(set(handoff_tool_names)):
            raise ValueError(f"Handoff names must be unique: {handoff_tool_names}")
        # Check if handoff tool names not in tool names.
        if any(name in tool_names for name in handoff_tool_names):
            raise ValueError(
                f"Handoff names must be unique from tool names. "
                f"Handoff names: {handoff_tool_names}; tool names: {tool_names}"
            )
        
        if workbench is not None:
            if self._tools:
                raise ValueError("Tools cannot be used with a workbench.")
            self._workbench = workbench
        else:
            self._workbench = StaticWorkbench(self._tools)

        if model_context is not None:
            self._model_context = model_context
        else:
            self._model_context = UnboundedChatCompletionContext()

        if self._output_content_type is not None and reflect_on_tool_use is None:
            # If output_content_type is set, we need to reflect on tool use by default.
            self._reflect_on_tool_use = True
        elif reflect_on_tool_use is None:
            self._reflect_on_tool_use = False
        else:
            self._reflect_on_tool_use = reflect_on_tool_use
        if self._reflect_on_tool_use and ModelFamily.is_claude(model_client.model_info["family"]):
            warnings.warn(
                "Claude models may not work with reflection on tool use because Claude requires that any requests including a previous tool use or tool result must include the original tools definition."
                "Consider setting reflect_on_tool_use to False. "
                "As an alternative, consider calling the agent in a loop until it stops producing tool calls. "
                "See [Single-Agent Team](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html#single-agent-team) "
                "for more details.",
                UserWarning,
                stacklevel=2,
            )
        self._tool_call_summary_format = tool_call_summary_format
        self._tool_call_summary_prompt = tool_call_summary_prompt
        self._is_running = False

        # Custom reply function instead of call_llm
        # self._allow_reply_function: bool = allow_reply_function
        self._reply_function: Callable = reply_function
        
        # custom memory function in call_llm
        self._memory_function: Callable = memory_function
       
        # For state
        self.is_paused = False
        self._paused = asyncio.Event()
        self._cancellation_token: CancellationToken | None = None

        # For user's customization
        self._thread_id: str = thread_id
        self._user_id: str = user_id
        self._db_manager: DatabaseManager = db_manager

        # custom arguments for _reply_function
        self._user_params: Dict[str, Any] = {}
        self._user_params.update(kwargs)
    
    @property
    def produced_message_types(self) -> Sequence[type[BaseChatMessage]]:
        message_types: List[type[BaseChatMessage]] = []
        if self._handoffs:
            message_types.append(HandoffMessage)
        if self._tools:
            message_types.append(ToolCallSummaryMessage)
        if self._output_content_type:
            message_types.append(StructuredMessage[self._output_content_type])  # type: ignore[name-defined]
        else:
            message_types.append(TextMessage)
        return tuple(message_types)

    @property
    def model_context(self) -> ChatCompletionContext:
        """
        The model context in use by the agent.
        """
        return self._model_context

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
    
    async def on_messages(self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken) -> Response:
        async for message in self.on_messages_stream(messages, cancellation_token):
            if isinstance(message, Response):
                return message
        raise AssertionError("The stream should have returned the final result.")
    
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
            model_client = self._model_client
            model_client_stream = self._model_client_stream
            reflect_on_tool_use = self._reflect_on_tool_use
            tool_call_summary_format = self._tool_call_summary_format
            output_content_type = self._output_content_type
            format_string = self._output_content_type_format

            # STEP 1: Add new user/handoff messages to the model context
            await self._add_messages_to_context(
                model_context=model_context,
                messages=messages,
            )

            # STEP 2: Update model context with any relevant memory
            for event_msg in await self._update_model_context_with_memory(
                memory=memory,
                model_context=model_context,
                agent_name=agent_name,
            ):
                inner_messages.append(event_msg)
                yield event_msg

            # STEP 3: Run the first inference
            model_result = None
            async for inference_output in self._call_llm(
                model_client=model_client,
                model_client_stream=model_client_stream,
                system_messages=system_messages,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
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

            # STEP 4: Process the model output
            async for output_event in self._process_model_result(
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
                
                yield output_event

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
            logger.error(f"Error in {self.name}: {e}")
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

    async def _process_long_task_query(
            self,
            task: Dict|LongTaskQueryMessage|Sequence[BaseChatMessage] | None = None,
            cancellation_token: CancellationToken | None = None,
    )-> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        
        if task is None:
            logger.info("No tasks provided for long task query")
        if isinstance(task, LongTaskQueryMessage):
            query_context: str|Dict[str, Any] = task.content
        ## TODO: Implement long task query
        raise NotImplementedError("Long task query not implemented")
    
    @staticmethod
    async def _add_messages_to_context(
        model_context: ChatCompletionContext,
        messages: Sequence[BaseChatMessage],
    ) -> None:
        """
        Add incoming messages to the model context.
        """
        for msg in messages:
            if isinstance(msg, HandoffMessage):
                for llm_msg in msg.context:
                    await model_context.add_message(llm_msg)
            await model_context.add_message(msg.to_model_message())

    @staticmethod
    async def _update_model_context_with_memory(
        memory: Optional[Sequence[Memory]],
        model_context: ChatCompletionContext,
        agent_name: str,
    ) -> List[MemoryQueryEvent]:
        """
        If memory modules are present, update the model context and return the events produced.
        """
        events: List[MemoryQueryEvent] = []
        if memory:
            for mem in memory:
                update_context_result = await mem.update_context(model_context)
                if update_context_result and len(update_context_result.memories.results) > 0:
                    memory_query_event_msg = MemoryQueryEvent(
                        content=update_context_result.memories.results,
                        source=agent_name,
                    )
                    events.append(memory_query_event_msg)
        return events

    async def _call_llm(
        self,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
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

        all_tools = (await workbench.list_tools()) + handoff_tools
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

        # If direct text response (string)
        if isinstance(model_result.content, str):
            if output_content_type:
                content = output_content_type.model_validate_json(model_result.content)
                yield Response(
                    chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
                        content=content,
                        source=agent_name,
                        models_usage=model_result.usage,
                        format_string=format_string,
                    ),
                    inner_messages=inner_messages,
                )
            else:
                yield Response(
                    chat_message=TextMessage(
                        content=model_result.content,
                        source=agent_name,
                        models_usage=model_result.usage,
                    ),
                    inner_messages=inner_messages,
                )
            return

        # Otherwise, we have function calls
        assert isinstance(model_result.content, list) and all(
            isinstance(item, FunctionCall) for item in model_result.content
        )

        # STEP 4A: Yield ToolCallRequestEvent
        tool_call_msg = ToolCallRequestEvent(
            content=model_result.content,
            source=agent_name,
            models_usage=model_result.usage,
        )
        logger.debug(tool_call_msg)
        yield AgentLogEvent(source=agent_name, content=str(tool_call_msg.content), content_type="tools")
        inner_messages.append(tool_call_msg)
        yield tool_call_msg

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

        # Yield ToolCallExecutionEvent
        tool_call_result_msg = ToolCallExecutionEvent(
            content=exec_results,
            source=agent_name,
        )
        logger.debug(tool_call_result_msg)
        yield AgentLogEvent(source=agent_name, content=str(tool_call_result_msg.content), content_type="tools")
        await model_context.add_message(FunctionExecutionResultMessage(content=exec_results))
        inner_messages.append(tool_call_result_msg)
        yield tool_call_result_msg

        # STEP 4C: Check for handoff
        handoff_output = cls._check_and_handle_handoff(
            model_result=model_result,
            executed_calls_and_results=executed_calls_and_results,
            inner_messages=inner_messages,
            handoffs=handoffs,
            agent_name=agent_name,
        )
        if handoff_output:
            yield ModelClientStreamingChunkEvent(content=handoff_output.chat_message.content, source=agent_name)
            yield handoff_output
            return

        # STEP 4D: Reflect or summarize tool results
        if reflect_on_tool_use:
            async for reflection_response in cls._reflect_on_tool_use_flow(
                system_messages=system_messages,
                model_client=model_client,
                model_client_stream=model_client_stream,
                model_context=model_context,
                agent_name=agent_name,
                inner_messages=inner_messages,
                output_content_type=output_content_type,
            ):
                yield reflection_response
        else:
            async for reflection_response in  cls._summarize_tool_use(
                executed_calls_and_results=executed_calls_and_results,
                system_messages=system_messages,
                model_client=model_client,
                model_client_stream=model_client_stream,
                model_context=model_context,
                inner_messages=inner_messages,
                handoffs=handoffs,
                tool_call_summary_format=tool_call_summary_format,
                tool_call_summary_prompt=tool_call_summary_prompt,
                agent_name=agent_name,
            ):
                yield reflection_response

    @staticmethod
    def _check_and_handle_handoff(
        model_result: CreateResult,
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]],
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        handoffs: Dict[str, HandoffBase],
        agent_name: str,
    ) -> Optional[Response]:
        """
        Detect handoff calls, generate the HandoffMessage if needed, and return a Response.
        If multiple handoffs exist, only the first is used.
        """
        handoff_reqs = [
            call for call in model_result.content if isinstance(call, FunctionCall) and call.name in handoffs
        ]
        if len(handoff_reqs) > 0:
            # We have at least one handoff function call
            selected_handoff = handoffs[handoff_reqs[0].name]

            if len(handoff_reqs) > 1:
                warnings.warn(
                    (
                        f"Multiple handoffs detected. Only the first is executed: "
                        f"{[handoffs[c.name].name for c in handoff_reqs]}. "
                        "Disable parallel tool calls in the model client to avoid this warning."
                    ),
                    stacklevel=2,
                )

            # Collect normal tool calls (not handoff) into the handoff context
            tool_calls: List[FunctionCall] = []
            tool_call_results: List[FunctionExecutionResult] = []
            # Collect the results returned by handoff_tool. By default, the message attribute will returned.
            selected_handoff_message = selected_handoff.message
            for exec_call, exec_result in executed_calls_and_results:
                if exec_call.name not in handoffs:
                    tool_calls.append(exec_call)
                    tool_call_results.append(exec_result)
                elif exec_call.name == selected_handoff.name:
                    selected_handoff_message = exec_result.content

            handoff_context: List[LLMMessage] = []
            if len(tool_calls) > 0:
                # Include the thought in the AssistantMessage if model_result has it
                handoff_context.append(
                    AssistantMessage(
                        content=tool_calls,
                        source=agent_name,
                        thought=getattr(model_result, "thought", None),
                    )
                )
                handoff_context.append(FunctionExecutionResultMessage(content=tool_call_results))
            elif model_result.thought:
                # If no tool calls, but a thought exists, include it in the context
                handoff_context.append(
                    AssistantMessage(
                        content=model_result.thought,
                        source=agent_name,
                    )
                )

            # Return response for the first handoff
            return Response(
                chat_message=HandoffMessage(
                    content=selected_handoff_message,
                    target=selected_handoff.target,
                    source=agent_name,
                    context=handoff_context,
                ),
                inner_messages=inner_messages,
            )
        return None

    @classmethod
    async def _reflect_on_tool_use_flow(
        cls,
        system_messages: List[SystemMessage],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        agent_name: str,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[Response | ModelClientStreamingChunkEvent | ThoughtEvent, None]:
        """
        If reflect_on_tool_use=True, we do another inference based on tool results
        and yield the final text response (or streaming chunks).
        """
        all_messages = system_messages + await model_context.get_messages()
        llm_messages = cls._get_compatible_context(model_client=model_client, messages=all_messages)

        reflection_result: Optional[CreateResult] = None

        if model_client_stream:
            async for chunk in model_client.create_stream(
                llm_messages,
                json_output=output_content_type,
            ):
                if isinstance(chunk, CreateResult):
                    reflection_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
        else:
            reflection_result = await model_client.create(llm_messages, json_output=output_content_type)

        if not reflection_result or not isinstance(reflection_result.content, str):
            raise RuntimeError("Reflect on tool use produced no valid text response.")

        # --- NEW: If the reflection produced a thought, yield it ---
        if reflection_result.thought:
            thought_event = ThoughtEvent(content=reflection_result.thought, source=agent_name)
            yield thought_event
            inner_messages.append(thought_event)

        # Add to context (including thought if present)
        await model_context.add_message(
            AssistantMessage(
                content=reflection_result.content,
                source=agent_name,
                thought=getattr(reflection_result, "thought", None),
            )
        )

        if output_content_type:
            content = output_content_type.model_validate_json(reflection_result.content)
            yield Response(
                chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
                    content=content,
                    source=agent_name,
                    models_usage=reflection_result.usage,
                ),
                inner_messages=inner_messages,
            )
        else:
            yield Response(
                chat_message=TextMessage(
                    content=reflection_result.content,
                    source=agent_name,
                    models_usage=reflection_result.usage,
                ),
                inner_messages=inner_messages,
            )

    # @staticmethod
    @classmethod
    async def _summarize_tool_use(
        cls,
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]],
        system_messages: List[SystemMessage],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        handoffs: Dict[str, HandoffBase],
        tool_call_summary_format: str,
        tool_call_summary_prompt: str|None,
        agent_name: str,
    ) -> AsyncGenerator[Response | ModelClientStreamingChunkEvent | ThoughtEvent, None]:
        """
        If reflect_on_tool_use=False, create a summary message of all tool calls.
        """
        # Filter out calls which were actually handoffs
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

        if tool_call_summary_prompt:
            # yield ModelClientStreamingChunkEvent(content="<think>\n", source=agent_name)
            # yield ModelClientStreamingChunkEvent(content=tool_call_summary_format, source=agent_name)
            # yield ModelClientStreamingChunkEvent(content="</think>\n", source=agent_name)
            yield AgentLogEvent(source=agent_name, content=tool_call_summary, content_type="tools")
            all_messages = system_messages + await model_context.get_messages()
            all_messages.append(
                UserMessage(
                    content=tool_call_summary_prompt+f"\n\nThese result are as following:\n {tool_call_summary}",
                    source="user",
                )
            )
            llm_messages = cls._get_compatible_context(model_client=model_client, messages=all_messages)
            if model_client_stream:
                async for chunk in model_client.create_stream(
                    llm_messages,
                ):
                    if isinstance(chunk, CreateResult):
                        reflection_result = chunk
                    elif isinstance(chunk, str):
                        yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                    else:
                        raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            else:
                reflection_result = await model_client.create(llm_messages)
            
            if reflection_result.thought:
                thought_event = ThoughtEvent(content=reflection_result.thought, source=agent_name)
                yield thought_event
                inner_messages.append(thought_event)

            # # Add to context (including thought if present)
            # await model_context.add_message(
            #     AssistantMessage(
            #         content=reflection_result.content,
            #         source=agent_name,
            #         thought=getattr(reflection_result, "thought", None),
            #     )
            # )

            yield Response(
                chat_message=TextMessage(
                    content=reflection_result.content,
                    source=agent_name,
                ),
                inner_messages=inner_messages,
            )
        else:
            yield Response(
                chat_message=ToolCallSummaryMessage(
                    content=tool_call_summary,
                    source=agent_name,
                ),
                inner_messages=inner_messages,
            )

    @staticmethod
    async def _execute_tool_call(
        tool_call: FunctionCall,
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
        agent_name: str,
        cancellation_token: CancellationToken,
    ) -> Tuple[FunctionCall, FunctionExecutionResult]:
        """Execute a single tool call and return the result."""
        # Load the arguments from the tool call.
        try:
            arguments = json.loads(tool_call.arguments)
        except json.JSONDecodeError as e:
            return (
                tool_call,
                FunctionExecutionResult(
                    content=f"Error: {e}",
                    call_id=tool_call.id,
                    is_error=True,
                    name=tool_call.name,
                ),
            )

        # Check if the tool call is a handoff.
        # TODO: consider creating a combined workbench to handle both handoff and normal tools.
        for handoff_tool in handoff_tools:
            if tool_call.name == handoff_tool.name:
                # Run handoff tool call.
                result = await handoff_tool.run_json(arguments, cancellation_token)
                result_as_str = handoff_tool.return_value_as_string(result)
                return (
                    tool_call,
                    FunctionExecutionResult(
                        content=result_as_str,
                        call_id=tool_call.id,
                        is_error=False,
                        name=tool_call.name,
                    ),
                )

        # Handle normal tool call using workbench.
        result = await workbench.call_tool(
            name=tool_call.name,
            arguments=arguments,
            cancellation_token=cancellation_token,
        )
        return (
            tool_call,
            FunctionExecutionResult(
                content=result.to_text(),
                call_id=tool_call.id,
                is_error=result.is_error,
                name=tool_call.name,
            ),
        )
    
    async def lazy_init(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Initialize the tools and models needed by the agent."""
        pass

    async def close(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Clean up resources used by the agent.

        This method:
          ...
        """
        logger.info(f"Closing {self.name}...")
        if self._cancellation_token is not None and not self._cancellation_token.is_cancelled():
            self._cancellation_token.cancel()
        # Close the model client.
        await self._model_client.close()

    async def pause(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Pause the agent by setting the paused state."""
        logger.info(f"Pausing {self.name}...")
        if self._cancellation_token is not None and not self._cancellation_token.is_cancelled():
            self._cancellation_token.cancel()
        self.is_paused = True
        self._paused.set()

    async def resume(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Resume the agent by clearing the paused state."""
        self.is_paused = False
        self._paused.clear()
    async def on_reset(self, cancellation_token: CancellationToken|None = None, **kwargs) -> None:
        """Reset the assistant agent to its initialization state."""
        await self._model_context.clear()

    async def save_state(self) -> Mapping[str, Any]:
        """Save the current state of the assistant agent."""
        model_context_state = await self._model_context.save_state()
        return DrSaiAgentState(llm_context=model_context_state).model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the assistant agent"""
        assistant_agent_state = DrSaiAgentState.model_validate(state)
        # Load the model context state.
        await self._model_context.load_state(assistant_agent_state.llm_context)

    @staticmethod
    def _get_compatible_context(model_client: ChatCompletionClient, messages: List[LLMMessage]) -> Sequence[LLMMessage]:
        """Ensure that the messages are compatible with the underlying client, by removing images if needed."""
        if model_client.model_info["vision"]:
            return messages
        else:
            return remove_images(messages)
        
    def _to_config(self) -> AssistantAgentConfig:
        """Convert the assistant agent to a declarative config."""

        return DrSaiAgentConfig(
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
            db_manager_config=self._db_manager.dump_component()
        )
    
    @classmethod
    def _from_config(
        cls, config: DrSaiAgentConfig, 
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
            **kwargs,
        
        )
    
    
    ### For memory_function and reply_function ###
    async def llm_messages2oai_messages(self, llm_messages: List[LLMMessage]) -> List[Dict[str, str]]:
        """Convert a list of LLM messages to a list of OAI chat messages."""

        def handle_mulyimodal(content: list[Union[str, Image]])->list:
            """
            处理多模态消息
            """
            base64_images: str = ""
            text: str = ""
            handle_content = []
            for item in content:
                if isinstance(item, Image):
                    base64_images = item.data_uri
                    handle_content.append( {
                    "type": "image_url",
                    "image_url": {
                        "url": base64_images,
                    }
                })
                else:
                    text = item
                    handle_content.append({"type": "text", "text": text})
            return handle_content
        
        messages = []
        for llm_message in llm_messages:
            if isinstance(llm_message, SystemMessage):
                messages.append({"role": "system", "content": llm_message.content} )
            if isinstance(llm_message, UserMessage):
                messages.append({"role": "user", "content": llm_message.content, "name": llm_message.source})
            if isinstance(llm_message, AssistantMessage):
                messages.append({"role": "assistant", "content": llm_message.content, "name": llm_message.source})
            if isinstance(llm_message, FunctionExecutionResultMessage):
                messages.append({"role": "function", "content": json.dumps(llm_message.content)}) 

            
        
        for message in messages:
            if isinstance(message["content"], list):
                message["content"] = handle_mulyimodal(message["content"])
        return messages
    
    async def oai_messages2llm_messages(self, oai_messages: List[Dict[str, str]]) -> List[LLMMessage]:
        """Convert a list of OAI chat messages to a list of LLM messages."""
        messages = []
        for oai_message in oai_messages:
            if oai_message["role"] == "system":
                messages.append(SystemMessage(content=oai_message["content"]))
            if oai_message["role"] == "user":
                messages.append(UserMessage(content=oai_message["content"], source=oai_message.get("name", self.name)))
            if oai_message["role"] == "assistant":
                messages.append(AssistantMessage(content=oai_message["content"], source=oai_message.get("name", self.name)))
            if oai_message["role"] == "function":
                messages.append(FunctionExecutionResultMessage(content=oai_message["content"]))
        return messages
    
    async def _call_memory_function(
            self, 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,) -> List[LLMMessage]:
        """使用自定义的memory_function，为大模型回复增加最新的知识"""
        # memory_function: 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        memory_messages: List[Dict[str, str]] = await self.llm_messages2oai_messages(llm_messages)
        try:
            memory_messages_with_new_knowledge: List[Dict[str, str]]|List[LLMMessage] = await self._memory_function(
                memory_messages, 
                llm_messages, 
                model_client, 
                cancellation_token,
                agent_name,
                **self._user_params)
            if isinstance(memory_messages_with_new_knowledge[0], dict):
                llm_messages: List[LLMMessage] = await self.oai_messages2llm_messages(memory_messages_with_new_knowledge)
            else:
                llm_messages = memory_messages_with_new_knowledge
            return llm_messages
        except Exception as e:
            raise ValueError(f"Error: memory_function: {self._memory_function.__name__} failed with error {e}.")
    
    async def _call_reply_function(
            self, 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            workbench: Workbench,
            handoff_tools: List[BaseTool[Any, Any]],
            tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
            agent_name: str,
            cancellation_token: CancellationToken,
            db_manager: DatabaseManager,
            **kwargs,
            ) -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
        """使用自定义的reply_function，自定义对话回复的定制, CreateResult被期待在最后一个事件返回"""

        oai_messages = await self.llm_messages2oai_messages(llm_messages)

        model_result: Optional[CreateResult] = None
        allowed_events = [
            ToolCallRequestEvent,
            ToolCallExecutionEvent,
            MemoryQueryEvent,
            UserInputRequestedEvent,
            ModelClientStreamingChunkEvent,
            ThoughtEvent]
        
        if self._model_client_stream:
            # 如果reply_function不是返回一个异步生成器而使用了流式模式，则会报错
            if not inspect.isasyncgenfunction(self._reply_function):
                raise ValueError("reply_function must be AsyncGenerator function if model_client_stream is True.")
            # Stream the reply_function.
            response = ""
            async for chunk in self._reply_function(
                self,
                oai_messages, 
                agent_name = agent_name,
                llm_messages = llm_messages, 
                model_client=model_client, 
                workbench=workbench, 
                handoff_tools=handoff_tools, 
                tools=tools, 
                cancellation_token=cancellation_token, 
                db_manager=db_manager,
                thread_id=self._thread_id,
                user_id=self._user_id,
                **self._user_params
                ):
                if isinstance(chunk, str):
                    response += chunk
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                elif any(isinstance(chunk, event_type) for event_type in allowed_events):
                    response += str(chunk.content)
                    yield chunk
                elif isinstance(chunk, HandoffMessage):
                    yield chunk
                elif isinstance(chunk, CreateResult):
                    model_result = chunk
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            if isinstance(model_result, CreateResult):
                pass
            elif model_result is None:
            #     if isinstance(chunk, str):
            #         yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
            #         response += chunk
            #     elif isinstance(chunk, AgentEvent):
            #         yield chunk
            #     elif isinstance(chunk, BaseAgentEvent):
            #     else:
            #         raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
                assert isinstance(response, str)
                model_result = CreateResult(
                    content=response, finish_reason="stop",
                    usage = RequestUsage(prompt_tokens=0, completion_tokens=0),
                    cached=False)
        else:
            # 如果reply_function不是异步函数，或者是一个异步生成器，则会报错
            if not asyncio.iscoroutinefunction(self._reply_function) and not inspect.isasyncgenfunction(self._reply_function):
                raise ValueError("reply_function must be a coroutine function if model_client_stream is False.")
            response = await self._reply_function(
                self,
                oai_messages, 
                agent_name = agent_name,
                llm_messages = llm_messages, 
                model_client=model_client, 
                workbench=workbench, 
                handoff_tools=handoff_tools, 
                tools=tools, 
                cancellation_token=cancellation_token, 
                db_manager=db_manager,
                **self._user_params
                )
            if isinstance(response, str):
                model_result = CreateResult(
                    content=response, finish_reason="stop",
                    usage = RequestUsage(prompt_tokens=0, completion_tokens=0),
                    cached=False)
            elif isinstance(response, CreateResult):
                model_result = response
            else:
                raise RuntimeError(f"Invalid response type: {type(response)}")
        yield model_result

    @classmethod
    async def call_llm(
        cls,
        agent_name: str,
        model_client: ChatCompletionClient,
        llm_messages: List[LLMMessage], 
        tools: List[BaseTool[Any, Any]], 
        model_client_stream: bool,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
        ) -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
    
        model_result: Optional[CreateResult] = None

        if model_client_stream:
                
            async for chunk in model_client.create_stream(
                llm_messages, 
                tools=tools,
                json_output=output_content_type,
                cancellation_token=cancellation_token
            ):
                if isinstance(chunk, CreateResult):
                    model_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            if model_result is None:
                raise RuntimeError("No final model result in streaming mode.")
            yield model_result
        else:
            model_result = await model_client.create(
                llm_messages, tools=tools, cancellation_token=cancellation_token
            )
            yield model_result