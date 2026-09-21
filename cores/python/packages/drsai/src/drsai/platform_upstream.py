"""Canonical HepAI upstream selection shared by auth and model configuration."""

from __future__ import annotations

from collections.abc import Mapping
import os


# ── OIDC (login / token / session — independent service) ──
DEVELOPMENT_OIDC_ISSUER = "https://ai-dev.ihep.ac.cn/api"
PRODUCTION_OIDC_ISSUER = "https://ai.ihep.ac.cn/api"

# ── Unified DDF platform base (all platform / DDF / model services) ──
DEVELOPMENT_PLATFORM_BASE_URL = "https://ai-dev.ihep.ac.cn"
PRODUCTION_PLATFORM_BASE_URL = "https://ddf.ihep.ac.cn"

# ── API path prefix ──
API_PATH_PREFIX = "/apiv2"

# ── Derived model URLs (backward-compatible constants) ──
DEVELOPMENT_MODEL_BASE_URL = f"{DEVELOPMENT_PLATFORM_BASE_URL}{API_PATH_PREFIX}/v1"
PRODUCTION_MODEL_BASE_URL = f"{PRODUCTION_PLATFORM_BASE_URL}{API_PATH_PREFIX}"


def _is_development(env: Mapping[str, str]) -> bool:
    """Check whether the active platform is development."""
    active = env.get("OPENDRSAI_ACTIVE_PLATFORM", "").strip().lower()
    return active == "development" or (
        not active and env.get("OPENDRSAI_DESKTOP_DEV", "").strip() == "1"
    )


def resolve_platform_base_url(
    environ: Mapping[str, str] | None = None,
) -> str:
    """Resolve the unified DDF platform base URL.

    This is the single source of truth for the DDF platform host. All other
    endpoints (platform API, DDF catalog, model API) are derived from it
    by appending ``API_PATH_PREFIX``.

    Priority:
      1. ``OPENDRSAI_PLATFORM_BASE_URL`` (explicit override)
      2. ``OPENDRSAI_ACTIVE_PLATFORM`` / ``OPENDRSAI_DESKTOP_DEV`` selection
      3. Built-in production / development defaults
    """
    env = os.environ if environ is None else environ
    explicit = env.get("OPENDRSAI_PLATFORM_BASE_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    return DEVELOPMENT_PLATFORM_BASE_URL if _is_development(env) else PRODUCTION_PLATFORM_BASE_URL


def resolve_platform_api_base_url(
    environ: Mapping[str, str] | None = None,
) -> str:
    """Resolve the platform API base URL, derived from the platform base."""
    env = os.environ if environ is None else environ
    override = env.get("OPENDRSAI_PLATFORM_API_BASE_URL", "").strip().rstrip("/")
    if override:
        return override
    return resolve_platform_base_url(env) + API_PATH_PREFIX


def resolve_ddf_api_base_url(
    environ: Mapping[str, str] | None = None,
) -> str:
    """Resolve the DDF Agent catalog API base URL, derived from the platform base."""
    env = os.environ if environ is None else environ
    override = env.get("OPENDRSAI_DDF_API_BASE_URL", "").strip().rstrip("/")
    if override:
        return override
    return resolve_platform_base_url(env) + API_PATH_PREFIX


def resolve_hepai_oidc_issuer(
    environ: Mapping[str, str] | None = None,
) -> str:
    """Resolve the HepAI OIDC issuer.

    OIDC is an independent service from the DDF platform. In production the
    OIDC issuer lives on ``ai.ihep.ac.cn`` while the DDF/model gateway lives
    on ``ddf.ihep.ac.cn`` — they must not be derived from each other.

    Priority:
      1. ``OPENDRSAI_OIDC_ISSUER`` / ``HAI_OIDC_ISSUER`` (explicit override)
      2. ``OPENDRSAI_ACTIVE_PLATFORM`` / ``OPENDRSAI_DESKTOP_DEV`` selection
      3. Built-in production / development defaults
    """
    env = os.environ if environ is None else environ
    explicit = (env.get("OPENDRSAI_OIDC_ISSUER") or env.get("HAI_OIDC_ISSUER") or "").strip().rstrip("/")
    if explicit:
        return explicit
    return DEVELOPMENT_OIDC_ISSUER if _is_development(env) else PRODUCTION_OIDC_ISSUER


def resolve_hepai_model_base_url(
    environ: Mapping[str, str] | None = None,
    *,
    issuer: str | None = None,
) -> str:
    """Resolve the HepAI model API base URL.

    The model gateway shares the same host as the DDF platform API. In
    production both are on ``ddf.ihep.ac.cn/apiv2``; in development the model
    endpoint has an extra ``/v1`` suffix for OpenAI-compatible routing.

    Priority:
      1. ``OPENDRSAI_MODEL_BASE_URL`` (explicit override)
      2. ``OPENDRSAI_DDF_API_BASE_URL`` (DDF override — DDF and model share a gateway)
      3. Derived from ``OPENDRSAI_PLATFORM_BASE_URL`` + ``API_PATH_PREFIX``
    """
    env = os.environ if environ is None else environ
    # 1. Explicit model override
    override = env.get("OPENDRSAI_MODEL_BASE_URL", "").strip().rstrip("/")
    if override:
        return override
    # 2. DDF override (DDF and model share the same gateway)
    ddf_override = env.get("OPENDRSAI_DDF_API_BASE_URL", "").strip().rstrip("/")
    if ddf_override:
        return ddf_override
    # 3. Derive from platform base
    base = resolve_platform_base_url(env)
    if _is_development(env):
        return f"{base}{API_PATH_PREFIX}/v1"
    return f"{base}{API_PATH_PREFIX}"


def resolve_hepai_anthropic_base_url(
    environ: Mapping[str, str] | None = None,
    *,
    issuer: str | None = None,
) -> str:
    """Resolve the Anthropic-compatible base URL derived from the model base."""
    return f"{resolve_hepai_model_base_url(environ, issuer=issuer).removesuffix('/v1')}/anthropic"
