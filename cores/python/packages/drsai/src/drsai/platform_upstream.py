"""Canonical HepAI upstream selection shared by auth and model configuration."""

from __future__ import annotations

from collections.abc import Mapping
import os


DEVELOPMENT_OIDC_ISSUER = "https://ai-dev.ihep.ac.cn/api"
PRODUCTION_OIDC_ISSUER = "https://ai.ihep.ac.cn/api"
DEVELOPMENT_MODEL_BASE_URL = "https://ai-dev.ihep.ac.cn/apiv2/v1"
# Until the HAI production service is restored, even a legacy production
# issuer is routed to the development model service. New desktop OIDC sessions
# are issued by DEVELOPMENT_OIDC_ISSUER.
PRODUCTION_MODEL_BASE_URL = DEVELOPMENT_MODEL_BASE_URL


def resolve_hepai_model_base_url(
    environ: Mapping[str, str] | None = None,
    *,
    issuer: str | None = None,
) -> str:
    env = os.environ if environ is None else environ
    override = env.get("OPENDRSAI_MODEL_BASE_URL", "").strip().rstrip("/")
    if override:
        return override
    selected_issuer = (issuer or env.get("OPENDRSAI_OIDC_ISSUER", "")).strip().rstrip("/")
    if selected_issuer == DEVELOPMENT_OIDC_ISSUER:
        return DEVELOPMENT_MODEL_BASE_URL
    if selected_issuer == PRODUCTION_OIDC_ISSUER:
        return PRODUCTION_MODEL_BASE_URL
    if issuer:
        raise ValueError("unsupported_issuer")
    development = (
        env.get("OPENDRSAI_ACTIVE_PLATFORM", "").strip().lower() == "development"
        or env.get("OPENDRSAI_DESKTOP_DEV", "").strip() == "1"
    )
    return DEVELOPMENT_MODEL_BASE_URL if development else PRODUCTION_MODEL_BASE_URL


def resolve_hepai_anthropic_base_url(
    environ: Mapping[str, str] | None = None,
    *,
    issuer: str | None = None,
) -> str:
    return f"{resolve_hepai_model_base_url(environ, issuer=issuer).removesuffix('/v1')}/anthropic"
