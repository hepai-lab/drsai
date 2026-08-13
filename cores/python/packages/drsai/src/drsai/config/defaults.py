"""Stable defaults for the compact user configuration."""

from __future__ import annotations

from collections.abc import Mapping

from drsai.platform_upstream import (
    resolve_hepai_anthropic_base_url,
    resolve_hepai_model_base_url,
)

DEFAULT_MODEL = "deepseek-v4-flash"
DEFAULT_PROVIDER = "hepai"


def hepai_openai_base_url(environ: Mapping[str, str] | None = None) -> str:
    """Resolve the HepAI model upstream from the selected desktop platform."""
    return resolve_hepai_model_base_url(environ)


def hepai_anthropic_base_url(environ: Mapping[str, str] | None = None) -> str:
    return resolve_hepai_anthropic_base_url(environ)


DEFAULT_OPENAI_BASE_URL = hepai_openai_base_url()
DEFAULT_ANTHROPIC_BASE_URL = hepai_anthropic_base_url()
CURRENT_CONFIG_VERSION = 3
DEFAULT_AGENT = "opendrsai"
DEFAULT_AGENT_CONFIG_FILE = "configs/agents/agent_opendrsai.toml"
