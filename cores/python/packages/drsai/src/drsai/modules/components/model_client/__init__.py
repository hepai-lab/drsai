from .LLMClient import HepAIChatCompletionClient
from .anthropic import HepAIAnthropicChatCompletionClient

from autogen_core.models._model_client import (
    ChatCompletionClient,
    ModelCapabilities,  # type: ignore
    # ModelFamily,
    ModelInfo,
    validate_model_info,
)

from ._model_client import (
    ModelFamily,
)
from ._trace_log_filters import suppress_token_estimator_schema_warnings

from autogen_core.models._types import (
    AssistantMessage,
    ChatCompletionTokenLogprob,
    CreateResult,
    FinishReasons,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    RequestUsage,
    SystemMessage,
    TopLogprob,
    UserMessage,
)

from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_ext.models.anthropic import AnthropicChatCompletionClient, AnthropicBedrockClientConfiguration
# from autogen_ext.models.azure import AzureAIChatCompletionClient, AzureAIChatCompletionClientConfig
# from autogen_ext.models.llama_cpp import LlamaCppChatCompletionClient

# Import-time so it holds for every entry point that can reach a client's
# ``count_tokens`` (Desktop Runtime, CLI, daemon, hot-reloaded uvicorn).
suppress_token_estimator_schema_warnings()
# from autogen_ext.models.semantic_kernel import SKChatCompletionAdapter
# from autogen_ext.models.llama_cpp import LlamaCppChatCompletionClient