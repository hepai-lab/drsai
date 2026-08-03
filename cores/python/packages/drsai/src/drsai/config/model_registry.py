"""Versioned capabilities for common built-in models."""

from __future__ import annotations

from typing import Final

from .schema import ModelCapabilities, ReasoningCapabilities

BUILTIN_MODELS: Final[dict[str, ModelCapabilities]] = {
    "deepseek-v4-pro": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("low", "medium", "high"),
            param_type="is_r1_model",
        ),
    ),
    "hepai/deepseek-v4-pro": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
        reasoning=ReasoningCapabilities(
            supported=True,
            effort_levels=("low", "medium", "high"),
            param_type="is_r1_model",
        ),
    ),
    "deepseek-v4-flash": ModelCapabilities(
        token_limit=1_048_576,
        max_tokens=64_000,
        vision=False,
    ),
    "claude-sonnet-4-6": ModelCapabilities(
        token_limit=200_000,
        max_tokens=64_000,
        vision=True,
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
    return ModelCapabilities(), False
