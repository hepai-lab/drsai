import asyncio
import json
import logging
from types import SimpleNamespace
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

import httpx
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
from drsai.platform_auth import (
    DelegatedModelCredentialProvider,
    OidcModelCredentialProvider,
    get_model_credential_provider,
    static_model_credentials_allowed,
)

class HepAIAnthropicChatCompletionClient(AnthropicChatCompletionClient):

    component_provider_override = "drsai.modules.components.model_client.anthropic._anthropic_client.HepAIAnthropicChatCompletionClient"

    def __init__(self, **kwargs: Any):
        self._oidc_credential_pending = False
        self._uses_platform_auth = False
        if not static_model_credentials_allowed():
            kwargs["api_key"] = None
        credential = get_model_credential_provider(
            kwargs.get("api_key"),
            kwargs.get("base_url"),
        )
        if credential:
            kwargs["api_key"] = credential.access_token
            kwargs["base_url"] = credential.anthropic_base_url
            self._uses_platform_auth = isinstance(
                credential, (OidcModelCredentialProvider, DelegatedModelCredentialProvider)
            )
            if credential.delegation_headers:
                kwargs["default_headers"] = credential.delegation_headers
        elif not kwargs.get("api_key"):
            kwargs["api_key"] = "opendrsai-oidc-pending"
            self._oidc_credential_pending = True
            self._uses_platform_auth = True
        super().__init__(**kwargs)

    def _bind_platform_auth(self) -> None:
        if not getattr(self, "_uses_platform_auth", True) and not getattr(self, "_oidc_credential_pending", False):
            return
        credential = get_model_credential_provider()
        if not credential:
            if getattr(self, "_oidc_credential_pending", False):
                raise RuntimeError("OIDC credential context is unavailable for this model request.")
            return
        self._client.api_key = credential.access_token
        self._client.base_url = credential.anthropic_base_url
        if credential.delegation_headers:
            self._client._custom_headers = credential.delegation_headers
        self._oidc_credential_pending = False

    async def create(self, *args: Any, **kwargs: Any):
        self._bind_platform_auth()
        return await super().create(*args, **kwargs)

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
        self._bind_platform_auth()
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
        for param in ["top_p", "top_k", "stop_sequences", "metadata", "thinking", "output_config"]:
            if param in create_args:
                request_args[param] = create_args[param]

        # Prompt cache: Anthropic / Bedrock require cache_control to be attached
        # to a content block (system text or message content), NOT at the top
        # level of the request — the top-level field is silently ignored by
        # Bedrock. Empirically:
        #   top-level     → cache_creation_input_tokens == 0 (NOT cached)
        #   on system[-1] → cache_creation_input_tokens == N (CACHED)
        # So we attach the marker to the last cacheable block instead.
        cache_control = create_args.get("cache_control") or self._model_info.get("anthropic_cache_control")
        if cache_control:
            cc_source = "extra_create_args" if "cache_control" in create_args else "model_info.anthropic_cache_control"
            cc_ttl = cache_control.get("ttl") if isinstance(cache_control, Mapping) else None
            logger.info(
                "Anthropic prompt cache: applying %s ttl=%s (from %s)",
                cache_control, cc_ttl, cc_source,
            )
            _apply_cache_control_to_last_block(request_args, cache_control)

        # Stream the response
        # NOTE: Some HepAI-style gateways wrap upstream Anthropic SSE events
        # inside a non-standard envelope:
        #     event: message_metrics
        #     data:  {"event": "<real_type>", "data": {...real Anthropic payload...}}
        # The anthropic SDK dispatches on the SSE "event:" name, so it sees
        # only "message_metrics" and yields nothing. Detect this upfront and
        # take a custom httpx parsing path; otherwise use the SDK stream.
        use_custom_sse = self._gateway_uses_metrics_envelope()
        stream: Optional[AsyncStream[RawMessageStreamEvent]] = None
        custom_sse_iter: Optional[AsyncGenerator[Any, None]] = None

        if use_custom_sse:
            custom_sse_iter = self._stream_sse_via_httpx(
                request_args=request_args,
                cancellation_token=cancellation_token,
            )
        else:
            stream_future: asyncio.Task[AsyncStream[RawMessageStreamEvent]] = asyncio.ensure_future(
                cast(Coroutine[Any, Any, AsyncStream[RawMessageStreamEvent]], self._client.messages.create(**request_args))
            )
            if cancellation_token is not None:
                cancellation_token.link_future(stream_future)  # type: ignore
            stream = cast(AsyncStream[RawMessageStreamEvent], await stream_future)  # type: ignore

        text_content: List[str] = []
        tool_calls: Dict[str, Dict[str, Any]] = {}  # Track tool calls by ID
        current_tool_id: Optional[str] = None
        input_tokens: int = 0
        output_tokens: int = 0
        cache_creation_input_tokens: int = 0
        cache_read_input_tokens: int = 0
        stop_reason: Optional[str] = None

        first_chunk = True
        any_event_seen = False
        serialized_messages: List[Dict[str, Any]] = [self._serialize_message(msg) for msg in anthropic_messages]

        # Process the stream — either SDK stream or our custom SSE iterator
        chunk_source: Any = custom_sse_iter if use_custom_sse else stream
        async for chunk in chunk_source:
            any_event_seen = True
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

        # Fallback for upstream gateways that ignore stream=true and return a
        # single aggregated JSON payload. The SDK then yields zero events and
        # we'd produce CreateResult(content=""). Detect this and replay the
        # same request as a non-stream call so the caller still gets content.
        if not any_event_seen or (not text_content and not tool_calls):
            logger.warning(
                "Anthropic stream produced no usable events "
                "(events_seen=%s, text=%s, tool_calls=%s). "
                "Falling back to non-stream messages.create().",
                any_event_seen,
                bool(text_content),
                bool(tool_calls),
            )
            fallback_args = dict(request_args)
            fallback_args["stream"] = False
            fallback_future = asyncio.ensure_future(
                cast(Any, self._client.messages.create(**fallback_args))
            )
            if cancellation_token is not None:
                cancellation_token.link_future(fallback_future)  # type: ignore
            fb_msg = await fallback_future

            fb_usage = getattr(fb_msg, "usage", None)
            if fb_usage is not None:
                input_tokens = getattr(fb_usage, "input_tokens", input_tokens) or input_tokens
                output_tokens = getattr(fb_usage, "output_tokens", output_tokens) or output_tokens
                cache_creation_input_tokens = (
                    getattr(fb_usage, "cache_creation_input_tokens", None) or cache_creation_input_tokens
                )
                cache_read_input_tokens = (
                    getattr(fb_usage, "cache_read_input_tokens", None) or cache_read_input_tokens
                )
            stop_reason = getattr(fb_msg, "stop_reason", stop_reason) or stop_reason

            for block in getattr(fb_msg, "content", []) or []:
                btype = getattr(block, "type", None)
                if btype == "text":
                    text = getattr(block, "text", "") or ""
                    if text:
                        text_content.append(text)
                        yield text
                elif btype == "tool_use":
                    tool_id = getattr(block, "id", None)
                    if tool_id is None:
                        continue
                    raw_input = getattr(block, "input", {})
                    try:
                        input_str = json.dumps(raw_input) if not isinstance(raw_input, str) else raw_input
                    except (TypeError, ValueError):
                        input_str = str(raw_input)
                    tool_calls[tool_id] = {
                        "id": tool_id,
                        "name": getattr(block, "name", ""),
                        "input": input_str,
                    }

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

    # ── HepAI gateway SSE envelope handling ─────────────────────────────────
    # The HepAI Anthropic-compatible gateway wraps upstream Anthropic events
    # inside a non-standard envelope:
    #     event: message_metrics
    #     data:  {"event": "<real_event>", "data": {<real Anthropic payload>}}
    # The anthropic SDK dispatches by SSE event-name and ignores anything
    # outside its known set, so the SDK stream silently yields zero events.
    # We detect this at runtime and substitute our own SSE reader that
    # unwraps the envelope and yields objects shaped like the SDK's
    # RawMessageStreamEvent so the rest of create_stream_tmp can stay
    # unchanged. Re-detected per-request (cached on the instance).

    _METRICS_ENVELOPE_DETECTED_ATTR = "_hepai_metrics_envelope_detected"

    def _gateway_uses_metrics_envelope(self) -> bool:
        """Return True if a prior request confirmed the metrics-envelope
        gateway. Defaults to True for HepAI-style base_urls so the first
        request also takes the safe path; flips to False permanently on the
        first response whose Content-Type is plain JSON (i.e. real
        Anthropic / standard provider)."""
        cached = getattr(self, self._METRICS_ENVELOPE_DETECTED_ATTR, None)
        if cached is not None:
            return cached
        # Heuristic: if base_url points at the HepAI Anthropic gateway,
        # assume the envelope is in play until proven otherwise.
        base_url = str(getattr(self._client, "base_url", "") or "")
        return "aiapi.ihep.ac.cn" in base_url or "/apiv2/anthropic" in base_url

    def _remember_envelope_detection(self, detected: bool) -> None:
        setattr(self, self._METRICS_ENVELOPE_DETECTED_ATTR, detected)

    async def _stream_sse_via_httpx(
        self,
        request_args: Dict[str, Any],
        cancellation_token: Optional[CancellationToken],
    ) -> AsyncGenerator[Any, None]:
        """Stream Anthropic /v1/messages SSE while transparently unwrapping
        the HepAI ``message_metrics`` envelope.

        Strategy: re-use the official ``anthropic`` SDK's own HTTP client
        (auth headers, connection pool, proxy, retries, timeout) by calling
        ``self._client.messages.with_raw_response.create(...)``. That returns
        an unconsumed ``httpx.Response``. We then drive the SDK's own
        ``SSEDecoder`` over the raw byte stream and dispatch on
        ``ServerSentEvent.data`` (NOT ``.event``), which is where HepAI
        smuggles the real Anthropic event payload.

        Yielded objects are attribute-namespaces shaped like
        ``anthropic.types.RawMessageStreamEvent`` (``chunk.type``,
        ``chunk.delta.text`` …) — the exact contract used by
        ``create_stream_tmp``.
        """

        from anthropic._streaming import SSEDecoder  # private but stable

        # Pull out fields the SDK accepts as kwargs; everything else goes via
        # extra_body so it still reaches /v1/messages without breaking when
        # the SDK adds/removes typed parameters.
        sdk_kwargs: Dict[str, Any] = {}
        extra_body: Dict[str, Any] = {}
        _SDK_KWARGS = {
            "max_tokens", "messages", "model", "metadata", "stop_sequences",
            "system", "temperature", "thinking", "tool_choice", "tools",
            "top_k", "top_p", "service_tier",
            # NOTE: ``cache_control`` is intentionally routed through
            # extra_body. Top-level cache_control is silently ignored by
            # Bedrock; _apply_cache_control_to_last_block has already moved
            # the marker into a content block before we get here.
        }
        for key, val in request_args.items():
            if val is None or key == "stream":
                continue
            if key in _SDK_KWARGS:
                sdk_kwargs[key] = val
            else:
                extra_body[key] = val

        # Use the SDK's with_raw_response so we get the raw httpx.Response
        # without the SDK trying to parse SSE itself (it dispatches by event
        # name, which HepAI clobbers to "message_metrics").
        #
        # Mirror the standard SDK path (self._client.messages.create +
        # cancellation_token.link_future): wrap the connection coroutine in a
        # Task so the CancellationToken can cancel it before the first byte
        # arrives.  Once the response is in hand the token is no longer
        # checked — identical behaviour to the non-custom-SSE branch.
        connect_future: asyncio.Task = asyncio.ensure_future(
            self._client.messages.with_raw_response.create(
                stream=True,
                extra_body=extra_body if extra_body else None,
                **sdk_kwargs,
            )
        )
        if cancellation_token is not None:
            cancellation_token.link_future(connect_future)  # type: ignore

        raw_resp = await connect_future
        http_response: httpx.Response = raw_resp.http_response

        try:
            content_type = (http_response.headers.get("content-type") or "").lower()
            if "text/event-stream" not in content_type:
                # Gateway returned aggregated JSON instead of SSE. Remember so
                # we don't take this path again, and let create_stream_tmp's
                # "empty events" fallback do non-stream replay.
                self._remember_envelope_detection(False)
                logger.warning(
                    "Anthropic gateway returned %s instead of SSE; "
                    "skipping custom SSE parser.",
                    content_type or "<no content-type>",
                )
                return

            envelope_confirmed: Optional[bool] = None
            decoder = SSEDecoder()
            async for sse in decoder.aiter_bytes(http_response.aiter_bytes()):
                # ``sse.data`` is the JSON-encoded SSE data field. HepAI's
                # envelope and the standard payload both live there; only the
                # ``sse.event`` name is unreliable.
                if not sse.data:
                    continue
                try:
                    raw = json.loads(sse.data)
                except json.JSONDecodeError:
                    logger.warning("Skipping non-JSON SSE data: %r", sse.data[:120])
                    continue

                # HepAI envelope: {"event": "...", "data": {...real payload...}}
                is_envelope = (
                    isinstance(raw, dict)
                    and "event" in raw
                    and isinstance(raw.get("data"), dict)
                    and raw["data"].get("type") == raw.get("event")
                )
                if envelope_confirmed is None:
                    envelope_confirmed = is_envelope
                    self._remember_envelope_detection(is_envelope)

                payload_dict = raw["data"] if is_envelope else raw
                if not isinstance(payload_dict, dict):
                    continue
                yield _to_attr_namespace(payload_dict)
        finally:
            await http_response.aclose()


