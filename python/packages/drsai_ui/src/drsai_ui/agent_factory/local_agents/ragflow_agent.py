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
from autogen_ext.tools.mcp import (
    McpServerParams, 
    SseServerParams, 
    StdioServerParams,
    StdioMcpToolAdapter,
    SseMcpToolAdapter,
    McpWorkbench,
    create_mcp_server_session,
    mcp_server_tools)
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
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory, RAGFlowMemoryConfig
from drsai.modules.managers.database import DatabaseManager, DatabaseManagerConfig
from drsai import DrSaiStaticWorkbench
from drsai import DrSaiChatCompletionContext
from drsai.modules.managers.messages.agent_messages import(
    AgentLongTaskMessage,
    LongTaskQueryMessage,
    AgentLogEvent,
    ToolLongTaskEvent,
)
from drsai import DrSaiAgent


class RAGFlowAgent(DrSaiAgent):
    """
    TODO: 增加用户的个人长期记忆document_id与chat_id+thread_id进行绑定
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
        tool_call_summary_format: str = "tool_name:<{tool_name}>\narguments:{arguments}\nresult:{result}\n",
        tool_call_summary_prompt: str| None = "Use the execution information of the above tools to answer users' questions.",
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
            **kwargs,
        )

        agent_config = kwargs.get("agent_config") or {}
        self._user_agent_name = agent_config.get("name", "drsai")

    #     # ragflow_configs 为可选配置：不存在时直接跳过，不影响其他功能
    #     ragflow_configs = agent_config.get("ragflow_configs") or []
    #     for ragflow_config in ragflow_configs:
    #         self._memory = []
    #         if ragflow_config is not None:
    #             ragflow_url = ragflow_config.get("ragflow_url")
    #             ragflow_token = ragflow_config.get("ragflow_token")
    #             dataset_ids = ragflow_config.get("dataset_ids")  # necessary
    #             # document_ids = ragflow_config.get("document_ids")
    #             self._memory.append(
    #                 RAGFlowMemory(
    #                     config=RAGFlowMemoryConfig(
    #                         name="ragflow_memory",
    #                         RAGFLOW_URL=ragflow_url,
    #                         RAGFLOW_TOKEN=ragflow_token,
    #                         dataset_ids=dataset_ids,
    #                         keyword=True,
    #                     )
    #                 )
    #             )
        
    #     self._workbench: StaticWorkbench | None = None
    #     tool_schema = None
    #     mcp_sse_list = agent_config.get("mcp_sse_list")
    #     if mcp_sse_list is not None:
    #         asyncio.create_task(self.get_mcp_server_tools(mcp_sse_list))
    #         tool_schema = self._workbench.list_tools()
    #     else:
    #         self._workbench=StaticWorkbench(tools=self._tools)

        memory_config = agent_config.get("memory", {})
        token_limit = memory_config.get("token_limit")
        dataset_id = memory_config.get("dataset_id")
        document_id = memory_config.get("document_id")
        self._model_context = DrSaiChatCompletionContext(
            agent_name = agent_config.get("name", "drsai"),
            model_client = self._model_client,
            token_limit = token_limit or 100000,
            tool_schema = kwargs.get("tool_schema") or None,
            dataset_id = dataset_id,
            document_id = document_id,
        )
        
    # async def get_mcp_server_tools(self, mcp_sse_list: List[Dict[str, Any]]) -> List[SseMcpToolAdapter]:
    #     """
    #     加载 MCP SSE 工具。
    #     mcp_sse_list 约定为 List[Dict[str, Any]]，每个元素形如：
    #     {
    #         "url": "https://example.com/mcp",
    #         "token": "xxx",                   # 可选，若不需要鉴权可传空字符串 ""
    #         "headers": {...},                 # 可选，若提供则优先使用此 headers
    #         "timeout": 20,                    # 可选，默认 20
    #         "sse_read_timeout": 300           # 可选，默认 300
    #     }
    #     """
    #     sse_tools: list[SseMcpToolAdapter] = []
    #     for cfg in mcp_sse_list:
    #         url = cfg.get("url", None)
    #         assert url is not None, "mcp_sse_list.url 不能为空"

    #         # 优先使用用户显式传入的 headers
    #         headers = cfg.get("headers") or {}

    #         # 兼容单独传 token 的场景，如果 token 非空则自动加 Authorization
    #         token = cfg.get("token", "")
    #         if token:
    #             headers = dict(headers)  # 拷贝一份，避免修改原对象
    #             headers.setdefault("Authorization", f"Bearer {token}")

    #         timeout = cfg.get("timeout", 20)
    #         sse_read_timeout = cfg.get("sse_read_timeout", 60 * 5)

    #         sse_tool: list[SseMcpToolAdapter] = await mcp_server_tools(
    #             SseServerParams(
    #                 url=url,
    #                 headers=headers or None,
    #                 timeout=timeout,
    #                 sse_read_timeout=sse_read_timeout,
    #             )
    #         )
    #         # mcp_server_tools 返回的是一个工具列表，这里要累加到总的工具集合中
    #         sse_tools.extend(sse_tool)
        
    #     # 用所有 SSE 工具构建 Workbench，供后续模型调用工具使用
    #     self._workbench = DrsaiStaticWorkbench(tools=sse_tools)
    #     return sse_tools
        

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
            first_chunk = True
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
                    inference_output.source = self._user_agent_name
                    if first_chunk:
                        if isinstance(inference_output, ModelClientStreamingChunkEvent):
                            inference_output.metadata.update({"start_flag": "yes"})
                            first_chunk=False
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
                first_chunk=first_chunk,
                user_agenty_name=self._user_agent_name,
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
        first_chunk: bool = False,
        user_agenty_name: str|None = None,
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
                first_chunk=first_chunk,
                user_agenty_name=user_agenty_name,
            ):
                yield reflection_response
    
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
        first_chunk: bool,
        user_agenty_name: str,
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
            # if first_chunk:
            #     yield ModelClientStreamingChunkEvent(content="<think>\n", source=user_agenty_name, metadata={"start_flag": "yes"})
            # else:
            #     yield ModelClientStreamingChunkEvent(content="<think>\n", source=agent_name)
            # yield ModelClientStreamingChunkEvent(content=tool_call_summary+"\n", source=agent_name)
            # yield ModelClientStreamingChunkEvent(content="</think>\n", source=agent_name)
            yield AgentLogEvent(source=user_agenty_name, content=tool_call_summary, content_type="tools")
            all_messages = system_messages + await model_context.get_messages()
            all_messages.append(
                UserMessage(
                    content=tool_call_summary_prompt,
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
                        if first_chunk:
                            yield ModelClientStreamingChunkEvent(content=chunk, source=user_agenty_name, metadata={"start_flag": "yes"})
                        else:
                            yield ModelClientStreamingChunkEvent(content=chunk, source=user_agenty_name)
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