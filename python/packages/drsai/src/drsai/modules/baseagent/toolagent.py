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
    )

import asyncio
from loguru import logger
import inspect
import json
import os

from pydantic import BaseModel

from autogen_core import CancellationToken, FunctionCall
from autogen_core.tools import (
    BaseTool, 
    Workbench, 
    ToolSchema)
from autogen_core.memory import Memory
from autogen_core.model_context import ChatCompletionContext
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
)

from .drsaiagent import DrSaiAgent
from autogen_agentchat.agents._assistant_agent import AssistantAgentConfig
from autogen_agentchat.base import Handoff as HandoffBase
from autogen_agentchat.base import Response
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
    StructuredMessageFactory,
    # MultiModalMessage,
    Image,
)
from drsai import HepAIChatCompletionClient
from drsai.modules.managers.database import DatabaseManager



class ToolAgent(DrSaiAgent):
    """通过多工具进行优化"""
    def __init__(
        self,
        name: str,
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
        output_content_type: type[BaseModel] | None = None,
        output_content_type_format: str | None = None,
        memory: Sequence[Memory] | None = None,
        metadata: Dict[str, str] | None = None,
        memory_function: Callable = None,
        # allow_reply_function: bool = False,
        reply_function: Callable = None,
        db_manager: DatabaseManager = None,
        **kwargs,
            ):
        
        super().__init__(
            name, 
            model_client,
            tools=tools,
            workbench=workbench,
            handoffs=handoffs,
            model_context=model_context,
            description=description,
            system_message=system_message,
            model_client_stream=model_client_stream,
            reflect_on_tool_use=reflect_on_tool_use,
            tool_call_summary_format=tool_call_summary_format,
            output_content_type=output_content_type,
            output_content_type_format=output_content_type_format,
            memory=memory,
            metadata=metadata,
            memory_function=memory_function,
            reply_function=reply_function,
            db_manager=db_manager,
            **kwargs,
            )
    
    async def lazy_init(self, **kwargs: Any) -> None:
        """Initialize the tools and models needed by the agent."""
        pass

    async def close(self) -> None:
        """Clean up resources used by the agent.

        This method:
          ...
        """
        logger.info(f"Closing {self.name}...")
        
        # Close the model client.
        await self._model_client.close()

    async def pause(self) -> None:
        """Pause the agent by setting the paused state."""
        logger.info(f"Pausing {self.name}...")

        self.is_paused = True
        self._paused.set()

    async def resume(self) -> None:
        """Resume the agent by clearing the paused state."""
        self.is_paused = False
        self._paused.clear()

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
            inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
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

    @staticmethod
    def _summarize_tool_use(
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]],
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        handoffs: Dict[str, HandoffBase],
        tool_call_summary_format: str,
        agent_name: str,
    ) -> Response:
        """
        If reflect_on_tool_use=False, create a summary message of all tool calls.
        """
        # Filter out calls which were actually handoffs
        normal_tool_calls = [(call, result) for call, result in executed_calls_and_results if call.name not in handoffs]
        tool_call_summaries: List[str] = []
        for tool_call, tool_call_result in normal_tool_calls:
            # 对MCP的结果进行处理
            try:
                json_results = json.loads(tool_call_result.content)
                if isinstance(json_results, list):
                    json_result = json_results[0]
                    if isinstance(json_result, dict) and 'type' in json_result:
                        if json_result['type'] == 'text':
                            tool_call_result.content = json_result['text']
            except:
                pass
            # 其他的tool的结果直接用content
            tool_call_summaries.append(
                tool_call_summary_format.format(
                    tool_name=tool_call.name,
                    arguments=tool_call.arguments,
                    result=tool_call_result.content,
                )
            )
        tool_call_summary = "\n".join(tool_call_summaries)
        return Response(
            chat_message=ToolCallSummaryMessage(
                content=tool_call_summary,
                source=agent_name,
            ),
            inner_messages=inner_messages,
        )
    
    @classmethod
    def _from_config(
        cls, config: AssistantAgentConfig, 
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
            output_content_type=output_content_type,
            output_content_type_format=format_string,
            metadata=config.metadata,
            memory_function=memory_function,
            reply_function=reply_function,
            db_manager=db_manager,
            **kwargs,
        
        )