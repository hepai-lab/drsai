"""Stable defaults for the compact user configuration."""

from __future__ import annotations

from collections.abc import Mapping

from drsai.platform_upstream import (
    resolve_hepai_anthropic_base_url,
    resolve_hepai_model_base_url,
)

from .model_defaults import DEFAULT_CONFIG_NAME

# Unified default model: ``DEFAULT_MODEL`` is the single source of truth for
# the desktop bootstrap, resolver, and agent policy.  It mirrors
# ``DEFAULT_CONFIG_NAME`` from ``model_defaults.py`` so that the model catalog,
# config.toml, and Agent TOML all agree on the same default.
DEFAULT_MODEL = DEFAULT_CONFIG_NAME
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
