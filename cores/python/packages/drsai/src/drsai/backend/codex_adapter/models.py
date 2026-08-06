"""Stable Codex model/list capability mapping."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
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


class CodexModelCatalog:
    def __init__(self, client: CodexJSONRPCClient):
        self.client = client
        self.models: dict[str, CodexModelCapability] = {}
        self.generation: int | None = None
        self.last_successful_at: str | None = None
        self.last_error: str | None = None
        self._refresh_lock = asyncio.Lock()

    async def refresh(self, *, generation: int | None = None, force: bool = False) -> Mapping[str, CodexModelCapability]:
        async with self._refresh_lock:
            if not force and generation is not None and self.is_current(generation):
                return dict(self.models)
            try:
                result = await self.client.request("model/list", {"includeHidden": True})
            except RuntimeExecutionError as exc:
                self.last_error = exc.code
                raise
            if not isinstance(result, Mapping):
                self.last_error = "codex_model_list_invalid"
                raise RuntimeExecutionError("codex_model_list_invalid", "Codex model/list returned an invalid response.")
            values: Sequence[Any] | None = None
            for key in ("data", "models", "items"):
                candidate = result.get(key)
                if isinstance(candidate, list):
                    values = candidate
                    break
            if values is None:
                self.last_error = "codex_model_list_invalid"
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
                )
            if not parsed:
                self.last_error = "codex_model_list_invalid"
                raise RuntimeExecutionError("codex_model_list_invalid", "Codex model/list contained no usable models.")
            self.models = parsed
            self.generation = generation
            self.last_successful_at = datetime.now(timezone.utc).isoformat()
            self.last_error = None
            return dict(parsed)

    def is_current(self, generation: int) -> bool:
        return bool(self.models) and self.generation == generation and self.last_error is None

    def select(self, requested_model: str) -> CodexModelCapability:
        if not requested_model:
            defaults = [item for item in self.models.values() if item.is_default and not item.hidden]
            if len(defaults) == 1:
                return defaults[0]
            raise RuntimeExecutionError("codex_model_required", "Codex did not provide one unambiguous default model.")
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

    def capability(self, *, current_generation: int | None = None) -> Mapping[str, Any]:
        """Return only the reviewed, backend-neutral model fields."""
        return {
            "generation": self.generation,
            "stale": current_generation is not None and not self.is_current(current_generation),
            "last_successful_at": self.last_successful_at,
            "error": self.last_error,
            "default_model": next((item.model_id for item in self.models.values()
                                   if item.is_default and not item.hidden), None),
            "models": [
                {
                    "id": item.model_id,
                    "display_name": item.display_name or item.model_id,
                    "default": item.is_default,
                    "hidden": item.hidden,
                    "reasoning_efforts": list(item.reasoning_efforts),
                    "modalities": list(item.input_modalities),
                }
                for item in self.models.values()
            ],
        }
