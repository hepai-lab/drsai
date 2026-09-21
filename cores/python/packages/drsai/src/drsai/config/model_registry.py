"""Versioned capabilities for common built-in models.

This module is the bridge between the old system (``DEFAULT_LLM_MODE_CONFIG``
in ``model_defaults.py``) and the new system (``ModelCapabilities`` /
``ReasoningCapabilities`` in ``schema.py``).

``BUILTIN_MODELS`` is now **auto-generated** from ``DEFAULT_LLM_MODE_CONFIG``
via ``_build_builtin_models()``. To add or modify a model, edit
``DEFAULT_LLM_MODE_CONFIG`` in ``model_defaults.py`` — this file will pick up
the change automatically.

Import safety: ``model_defaults`` is a leaf module (no ``drsai.config`` or
``drsai.backend`` imports), so importing it here does NOT create a circular
dependency.
"""

from __future__ import annotations

from typing import Final

from .model_defaults import DEFAULT_LLM_MODE_CONFIG, ModelEntry
from .schema import ModelCapabilities, ReasoningCapabilities


def _model_entry_to_capabilities(entry: ModelEntry) -> ModelCapabilities:
    """Convert an old-system ``ModelEntry`` to a new-system ``ModelCapabilities``."""

    return ModelCapabilities(
        token_limit=entry.token_limit,
        max_tokens=entry.max_tokens if entry.max_tokens > 0 else 8_192,
        vision=entry.vision,
        function_calling=True,
        json_output=True,
        structured_output=False,
        token_model="gpt-4o-2024-11-20",
        reasoning=ReasoningCapabilities(
            supported=entry.reasoning.supported,
            effort_levels=tuple(entry.reasoning.effort_levels),
            param_type=entry.reasoning.param_type,
        ),
    )


def _build_builtin_models() -> dict[str, ModelCapabilities]:
    """Build the BUILTIN_MODELS registry from ``DEFAULT_LLM_MODE_CONFIG``.

    Each alias in the config is registered under both its alias key and its
    model-name suffix (the part after the ``/``), so ``find_model_capabilities``
    can resolve models referenced either way.
    """

    result: dict[str, ModelCapabilities] = {}
    for alias, entry in DEFAULT_LLM_MODE_CONFIG.items():
        caps = _model_entry_to_capabilities(entry)
        result[alias] = caps
        # Also register under the model-name suffix (e.g. "claude-sonnet-4-6"
        # from "anthropic/claude-sonnet-4-6") if it differs from the alias.
        if "/" in entry.model:
            suffix = entry.model.split("/", 1)[1]
            if suffix not in result:
                result[suffix] = caps
    return result


BUILTIN_MODELS: Final[dict[str, ModelCapabilities]] = _build_builtin_models()


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
