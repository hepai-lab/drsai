"""
Model configuration for DocMaster agent.

This module provides model client factory and configuration constants.
"""

import os
from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO,
)


# LLM mode configuration - maps friendly names to model identifiers
LLM_MODE_CONFIG = {
    "minimax-m2.7": "hepai/minimax-m2.7",
    "minimax-m2.7-highspeed": "hepai/minimax-m2.7-highspeed",
    "deepseek-v4-pro": "hepai/deepseek-v4-pro",
    "deepseek-v4-flash(Fast)": "hepai/deepseek-v4-flash",
    "qwen3_30b": "hepai/qwen3_30b",
}


def _build_client(llm_model: str, model_name: str, api_key: str | None):
    """Build a model client for the specified model.

    Args:
        llm_model: The model identifier (e.g., "hepai/minimax-m2.7")
        model_name: The friendly name for logging
        api_key: HepAI API key

    Returns:
        HepAIChatCompletionClient or HepAIAnthropicChatCompletionClient instance

    Raises:
        Exception: If client creation fails
    """
    if llm_model.startswith("hepai/minimax"):
        # minimax models use Anthropic API
        return HepAIAnthropicChatCompletionClient(
            model=llm_model,
            base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
            api_key=api_key or os.environ.get("HEPAI_API_KEY"),
            model_info=_MODEL_INFO.get("claude-sonnet-4-5", _MODEL_INFO["claude-sonnet-4-5"]),
            max_tokens=32000,
            temperature=0.3,
            timeout=120.0,
            max_retries=2,
        )
    else:
        # deepseek-v4-flash and qwen3_30b use OpenAI-compatible API
        return HepAIChatCompletionClient(
            model=llm_model,
            api_key=api_key or os.environ.get("HEPAI_API_KEY"),
            base_url="https://aiapi.ihep.ac.cn/apiv2",
            model_info={
                "vision": False,
                "function_calling": True,
                "json_output": True,
                "structured_output": False,
                "family": ModelFamily.UNKNOWN,
                "multiple_system_messages": True,
                "token_model": "hepai/deepseek-v4-flash",
            },
            temperature=0.3,
            max_tokens=32000,
            timeout=120.0,
            max_retries=2,
        )


def _build_fallback_client(api_key: str | None):
    """Build a fallback model client (deepseek-v4-flash).

    Args:
        api_key: HepAI API key

    Returns:
        HepAIChatCompletionClient instance for deepseek-v4-flash
    """
    return HepAIChatCompletionClient(
        model="hepai/deepseek-v4-flash",
        api_key=api_key or os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        model_info={
            "vision": False,
            "function_calling": True,
            "json_output": True,
            "structured_output": False,
            "family": ModelFamily.UNKNOWN,
            "multiple_system_messages": True,
            "token_model": "hepai/deepseek-v4-flash",
        },
        temperature=0.3,
        max_tokens=32000,
        timeout=120.0,
        max_retries=2,
    )


def create_model_client(default_config_name: str | None = None, api_key: str | None = None):
    """Create a model client for DocMaster agent.

    Attempts to create a model client with the specified configuration,
    falling back to alternative models if the primary choice fails.

    Args:
        default_config_name: Friendly name of the model to try first
        api_key: HepAI API key (optional, will use HEPAI_API_KEY env var if not provided)

    Returns:
        HepAIChatCompletionClient or HepAIAnthropicChatCompletionClient instance

    Strategy:
        1. Try models in priority order (most-context-tolerant first)
        2. qwen3_30b / deepseek-v4-flash fail on large system prompts,
           so minimax models are prioritized
        3. Fall back to deepseek-v4-flash if all else fails
    """
    # Default to deepseek-v4-pro if not specified
    if default_config_name is None:
        default_config_name = "deepseek-v4-pro"

    # List of models to try in order (most-context-tolerant first).
    # qwen3_30b / deepseek-v4-flash fail (HTTP 503) on the large DocMaster
    # system prompt, so the minimax models lead.
    models_to_try = [
        "deepseek-v4-pro",           # Default - pro tier handles full system prompt
        "minimax-m2.7-highspeed",    # Fallback
        "minimax-m2.7",              # Standard minimax fallback
        "qwen3_30b",                  # Small-prompt fallback only
        "deepseek-v4-flash(Fast)",   # Small-prompt fallback only
    ]

    # If specified model is in the list, try it first
    if default_config_name in LLM_MODE_CONFIG:
        models_to_try.insert(0, default_config_name)

    # Remove duplicates while preserving order
    models_to_try = list(dict.fromkeys(models_to_try))

    # Try each model until one works
    for model_name in models_to_try:
        if model_name in LLM_MODE_CONFIG:
            llm_model = LLM_MODE_CONFIG[model_name]
            print(f"🔄 Trying model: {model_name} ({llm_model})")
            try:
                model_client = _build_client(llm_model, model_name, api_key)
                print(f"✅ Successfully created model client for {model_name}")
                return model_client
            except Exception as e:
                print(f"❌ Failed to create model client for {model_name}: {e}")
                continue

    # If all models fail, use fallback
    print(f"⚠️ Model not found in config, using fallback: deepseek-v4-flash")
    try:
        return _build_fallback_client(api_key)
    except Exception as e:
        print(f"❌ Failed to create fallback client: {e}")
        raise
