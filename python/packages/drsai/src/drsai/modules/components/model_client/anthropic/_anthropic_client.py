import asyncio
import json
import logging
from typing import (
    Any,
    AsyncGenerator,
    Coroutine,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Union,
    cast,
)

from anthropic import  AsyncStream
from anthropic.types import (
    # Base64ImageSourceParam,
    # ContentBlock,
    # ImageBlockParam,
    # Message,
    MessageParam,
    RawMessageStreamEvent,  # type: ignore
    TextBlock,
    # TextBlockParam,
    # ToolParam,
    # ToolResultBlockParam,
    ToolUseBlock,
)
from autogen_core import (
    EVENT_LOGGER_NAME,
    TRACE_LOGGER_NAME,
    CancellationToken,
    Component,
    FunctionCall,
    Image,
)
from autogen_core.logging import LLMCallEvent, LLMStreamEndEvent, LLMStreamStartEvent
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    FinishReasons,
    FunctionExecutionResultMessage,
    LLMMessage,
    ModelCapabilities,  # type: ignore
    ModelInfo,
    RequestUsage,
    SystemMessage,
    UserMessage,
    validate_model_info,
)
from autogen_core.tools import Tool, ToolSchema
from pydantic import BaseModel

logger = logging.getLogger(EVENT_LOGGER_NAME)


from autogen_ext.models.anthropic import AnthropicChatCompletionClient, AnthropicBedrockClientConfiguration
from autogen_ext.models.anthropic._anthropic_client import (
    to_anthropic_type, 
    convert_tools, 
    normalize_name,
    normalize_stop_reason,
    _add_usage
    )

