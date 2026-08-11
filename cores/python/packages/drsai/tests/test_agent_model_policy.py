from __future__ import annotations

import json

import pytest

from drsai.config.agent_model_policy import (
    AgentModelPolicyConflict,
    commit_agent_model_policy,
    load_agent_model_policy,
)
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef


def test_missing_policy_inherits_provider_default(tmp_path) -> None:
    snapshot = load_agent_model_policy("my-drsai", path=tmp_path / "policies.json")
    assert snapshot.policy.primary_model.mode == "inherit_provider_default"
    assert snapshot.policy.primary_model.ref is None
    assert snapshot.revision.startswith("sha256:")


def test_policy_persists_provider_aware_ref_and_revision(tmp_path) -> None:
    path = tmp_path / "policies.json"
    initial = load_agent_model_policy("my-drsai", path=path)
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=AgentModelSelection("explicit", ModelRef("provider-b", "same-model")),
    )
    committed = commit_agent_model_policy(policy, expected_revision=initial.revision, path=path)
    loaded = load_agent_model_policy("my-drsai", path=path)
    assert loaded == committed
    assert loaded.policy.primary_model.ref == ModelRef("provider-b", "same-model")
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["policies"]["my-drsai"]["primary_model"]["ref"] == {
        "provider_id": "provider-b", "model_id": "same-model",
    }


def test_policy_persists_capability_model_bindings(tmp_path) -> None:
    path = tmp_path / "policies.json"
    initial = load_agent_model_policy("my-drsai", path=path)
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=AgentModelSelection("explicit", ModelRef("provider-a", "chat")),
        image_understanding_model=AgentModelSelection("explicit", ModelRef("provider-a", "vision")),
        image_generation_model=AgentModelSelection("explicit", ModelRef("provider-b", "image")),
        text_to_speech_model=AgentModelSelection("explicit", ModelRef("provider-b", "tts")),
        speech_to_text_model=AgentModelSelection("explicit", ModelRef("provider-b", "stt")),
        reasoning_effort="max",
    )

    commit_agent_model_policy(policy, expected_revision=initial.revision, path=path)
    loaded = load_agent_model_policy("my-drsai", path=path).policy
    assert loaded.image_understanding_model.ref == ModelRef("provider-a", "vision")
    assert loaded.image_generation_model.ref == ModelRef("provider-b", "image")
    assert loaded.text_to_speech_model.ref == ModelRef("provider-b", "tts")
    assert loaded.speech_to_text_model.ref == ModelRef("provider-b", "stt")
    assert loaded.reasoning_effort == "max"
    document = json.loads(path.read_text(encoding="utf-8"))["policies"]["my-drsai"]
    assert "image_model" not in document
    assert document["image_generation_model"]["ref"]["model_id"] == "image"
    assert document["reasoning_effort"] == "max"


def test_policy_persists_disabled_thinking_mode(tmp_path) -> None:
    path = tmp_path / "policies.json"
    initial = load_agent_model_policy("my-drsai", path=path)
    policy = AgentModelPolicy(agent_id="my-drsai", reasoning_effort="none")

    commit_agent_model_policy(policy, expected_revision=initial.revision, path=path)

    loaded = load_agent_model_policy("my-drsai", path=path).policy
    assert loaded.reasoning_effort == "none"
    document = json.loads(path.read_text(encoding="utf-8"))["policies"]["my-drsai"]
    assert document["reasoning_effort"] == "none"


def test_legacy_image_model_is_loaded_as_image_generation_model(tmp_path) -> None:
    path = tmp_path / "policies.json"
    path.write_text(json.dumps({
        "schema_version": 1,
        "policies": {
            "my-drsai": {
                "primary_model": {"mode": "inherit_provider_default", "ref": None},
                "image_model": {
                    "mode": "explicit",
                    "ref": {"provider_id": "provider-a", "model_id": "legacy-image"},
                },
            },
        },
    }), encoding="utf-8")

    policy = load_agent_model_policy("my-drsai", path=path).policy
    assert policy.image_generation_model.ref == ModelRef("provider-a", "legacy-image")


def test_policy_revision_conflict_does_not_overwrite(tmp_path) -> None:
    path = tmp_path / "policies.json"
    initial = load_agent_model_policy("my-drsai", path=path)
    first = AgentModelPolicy("my-drsai", AgentModelSelection("explicit", ModelRef("provider-a", "model-a")))
    second = AgentModelPolicy("my-drsai", AgentModelSelection("explicit", ModelRef("provider-b", "model-b")))
    commit_agent_model_policy(first, expected_revision=initial.revision, path=path)
    with pytest.raises(AgentModelPolicyConflict):
        commit_agent_model_policy(second, expected_revision=initial.revision, path=path)
    assert load_agent_model_policy("my-drsai", path=path).policy == first


def test_corrupted_policy_store_fails_closed(tmp_path) -> None:
    path = tmp_path / "policies.json"
    path.write_text('{"schema_version": 1, "policies": {"my-drsai": {"primary_model": {"mode": "explicit"}}}}', encoding="utf-8")
    with pytest.raises(Exception, match="requires a ref"):
        load_agent_model_policy("my-drsai", path=path)
