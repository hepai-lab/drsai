from typing import AsyncGenerator, List, Sequence, Dict, Any, Callable, Awaitable
import asyncio
import logging
import warnings

from autogen_core import CancellationToken, FunctionCall
from autogen_core.tools import BaseTool
from autogen_core.memory import Memory
from autogen_core.model_context import ChatCompletionContext
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    UserMessage,
)
from autogen_core import EVENT_LOGGER_NAME
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.base import Handoff as HandoffBase
from autogen_agentchat.base import Response
from autogen_agentchat.messages import (
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
)

event_logger = logging.getLogger(EVENT_LOGGER_NAME)

def SychrotronClear(messsages: List[Dict], **kwargs):
    # TODO: Implement SychrotronClear agent.
    pass

class DrSaiAgent(AssistantAgent):
    """基于aotogen AssistantAgent的定制Agent"""
    def __init__(
            self, 
            name: str,
            model_client: ChatCompletionClient,
            *,
            tools: List[BaseTool[Any, Any] | Callable[..., Any] | Callable[..., Awaitable[Any]]] | None = None,
            handoffs: List[HandoffBase | str] | None = None,
            model_context: ChatCompletionContext | None = None,
            description: str = "An agent that provides assistance with ability to use tools.",
            system_message: (
                str | None
            ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
            model_client_stream: bool = False,
            reflect_on_tool_use: bool = False,
            tool_call_summary_format: str = "{result}",
            memory: Sequence[Memory] | None = None,
            **kwargs,
            ):
        super().__init__(
            name, 
            model_client,
            tools=tools,
            handoffs=handoffs,
            model_context=model_context,
            description=description,
            system_message=system_message,
            model_client_stream=model_client_stream,
            reflect_on_tool_use=reflect_on_tool_use,
            tool_call_summary_format=tool_call_summary_format,
            memory=memory
            )
        
        self.on_messages_stream_function = kwargs.get("on_messages_stream_function", self.on_messages_stream)

    @property
    def produced_message_types(self) -> Sequence[type[ChatMessage]]:
        """The types of final response messages that the assistant agent produces."""
        message_types: List[type[ChatMessage]] = [TextMessage]
        if self._handoffs:
            message_types.append(HandoffMessage)
        if self._tools:
            message_types.append(ToolCallSummaryMessage)
        return tuple(message_types)
    
    async def on_messages(self, messages: Sequence[ChatMessage], cancellation_token: CancellationToken) -> Response:
        async for message in self.on_messages_stream(messages, cancellation_token):
            if isinstance(message, Response):
                return message
        raise AssertionError("The stream should have returned the final result.")

    async def on_messages_stream(
        self, messages: Sequence[ChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[AgentEvent | ChatMessage | Response, None]:
        # Add messages to the model context.
        for msg in messages:
            if isinstance(msg, HandoffMessage):
                # Add handoff context to the model context.
                for context_msg in msg.context:
                    await self._model_context.add_message(context_msg)
            await self._model_context.add_message(UserMessage(content=msg.content, source=msg.source))

        # Inner messages.
        inner_messages: List[AgentEvent | ChatMessage] = []

        # Update the model context with memory content.
        if self._memory:
            for memory in self._memory:
                update_context_result = await memory.update_context(self._model_context)
                if update_context_result and len(update_context_result.memories.results) > 0:
                    memory_query_event_msg = MemoryQueryEvent(
                        content=update_context_result.memories.results, source=self.name
                    )
                    inner_messages.append(memory_query_event_msg)
                    yield memory_query_event_msg

        # Generate an inference result based on the current model context.
        llm_messages = self._get_compatible_context(self._system_messages + await self._model_context.get_messages())
        model_result: CreateResult | None = None
        if self._model_client_stream:
            # Stream the model client.
            async for chunk in self._model_client.create_stream(
                llm_messages, tools=self._tools + self._handoff_tools, cancellation_token=cancellation_token
            ):
                if isinstance(chunk, CreateResult):
                    model_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(content=chunk, source=self.name)
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            assert isinstance(model_result, CreateResult)
        else:
            model_result = await self._model_client.create(
                llm_messages, tools=self._tools + self._handoff_tools, cancellation_token=cancellation_token
            )

        # Add the response to the model context.
        await self._model_context.add_message(AssistantMessage(content=model_result.content, source=self.name))

        # Check if the response is a string and return it.
        if isinstance(model_result.content, str):
            yield Response(
                chat_message=TextMessage(
                    content=model_result.content, source=self.name, models_usage=model_result.usage
                ),
                inner_messages=inner_messages,
            )
            return

        # Process tool calls.
        assert isinstance(model_result.content, list) and all(
            isinstance(item, FunctionCall) for item in model_result.content
        )
        tool_call_msg = ToolCallRequestEvent(
            content=model_result.content, source=self.name, models_usage=model_result.usage
        )
        event_logger.debug(tool_call_msg)
        # Add the tool call message to the output.
        inner_messages.append(tool_call_msg)
        yield tool_call_msg

        # Execute the tool calls and hanoff calls.
        executed_calls_and_results = await asyncio.gather(
            *[self._execute_tool_call(call, cancellation_token) for call in model_result.content]
        )
        # Collect the execution results in a list.
        exec_results = [result for _, result in executed_calls_and_results]
        # Add the execution results to output and model context.
        tool_call_result_msg = ToolCallExecutionEvent(content=exec_results, source=self.name)
        event_logger.debug(tool_call_result_msg)
        await self._model_context.add_message(FunctionExecutionResultMessage(content=exec_results))
        inner_messages.append(tool_call_result_msg)
        yield tool_call_result_msg

        # Separate out tool calls and tool call results from handoff requests.
        tool_calls: List[FunctionCall] = []
        tool_call_results: List[FunctionExecutionResult] = []
        for exec_call, exec_result in executed_calls_and_results:
            if exec_call.name not in self._handoffs:
                tool_calls.append(exec_call)
                tool_call_results.append(exec_result)

        # Detect handoff requests.
        handoff_reqs = [call for call in model_result.content if call.name in self._handoffs]
        if len(handoff_reqs) > 0:
            handoffs = [self._handoffs[call.name] for call in handoff_reqs]
            if len(handoffs) > 1:
                # show warning if multiple handoffs detected
                warnings.warn(
                    (
                        f"Multiple handoffs detected only the first is executed: {[handoff.name for handoff in handoffs]}. "
                        "Disable parallel tool call in the model client to avoid this warning."
                    ),
                    stacklevel=2,
                )
            # Current context for handoff.
            handoff_context: List[LLMMessage] = []
            if len(tool_calls) > 0:
                handoff_context.append(AssistantMessage(content=tool_calls, source=self.name))
                handoff_context.append(FunctionExecutionResultMessage(content=tool_call_results))
            # Return the output messages to signal the handoff.
            yield Response(
                chat_message=HandoffMessage(
                    content=handoffs[0].message, target=handoffs[0].target, source=self.name, context=handoff_context
                ),
                inner_messages=inner_messages,
            )
            return

        if self._reflect_on_tool_use:
            # Generate another inference result based on the tool call and result.
            llm_messages = self._get_compatible_context(
                self._system_messages + await self._model_context.get_messages()
            )
            reflection_model_result: CreateResult | None = None
            if self._model_client_stream:
                # Stream the model client.
                async for chunk in self._model_client.create_stream(
                    llm_messages, cancellation_token=cancellation_token
                ):
                    if isinstance(chunk, CreateResult):
                        reflection_model_result = chunk
                    elif isinstance(chunk, str):
                        yield ModelClientStreamingChunkEvent(content=chunk, source=self.name)
                    else:
                        raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
                assert isinstance(reflection_model_result, CreateResult)
            else:
                reflection_model_result = await self._model_client.create(
                    llm_messages, cancellation_token=cancellation_token
                )
            assert isinstance(reflection_model_result.content, str)
            # Add the response to the model context.
            await self._model_context.add_message(
                AssistantMessage(content=reflection_model_result.content, source=self.name)
            )
            # Yield the response.
            yield Response(
                chat_message=TextMessage(
                    content=reflection_model_result.content,
                    source=self.name,
                    models_usage=reflection_model_result.usage,
                ),
                inner_messages=inner_messages,
            )
        else:
            # Return tool call result as the response.
            tool_call_summaries: List[str] = []
            for tool_call, tool_call_result in zip(tool_calls, tool_call_results, strict=False):
                tool_call_summaries.append(
                    self._tool_call_summary_format.format(
                        tool_name=tool_call.name,
                        arguments=tool_call.arguments,
                        result=tool_call_result.content,
                    ),
                )
            tool_call_summary = "\n".join(tool_call_summaries)
            yield Response(
                chat_message=ToolCallSummaryMessage(content=tool_call_summary, source=self.name),
                inner_messages=inner_messages,
            )
    
    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        """Reset the assistant agent to its initialization state."""
        await self._model_context.clear()


