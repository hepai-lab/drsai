from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from drsai.backend import gateway
from drsai.config.agent_model_policy import AgentModelPolicyConflict
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef


def config():
    return parse_user_config({
        "model": "same", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {"base_url": "https://a.example/v1", "requires_api_key": False, "models": ["same"]},
            "provider-b": {"base_url": "https://b.example/v1", "requires_api_key": False, "models": ["same"]},
        },
    })


def test_agent_policy_get_requires_explicit_primary_model(monkeypatch) -> None:
    policy = AgentModelPolicy("my-drsai")
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _agent_id: SimpleNamespace(policy=policy, revision="sha256:" + "a" * 64))
    monkeypatch.setattr(gateway, "load_model_provider_config", config)
    result = asyncio.run(gateway.get_agent_model_policy("my-drsai"))
    assert result["primary_model"] == {"mode": "explicit", "ref": None}
    assert result["effective_ref"] is None
    assert result["valid"] is False
    assert "no primary model" in result["error"]


def test_agent_policy_put_persists_exact_provider_ref(monkeypatch) -> None:
    captured = []
    monkeypatch.setattr(gateway, "load_model_provider_config", config)
    monkeypatch.setattr(
        gateway,
        "commit_agent_model_policy",
        lambda policy, **_kwargs: captured.append(policy) or SimpleNamespace(policy=policy, revision="sha256:" + "b" * 64),
    )
    result = asyncio.run(gateway.put_agent_model_policy(
        "my-drsai",
        gateway.AgentModelPolicyUpdateRequest(
            primary_model=gateway.AgentModelSelectionRequest(
                mode="explicit",
                ref=gateway.RuntimeModelRefResponse(provider_id="provider-b", model_id="same"),
            ),
            expected_revision="sha256:" + "a" * 64,
        ),
    ))
    assert captured[0].primary_model.ref == ModelRef("provider-b", "same")
    assert result["effective_ref"] == {"provider_id": "provider-b", "model_id": "same"}


def test_agent_policy_rejects_outside_model_and_conflict(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", config)
    outside = gateway.AgentModelPolicyUpdateRequest(primary_model=gateway.AgentModelSelectionRequest(
        mode="explicit", ref=gateway.RuntimeModelRefResponse(provider_id="provider-b", model_id="outside"),
    ))
    with pytest.raises(gateway.HTTPException) as invalid:
        asyncio.run(gateway.put_agent_model_policy("my-drsai", outside))
    assert invalid.value.status_code == 400

    monkeypatch.setattr(gateway, "commit_agent_model_policy", lambda *_args, **_kwargs: (_ for _ in ()).throw(AgentModelPolicyConflict("changed")))
    inherited = gateway.AgentModelPolicyUpdateRequest(primary_model=gateway.AgentModelSelectionRequest(
        mode="explicit", ref=gateway.RuntimeModelRefResponse(provider_id="provider-a", model_id="same"),
    ))
    with pytest.raises(gateway.HTTPException) as conflict:
        asyncio.run(gateway.put_agent_model_policy("my-drsai", inherited))
    assert conflict.value.status_code == 409
    assert conflict.value.detail["code"] == "agent_model_policy_conflict"


def test_legacy_policy_migration_is_active_provider_scoped_and_fail_closed(monkeypatch) -> None:
    committed = []
    monkeypatch.setattr(gateway, "load_model_provider_config", config)
    monkeypatch.setattr(
        gateway,
        "commit_agent_model_policy",
        lambda policy, **_kwargs: committed.append(policy) or SimpleNamespace(policy=policy, revision="sha256:" + "c" * 64),
    )
    migrated = asyncio.run(gateway.migrate_legacy_agent_model_policy(
        "my-drsai", gateway.LegacyAgentModelPolicyMigrationRequest(legacy_model="same"),
    ))
    assert migrated["primary_model"]["ref"] == {"provider_id": "provider-a", "model_id": "same"}
    with pytest.raises(gateway.HTTPException) as unresolved:
        asyncio.run(gateway.migrate_legacy_agent_model_policy(
            "my-drsai", gateway.LegacyAgentModelPolicyMigrationRequest(legacy_model="unknown"),
        ))
    assert unresolved.value.status_code == 400


def test_non_opendrsai_backend_has_no_local_provider_policy() -> None:
    with pytest.raises(gateway.HTTPException) as missing:
        asyncio.run(gateway.get_agent_model_policy("my-codex"))
    assert missing.value.status_code == 404


def test_agent_image_policy_requires_declared_image_operation(monkeypatch) -> None:
    image_config = parse_user_config({
        "model": "chat", "model_provider": "provider-a",
        "model_providers": {"provider-a": {
            "base_url": "https://a.example/v1", "wire_api": "openai",
            "requires_api_key": False, "models": ["chat", "image"],
            "model_operations": {"image": ["image_generation"]},
        }},
    })
    captured = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: image_config)
    monkeypatch.setattr(
        gateway, "commit_agent_model_policy",
        lambda policy, **_kwargs: captured.append(policy) or SimpleNamespace(
            policy=policy, revision="sha256:" + "d" * 64,
        ),
    )
    request = gateway.AgentModelPolicyUpdateRequest(
        primary_model=gateway.AgentModelSelectionRequest(
            mode="explicit", ref=gateway.RuntimeModelRefResponse(provider_id="provider-a", model_id="chat"),
        ),
        image_model=gateway.AgentModelSelectionRequest(
            mode="explicit",
            ref=gateway.RuntimeModelRefResponse(provider_id="provider-a", model_id="image"),
        ),
    )

    result = asyncio.run(gateway.put_agent_model_policy("my-drsai", request))

    assert captured[0].image_model.ref == ModelRef("provider-a", "image")
    assert result["effective_image_ref"] == {"provider_id": "provider-a", "model_id": "image"}

    descriptor = next(
        item for item in gateway._runtime_model_catalog_payload(image_config)["models"]
        if item["ref"] == {"provider_id": "provider-a", "model_id": "image"}
    )
    assert descriptor["operations"] == ["image_generation"]
    assert descriptor["input_modalities"] == []
    assert descriptor["output_modalities"] == ["image"]
    assert descriptor["capability_source"] == "user_override"
    assert descriptor["capability_confidence"] == "declared"


