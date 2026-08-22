"""Built-in provider definitions that users should not need to repeat."""

from __future__ import annotations

from typing import Final

from .defaults import DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_OPENAI_BASE_URL

BUILTIN_PROVIDERS: Final[dict[str, dict[str, object]]] = {
    "hepai": {
        "base_url": DEFAULT_OPENAI_BASE_URL,
        "wire_api": "openai",
        "requires_api_key": True,
        "api_key_env": "HEPAI_API_KEY",
    },
    "hepai-anthropic": {
        "base_url": DEFAULT_ANTHROPIC_BASE_URL,
        "wire_api": "anthropic",
        "requires_api_key": True,
        "api_key_env": "HEPAI_API_KEY",
    },
}


def builtin_provider_names() -> tuple[str, ...]:
    return tuple(sorted(BUILTIN_PROVIDERS))