class HepAIAnthropicChatCompletionClient(AnthropicChatCompletionClient):

    component_provider_override = "drsai.modules.components.model_client.anthropic._anthropic_client.HepAIAnthropicChatCompletionClient"

    def _sanitize_anthropic_message(self, message: MessageParam) -> MessageParam:
        """Remove/repair empty Anthropic text blocks before sending.

        Some non-Anthropic providers persist AssistantMessage(thought="") for
        tool-call turns. autogen-ext serializes that as an empty Anthropic
        TextBlock, but Anthropic rejects empty text content blocks. Preserve all
        non-empty reasoning text and non-text blocks; only drop empty text blocks.
        """
        content = message.get("content")
        if isinstance(content, str):
            if not content.strip():
                message["content"] = " "
            return message

        if not isinstance(content, list):
            return message

        cleaned: List[Any] = []
        for block in content:
            if isinstance(block, TextBlock):
                if block.text and block.text.strip():
                    cleaned.append({"type": "text", "text": block.text})
                continue

            if isinstance(block, BaseModel):
                block = block.model_dump(exclude_none=True)

            if isinstance(block, dict):
                # Anthropic request params reject optional fields explicitly set
                # to null, e.g. tool_use.caller=None. Omit them instead.
                block = {k: v for k, v in block.items() if v is not None}
                if block.get("type") == "text":
                    text = str(block.get("text", ""))
                    if not text.strip():
                        continue

            cleaned.append(block)

        message["content"] = cleaned or [{"type": "text", "text": " "}]
        return message

    async def create_stream(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        json_output: Optional[bool | type[BaseModel]] = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: Optional[CancellationToken] = None,
        max_consecutive_empty_chunk_tolerance: int = 0,
    ) -> AsyncGenerator[Union[str, CreateResult], None]:
        async for chunk in self.create_stream_tmp(
            messages,
            tools=tools,
            json_output=json_output,
            extra_create_args=extra_create_args,
            cancellation_token=cancellation_token,
            max_consecutive_empty_chunk_tolerance=max_consecutive_empty_chunk_tolerance,
        ):
            yield chunk

    async def create_stream_tmp(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        json_output: Optional[bool | type[BaseModel]] = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: Optional[CancellationToken] = None,
        max_consecutive_empty_chunk_tolerance: int = 0,
    ) -> AsyncGenerator[Union[str, CreateResult], None]:
        """
        Creates an AsyncGenerator that yields a stream of completions based on the provided messages and tools.
        """
        # Copy create args and update with extra args
        create_args = self._create_args.copy()
        create_args.update(extra_create_args)

        # Check for vision capability if images are present
        if self.model_info["vision"] is False:
            for message in messages:
                if isinstance(message, UserMessage):
                    if isinstance(message.content, list) and any(isinstance(x, Image) for x in message.content):
                        raise ValueError("Model does not support vision and image was provided")

        # Handle JSON output format
        if json_output is not None:
            if self.model_info["json_output"] is False and json_output is True:
                raise ValueError("Model does not support JSON output")

            if json_output is True:
                create_args["response_format"] = {"type": "json_object"}

            if isinstance(json_output, type):
                raise ValueError("Structured output is currently not supported for Anthropic models")

        # Process system message separately
        system_message = None
        anthropic_messages: List[MessageParam] = []

        # Merge continuous system messages into a single message
        messages = self._merge_system_messages(messages)
        messages = self._rstrip_last_assistant_message(messages)

        for message in messages:
            if isinstance(message, SystemMessage):
                if system_message is not None:
                    # if that case, system message is must only one
                    raise ValueError("Multiple system messages are not supported")
                system_message = to_anthropic_type(message)
            else:
                anthropic_message = to_anthropic_type(message)
                if isinstance(anthropic_message, list):
                    anthropic_messages.extend(
                        self._sanitize_anthropic_message(msg) for msg in anthropic_message
                    )
                elif isinstance(anthropic_message, str):
                    msg = MessageParam(
                        role="user" if isinstance(message, UserMessage) else "assistant", content=anthropic_message
                    )
                    anthropic_messages.append(self._sanitize_anthropic_message(msg))
                else:
                    anthropic_messages.append(self._sanitize_anthropic_message(anthropic_message))

        # Check for function calling support
        if self.model_info["function_calling"] is False and len(tools) > 0:
            raise ValueError("Model does not support function calling")

        # Set up the request
        request_args: Dict[str, Any] = {
            "model": create_args["model"],
            "messages": anthropic_messages,
            "max_tokens": create_args.get("max_tokens", 4096),
            "temperature": create_args.get("temperature", 1.0),
            "stream": True,
        }

        # Add system message if present
        if system_message is not None:
            if isinstance(system_message, str) and not system_message.strip():
                system_message = " "
            request_args["system"] = system_message

        # Check if any message is a tool result
        has_tool_results = any(isinstance(msg, FunctionExecutionResultMessage) for msg in messages)

        # Add tools if present
        if len(tools) > 0:
            converted_tools = convert_tools(tools)
            self._last_used_tools = converted_tools
            request_args["tools"] = converted_tools
        elif has_tool_results:
            request_args["tools"] = self._last_used_tools

        # Optional parameters
        for param in ["top_p", "top_k", "stop_sequences", "metadata", "cache_control"]:
            if param in create_args:
                request_args[param] = create_args[param]

        if "cache_control" not in request_args:
            cache_control = self._model_info.get("anthropic_cache_control")
            if cache_control:
                request_args["cache_control"] = cache_control

        # Stream the response
        stream_future: asyncio.Task[AsyncStream[RawMessageStreamEvent]] = asyncio.ensure_future(
            cast(Coroutine[Any, Any, AsyncStream[RawMessageStreamEvent]], self._client.messages.create(**request_args))
        )

        if cancellation_token is not None:
            cancellation_token.link_future(stream_future)  # type: ignore

        stream: AsyncStream[RawMessageStreamEvent] = cast(AsyncStream[RawMessageStreamEvent], await stream_future)  # type: ignore

        text_content: List[str] = []
        tool_calls: Dict[str, Dict[str, Any]] = {}  # Track tool calls by ID
        current_tool_id: Optional[str] = None
        input_tokens: int = 0
        output_tokens: int = 0
        cache_creation_input_tokens: int = 0
        cache_read_input_tokens: int = 0
        stop_reason: Optional[str] = None

        first_chunk = True
        serialized_messages: List[Dict[str, Any]] = [self._serialize_message(msg) for msg in anthropic_messages]

        # Process the stream
        async for chunk in stream:
            if first_chunk:
                first_chunk = False
                # Emit the start event.
                logger.info(
                    LLMStreamStartEvent(
                        messages=serialized_messages,
                    )
                )
            # Handle different event types
            if chunk.type == "content_block_start":
                if chunk.content_block.type == "tool_use":
                    # Start of a tool use block
                    current_tool_id = chunk.content_block.id
                    tool_calls[current_tool_id] = {
                        "id": chunk.content_block.id,
                        "name": chunk.content_block.name,
                        "input": "",  # Will be populated from deltas
                    }

            elif chunk.type == "content_block_delta":
                if hasattr(chunk.delta, "type") and chunk.delta.type == "text_delta":
                    # Handle text content
                    delta_text = chunk.delta.text
                    text_content.append(delta_text)
                    if delta_text:
                        yield delta_text

                # Handle tool input deltas - they come as InputJSONDelta
                elif hasattr(chunk.delta, "type") and chunk.delta.type == "input_json_delta":
                    if current_tool_id is not None and hasattr(chunk.delta, "partial_json"):
                        # Accumulate partial JSON for the current tool
                        tool_calls[current_tool_id]["input"] += chunk.delta.partial_json

            elif chunk.type == "content_block_stop":
                # End of a content block (could be text or tool)
                current_tool_id = None

            elif chunk.type == "message_delta":
                if hasattr(chunk.delta, "stop_reason") and chunk.delta.stop_reason:
                    stop_reason = chunk.delta.stop_reason

                # Get usage info if available
                if hasattr(chunk, "usage"):
                    usage_obj = chunk.usage
                    if hasattr(usage_obj, "output_tokens"):
                        output_tokens = usage_obj.output_tokens
                    if getattr(usage_obj, "cache_creation_input_tokens", None) is not None:
                        cache_creation_input_tokens = usage_obj.cache_creation_input_tokens or 0
                    if getattr(usage_obj, "cache_read_input_tokens", None) is not None:
                        cache_read_input_tokens = usage_obj.cache_read_input_tokens or 0

            elif chunk.type == "message_start":
                if hasattr(chunk, "message") and hasattr(chunk.message, "usage"):
                    usage_obj = chunk.message.usage
                    if hasattr(usage_obj, "input_tokens"):
                        input_tokens = usage_obj.input_tokens
                    if hasattr(usage_obj, "output_tokens"):
                        output_tokens = usage_obj.output_tokens
                    if getattr(usage_obj, "cache_creation_input_tokens", None) is not None:
                        cache_creation_input_tokens = usage_obj.cache_creation_input_tokens or 0
                    if getattr(usage_obj, "cache_read_input_tokens", None) is not None:
                        cache_read_input_tokens = usage_obj.cache_read_input_tokens or 0

        # Prepare the final response
        usage = RequestUsage(
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
        )

        # Determine content based on what was received
        content: Union[str, List[FunctionCall]]
        thought = None

        if tool_calls:
            # We received tool calls
            if text_content:
                # Text before tool calls is treated as thought
                thought = "".join(text_content)

            # Convert tool calls to FunctionCall objects
            content = []
            for _, tool_data in tool_calls.items():
                # Parse the JSON input if needed
                input_str = tool_data["input"]
                try:
                    # If it's valid JSON, parse it; otherwise use as-is
                    if input_str.strip().startswith("{") and input_str.strip().endswith("}"):
                        parsed_input = json.loads(input_str)
                        input_str = json.dumps(parsed_input)  # Re-serialize to ensure valid JSON
                except json.JSONDecodeError:
                    # Keep as string if not valid JSON
                    pass

                content.append(
                    FunctionCall(
                        id=tool_data["id"],
                        name=normalize_name(tool_data["name"]),
                        arguments=input_str,
                    )
                )
        else:
            # Just text content
            content = "".join(text_content)

        # Create the final result
        result = CreateResult(
            finish_reason=normalize_stop_reason(stop_reason),
            content=content,
            usage=usage,
            cached=False,
            thought=thought,
        )

        logger.info(
            "Anthropic prompt cache: creation=%s read=%s hit=%s",
            cache_creation_input_tokens,
            cache_read_input_tokens,
            cache_read_input_tokens > 0,
        )

        # Emit the end event.
        logger.info(
            LLMStreamEndEvent(
                response=result.model_dump(),
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
            )
        )

        # Update usage statistics
        self._total_usage = _add_usage(self._total_usage, usage)
        self._actual_usage = _add_usage(self._actual_usage, usage)

        yield result
