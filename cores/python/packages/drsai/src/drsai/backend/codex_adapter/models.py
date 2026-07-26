"""Stable Codex model/list capability mapping."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient


@dataclass(frozen=True)
class CodexModelCapability:
    model_id: str
    display_name: str | None
    reasoning_efforts: tuple[str, ...]
    input_modalities: tuple[str, ...]
    is_default: bool
    hidden: bool
    raw: Mapping[str, Any]


class CodexModelCatalog:
    def __init__(self, client: CodexJSONRPCClient):
        self.client = client
        self.models: dict[str, CodexModelCapability] = {}

    async def refresh(self) -> Mapping[str, CodexModelCapability]:
        result = await self.client.request("model/list", {"includeHidden": True})
        if not isinstance(result, Mapping):
            raise RuntimeExecutionError("codex_model_list_invalid", "Codex model/list returned an invalid response.")
        values: Sequence[Any] | None = None
        for key in ("data", "models", "items"):
            candidate = result.get(key)
            if isinstance(candidate, list):
                values = candidate
                break
        if values is None:
            raise RuntimeExecutionError("codex_model_list_invalid", "Codex model/list did not contain a model array.")
        parsed: dict[str, CodexModelCapability] = {}
        for value in values:
            if not isinstance(value, Mapping):
                continue
            identity = value.get("id") or value.get("model") or value.get("slug")
            if not isinstance(identity, str) or not identity:
                continue
            efforts = value.get("supportedReasoningEfforts") or value.get("reasoningEfforts") or []
            modalities = value.get("inputModalities") or []
            parsed[identity] = CodexModelCapability(
                model_id=identity,
                display_name=str(value["displayName"]) if value.get("displayName") else None,
                reasoning_efforts=tuple(str(item) for item in efforts if isinstance(item, str)),
                input_modalities=tuple(str(item) for item in modalities if isinstance(item, str)),
                is_default=bool(value.get("isDefault")),
                hidden=bool(value.get("hidden")),
                raw=dict(value),
            )
        if not parsed:
            raise RuntimeExecutionError("codex_model_list_invalid", "Codex model/list contained no usable models.")
        self.models = parsed
        return dict(parsed)

    def select(self, requested_model: str) -> CodexModelCapability:
        if not requested_model:
            raise RuntimeExecutionError("codex_model_required", "Agent Definition must select a Codex model explicitly.")
        model = self.models.get(requested_model)
        if model is None:
            defaults = [item.model_id for item in self.models.values() if item.is_default]
            raise RuntimeExecutionError(
                "codex_model_incompatible",
                f"Codex App Server does not support the requested model: {requested_model}",
                detail={"requested_model": requested_model, "available_models": sorted(self.models),
                        "server_defaults": sorted(defaults)},
            )
        return model
