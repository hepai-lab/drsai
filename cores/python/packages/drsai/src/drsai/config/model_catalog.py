"""Canonical, provider-aware model catalog contracts for OpenDrSai Runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import re
from typing import Iterable, Literal

InputModality = Literal["text", "image", "audio", "video"]
OutputModality = Literal["text", "image", "audio", "video"]
ModelOperation = Literal["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"]
ModelAvailability = Literal["available", "configured_unverified", "unavailable", "stale", "offline", "unauthorized", "error"]
CapabilitySource = Literal["user_override", "provider", "builtin", "unknown"]
CapabilityConfidence = Literal["verified", "declared", "inferred", "unknown"]
CatalogState = Literal["fresh", "stale", "offline", "unauthorized", "error"]
ReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]

_IDENTITY_PATTERN = re.compile(r"^[^\s\x00-\x1f]{1,240}$")
_SOURCE_PRIORITY: dict[CapabilitySource, int] = {
    "unknown": 0,
    "builtin": 1,
    "provider": 2,
    "user_override": 3,
}


def _identity(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not _IDENTITY_PATTERN.fullmatch(value):
        raise ValueError(f"{field_name} is invalid")
    return value


@dataclass(frozen=True, order=True)
class ModelRef:
    provider_id: str
    model_id: str
    catalog_revision: str | None = field(default=None, compare=False)

    def __post_init__(self) -> None:
        _identity(self.provider_id, "provider_id")
        _identity(self.model_id, "model_id")
        if self.catalog_revision is not None and not re.fullmatch(r"sha256:[0-9a-f]{64}", self.catalog_revision):
            raise ValueError("catalog_revision is invalid")

    def public_dict(self, *, include_revision: bool = True) -> dict[str, object]:
        value: dict[str, object] = {"provider_id": self.provider_id, "model_id": self.model_id}
        if include_revision and self.catalog_revision is not None:
            value["catalog_revision"] = self.catalog_revision
        return value


@dataclass(frozen=True)
class ModelDescriptor:
    ref: ModelRef
    display_name: str
    input_modalities: tuple[InputModality, ...] = ()
    output_modalities: tuple[OutputModality, ...] = ()
    operations: tuple[ModelOperation, ...] = ()
    reasoning_efforts: tuple[ReasoningEffort, ...] = ()
    token_limit: int | None = None
    max_output_tokens: int | None = None
    availability: ModelAvailability = "configured_unverified"
    capability_source: CapabilitySource = "unknown"
    capability_confidence: CapabilityConfidence = "unknown"
    updated_at: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.display_name, str) or not self.display_name.strip() or len(self.display_name) > 240:
            raise ValueError("display_name is invalid")
        if len(set(self.input_modalities)) != len(self.input_modalities) or len(set(self.output_modalities)) != len(self.output_modalities):
            raise ValueError("model modalities must be unique")
        if len(set(self.operations)) != len(self.operations) or len(set(self.reasoning_efforts)) != len(self.reasoning_efforts):
            raise ValueError("model operations and reasoning efforts must be unique")
        if self.token_limit is not None and self.token_limit <= 0:
            raise ValueError("token_limit must be positive")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive")
        if self.max_output_tokens is not None and self.token_limit is not None and self.max_output_tokens > self.token_limit:
            raise ValueError("max_output_tokens cannot exceed token_limit")
        if "tool_calling" in self.operations and "chat" not in self.operations:
            raise ValueError("tool_calling requires chat")
        if "reasoning" in self.operations and "chat" not in self.operations:
            raise ValueError("reasoning requires chat")
        if self.reasoning_efforts and "reasoning" not in self.operations:
            raise ValueError("reasoning efforts require reasoning operation")
        if "image_generation" in self.operations and "image" not in self.output_modalities:
            raise ValueError("image_generation requires image output")
        if "image_edit" in self.operations and not ({"image"} <= set(self.input_modalities) and {"image"} <= set(self.output_modalities)):
            raise ValueError("image_edit requires image input and output")
        if "speech_to_text" in self.operations and not ("audio" in self.input_modalities and "text" in self.output_modalities):
            raise ValueError("speech_to_text requires audio input and text output")
        if "text_to_speech" in self.operations and not ("text" in self.input_modalities and "audio" in self.output_modalities):
            raise ValueError("text_to_speech requires text input and audio output")
        if "video_generation" in self.operations and "video" not in self.output_modalities:
            raise ValueError("video_generation requires video output")
        if self.capability_source == "unknown" and (self.input_modalities or self.output_modalities or self.operations or self.reasoning_efforts):
            raise ValueError("unknown model capabilities must be empty")

    def public_dict(self, *, for_revision: bool = False) -> dict[str, object]:
        value: dict[str, object] = {
            "ref": self.ref.public_dict(include_revision=False),
            "display_name": self.display_name.strip(),
            "input_modalities": list(self.input_modalities),
            "output_modalities": list(self.output_modalities),
            "operations": list(self.operations),
            "reasoning_efforts": list(self.reasoning_efforts),
            "token_limit": self.token_limit,
            "max_output_tokens": self.max_output_tokens,
            "availability": self.availability,
            "capability_source": self.capability_source,
            "capability_confidence": self.capability_confidence,
        }
        if not for_revision:
            value["updated_at"] = self.updated_at
        return value


@dataclass(frozen=True)
class AgentModelSelection:
    mode: Literal["inherit_provider_default", "explicit"]
    ref: ModelRef | None = None

    def __post_init__(self) -> None:
        if self.mode == "inherit_provider_default" and self.ref is not None:
            raise ValueError("inherited model selection cannot include a ref")
        if self.mode == "explicit" and self.ref is None:
            raise ValueError("explicit model selection requires a ref")


@dataclass(frozen=True)
class AgentModelPolicy:
    agent_id: str
    primary_model: AgentModelSelection = field(default_factory=lambda: AgentModelSelection("inherit_provider_default"))
    # Legacy image_model is read for backward compatibility and migrates to
    # image_generation_model on the next write.
    image_model: AgentModelSelection | None = None
    image_understanding_model: AgentModelSelection | None = None
    image_generation_model: AgentModelSelection | None = None
    text_to_speech_model: AgentModelSelection | None = None
    speech_to_text_model: AgentModelSelection | None = None
    reasoning_effort: ReasoningEffort | None = None
    expected_revision: str | None = None

    def __post_init__(self) -> None:
        _identity(self.agent_id, "agent_id")
        if self.expected_revision is not None and not re.fullmatch(r"sha256:[0-9a-f]{64}", self.expected_revision):
            raise ValueError("expected_revision is invalid")


@dataclass(frozen=True)
class RuntimeModelCatalog:
    models: tuple[ModelDescriptor, ...]
    revision: str
    state: CatalogState


def build_runtime_model_catalog(
    descriptors: Iterable[ModelDescriptor], *, state: CatalogState = "fresh",
) -> RuntimeModelCatalog:
    """Deduplicate only by provider+model and choose explicit provenance deterministically."""

    selected: dict[tuple[str, str], ModelDescriptor] = {}
    for descriptor in descriptors:
        key = (descriptor.ref.provider_id, descriptor.ref.model_id)
        current = selected.get(key)
        if current is None or _SOURCE_PRIORITY[descriptor.capability_source] > _SOURCE_PRIORITY[current.capability_source]:
            selected[key] = descriptor
        elif _SOURCE_PRIORITY[descriptor.capability_source] == _SOURCE_PRIORITY[current.capability_source]:
            left = json.dumps(descriptor.public_dict(for_revision=True), sort_keys=True, separators=(",", ":"))
            right = json.dumps(current.public_dict(for_revision=True), sort_keys=True, separators=(",", ":"))
            if left != right:
                raise ValueError(f"conflicting model descriptors for {key[0]}/{key[1]}")
    models = tuple(selected[key] for key in sorted(selected))
    canonical = {
        "state": state,
        "models": [model.public_dict(for_revision=True) for model in models],
    }
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return RuntimeModelCatalog(models=models, revision=f"sha256:{digest}", state=state)
