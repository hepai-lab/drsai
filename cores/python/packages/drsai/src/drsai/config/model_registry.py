"""Versioned capabilities for common built-in models."""

from __future__ import annotations

from typing import Final

from .schema import ModelCapabilities, ReasoningCapabilities

BUILTIN_MODELS: Final[dict[str, ModelCapabilities]] = {
    "gemini-3-flash-preview": ModelCapabilities(
        token_limit=1_000_000,
        max_tokens=64_000,
        vision=True,
        function_calling=True,
        json_output=True,
        token_model="gpt-4o-2024-11-20",
        reasoning=ReasoningCapabilities(
            supported=True,
            param_type="adaptive",
        ),
    ),
    "gpt-5.4": ModelCapabilities(
        token_limit=1_050_000,
        max_tokens=64_000,
        vision=True,
        function_calling=True,
        json_output=True,
        token_model="gpt-4o-2024-11-20",
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("none", "low", "medium", "high", "xhigh"),
            param_type="reasoning_effort",
        ),
    ),
    "deepseek-v4-pro": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
        function_calling=True,
        json_output=True,
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("none", "high", "max"),
            param_type="deepseek_reasoning_effort",
        ),
    ),
    "hepai/deepseek-v4-pro": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
        function_calling=True,
        json_output=True,
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("none", "high", "max"),
            param_type="deepseek_reasoning_effort",
        ),
    ),
    "deepseek-v4-flash": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
        function_calling=True,
        json_output=True,
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("none", "high", "max"),
            param_type="deepseek_reasoning_effort",
        ),
    ),
    # HepAI exposes the production deployment with this Provider-local ID.
    # It has the same reasoning contract as the canonical V4 Flash model.
    "deepseek-v4-flash-正式版": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
        function_calling=True,
        json_output=True,
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("none", "high", "max"),
            param_type="deepseek_reasoning_effort",
        ),
    ),
    "claude-sonnet-4-6": ModelCapabilities(
        token_limit=200_000,
        max_tokens=64_000,
        vision=True,
        function_calling=True,
        json_output=True,
        token_model="claude-3-5-sonnet-20240620",
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("low", "medium", "high"),
            param_type="adaptive",
        ),
    ),
}


def find_model_capabilities(model: str) -> tuple[ModelCapabilities, bool]:
    """Return registered capabilities, accepting an optional provider prefix."""

    direct = BUILTIN_MODELS.get(model)
    if direct is not None:
        return direct, True
    suffix = model.split("/", 1)[1] if "/" in model else model
    registered = BUILTIN_MODELS.get(suffix)
    if registered is not None:
        return registered, True
    # Provider deployments commonly append a release date or channel label
    # while retaining the canonical DeepSeek V4 Flash API contract.
    if suffix.lower().startswith("deepseek-v4-flash-"):
        return BUILTIN_MODELS["deepseek-v4-flash"], True
    return ModelCapabilities(), False
