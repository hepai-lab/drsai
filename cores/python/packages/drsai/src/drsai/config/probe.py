"""No-persistence Provider draft validation and connectivity probes."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, Mapping

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
    config = parse_user_config({
        "model": draft.model,
        "model_provider": draft.name,
        "model_providers": {draft.name: values},
    })
    resolved = resolve_model_config(config, environ=os.environ if environ is None else environ)
    result = await test_provider_connection(resolved, timeout=timeout, mode=mode)
    return {
        **result,
        "persisted": False,
        "may_incur_cost": mode == "model",
    }