def _to_attr_namespace(obj: Any) -> Any:
    """Recursively convert dict → SimpleNamespace so that downstream code
    using attribute access (chunk.type, chunk.delta.text, …) keeps working,
    while preserving lists and primitives."""
    if isinstance(obj, dict):
        return SimpleNamespace(**{k: _to_attr_namespace(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return [_to_attr_namespace(v) for v in obj]
    return obj


def _apply_cache_control_to_last_block(
    request_args: Dict[str, Any],
    cache_control: Mapping[str, Any],
) -> None:
    """Attach the Anthropic cache_control marker to the last content block of
    the *most recently rolling* prefix — ``messages[-1].content[-1]``.

    Rolling-marker policy (mirrors Anthropic's claude-code CLI):
        On every request we move the single message-level marker to the
        latest message. Anthropic's cache treats this marker as the cut
        point of a cache prefix, so the *whole prefix up to that block*
        (system + tools + all prior messages + current user msg) gets
        written/read together. Next turn, the marker moves forward to the
        new last message, the previous prefix is still a prefix of the new
        one, so it reads from cache and we only write the delta — into the
        SAME 1h bucket since the same ttl is reused.

    Why not system[-1]?
        We tried that first. Anthropic then auto-creates a *default* 5m
        breakpoint at the end of every new turn's content (because the
        prefix beyond `system` is unmarked), so multi-turn conversation
        churn always lands in the 5m bucket and is evicted every turn.
        Marker on messages[-1] avoids this.

    Anthropic's top-level ``cache_control`` field is documented as
    auto-applying the marker to the last cacheable block, but the Bedrock
    backend used by HepAI gateway does NOT honor that shorthand —
    cache_creation_input_tokens stays 0. Attaching the marker directly to a
    block reliably works on both vanilla Anthropic and Bedrock.

    Preference (the *first* hit gets the marker):
        1) messages[-1].content[-1]  — the rolling prefix end (preferred)
        2) tools[-1]                 — fallback when no messages
        3) system[-1] text block     — last resort when neither exists

    Mutates ``request_args`` in place. Skips silently if no candidate block.
    """
    marker = {k: v for k, v in dict(cache_control).items()}
    if marker.get("type") != "ephemeral":
        marker["type"] = "ephemeral"

    # Promote system: str → [TextBlockParam] so cache_control can attach if
    # we end up falling back to system.
    sys_val = request_args.get("system")
    if isinstance(sys_val, str):
        if sys_val.strip():
            request_args["system"] = [{"type": "text", "text": sys_val}]
            sys_val = request_args["system"]
        else:
            sys_val = None

    target_block: Optional[Dict[str, Any]] = None

    # 1) Preferred: messages[-1].content[-1] — rolling marker, advances every
    #    turn so the new content joins the cached prefix in the same bucket.
    msgs = request_args.get("messages") or []
    if msgs:
        last_msg = msgs[-1]
        if isinstance(last_msg, dict):
            content = last_msg.get("content")
            if isinstance(content, list) and content:
                cand = content[-1]
                if isinstance(cand, dict):
                    target_block = cand
            elif isinstance(content, str) and content:
                last_msg["content"] = [{"type": "text", "text": content}]
                target_block = last_msg["content"][-1]

    # 2) Fallback: tools[-1] (no messages, e.g. validation request).
    if target_block is None:
        tools_val = request_args.get("tools")
        if isinstance(tools_val, list) and tools_val:
            cand = tools_val[-1]
            if isinstance(cand, dict):
                target_block = cand

    # 3) Last resort: system[-1].
    if target_block is None and isinstance(sys_val, list) and sys_val:
        cand = sys_val[-1]
        if isinstance(cand, dict):
            target_block = cand

    if target_block is None:
        return

    target_block["cache_control"] = marker


def _jsonable(obj: Any) -> Any:
    """Deep-convert Anthropic block models / pydantic BaseModel / dataclasses
    to plain Python so that ``json.dumps`` (and hence ``httpx.json=``) can
    serialize the full Anthropic /v1/messages payload.

    Specifically handles values that the standard JSON encoder rejects:
    - pydantic v2 BaseModel → ``model_dump(exclude_none=True)``
    - pydantic v1 BaseModel → ``dict(exclude_none=True)``
    - objects with ``to_dict`` / ``dict`` method
    - dict / list / tuple / set are recursed
    Everything else is returned as-is; the JSON encoder will fail loudly on
    truly unsupported types, which is the right behavior.
    """
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_jsonable(v) for v in obj]

    # pydantic v2
    model_dump = getattr(obj, "model_dump", None)
    if callable(model_dump):
        try:
            return _jsonable(model_dump(exclude_none=True))
        except TypeError:
            return _jsonable(model_dump())

    # pydantic v1
    if hasattr(obj, "dict") and callable(getattr(obj, "dict")) and obj.__class__.__module__.startswith("pydantic"):
        try:
            return _jsonable(obj.dict(exclude_none=True))  # type: ignore[call-arg]
        except TypeError:
            return _jsonable(obj.dict())  # type: ignore[call-arg]

    return obj