def test_agent_image_policy_rejects_chat_only_model(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", config)
    request = gateway.AgentModelPolicyUpdateRequest(
        primary_model=gateway.AgentModelSelectionRequest(
            mode="explicit", ref=gateway.RuntimeModelRefResponse(provider_id="provider-a", model_id="same"),
        ),
        image_model=gateway.AgentModelSelectionRequest(
            mode="explicit",
            ref=gateway.RuntimeModelRefResponse(provider_id="provider-a", model_id="same"),
        ),
    )

    with pytest.raises(gateway.HTTPException) as invalid:
        asyncio.run(gateway.put_agent_model_policy("my-drsai", request))

    assert invalid.value.status_code == 400
    assert "no declared image operation" in str(invalid.value.detail)


def test_agent_policy_binds_each_capability_by_declared_modalities(monkeypatch) -> None:
    capability_config = parse_user_config({
        "model": "chat", "model_provider": "provider-a",
        "model_providers": {"provider-a": {
            "base_url": "https://a.example/v1", "requires_api_key": False,
            "models": {
                "chat": {"input_modalities": ["text"], "output_modalities": ["text"], "api_protocol": "openai", "enabled": True, "capabilities": ["chat"]},
                "vision": {"input_modalities": ["text", "image"], "output_modalities": ["text"], "api_protocol": "openai", "enabled": True, "capabilities": ["chat"]},
                "image": {"input_modalities": ["text"], "output_modalities": ["image"], "api_protocol": "openai", "enabled": True, "capabilities": ["image_generation"]},
                "tts": {"input_modalities": ["text"], "output_modalities": ["audio"], "api_protocol": "openai", "enabled": True, "capabilities": ["text_to_speech"]},
                "stt": {"input_modalities": ["audio"], "output_modalities": ["text"], "api_protocol": "openai", "enabled": True, "capabilities": ["speech_to_text"]},
            },
        }},
    })
    captured = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: capability_config)
    monkeypatch.setattr(
        gateway, "commit_agent_model_policy",
        lambda policy, **_kwargs: captured.append(policy) or SimpleNamespace(
            policy=policy, revision="sha256:" + "e" * 64,
        ),
    )
    explicit = lambda model_id: gateway.AgentModelSelectionRequest(
        mode="explicit",
        ref=gateway.RuntimeModelRefResponse(provider_id="provider-a", model_id=model_id),
    )

    result = asyncio.run(gateway.put_agent_model_policy(
        "my-drsai",
        gateway.AgentModelPolicyUpdateRequest(
            primary_model=explicit("chat"),
            image_understanding_model=explicit("vision"),
            image_generation_model=explicit("image"),
            text_to_speech_model=explicit("tts"),
            speech_to_text_model=explicit("stt"),
        ),
    ))

    assert captured[0].image_understanding_model.ref.model_id == "vision"
    assert result["effective_image_generation_ref"]["model_id"] == "image"
    assert result["effective_text_to_speech_ref"]["model_id"] == "tts"
    assert result["effective_speech_to_text_ref"]["model_id"] == "stt"


def test_agent_policy_persists_deepseek_reasoning_effort(monkeypatch) -> None:
    deepseek_config = parse_user_config({
        "model": "deepseek-v4-pro", "model_provider": "hepai",
        "model_providers": {"hepai": {
            "base_url": "https://aiapi.ihep.ac.cn/apiv2", "requires_api_key": False,
            # Existing catalogs that predate this feature may only declare
            # chat; the built-in DeepSeek facts must retain reasoning support.
            "models": {"deepseek-v4-pro": {
                "input_modalities": ["text"], "output_modalities": ["text"],
                "api_protocol": "openai", "enabled": True, "capabilities": ["chat"],
            }},
        }},
    })
    captured = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: deepseek_config)
    monkeypatch.setattr(
        gateway, "commit_agent_model_policy",
        lambda policy, **_kwargs: captured.append(policy) or SimpleNamespace(
            policy=policy, revision="sha256:" + "f" * 64,
        ),
    )

    result = asyncio.run(gateway.put_agent_model_policy(
        "my-drsai",
        gateway.AgentModelPolicyUpdateRequest(
            primary_model=gateway.AgentModelSelectionRequest(
                mode="explicit", ref=gateway.RuntimeModelRefResponse(provider_id="hepai", model_id="deepseek-v4-pro"),
            ),
            reasoning_effort="max",
        ),
    ))

    assert captured[0].reasoning_effort == "max"
    assert result["reasoning_effort"] == "max"
    descriptor = gateway._runtime_model_catalog_payload(deepseek_config)["models"][0]
    assert descriptor["reasoning_efforts"] == ["none", "high", "max"]
    assert "reasoning" in descriptor["operations"]
