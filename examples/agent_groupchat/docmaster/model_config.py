"""
Model configuration for DocMaster agent.

This module provides model client factory and configuration constants.
"""

import hashlib
import json
import logging
import os
from collections import Counter
from typing import Any, Mapping, Sequence

from autogen_core import TRACE_LOGGER_NAME
from autogen_core.tools import Tool, ToolSchema
from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO,
)


_SCHEMA_FIELDS_OF_INTEREST = {
    "anyOf", "oneOf", "allOf", "items", "additionalProperties", "default", "$ref", "$defs"
}

# Temporary development routing: ai-dev accepts the JWT forwarded by the
# remote-agent entrypoints, while the production aiapi deployment does not yet
# support that authentication flow. Keep an environment override so deployment
# can switch back without another source change.
MODEL_BASE_URL = os.environ.get(
    "DOCMASTER_MODEL_BASE_URL",
    "https://ai-dev.ihep.ac.cn/apiv2/v1",
).rstrip("/")


class _TokenEstimatorSchemaWarningFilter(logging.Filter):
    """Hide misleading warnings emitted only by AutoGen's token estimator.

    AutoGen's OpenAI token estimator warns for every property-schema key it
    cannot price.  The request converter does not remove those keys; emitting
    the warnings made them look like provider compatibility failures.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return not str(record.getMessage()).startswith("Not supported field ")


def _install_token_estimator_warning_filter() -> None:
    trace_logger = logging.getLogger(TRACE_LOGGER_NAME)
    if not any(isinstance(item, _TokenEstimatorSchemaWarningFilter) for item in trace_logger.filters):
        trace_logger.addFilter(_TokenEstimatorSchemaWarningFilter())


def summarize_tool_schemas(tools: Sequence[Tool | ToolSchema | Mapping[str, Any]]) -> dict[str, Any]:
    """Return a content-free summary of the schemas sent to chat completions."""
    field_counts: Counter[str] = Counter()
    per_tool: list[dict[str, Any]] = []
    canonical_tools: list[Mapping[str, Any]] = []

    def count_fields(value: Any, depth: int = 0) -> int:
        max_depth = depth
        if isinstance(value, Mapping):
            for key, child in value.items():
                if key in _SCHEMA_FIELDS_OF_INTEREST:
                    field_counts[key] += 1
                max_depth = max(max_depth, count_fields(child, depth + 1))
        elif isinstance(value, list):
            for child in value:
                max_depth = max(max_depth, count_fields(child, depth + 1))
        return max_depth

    for tool in tools:
        schema = tool.schema if isinstance(tool, Tool) else tool
        if not isinstance(schema, Mapping):
            continue
        canonical_tools.append(schema)
        parameters = schema.get("parameters", {})
        encoded = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        per_tool.append({
            "name": str(schema.get("name", "")),
            "schema_bytes": len(encoded),
            "parameter_count": len(parameters.get("properties", {})) if isinstance(parameters, Mapping) else 0,
            "max_depth": count_fields(parameters),
        })

    canonical = json.dumps(canonical_tools, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "tool_count": len(per_tool),
        "schema_bytes": len(canonical),
        "schema_sha256": hashlib.sha256(canonical).hexdigest()[:16],
        "field_counts": dict(sorted(field_counts.items())),
        "largest_tools": sorted(per_tool, key=lambda item: item["schema_bytes"], reverse=True)[:10],
    }


class DiagnosticHepAIChatCompletionClient(HepAIChatCompletionClient):
    """HepAI client that logs a redacted summary of the actual tool payload."""

    _last_tool_schema_fingerprint: str | None = None

    def _process_create_args(self, messages, tools, json_output, extra_create_args):
        params = super()._process_create_args(messages, tools, json_output, extra_create_args)
        summary = summarize_tool_schemas(tools)
        fingerprint = summary["schema_sha256"]
        if fingerprint != self._last_tool_schema_fingerprint:
            logging.getLogger(__name__).info(
                "DocMaster chat/completions tool schema summary: %s",
                json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            )
            self._last_tool_schema_fingerprint = fingerprint
        return params


_install_token_estimator_warning_filter()


# LLM mode configuration - maps friendly names to model identifiers
LLM_MODE_CONFIG = {
    "minimax-m2.7": "hepai/minimax-m2.7",
    "minimax-m2.7-highspeed": "hepai/minimax-m2.7-highspeed",
    "deepseek-v4-pro": "hepai/deepseek-v4-pro",
    "deepseek-v4-flash": "deepseek-v4-flash",
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
            base_url=f"{MODEL_BASE_URL.removesuffix('/v1')}/anthropic",
            api_key=api_key or os.environ.get("HEPAI_API_KEY"),
            model_info=_MODEL_INFO.get("claude-sonnet-4-5", _MODEL_INFO["claude-sonnet-4-5"]),
            max_tokens=32000,
            temperature=0.3,
            timeout=120.0,
            max_retries=2,
        )
    else:
        # deepseek-v4-flash and qwen3_30b use OpenAI-compatible API
        return DiagnosticHepAIChatCompletionClient(
            model=llm_model,
            api_key=api_key or os.environ.get("HEPAI_API_KEY"),
            base_url=MODEL_BASE_URL,
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
    return DiagnosticHepAIChatCompletionClient(
        model="deepseek-v4-flash",
        api_key=api_key or os.environ.get("HEPAI_API_KEY"),
        base_url=MODEL_BASE_URL,
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
        1. Use deepseek-v4-flash by default
        2. Try the remaining configured models if client creation fails
        3. Fall back to a direct deepseek-v4-flash client
    """
    # Keep the default model identifier unprefixed: the upstream API expects
    # ``deepseek-v4-flash``, not ``hepai/deepseek-v4-flash``.
    if default_config_name is None:
        default_config_name = "deepseek-v4-flash"

    # List of models to try in order, with the requested default first.
    models_to_try = [
        "deepseek-v4-flash",         # Default
        "deepseek-v4-pro",           # Fallback
        "minimax-m2.7-highspeed",    # Fallback
        "minimax-m2.7",              # Standard minimax fallback
        "qwen3_30b",                  # Small-prompt fallback only
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
