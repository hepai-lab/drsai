"""Stable defaults for the compact user configuration."""

from __future__ import annotations

from collections.abc import Mapping

from drsai.platform_upstream import (
    resolve_ddf_api_base_url,
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
    """Resolve the HepAI model upstream from the DDF platform base URL.

    ``resolve_hepai_model_base_url`` already incorporates ``OPENDRSAI_DDF_API_BASE_URL``
    as its second-priority override (DDF and Model share the same gateway),
    satisfying the requirement that DDF_API_BASE_URL participates in model
    client construction.  We keep it (rather than ``resolve_ddf_api_base_url``)
    because the model endpoint needs an extra ``/v1`` suffix in development.
    """
    return resolve_hepai_model_base_url(environ)


def hepai_anthropic_base_url(environ: Mapping[str, str] | None = None) -> str:
    return resolve_hepai_anthropic_base_url(environ)


DEFAULT_OPENAI_BASE_URL = hepai_openai_base_url()
DEFAULT_ANTHROPIC_BASE_URL = hepai_anthropic_base_url()
CURRENT_CONFIG_VERSION = 3
DEFAULT_AGENT = "opendrsai"
DEFAULT_AGENT_CONFIG_FILE = "configs/agents/agent_opendrsai.toml"
