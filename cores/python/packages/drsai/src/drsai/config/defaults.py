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
# Providers whose ``models_file`` is a *product-owned* catalog: OpenDrSai ships
# and regenerates it on every bootstrap, so a model the product removes there
# disappears, and a model it adds appears.
#
# Every other Provider's ``models_file`` is still user-owned: it exists because
# the user created the Provider, so its entries stay editable and must never be
# reported as product-owned.
PRODUCT_PROVIDER_IDS: frozenset[str] = frozenset({DEFAULT_PROVIDER})


def provider_models_file(provider_name: str) -> str:
    """Relative path of a Provider's catalog file below the config directory.

    For a Provider in :data:`PRODUCT_PROVIDER_IDS` this is the *product-owned*
    file: OpenDrSai regenerates it as a whole on every bootstrap, so it is not
    a place for user edits. For every other Provider it is simply the file the
    user's own Provider definition points at.
    """
    return f"configs/models/provider_{provider_name}.toml"


def provider_user_models_file(provider_name: str) -> str:
    """Relative path of a Provider's *user-owned* overlay catalog.

    OpenDrSai never regenerates or rewrites this file: it only ever writes it
    when the user explicitly adds a model, so a user's own models survive every
    product catalog update.
    """
    return f"configs/models/provider_{provider_name}.local.toml"


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
