from __future__ import annotations

import pytest

from drsai.config.model_catalog import (
    AgentModelPolicy,
    AgentModelSelection,
    ModelDescriptor,
    ModelRef,
    build_runtime_model_catalog,
)
from drsai.config.schema import ModelCapabilities


def descriptor(provider: str, model: str, **overrides) -> ModelDescriptor:
    values = {
        "ref": ModelRef(provider, model),
        "display_name": model,
        "input_modalities": ("text",),
        "output_modalities": ("text",),
        "operations": ("chat", "tool_calling"),
        "availability": "available",
        "capability_source": "provider",
        "capability_confidence": "verified",
    }
    values.update(overrides)
    return ModelDescriptor(**values)


def test_provider_and_model_form_canonical_identity() -> None:
    catalog = build_runtime_model_catalog([
        descriptor("provider-a", "shared-model"),
        descriptor("provider-b", "shared-model"),
    ])
    assert [(item.ref.provider_id, item.ref.model_id) for item in catalog.models] == [
        ("provider-a", "shared-model"),
        ("provider-b", "shared-model"),
    ]


def test_catalog_revision_is_deterministic_and_semantic() -> None:
    first = descriptor("provider", "model", updated_at="2026-08-05T00:00:00Z")
    same = descriptor("provider", "model", updated_at="2026-08-06T00:00:00Z")
    assert build_runtime_model_catalog([first]).revision == build_runtime_model_catalog([same]).revision
    unavailable = descriptor("provider", "model", availability="offline")
    assert build_runtime_model_catalog([first]).revision != build_runtime_model_catalog([unavailable]).revision


def test_capability_provenance_precedence_is_explicit() -> None:
    builtin = descriptor("provider", "model", capability_source="builtin", capability_confidence="inferred")
    provider = descriptor("provider", "model", display_name="Provider model")
    user = descriptor("provider", "model", display_name="User override", capability_source="user_override", capability_confidence="declared")
    assert build_runtime_model_catalog([user, builtin, provider]).models[0].display_name == "User override"
    with pytest.raises(ValueError, match="conflicting model descriptors"):
        build_runtime_model_catalog([provider, descriptor("provider", "model", display_name="Conflict")])


@pytest.mark.parametrize("kwargs", [
    {"operations": ("image_generation",), "output_modalities": ("text",)},
    {"operations": ("image_edit",), "input_modalities": ("text",), "output_modalities": ("image",)},
    {"operations": ("tool_calling",)},
    {"operations": ("reasoning",), "reasoning_efforts": ("high",)},
])
def test_invalid_capability_combinations_fail_closed(kwargs) -> None:
    with pytest.raises(ValueError):
        descriptor("provider", "model", **kwargs)


def test_unknown_models_have_no_implied_capabilities() -> None:
    capabilities = ModelCapabilities()
    assert capabilities.vision is False
    assert capabilities.function_calling is False
    assert capabilities.json_output is False
    with pytest.raises(ValueError, match="unknown model capabilities must be empty"):
        descriptor("provider", "unknown", capability_source="unknown")
    unknown = ModelDescriptor(
        ref=ModelRef("provider", "unknown"),
        display_name="Unknown",
        capability_source="unknown",
        capability_confidence="unknown",
    )
    assert unknown.operations == ()
    assert unknown.input_modalities == ()


def test_agent_policy_requires_unambiguous_explicit_ref() -> None:
    inherited = AgentModelPolicy(agent_id="my-drsai")
    assert inherited.primary_model.mode == "inherit_provider_default"
    explicit = AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=AgentModelSelection("explicit", ModelRef("hepai", "deepseek-v4-pro")),
    )
    assert explicit.primary_model.ref == ModelRef("hepai", "deepseek-v4-pro")
    with pytest.raises(ValueError, match="requires a ref"):
        AgentModelSelection("explicit")
