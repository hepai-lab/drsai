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
# from autogen_ext.models.semantic_kernel import SKChatCompletionAdapter
# from autogen_ext.models.llama_cpp import LlamaCppChatCompletionClient