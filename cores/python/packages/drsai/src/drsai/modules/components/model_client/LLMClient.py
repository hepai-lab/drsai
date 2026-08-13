
from typing_extensions import Unpack
import os
import logging
import warnings
from typing import (
    Any,
    AsyncGenerator,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Type,
    Union,
    cast,
)
from typing_extensions import Required
from pydantic import BaseModel
from drsai.platform_auth import OidcModelCredentialProvider, get_model_credential_provider, static_model_credentials_allowed

from openai.types.chat import ChatCompletionChunk
from tiktoken.model import MODEL_TO_ENCODING

from autogen_core import (
    EVENT_LOGGER_NAME,
    TRACE_LOGGER_NAME,
    CancellationToken,
    Component,
    FunctionCall,
    Image,
)
from autogen_ext.models._utils.normalize_stop_reason import normalize_stop_reason
from autogen_ext.models._utils.parse_r1_content import parse_r1_content
from autogen_core.models import (
    ChatCompletionTokenLogprob,
    CreateResult,
    LLMMessage,
    ModelInfo,
    ModelFamily,
    RequestUsage,
    TopLogprob,
    UserMessage,
    SystemMessage,
    AssistantMessage,
)
from autogen_core.logging import LLMCallEvent, LLMStreamEndEvent, LLMStreamStartEvent
from autogen_core.tools import Tool, ToolSchema

from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_ext.models.openai._model_info import (
    _MODEL_TOKEN_LIMITS,
)
from autogen_ext.models.openai._openai_client import (
    convert_tools, 
    _add_usage,
    to_oai_type,
    create_kwargs,
    count_tokens_openai,
    _model_info,
    )
from autogen_ext.models.openai.config import (
    OpenAIClientConfiguration, 
    OpenAIClientConfigurationConfigModel)

logger = logging.getLogger(EVENT_LOGGER_NAME)


class HepAIModelInfo(ModelInfo):
    token_model: Required[str]

# See OpenAI docs for explanation of these parameters
class HepAIClientConfiguration(OpenAIClientConfiguration, total=False):
    api_version: str | None = None
    use_responses_api: bool
    allow_deferred_oidc: bool


class HepAIClientConfigurationConfigModel(OpenAIClientConfigurationConfigModel):
    api_version: str | None = None
    use_responses_api: bool = False
    allow_deferred_oidc: bool = True


