"""No-persistence Provider draft validation and connectivity probes."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, Mapping

from drsai.platform_auth import get_model_credential_provider

from .connectivity import test_provider_connection
from .loader import parse_user_config
from .resolver import resolve_model_config


@dataclass(frozen=True)
class ProviderDraft:
    name: str
    base_url: str
    model: str
    wire_api: Literal["openai", "anthropic"] = "openai"
    requires_api_key: bool = True
    api_key: str | None = field(default=None, repr=False)
    api_key_env: str | None = None
    api_key_credential: str | None = None


async def probe_provider_draft(
    draft: ProviderDraft,
    *,
    mode: Literal["basic", "model"] = "basic",
    environ: Mapping[str, str] | None = None,
    timeout: float = 15.0,
) -> dict[str, object]:
    values: dict[str, object] = {
        "base_url": draft.base_url,
        "wire_api": draft.wire_api,
        "requires_api_key": draft.requires_api_key,
    }
    if draft.api_key is not None:
        values["api_key"] = draft.api_key
    if draft.api_key_env is not None:
        values["api_key_env"] = draft.api_key_env
    if draft.api_key_credential is not None:
        values["api_key_credential"] = draft.api_key_credential
    if draft.name == "hepai":
        credential = get_model_credential_provider(draft.api_key, draft.base_url)
        if credential is not None:
            # Match real HepAI model calls: an authenticated Desktop request uses
            # its request-scoped OIDC token and issuer-provided model endpoint.
            values["base_url"] = credential.openai_base_url
            values["api_key"] = credential.access_token
    config = parse_user_config({
        "model": draft.model,
        "model_provider": draft.name,
        "model_providers": {draft.name: values},
    })
    resolved = resolve_model_config(config, environ=os.environ if environ is None else environ)
    # Draft probes must never mutate the verification state of the saved
    # Provider, even when provider and model names happen to match.
    result = await test_provider_connection(resolved, timeout=timeout, mode=mode, record_history=False)
    return {
        **result,
        "persisted": False,
        "may_incur_cost": mode == "model",
    }
