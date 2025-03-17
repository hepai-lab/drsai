from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_ext.models.openai._openai_client import (
    convert_tools, 
    _add_usage,
    to_oai_type,
    create_kwargs
    )
from autogen_ext.models.openai.config import OpenAIClientConfiguration
from autogen_core.models import ModelFamily

from typing_extensions import Unpack
import os

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

from autogen_core import (
    CancellationToken,
    FunctionCall,
    Image
)
from autogen_core.models import (
    ChatCompletionTokenLogprob,
    CreateResult,
    LLMMessage,
    ModelFamily,
    RequestUsage,
    TopLogprob,
    UserMessage
)
from autogen_core.tools import Tool, ToolSchema
from openai.types.chat import (
    ParsedChoice

)
from openai.types.chat.chat_completion import Choice
from openai.types.chat.chat_completion_chunk import Choice as ChunkChoice
from pydantic import BaseModel

from autogen_ext.models._utils.normalize_stop_reason import normalize_stop_reason
from autogen_ext.models._utils.parse_r1_content import parse_r1_content

class HepAIChatCompletionClient(OpenAIChatCompletionClient):

    def __init__(self, **kwargs: Unpack[OpenAIClientConfiguration]):

        if "api_key" not in kwargs:
            kwargs["api_key"] = os.environ.get("HEPAI_API_KEY")
        if "base_url" not in kwargs:
            kwargs["base_url"] = "https://aiapi.ihep.ac.cn/apiv2"

        if "model_info" not in kwargs:
            model_info={
                "vision": False,
                "function_calling": False,  # You must sure that the model can handle function calling
                "json_output": False,
                "family": ModelFamily.UNKNOWN,
            }
            kwargs["model_info"] = model_info
        allowed_models = [
        "gpt-4o",
        "o1",
        "o3",
        "gpt-4",
        "gpt-35",
        "r1",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "claude-3-haiku",
        "claude-3-sonnet",
        "claude-3-opus",
        "claude-3.5-haiku",
        "claude-3.5-sonnet"]
        for allowed_model in allowed_models:
            model = kwargs.get("model", "")
            if allowed_model in model.lower():
                kwargs["model_info"]["family"] = allowed_model
                kwargs["model_info"]["function_calling"] = True
                break

        super().__init__(**kwargs)
    
    async def create_stream(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        json_output: Optional[bool] = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: Optional[CancellationToken] = None,
        max_consecutive_empty_chunk_tolerance: int = 0,
    ) -> AsyncGenerator[Union[str, CreateResult], None]:
        """
        Creates an AsyncGenerator that will yield a  stream of chat completions based on the provided messages and tools.

        Args:
            messages (Sequence[LLMMessage]): A sequence of messages to be processed.
            tools (Sequence[Tool | ToolSchema], optional): A sequence of tools to be used in the completion. Defaults to `[]`.
            json_output (Optional[bool], optional): If True, the output will be in JSON format. Defaults to None.
            extra_create_args (Mapping[str, Any], optional): Additional arguments for the creation process. Default to `{}`.
            cancellation_token (Optional[CancellationToken], optional): A token to cancel the operation. Defaults to None.
            max_consecutive_empty_chunk_tolerance (int): [Deprecated] The maximum number of consecutive empty chunks to tolerate before raising a ValueError. This seems to only be needed to set when using `AzureOpenAIChatCompletionClient`. Defaults to 0. This parameter is deprecated, empty chunks will be skipped.

        Yields:
            AsyncGenerator[Union[str, CreateResult], None]: A generator yielding the completion results as they are produced.

        In streaming, the default behaviour is not return token usage counts. See: [OpenAI API reference for possible args](https://platform.openai.com/docs/api-reference/chat/create).
        However `extra_create_args={"stream_options": {"include_usage": True}}` will (if supported by the accessed API)
        return a final chunk with usage set to a RequestUsage object having prompt and completion token counts,
        all preceding chunks will have usage as None. See: [stream_options](https://platform.openai.com/docs/api-reference/chat/create#chat-create-stream_options).

        Other examples of OPENAI supported arguments that can be included in `extra_create_args`:
            - `temperature` (float): Controls the randomness of the output. Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more focused and deterministic.
            - `max_tokens` (int): The maximum number of tokens to generate in the completion.
            - `top_p` (float): An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass.
            - `frequency_penalty` (float): A value between -2.0 and 2.0 that penalizes new tokens based on their existing frequency in the text so far, decreasing the likelihood of repeated phrases.
            - `presence_penalty` (float): A value between -2.0 and 2.0 that penalizes new tokens based on whether they appear in the text so far, encouraging the model to talk about new topics.
        """
        # Make sure all extra_create_args are valid
        extra_create_args_keys = set(extra_create_args.keys())
        if not create_kwargs.issuperset(extra_create_args_keys):
            raise ValueError(f"Extra create args are invalid: {extra_create_args_keys - create_kwargs}")

        # Copy the create args and overwrite anything in extra_create_args
        create_args = self._create_args.copy()
        create_args.update(extra_create_args)

        # Declare use_beta_client
        use_beta_client: bool = False
        response_format_value: Optional[Type[BaseModel]] = None

        if "response_format" in create_args:
            value = create_args["response_format"]
            # If value is a Pydantic model class, use the beta client
            if isinstance(value, type) and issubclass(value, BaseModel):
                response_format_value = value
                use_beta_client = True
            else:
                # response_format_value is not a Pydantic model class
                use_beta_client = False
                response_format_value = None

        # Remove 'response_format' from create_args to prevent passing it twice
        create_args_no_response_format = {k: v for k, v in create_args.items() if k != "response_format"}

        # TODO: allow custom handling.
        # For now we raise an error if images are present and vision is not supported
        if self.model_info["vision"] is False:
            for message in messages:
                if isinstance(message, UserMessage):
                    if isinstance(message.content, list) and any(isinstance(x, Image) for x in message.content):
                        raise ValueError("Model does not support vision and image was provided")

        if json_output is not None:
            if self.model_info["json_output"] is False and json_output is True:
                raise ValueError("Model does not support JSON output")

            if json_output is True:
                create_args["response_format"] = {"type": "json_object"}
            else:
                create_args["response_format"] = {"type": "text"}

        oai_messages_nested = [to_oai_type(m, prepend_name=self._add_name_prefixes) for m in messages]
        oai_messages = [item for sublist in oai_messages_nested for item in sublist]

        if self.model_info["function_calling"] is False and len(tools) > 0:
            raise ValueError("Model does not support function calling")

        if max_consecutive_empty_chunk_tolerance != 0:
            warnings.warn(
                "The 'max_consecutive_empty_chunk_tolerance' parameter is deprecated and will be removed in the future releases. All of empty chunks will be skipped with a warning.",
                DeprecationWarning,
                stacklevel=2,
            )

        tool_params = convert_tools(tools)

        # Get the async generator of chunks.
        if use_beta_client:
            chunks = self._create_stream_chunks_beta_client(
                tool_params=tool_params,
                oai_messages=oai_messages,
                response_format=response_format_value,
                create_args_no_response_format=create_args_no_response_format,
                cancellation_token=cancellation_token,
            )
        else:
            chunks = self._create_stream_chunks(
                tool_params=tool_params,
                oai_messages=oai_messages,
                create_args=create_args,
                cancellation_token=cancellation_token,
            )

        # Prepare data to process streaming chunks.
        choice: Union[ParsedChoice[Any], ParsedChoice[BaseModel], ChunkChoice] = cast(ChunkChoice, None)
        chunk = None
        stop_reason = None
        maybe_model = None
        content_deltas: List[str] = []
        full_tool_calls: Dict[int, FunctionCall] = {}
        completion_tokens = 0
        logprobs: Optional[List[ChatCompletionTokenLogprob]] = None

        empty_chunk_warning_has_been_issued: bool = False
        empty_chunk_warning_threshold: int = 10
        empty_chunk_count = 0

        # Process the stream of chunks.

        think_flag = False
        async for chunk in chunks:
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

            # to process usage chunk in streaming situations
            # add    stream_options={"include_usage": True} in the initialization of OpenAIChatCompletionClient(...)
            # However the different api's
            # OPENAI api usage chunk produces no choices so need to check if there is a choice
            # liteLLM api usage chunk does produce choices
            choice = (
                chunk.choices[0]
                if len(chunk.choices) > 0
                else choice
                if chunk.usage is not None and stop_reason is not None
                else cast(ChunkChoice, None)
            )

            # for liteLLM chunk usage, do the following hack keeping the pervious chunk.stop_reason (if set).
            # set the stop_reason for the usage chunk to the prior stop_reason
            stop_reason = choice.finish_reason if chunk.usage is None and stop_reason is None else stop_reason
            maybe_model = chunk.model
            # First try get content
            if choice.delta.model_extra: # 获取火山引擎的回答
                think: str|None = choice.delta.model_extra.get("reasoning_content")
                if think:
                    if not think_flag:
                        yield "<think>\n"
                        content_deltas.append("<think>\n")
                        think_flag = True
                    content_deltas.append(think)
                    yield think
                continue
            elif choice.delta.content:
                if think_flag:
                    content_deltas.append("</think>\n")
                    yield "</think>\n"
                    think_flag = False
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
        model = maybe_model or create_args["model"]
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
        if full_tool_calls:
            # This is a tool call.
            content = list(full_tool_calls.values())
            if len(content_deltas) > 1:
                # Put additional text content in the thought field.
                thought = "".join(content_deltas)
        elif len(content_deltas) > 0:
            # This is a text-only content.
            content = "".join(content_deltas)
        else:
            warnings.warn("No text content or tool calls are available. Model returned empty result.", stacklevel=2)
            content = ""

        # Parse R1 content if needed.
        if isinstance(content, str) and self._model_info["family"] == ModelFamily.R1:
            thought, content = parse_r1_content(content)

        # Create the result.
        result = CreateResult(
            finish_reason=normalize_stop_reason(stop_reason),
            content=content,
            usage=usage,
            cached=False,
            logprobs=logprobs,
            thought=thought,
        )

        # Update the total usage.
        self._total_usage = _add_usage(self._total_usage, usage)
        self._actual_usage = _add_usage(self._actual_usage, usage)

        # Yield the CreateResult.
        yield result