class HepAIChatCompletionClient(OpenAIChatCompletionClient, Component[HepAIClientConfigurationConfigModel]):

    component_type = "model"
    component_config_schema = HepAIClientConfigurationConfigModel
    component_provider_override = "drsai.HepAIChatCompletionClient"

    def __init__(self, **kwargs: Unpack[HepAIClientConfiguration]):

        self._use_responses_api = bool(kwargs.pop("use_responses_api", False))
        self._allow_deferred_oidc = bool(kwargs.pop("allow_deferred_oidc", True))
        # Cached/independent Agent clients can be reconstructed after the
        # resolved SecretValue has deliberately been omitted from serialized
        # component state. Recover only an exact configured Provider match;
        # never guess by model name or send one Provider's key to another URL.
        if (
            not kwargs.get("api_key")
            and kwargs.get("base_url")
            and not self._allow_deferred_oidc
        ):
            try:
                from drsai.config import load_user_config
                from drsai.config.resolver import resolve_model_config

                config = load_user_config()
                expected_url = str(kwargs["base_url"]).rstrip("/")
                provider_name = next((
                    name for name, provider in config.providers.items()
                    if str(provider.base_url or "").rstrip("/") == expected_url
                ), None)
                if provider_name is not None:
                    resolved_model = resolve_model_config(
                        config,
                        environ=os.environ,
                        provider=provider_name,
                        require_credentials=True,
                    )
                    if resolved_model.provider.api_key is not None:
                        kwargs["api_key"] = resolved_model.provider.api_key.reveal()
            except Exception:
                # The explicit actionable error below is safer than changing
                # transport or silently borrowing the platform OIDC token.
                pass
        self._oidc_credential_pending = False
        self._uses_platform_auth = False
        credential = get_model_credential_provider(
            kwargs.get("api_key"),
            kwargs.get("base_url"),
            configured_provider=not self._allow_deferred_oidc,
        )
        if credential:
            kwargs["api_key"] = credential.access_token
            kwargs["base_url"] = credential.openai_base_url
            self._uses_platform_auth = isinstance(credential, OidcModelCredentialProvider)
        else:
            if not static_model_credentials_allowed():
                kwargs["api_key"] = None
            elif not kwargs.get("api_key"):
                kwargs["api_key"] = os.environ.get("HEPAI_API_KEY")
            if "base_url" not in kwargs:
                kwargs["base_url"] = os.environ.get(
                    "OPENDRSAI_MODEL_BASE_URL",
                    "https://ai-dev.ihep.ac.cn/apiv2/v1",
                )
            if not kwargs.get("api_key"):
                if not self._allow_deferred_oidc:
                    raise RuntimeError(
                        "The configured model provider API credential is unavailable; "
                        "enter the provider API Key again in Model Settings."
                    )
                # The desktop gateway supplies a request-scoped OIDC token.
                # OpenAI validates credentials during construction, before the
                # request scope may reach an agent created in a worker thread.
                # Use a non-secret sentinel only to defer SDK validation; it is
                # replaced by _bind_platform_auth before any provider call.
                kwargs["api_key"] = "opendrsai-oidc-pending"
                self._oidc_credential_pending = True
                self._uses_platform_auth = True

        if "model_info" not in kwargs:
            model_info: Optional[HepAIModelInfo] ={
                "vision": False,
                "function_calling": False,  # You must sure that the model can handle function calling
                "json_output": False,
                "structured_output": False,
                "family": ModelFamily.UNKNOWN,
                "multiple_system_messages":False,
                "token_model": "gpt-4o-2024-11-20", # Default model for token counting
            }
            kwargs["model_info"] = model_info
        self.r1_series = [
            "aliyun/qwen-turbo-latest",
            "aliyun/qwen3-30b-a3b",
            "aliyun/qwen3-235b-a22b",
            "aliyun/qwq-plus-latest",
            "anthropic/claude-sonnet-4-thinking",
            "anthropic/claude-opus-4-thinking",
            "deepseek-ai/deepseek-r1:671b",
            "deepseek-ai/deepseek-r1:32b",
            "deepseek-ai/deepseek-r1:7b",

        ]
        self.v3_series = [
            "aliyun/qwen-max-latest",
            "aliyun/qwen-coder-plus-latest",
            "aliyun/qwen-long-latest",
            "openai/o1-mini",
            "openai/computer-use-preview",
            "anthropic/claude-sonnet-4",
            "anthropic/claude-3-5-haiku",
            "anthropic/claude-opus-4",
            "deepseek-ai/deepseek-v3:671b"

        ]

        self.vsion_series = [
            "aliyun/qwen-vl-max-latest",
            "aliyun/qwen-vl-ocr-latest",
            "aliyun/qvq-max-latest",
            "aliyun/qwen2.5-vl-32b-instruct",
            "aliyun/qwen2.5-vl-72b-instruct",
            "openai/o3",
            "openai/o4-mini-deep-research",
            "openai/gpt-4.1-nano",
            "openai/o4-mini",
            "openai/o1",
            "openai/gpt-4o-mini",
            "openai/codex-mini-latest",
            "openai/gpt-4o-audio-preview",
            "openai/gpt-4.1-mini",
            "openai/gpt-image-1",
            "openai/gpt-4o",
            "openai/gpt-4.1",
            "anthropic/claude-sonnet-4",
            "anthropic/claude-sonnet-4-thinking",
            "anthropic/claude-opus-4-thinking",
            "anthropic/claude-3-5-haiku",
            "anthropic/claude-opus-4",
            "ark/doubao-vision-pro",
        ]

        allowed_models = [
        # openai_models
        "gpt-41",
        "gpt-45",
        "gpt-4o",
        "o1",
        "o3",
        "o4",
        "gpt-4",
        "gpt-35",
        "r1",
        # google_models
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-2.5-pro",
        # anthropic_models
        "claude-3-haiku",
        "claude-3-sonnet",
        "claude-3-opus",
        "claude-3-5-haiku",
        "claude-3-5-sonnet",
        "claude-3-7-sonnet",
        # mistral_models
        "codestral",
        "open-codestral-mamba",
        "mistral",
        "ministral",
        "pixtral",
        # unknown
        "unknown"
        ]

        hepai_allowed_models = [
            "aliyun/",
            "openai/",
            "anthropic/",
            "ark/",
            "deepseek-ai/",
            "hepai/",
        ]
        model = kwargs.get("model", "")
        all_allowed_models = allowed_models+hepai_allowed_models
        for allowed_model in all_allowed_models:
            if allowed_model in model.lower():
                if allowed_model in hepai_allowed_models:
                    if model in self.r1_series:
                        kwargs["model_info"]["family"] = ModelFamily.R1
                    elif model in self.v3_series:
                        kwargs["model_info"]["family"] = ModelFamily.GPT_4O
                else:
                    kwargs["model_info"]["family"] = allowed_model
                
                if model in self.vsion_series:
                    kwargs["model_info"]["vision"] = True
                
                kwargs["model_info"]["function_calling"] = True
                kwargs["model_info"]["json_output"] = True
                kwargs["model_info"]["structured_output"] = True
                break

        super().__init__(**kwargs)
        # AutoGen clones this client from _raw_config for local subagents.
        # Keep the transport choice there so clones do not silently fall back
        # to Chat Completions.
        self._raw_config["use_responses_api"] = self._use_responses_api
        self._raw_config["allow_deferred_oidc"] = self._allow_deferred_oidc

    def _to_config(self) -> HepAIClientConfigurationConfigModel:
        return HepAIClientConfigurationConfigModel(**self._raw_config)

    def _bind_platform_auth(self) -> None:
        if not getattr(self, "_uses_platform_auth", True) and not getattr(self, "_oidc_credential_pending", False):
            return
        credential = get_model_credential_provider()
        if not credential:
            if getattr(self, "_oidc_credential_pending", False):
                raise RuntimeError("OIDC credential context is unavailable for this model request.")
            return
        self._client.api_key = credential.access_token
        self._client.base_url = credential.openai_base_url
        self._oidc_credential_pending = False

    async def create(self, *args: Any, **kwargs: Any):
        self._bind_platform_auth()
        if self._use_responses_api:
            result = None
            async for item in self.create_stream(*args, **kwargs):
                if isinstance(item, CreateResult):
                    result = item
            if result is None:
                raise RuntimeError("Responses API returned no final result.")
            return result
        return await super().create(*args, **kwargs)
    
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
        """Create a stream of string chunks from the model ending with a :class:`~autogen_core.models.CreateResult`.

        Extends :meth:`autogen_core.models.ChatCompletionClient.create_stream` to support OpenAI API.

        In streaming, the default behaviour is not return token usage counts.
        See: `OpenAI API reference for possible args <https://platform.openai.com/docs/api-reference/chat/create>`_.

        You can set `extra_create_args={"stream_options": {"include_usage": True}}`
        (if supported by the accessed API) to
        return a final chunk with usage set to a :class:`~autogen_core.models.RequestUsage` object
        with prompt and completion token counts,
        all preceding chunks will have usage as `None`.
        See: `OpenAI API reference for stream options <https://platform.openai.com/docs/api-reference/chat/create#chat-create-stream_options>`_.

        Other examples of supported arguments that can be included in `extra_create_args`:
            - `temperature` (float): Controls the randomness of the output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more focused and deterministic.
            - `max_tokens` (int): The maximum number of tokens to generate in the completion.
            - `top_p` (float): An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass.
            - `frequency_penalty` (float): A value between -2.0 and 2.0 that penalizes new tokens based on their existing frequency in the text so far, decreasing the likelihood of repeated phrases.
            - `presence_penalty` (float): A value between -2.0 and 2.0 that penalizes new tokens based on whether they appear in the text so far, encouraging the model to talk about new topics.
        """

        self._bind_platform_auth()

        if self._use_responses_api:
            responses_emitted = False
            try:
                async for item in self._create_responses_stream(
                    messages,
                    tools=tools,
                    json_output=json_output,
                    extra_create_args=extra_create_args,
                    cancellation_token=cancellation_token,
                ):
                    responses_emitted = True
                    yield item
                return
            except Exception as exc:
                # Unified OpenAI routing prefers Responses. A configured
                # compatibility endpoint may still expose only Chat
                # Completions, so fall back solely for a clean endpoint-level
                # rejection before any output; authentication, quota, model,
                # and mid-stream failures must remain visible to the caller.
                if responses_emitted or getattr(exc, "status_code", None) not in {404, 405, 501}:
                    raise
                logger.info("Responses endpoint unavailable; using Chat Completions compatibility route.")

        create_params = self._process_create_args(
            messages,
            tools,
            json_output,
            extra_create_args,
        )

        # DeepSeek V4 fix: add reasoning_content field to assistant messages
        # This is required for multi-turn + tool call scenarios
        model_name = create_params.create_args.get("model", "")
        if "deepseek-v4" in model_name.lower():
            # logger.info(f"[DeepSeek V4 Fix] Model: {model_name}, processing {len(messages)} LLM messages -> {len(create_params.messages)} OpenAI messages")

            # Extract reasoning_content from all AssistantMessage in original messages
            # For DeepSeek V4: thought field contains the reasoning content (with <think> tags)
            assistant_reasoning_contents = []
            for idx, llm_msg in enumerate(messages):
                # Check if this is an AssistantMessage
                if llm_msg.__class__.__name__ == "AssistantMessage":
                    reasoning_content = ""
                    # Extract reasoning_content from thought field (remove <think> tags)
                    if hasattr(llm_msg, "thought") and llm_msg.thought:
                        thought = llm_msg.thought
                        # Remove <think> and </think> tags
                        reasoning_content = thought.replace("<think>", "").replace("</think>", "").strip()
                    # if reasoning_content:
                    #     logger.info(f"[DeepSeek V4 Fix] Extracted reasoning_content from thought in message {idx}, length: {len(reasoning_content)}")
                    assistant_reasoning_contents.append(reasoning_content)

            # Now add reasoning_content to all assistant messages in OpenAI format
            # Match by position (nth assistant message in OpenAI messages corresponds to nth AssistantMessage)
            assistant_idx = 0
            for oai_idx, oai_msg in enumerate(create_params.messages):
                if oai_msg.get("role") == "assistant":
                    if assistant_idx < len(assistant_reasoning_contents):
                        reasoning_content = assistant_reasoning_contents[assistant_idx]
                    else:
                        reasoning_content = ""

                    oai_msg["reasoning_content"] = reasoning_content

                    # if reasoning_content:
                    #     logger.info(f"[DeepSeek V4 Fix] Added reasoning_content to OpenAI message {oai_idx} (assistant #{assistant_idx}): {reasoning_content[:100]}...")
                    # else:
                    #     logger.info(f"[DeepSeek V4 Fix] Added empty reasoning_content to OpenAI message {oai_idx} (assistant #{assistant_idx})")

                    assistant_idx += 1

        # # # TODO: we should remove tool_calls?
        # new_oai_messages = []
        # for message in create_params.messages:
        #     # if message.get("role") == "tool":
        #         # message["role"] = "assistant"
        #         # message.pop("tool_call_id")
        #         # continue
        #     if message.get("tool_calls") is not None:
        #         # tool_calls = message.pop("tool_calls")
        #         # if message.get("content") is None:
        #         #     message["content"] = ""
        #         # message["content"] += str(tool_calls)
        #         tool_call_messages = []
        #         # content = message.get("content")
        #         # role = "tool"
        #         tool_calls = message.get("tool_calls")
        #         for tool_call in tool_calls:
        #             tool_call_id = tool_call.get("id")
        #             tool_call_messages.append(
        #                 {
        #                     "role": "tool",
        #                     "tool_call_id": tool_call_id,
        #                     "content": str(tool_call),
        #                 }
        #             )

        #     new_oai_messages.append(message)
        # create_params.messages = new_oai_messages

        if max_consecutive_empty_chunk_tolerance != 0:
            warnings.warn(
                "The 'max_consecutive_empty_chunk_tolerance' parameter is deprecated and will be removed in the future releases. All of empty chunks will be skipped with a warning.",
                DeprecationWarning,
                stacklevel=2,
            )

        if create_params.response_format is not None:
            chunks = self._create_stream_chunks_beta_client(
                tool_params=create_params.tools,
                oai_messages=create_params.messages,
                response_format=create_params.response_format,
                create_args_no_response_format=create_params.create_args,
                cancellation_token=cancellation_token,
            )
        else:
            chunks = self._create_stream_chunks(
                tool_params=create_params.tools,
                oai_messages=create_params.messages,
                create_args=create_params.create_args,
                cancellation_token=cancellation_token,
            )

        # Prepare data to process streaming chunks.
        chunk: ChatCompletionChunk | None = None
        stop_reason = None
        maybe_model = None
        content_deltas: List[str] = []
        thought_deltas: List[str] = []
        full_tool_calls: Dict[int, FunctionCall] = {}
        logprobs: Optional[List[ChatCompletionTokenLogprob]] = None

        empty_chunk_warning_has_been_issued: bool = False
        empty_chunk_warning_threshold: int = 10
        empty_chunk_count = 0
        first_chunk = True
        is_reasoning = False

        # Process the stream of chunks.
        async for chunk in chunks:
            if first_chunk:
                first_chunk = False
                # Emit the start event.
                logger.info(
                    LLMStreamStartEvent(
                        messages=cast(List[Dict[str, Any]], create_params.messages),
                    )
                )

            # Set the model from the lastest chunk.
            maybe_model = chunk.model

            # Empty chunks has been observed when the endpoint is under heavy load.
            #  https://github.com/microsoft/autogen/issues/4213
            if len(chunk.choices) == 0:
                empty_chunk_count += 1
                if not empty_chunk_warning_has_been_issued and empty_chunk_count >= empty_chunk_warning_threshold:
                    empty_chunk_warning_has_been_issued = True
                    warnings.warn(
                        f"Received more than {empty_chunk_warning_threshold} consecutive empty chunks. Empty chunks are being ignored.",
                        stacklevel=2,
                    )
                continue
            else:
                empty_chunk_count = 0

            if len(chunk.choices) > 1:
                # This is a multi-choice chunk, we need to warn the user.
                warnings.warn(
                    f"Received a chunk with {len(chunk.choices)} choices. Only the first choice will be used.",
                    UserWarning,
                    stacklevel=2,
                )

            # Set the choice to the first choice in the chunk.
            choice = chunk.choices[0]

            # for liteLLM chunk usage, do the following hack keeping the pervious chunk.stop_reason (if set).
            # set the stop_reason for the usage chunk to the prior stop_reason
            stop_reason = choice.finish_reason if chunk.usage is None and stop_reason is None else stop_reason
            maybe_model = chunk.model

            reasoning_content: str | None = None
            if choice.delta:
                if choice.delta.model_extra is not None and "reasoning_content" in choice.delta.model_extra:
                    # If there is a reasoning_content field, then we populate the thought field. This is for models such as R1.
                    reasoning_content = choice.delta.model_extra.get("reasoning_content")

                if isinstance(reasoning_content, str) and len(reasoning_content) > 0:
                    if not is_reasoning:
                        # Enter reasoning mode.
                        reasoning_content = "<think>" + reasoning_content
                        is_reasoning = True
                    thought_deltas.append(reasoning_content)
                    yield reasoning_content
                elif is_reasoning:
                    # Exit reasoning mode.
                    reasoning_content = "</think>"
                    thought_deltas.append(reasoning_content)
                    is_reasoning = False
                    yield reasoning_content

                # First try get content
                if choice.delta.content:
                    content_deltas.append(choice.delta.content)
                    if len(choice.delta.content) > 0:
                        yield choice.delta.content
                    # NOTE: for OpenAI, tool_calls and content are mutually exclusive it seems, so we can skip the rest of the loop.
                    # However, this may not be the case for other APIs -- we should expect this may need to be updated.
                    continue
                # Otherwise, get tool calls
                if choice.delta.tool_calls is not None:
                    for tool_call_chunk in choice.delta.tool_calls:
                        idx = tool_call_chunk.index
                        if idx not in full_tool_calls:
                            # We ignore the type hint here because we want to fill in type when the delta provides it
                            full_tool_calls[idx] = FunctionCall(id="", arguments="", name="")

                        if tool_call_chunk.id is not None:
                            full_tool_calls[idx].id += tool_call_chunk.id

                        if tool_call_chunk.function is not None:
                            if tool_call_chunk.function.name is not None:
                                full_tool_calls[idx].name += tool_call_chunk.function.name
                            if tool_call_chunk.function.arguments is not None:
                                full_tool_calls[idx].arguments += tool_call_chunk.function.arguments
                if choice.logprobs and choice.logprobs.content:
                    logprobs = [
                        ChatCompletionTokenLogprob(
                            token=x.token,
                            logprob=x.logprob,
                            top_logprobs=[TopLogprob(logprob=y.logprob, bytes=y.bytes) for y in x.top_logprobs],
                            bytes=x.bytes,
                        )
                        for x in choice.logprobs.content
                    ]

        # Finalize the CreateResult.

        # TODO: can we remove this?
        if stop_reason == "function_call":
            raise ValueError("Function calls are not supported in this context")

        # We need to get the model from the last chunk, if available.
        model = maybe_model or create_params.create_args["model"]
        model = model.replace("gpt-35", "gpt-3.5")  # hack for Azure API

        # Because the usage chunk is not guaranteed to be the last chunk, we need to check if it is available.
        if chunk and chunk.usage:
            prompt_tokens = chunk.usage.prompt_tokens
            completion_tokens = chunk.usage.completion_tokens
        else:
            prompt_tokens = 0
            completion_tokens = 0
        usage = RequestUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

        # Detect whether it is a function call or just text.
        content: Union[str, List[FunctionCall]]
        thought: str | None = None
        # Determine the content and thought based on what was collected
        if full_tool_calls:
            # This is a tool call response
            content = list(full_tool_calls.values())
            if thought_deltas:
                thought = "".join(thought_deltas).lstrip("<think>").rstrip("</think>")
            else:
                # Store any text alongside tool calls as thoughts.
                # Normalize empty text to None so it is not serialized as an
                # empty Anthropic text block when switching providers.
                thought = "".join(content_deltas)
            if isinstance(thought, str) and not thought.strip():
                thought = None
        else:
            # This is a text response (possibly with thoughts)
            if content_deltas:
                content = "".join(content_deltas)
            else:
                warnings.warn(
                    "No text content or tool calls are available. Model returned empty result.",
                    stacklevel=2,
                )
                content = ""

            # Set thoughts if we have any reasoning content.
            if thought_deltas:
                thought = "".join(thought_deltas).lstrip("<think>").rstrip("</think>")

            # This is for local R1 models whose reasoning content is within the content string.
            if isinstance(content, str) and self._model_info["family"] == ModelFamily.R1 and thought is None:
                thought, content = parse_r1_content(content)

        # Create the result.
        # For DeepSeek V4: thought already contains the reasoning_content
        result = CreateResult(
            finish_reason=normalize_stop_reason(stop_reason),
            content=content,
            usage=usage,
            cached=False,
            logprobs=logprobs,
            thought=thought,
        )

        # Log the end of the stream.
        logger.info(
            LLMStreamEndEvent(
                response=result.model_dump(),
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
            )
        )

        # Update the total usage.
        self._total_usage = _add_usage(self._total_usage, usage)
        self._actual_usage = _add_usage(self._actual_usage, usage)

        # Yield the CreateResult.
        yield result

    async def _create_responses_stream(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema],
        json_output: Optional[bool | type[BaseModel]],
        extra_create_args: Mapping[str, Any],
        cancellation_token: Optional[CancellationToken],
    ) -> AsyncGenerator[Union[str, CreateResult], None]:
        """Adapt AutoGen's chat model contract to OpenAI's Responses API."""
        create_params = self._process_create_args(messages, tools, json_output, extra_create_args)
        request = self._responses_request(create_params)
        import asyncio

        stream_future = asyncio.ensure_future(self._client.responses.create(**request, stream=True))
        if cancellation_token is not None:
            cancellation_token.link_future(stream_future)
        stream = await stream_future

        content_deltas: list[str] = []
        thought_deltas: list[str] = []
        function_calls: dict[str, FunctionCall] = {}
        function_order: list[str] = []
        usage = RequestUsage(prompt_tokens=0, completion_tokens=0)
        finish_reason = "stop"

        logger.info(LLMStreamStartEvent(messages=cast(List[Dict[str, Any]], create_params.messages)))
        async for event in stream:
            event_type = getattr(event, "type", "")
            if event_type == "response.output_text.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    content_deltas.append(delta)
                    yield delta
            elif event_type in {"response.reasoning_summary_text.delta", "response.reasoning_text.delta"}:
                delta = getattr(event, "delta", "")
                if delta:
                    thought_deltas.append(delta)
            elif event_type == "response.output_item.added":
                item = getattr(event, "item", None)
                if getattr(item, "type", "") == "function_call":
                    key = getattr(item, "id", None) or getattr(item, "call_id", None) or str(getattr(event, "output_index", len(function_order)))
                    function_calls[key] = FunctionCall(
                        id=getattr(item, "call_id", None) or getattr(item, "id", ""),
                        name=getattr(item, "name", ""),
                        arguments=getattr(item, "arguments", "") or "",
                    )
                    function_order.append(key)
            elif event_type == "response.function_call_arguments.delta":
                key = getattr(event, "item_id", None)
                call = function_calls.get(key)
                if call is None and function_order:
                    call = function_calls[function_order[-1]]
                if call is not None:
                    call.arguments += getattr(event, "delta", "") or ""
            elif event_type == "response.completed":
                response = getattr(event, "response", None)
                for item in getattr(response, "output", None) or []:
                    if getattr(item, "type", "") != "function_call":
                        continue
                    key = getattr(item, "id", None) or getattr(item, "call_id", None)
                    if key not in function_calls:
                        function_calls[key] = FunctionCall(
                            id=getattr(item, "call_id", None) or getattr(item, "id", ""),
                            name=getattr(item, "name", ""),
                            arguments=getattr(item, "arguments", "") or "",
                        )
                        function_order.append(key)
                    else:
                        function_calls[key].arguments = getattr(item, "arguments", "") or function_calls[key].arguments
                response_usage = getattr(response, "usage", None)
                if response_usage is not None:
                    usage = RequestUsage(
                        prompt_tokens=getattr(response_usage, "input_tokens", 0) or 0,
                        completion_tokens=getattr(response_usage, "output_tokens", 0) or 0,
                    )
                if getattr(response, "status", None) == "incomplete":
                    finish_reason = "length"

        content: Union[str, List[FunctionCall]]
        thought = "".join(thought_deltas) or None
        if function_calls:
            content = [function_calls[key] for key in function_order]
            if content_deltas and thought is None:
                thought = "".join(content_deltas)
        else:
            content = "".join(content_deltas)
        result = CreateResult(
            finish_reason=normalize_stop_reason(finish_reason),
            content=content,
            usage=usage,
            cached=False,
            thought=thought,
        )
        logger.info(LLMStreamEndEvent(
            response=result.model_dump(),
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
        ))
        self._total_usage = _add_usage(self._total_usage, usage)
        self._actual_usage = _add_usage(self._actual_usage, usage)
        yield result

    @staticmethod
    def _responses_request(create_params: Any) -> dict[str, Any]:
        def response_content(content: Any) -> Any:
            if not isinstance(content, list):
                return content or ""
            converted = []
            for part in content:
                if not isinstance(part, dict):
                    converted.append(part)
                elif part.get("type") == "text":
                    converted.append({"type": "input_text", "text": part.get("text", "")})
                elif part.get("type") == "image_url":
                    image = part.get("image_url", {})
                    converted.append({
                        "type": "input_image",
                        "image_url": image.get("url", "") if isinstance(image, dict) else image,
                        **({"detail": image["detail"]} if isinstance(image, dict) and image.get("detail") else {}),
                    })
                else:
                    converted.append(part)
            return converted

        input_items: list[dict[str, Any]] = []
        for message in create_params.messages:
            role = message.get("role")
            if role == "tool":
                input_items.append({
                    "type": "function_call_output",
                    "call_id": message.get("tool_call_id", ""),
                    "output": message.get("content", "") or "",
                })
                continue
            if role == "assistant" and message.get("tool_calls"):
                if message.get("content"):
                    input_items.append({"role": "assistant", "content": response_content(message["content"])})
                for call in message["tool_calls"]:
                    function = call.get("function", {})
                    input_items.append({
                        "type": "function_call",
                        "call_id": call.get("id", ""),
                        "name": function.get("name", ""),
                        "arguments": function.get("arguments", ""),
                    })
                continue
            item = {"role": role, "content": response_content(message.get("content", ""))}
            input_items.append(item)

        response_tools = []
        for tool in create_params.tools or []:
            function = tool.get("function", tool)
            response_tools.append({
                "type": "function",
                "name": function.get("name", ""),
                "description": function.get("description", ""),
                "parameters": function.get("parameters", {}),
                **({"strict": function["strict"]} if "strict" in function else {}),
            })

        request = dict(create_params.create_args)
        request.pop("stream", None)
        request.pop("stream_options", None)
        request.pop("n", None)
        configured_response_format = request.pop("response_format", None)
        if "max_tokens" in request:
            request["max_output_tokens"] = request.pop("max_tokens")
        if "max_completion_tokens" in request:
            request["max_output_tokens"] = request.pop("max_completion_tokens")
        if "reasoning_effort" in request:
            request["reasoning"] = {"effort": request.pop("reasoning_effort")}
        request["input"] = input_items
        if response_tools:
            request["tools"] = response_tools
        schema = create_params.response_format or configured_response_format
        if schema is not None:
            if isinstance(schema, dict):
                if schema.get("type") == "json_schema" and isinstance(schema.get("json_schema"), dict):
                    response_format = {"type": "json_schema", **schema["json_schema"]}
                else:
                    response_format = schema
            elif isinstance(schema, BaseModel):
                response_format = schema.model_dump(exclude_none=True)
            else:
                response_format = {
                    "type": "json_schema",
                    "name": schema.__name__,
                    "schema": schema.model_json_schema(),
                    "strict": True,
                }
            request["text"] = {"format": response_format}
        return request
    
    def count_tokens(self, messages: Sequence[LLMMessage], *, tools: Sequence[Tool | ToolSchema] = []) -> int:

    
        model_name = self._model_info.get("token_model")
        if model_name is None:
            raise ValueError(f"Maybe you can provide a token_model with in {_MODEL_TOKEN_LIMITS} when provide the model_info")

        return count_tokens_openai(
            messages,
            model_name,
            add_name_prefixes=self._add_name_prefixes,
            tools=tools,
            model_family=self._model_info["family"],
        )

    def remaining_tokens(
            self, 
            messages: Sequence[LLMMessage], 
            *, 
            tools: Sequence[Tool | ToolSchema] = [],
            token_limit: int | None = None,
            ) -> int:
        model_name = self._model_info.get("token_model")
        if model_name is None:
            raise ValueError(f"Maybe you can provide a token_model with in {_MODEL_TOKEN_LIMITS} when provide the model_info")
        
        if token_limit is None:
            token_limit = _model_info.get_token_limit(model_name)
        return token_limit - self.count_tokens(messages, tools=tools)
