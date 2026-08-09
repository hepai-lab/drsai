from __future__ import annotations

import asyncio
import pytest
from types import SimpleNamespace

from drsai.backend import gateway
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


class _Manager:
    async def evict_user(self, _user_id: str) -> int:
        return 2

    async def mark_user_config_stale(self, _user_id: str) -> int:
        return 7

    async def model_config_state(self, _user_id: str):
        return {"configured_revision": "a" * 64, "runtime_revisions": [], "runtime_status": "not_started", "active_runtime_count": 0}


@pytest.fixture(autouse=True)
def _default_agent_model_policy(monkeypatch):
    policy = AgentModelPolicy(
        "my-drsai", primary_model=AgentModelSelection("explicit", ModelRef("custom", "custom-model")),
    )
    monkeypatch.setattr(
        gateway, "load_agent_model_policy",
        lambda _agent_id: SimpleNamespace(policy=policy, revision="sha256:" + "a" * 64),
    )


def _custom_config(*, with_key: bool = True):
    provider = {
        "base_url": "https://provider.example/v1",
        "wire_api": "openai",
    }
    if with_key:
        provider["api_key"] = "gateway-secret"
    return parse_user_config(
        {
            "model": "custom-model",
            "model_provider": "custom",
            "model_providers": {"custom": provider},
        },
        source_path="/test/config.toml",
    )


def test_get_active_model_config_is_redacted(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    payload = asyncio.run(gateway.get_active_model_config())

    assert payload["model"] == "custom-model"
    assert payload["provider"]["has_api_key"] is True
    assert "gateway-secret" not in repr(payload)


def test_model_state_and_doctor_are_redacted(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway, "default_model_config_path", lambda: tmp_path / "config.toml")
    monkeypatch.setattr(gateway, "model_config_revision", lambda *_args: "a" * 64)
    monkeypatch.setattr(gateway, "last_known_good_path", lambda _path: tmp_path / "missing")
    state = asyncio.run(gateway.get_model_config_state())
    assert state["effective"]["provider"]["has_api_key"] is True
    assert "gateway-secret" not in repr(state)
    assert state["runtime"]["runtime_status"] == "not_started"

    monkeypatch.setattr(gateway, "diagnose_model_config", lambda **_kwargs: {"ok": True, "checks": []})
    assert asyncio.run(gateway.doctor_model_config()) == {"ok": True, "checks": []}


def test_provider_list_keeps_persisted_models_when_credential_is_unavailable(monkeypatch) -> None:
    config = parse_user_config({
        "model_providers": {
            "zhizengzeng": {
                "base_url": "https://api.zhizengzeng.com/v1",
                "api_key_credential": "drsai-credential:00000000-0000-0000-0000-000000000001",
                "models": {
                    "deepseek-v4-pro": {
                        "input_modalities": ["text"],
                        "output_modalities": ["text"],
                        "api_protocol": "openai",
                        "capabilities": ["chat", "reasoning"],
                    },
                },
            },
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "resolve_credential", lambda _reference: None)

    payload = asyncio.run(gateway.list_model_provider_configs())
    provider = next(item for item in payload["providers"] if item["name"] == "zhizengzeng")

    assert provider["has_api_key"] is False
    assert provider["models"] == ["deepseek-v4-pro"]
    assert provider["model_configs"]["deepseek-v4-pro"]["enabled"] is True


def test_restore_model_config_marks_runtime_stale(monkeypatch) -> None:
    config = _custom_config(with_key=False)
    resolved = gateway.resolve_model_config(config, environ={}, require_credentials=False)
    monkeypatch.setattr(
        gateway,
        "restore_last_known_good",
        lambda **_kwargs: SimpleNamespace(resolved=resolved, revision="b" * 64),
    )
    monkeypatch.setattr(gateway, "manager", _Manager())
    payload = asyncio.run(gateway.restore_model_config(gateway.ModelConfigRestoreRequest()))
    assert payload["ok"] is True
    assert payload["config_revision"] == 7
    assert "gateway-secret" not in repr(payload)


def test_gateway_lists_presets_and_discovers_models(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(
        gateway,
        "discover_provider_models",
        lambda _resolved, refresh=False: _async_value({"ok": True, "models": ["custom-model"], "cached": False}),
    )
    presets = asyncio.run(gateway.get_model_provider_presets())
    assert any(item["id"] == "openai" for item in presets["presets"])
    result = asyncio.run(
        gateway.discover_model_provider_models(gateway.ModelDiscoveryRequest(provider="custom"))
    )
    assert result["models"] == ["custom-model"]


def test_model_discovery_openapi_freezes_provider_aware_contract() -> None:
    schema = gateway.app.openapi()
    operation = schema["paths"]["/v1/config/model-providers/models"]["post"]
    response_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert response_ref.endswith("/ModelDiscoveryResponse")
    descriptor = schema["components"]["schemas"]["RuntimeModelDescriptorResponse"]
    assert set(descriptor["required"]) >= {
        "ref", "display_name", "input_modalities", "output_modalities", "operations",
        "reasoning_efforts", "availability", "capability_source", "capability_confidence",
    }
    model_ref = schema["components"]["schemas"]["RuntimeModelRefResponse"]
    assert set(model_ref["required"]) == {"provider_id", "model_id"}


def test_runtime_model_catalog_uses_only_configured_provider_models(monkeypatch) -> None:
    config = parse_user_config({
        "model": "shared-model", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["shared-model"], "model_aliases": {"shared-model": "A display"},
            },
            "provider-b": {
                "base_url": "https://b.example/v1", "requires_api_key": False,
                "models": ["shared-model"], "model_aliases": {"shared-model": "B display"},
            },
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda *_args: None)
    result = asyncio.run(gateway.get_runtime_model_catalog())
    assert [(item["ref"]["provider_id"], item["ref"]["model_id"]) for item in result["models"]] == [
        ("provider-a", "shared-model"), ("provider-b", "shared-model"),
    ]
    assert [item["display_name"] for item in result["models"]] == ["A display", "B display"]
    assert result["revision"].startswith("sha256:")
    assert "base_url" not in repr(result)


def test_runtime_model_catalog_merges_exact_provider_discovery_fact(monkeypatch) -> None:
    config = parse_user_config({
        "model": "fixed-model", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["fixed-model"],
            },
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda provider, base_url: {
        "provider": provider,
        "models": ["fixed-model", "discovered-model"],
        "updated_at": "2026-08-05T00:00:00+00:00",
        "catalog_state": "fresh",
        "availability": "available",
    } if (provider, base_url) == ("provider-a", "https://a.example/v1") else None)
    result = asyncio.run(gateway.get_runtime_model_catalog())
    assert [item["ref"]["model_id"] for item in result["models"]] == [
        "discovered-model", "fixed-model",
    ]
    assert all(item["availability"] == "available" for item in result["models"])
    assert result["state"] == "fresh"


def test_runtime_model_catalog_preserves_stale_discovery_state(monkeypatch) -> None:
    config = _custom_config(with_key=False)
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda *_args: {
        "provider": "custom",
        "models": ["last-known-model"],
        "updated_at": "2026-08-05T00:00:00+00:00",
        "catalog_state": "stale",
        "availability": "stale",
    })
    result = asyncio.run(gateway.get_runtime_model_catalog())
    stale = next(item for item in result["models"] if item["ref"]["model_id"] == "last-known-model")
    assert stale["availability"] == "stale"
    assert result["state"] == "stale"


def test_runtime_model_catalog_openapi_is_canonical() -> None:
    operation = gateway.app.openapi()["paths"]["/v1/config/runtime-models"]["get"]
    response_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert response_ref.endswith("/RuntimeModelCatalogResponse")


def test_provider_delete_preflight_lists_active_reference_without_mutation(monkeypatch) -> None:
    config = _custom_config(with_key=False)
    commits = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "commit_model_config_update", lambda *_args, **_kwargs: commits.append(True))
    result = asyncio.run(gateway.get_model_provider_references("custom"))
    assert result == {
        "provider": "custom",
        "references": [
            {
                "kind": "agent_model_policy",
                    "id": "opendrsai",
                    "label": "opendrsai primary model",
                "model_id": "custom-model",
            },
        ],
        "can_delete": False,
    }
    with pytest.raises(gateway.HTTPException) as blocked:
        asyncio.run(gateway.remove_model_provider_config("custom"))
    assert blocked.value.status_code == 409
    assert blocked.value.detail["code"] == "provider_references_present"
    assert commits == []


def test_provider_delete_preflight_allows_unreferenced_provider(monkeypatch) -> None:
    config = parse_user_config({
        "model": "active", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {"base_url": "https://a.example/v1", "requires_api_key": False},
            "provider-b": {"base_url": "https://b.example/v1", "requires_api_key": False},
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    result = asyncio.run(gateway.get_model_provider_references("provider-b"))
    assert result["references"] == []
    assert result["can_delete"] is True


def test_provider_delete_preflight_finds_explicit_agent_policy(monkeypatch) -> None:
    config = parse_user_config({
        "model": "active", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {"base_url": "https://a.example/v1", "requires_api_key": False},
            "provider-b": {"base_url": "https://b.example/v1", "requires_api_key": False, "models": ["selected"]},
        },
    })
    policy = AgentModelPolicy(
        "my-drsai",
        gateway.AgentModelSelection("explicit", gateway.RuntimeModelRef("provider-b", "selected")),
    )
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _agent_id: SimpleNamespace(policy=policy, revision="sha256:" + "b" * 64))
    result = asyncio.run(gateway.get_model_provider_references("provider-b"))
    assert result["can_delete"] is False
    assert result["references"] == [{
        "kind": "agent_model_policy",
        "id": "opendrsai",
            "label": "opendrsai primary model",
        "model_id": "selected",
    }]


def test_provider_delete_preflight_finds_capability_model_policies(monkeypatch) -> None:
    config = parse_user_config({
        "model": "active", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {"base_url": "https://a.example/v1", "requires_api_key": False},
            "provider-b": {"base_url": "https://b.example/v1", "requires_api_key": False, "models": ["vision", "tts"]},
        },
    })
    explicit = lambda model_id: gateway.AgentModelSelection(
        "explicit", gateway.RuntimeModelRef("provider-b", model_id),
    )
    policy = AgentModelPolicy(
        "my-drsai",
        image_understanding_model=explicit("vision"),
        text_to_speech_model=explicit("tts"),
    )
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _agent_id: SimpleNamespace(policy=policy, revision="sha256:" + "b" * 64))

    result = asyncio.run(gateway.get_model_provider_references("provider-b"))

    assert [reference["kind"] for reference in result["references"]] == [
        "agent_image_understanding_model_policy",
        "agent_text_to_speech_model_policy",
    ]


def test_runtime_execute_model_selection_routes_exact_provider_and_upstream() -> None:
    config = parse_user_config({
        "model": "same", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["same"], "model_upstream_ids": {"same": "a/upstream"},
            },
            "provider-b": {
                "base_url": "https://b.example/v1", "requires_api_key": False,
                "models": ["same"], "model_upstream_ids": {"same": "b/upstream"},
            },
        },
    })
    selected = gateway._resolve_runtime_execution_model(
        config,
        gateway.RuntimeRunExecuteRequest(
            prompt="test",
            model_selection=gateway.RuntimeModelRefRequest(provider_id="provider-b", model_id="same"),
        ),
        environ={},
    )
    assert selected.provider.name == "provider-b"
    assert selected.model_id == "same"
    assert selected.model == "b/upstream"
    with pytest.raises(gateway.RuntimeExecutionError) as conflict:
        gateway._resolve_runtime_execution_model(
            config,
            gateway.RuntimeRunExecuteRequest(
                prompt="test", model="different",
                model_selection=gateway.RuntimeModelRefRequest(provider_id="provider-b", model_id="same"),
            ),
            environ={},
        )
    assert conflict.value.code == "legacy_model_selection_rejected"
    with pytest.raises(gateway.ModelProviderConfigError, match="is not configured"):
        gateway._resolve_runtime_execution_model(
            config,
            gateway.RuntimeRunExecuteRequest(
                prompt="test",
                model_selection=gateway.RuntimeModelRefRequest(provider_id="provider-b", model_id="outside"),
            ),
            environ={},
        )


def test_runtime_reasoning_effort_is_validated_against_exact_model_capabilities() -> None:
    config = parse_user_config({
        "model": "deepseek-v4-pro", "model_provider": "hepai",
        "model_providers": {
            "hepai": {
                "base_url": "https://aiapi.ihep.ac.cn/apiv2/v1",
                "requires_api_key": False,
                "models": ["deepseek-v4-pro", "deepseek-v4-flash"],
            },
        },
    })
    reasoning_model = gateway._resolve_runtime_execution_model(
        config,
        gateway.RuntimeRunExecuteRequest(
            prompt="test",
            model_selection=gateway.RuntimeModelRefRequest(provider_id="hepai", model_id="deepseek-v4-pro"),
        ),
        environ={},
    )
    assert gateway._validate_runtime_reasoning_effort(
        gateway.RuntimeRunExecuteRequest(prompt="test", reasoning_effort="max"), reasoning_model,
    ) == "max"

    plain_model = gateway._resolve_runtime_execution_model(
        config,
        gateway.RuntimeRunExecuteRequest(
            prompt="test",
            model_selection=gateway.RuntimeModelRefRequest(provider_id="hepai", model_id="deepseek-v4-flash"),
        ),
        environ={},
    )
    assert gateway._validate_runtime_reasoning_effort(
        gateway.RuntimeRunExecuteRequest(prompt="test", reasoning_effort="high"), plain_model,
    ) == "high"
    assert reasoning_model.capabilities.reasoning.effort_levels == ("none", "high", "max")
    assert plain_model.capabilities.reasoning.effort_levels == ("none", "high", "max")


def test_deepseek_v4_flash_production_alias_supports_reasoning_effort() -> None:
    config = parse_user_config({
        "model": "deepseek-v4-flash-正式版", "model_provider": "hepai",
        "model_providers": {"hepai": {
            "base_url": "https://aiapi.ihep.ac.cn/apiv2", "requires_api_key": False,
            "models": {"deepseek-v4-flash-正式版": {
                "input_modalities": ["text"], "output_modalities": ["text"],
                "api_protocol": "openai", "enabled": True, "capabilities": ["chat"],
            }},
        }},
    })
    resolved = gateway._resolve_runtime_execution_model(
        config,
        gateway.RuntimeRunExecuteRequest(
            prompt="test",
            model_selection=gateway.RuntimeModelRefRequest(
                provider_id="hepai", model_id="deepseek-v4-flash-正式版",
            ),
        ),
        environ={},
    )

    assert resolved.capabilities.reasoning.supported is True
    assert resolved.capabilities.reasoning.effort_levels == ("none", "high", "max")
    assert gateway._validate_runtime_reasoning_effort(
        gateway.RuntimeRunExecuteRequest(prompt="test", reasoning_effort="max"), resolved,
    ) == "max"


@pytest.mark.parametrize("model_id", ["deepseek-v4-flash-0731", "deepseek-v4-flash-正式版"])
def test_deepseek_v4_flash_deployment_ids_inherit_reasoning_capabilities(model_id: str) -> None:
    config = parse_user_config({
        "model": model_id, "model_provider": "hepai",
        "model_providers": {"hepai": {
            "base_url": "https://aiapi.ihep.ac.cn/apiv2", "requires_api_key": False,
            "models": {model_id: {
                "input_modalities": ["text"], "output_modalities": ["text"],
                "api_protocol": "openai", "enabled": True, "capabilities": ["chat"],
            }},
        }},
    })

    catalog = gateway._runtime_model_catalog_payload(config)
    descriptor = next(item for item in catalog["models"] if item["ref"]["model_id"] == model_id)

    assert descriptor["reasoning_efforts"] == ["none", "high", "max"]
    assert "reasoning" in descriptor["operations"]


def test_runtime_multimodal_admission_reuses_primary_model_and_rejects_nonvision_model() -> None:
    image_input = {"image_count": 1, "total_bytes": 123, "mime_types": ["image/png"], "resources": []}
    resolved = SimpleNamespace(capabilities=SimpleNamespace(vision=False))
    with pytest.raises(gateway.RuntimeExecutionError) as unsupported:
        gateway._validate_runtime_multimodal_admission(
            image_input, {"input_modalities": ["text"]}, resolved,
        )
    assert unsupported.value.code == "model_image_input_unsupported"
    assert unsupported.value.retryable is False
    assert "select_model" in unsupported.value.detail["recovery_actions"]

    gateway._validate_runtime_multimodal_admission(
        image_input, {"input_modalities": ["text", "image"]}, resolved,
    )
    gateway._validate_runtime_multimodal_admission(
        {**image_input, "image_count": 0}, {"input_modalities": ["text"]}, resolved,
    )


def test_runtime_model_admission_binds_current_catalog_revision(monkeypatch) -> None:
    config = parse_user_config({
        "model": "deepseek-v4-pro", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["deepseek-v4-pro"],
            },
        },
    })
    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda *_args: None)
    catalog = gateway._runtime_model_catalog_payload(config)
    request = gateway.RuntimeRunExecuteRequest(
        prompt="test",
        model_selection=gateway.RuntimeModelRefRequest(
            provider_id="provider-a", model_id="deepseek-v4-pro",
            catalog_revision=catalog["revision"],
        ),
    )
    resolved = gateway._resolve_runtime_execution_model(config, request, environ={})
    revision, descriptor = gateway._validate_runtime_model_admission(config, request, resolved)
    assert revision == catalog["revision"]
    assert descriptor["ref"] == {"provider_id": "provider-a", "model_id": "deepseek-v4-pro"}
    assert {"chat", "tool_calling"} <= set(descriptor["operations"])

    stale = request.model_copy(update={
        "model_selection": gateway.RuntimeModelRefRequest(
            provider_id="provider-a", model_id="deepseek-v4-pro",
            catalog_revision="sha256:" + "0" * 64,
        )
    })
    with pytest.raises(gateway.RuntimeExecutionError) as conflict:
        gateway._validate_runtime_model_admission(config, stale, resolved)
    assert conflict.value.code == "model_catalog_changed"
    assert conflict.value.retryable is True


def test_runtime_model_admission_preserves_configured_models_and_rejects_unknown_capabilities(monkeypatch) -> None:
    removed_config = parse_user_config({
        "model": "deepseek-v4-pro", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["deepseek-v4-pro"],
            },
        },
    })
    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda *_args: {
        "models": [], "catalog_state": "fresh", "availability": "available",
        "updated_at": "2026-08-05T00:00:00+00:00",
    })
    removed_catalog = gateway._runtime_model_catalog_payload(removed_config)
    assert removed_catalog["models"][0]["availability"] == "configured_unverified"
    gateway.RuntimeModelCatalogResponse.model_validate(removed_catalog)
    gateway.RuntimeModelCatalogResponse.model_validate({
        **removed_catalog,
        "models": [{**removed_catalog["models"][0], "availability": "unavailable"}],
    })
    removed_request = gateway.RuntimeRunExecuteRequest(
        prompt="test", model_selection=gateway.RuntimeModelRefRequest(
            provider_id="provider-a", model_id="deepseek-v4-pro",
            catalog_revision=removed_catalog["revision"],
        ),
    )
    removed_model = gateway._resolve_runtime_execution_model(removed_config, removed_request, environ={})
    revision, descriptor = gateway._validate_runtime_model_admission(removed_config, removed_request, removed_model)
    assert revision == removed_catalog["revision"]
    assert descriptor is not None
    assert descriptor["availability"] == "configured_unverified"

    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda *_args: {
        "models": [], "catalog_state": "unauthorized", "availability": "unauthorized",
        "updated_at": "2026-08-05T00:00:00+00:00",
    })
    unauthorized_catalog = gateway._runtime_model_catalog_payload(removed_config)
    unauthorized_request = gateway.RuntimeRunExecuteRequest(
        prompt="test", model_selection=gateway.RuntimeModelRefRequest(
            provider_id="provider-a", model_id="deepseek-v4-pro",
            catalog_revision=unauthorized_catalog["revision"],
        ),
    )
    with pytest.raises(gateway.RuntimeExecutionError) as unauthorized:
        gateway._validate_runtime_model_admission(removed_config, unauthorized_request, removed_model)
    assert unauthorized.value.code == "model_unauthorized"

    monkeypatch.setattr(gateway, "cached_provider_model_catalog", lambda *_args: None)
    unknown_config = parse_user_config({
        "model": "unknown-agent-model", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["unknown-agent-model"],
            },
        },
    })
    unknown_catalog = gateway._runtime_model_catalog_payload(unknown_config)
    unknown_request = gateway.RuntimeRunExecuteRequest(
        prompt="test", model_selection=gateway.RuntimeModelRefRequest(
            provider_id="provider-a", model_id="unknown-agent-model",
            catalog_revision=unknown_catalog["revision"],
        ),
    )
    unknown_model = gateway._resolve_runtime_execution_model(unknown_config, unknown_request, environ={})
    with pytest.raises(gateway.RuntimeExecutionError) as unsupported:
        gateway._validate_runtime_model_admission(unknown_config, unknown_request, unknown_model)
    assert unsupported.value.code == "model_capability_unsupported"


def test_legacy_runtime_model_is_rejected() -> None:
    config = parse_user_config({
        "model": "active", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {"base_url": "https://a.example/v1", "requires_api_key": False, "models": ["active"]},
            "provider-b": {"base_url": "https://b.example/v1", "requires_api_key": False, "models": ["other"]},
        },
    })
    with pytest.raises(gateway.RuntimeExecutionError) as rejected:
        gateway._resolve_runtime_execution_model(
            config, gateway.RuntimeRunExecuteRequest(prompt="test", model="other"), environ={},
        )
    assert rejected.value.code == "agent_model_policy_required"


def test_gateway_discovers_hepai_models_with_request_scoped_oidc(monkeypatch) -> None:
    captured = {}

    async def discover(resolved, refresh=False):
        captured["base_url"] = resolved.provider.base_url
        captured["token"] = resolved.provider.api_key.reveal()
        return {"ok": True, "models": ["deepseek-v4-pro"], "cached": False}

    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config(with_key=False))
    monkeypatch.setattr(gateway, "discover_provider_models", discover)
    auth = PlatformAuthContext(
        access_token="oidc-discovery-token",
        subject="hepai-user",
        issuer="https://issuer.example",
        expires_at=4_102_444_800,
        model_base_url="https://models.example/apiv2/v1",
    )

    with platform_auth_scope(auth):
        result = asyncio.run(gateway.discover_model_provider_models(
            gateway.ModelDiscoveryRequest(
                provider="hepai",
                base_url="https://legacy.example/apiv2",
            )
        ))

    assert result["models"] == ["deepseek-v4-pro"]
    assert captured == {
        "base_url": "https://models.example/apiv2/v1",
        "token": "oidc-discovery-token",
    }


async def _async_value(value):
    return value


def test_agent_manager_reports_pending_applied_and_mixed_revisions(monkeypatch) -> None:
    manager = gateway.AgentManager()
    monkeypatch.setattr(gateway, "model_config_revision", lambda *_args: "b" * 64)
    assert asyncio.run(manager.model_config_state("user"))["runtime_status"] == "not_started"

    manager._agent_model_config_revisions["user:old"] = "a" * 64
    pending = asyncio.run(manager.model_config_state("user"))
    assert pending["runtime_status"] == "pending_next_turn"
    assert pending["active_runtime_count"] == 1

    manager._agent_model_config_revisions["user:new"] = "b" * 64
    assert asyncio.run(manager.model_config_state("user"))["runtime_status"] == "partially_applied"
    manager._agent_model_config_revisions.pop("user:old")
    assert asyncio.run(manager.model_config_state("user"))["runtime_status"] == "applied"


def test_agent_manager_keeps_old_runtime_when_new_client_creation_fails(monkeypatch) -> None:
    manager = gateway.AgentManager()
    old_agent = SimpleNamespace()
    manager._agents["user:thread"] = old_agent
    manager._agent_config_revisions["user:thread"] = 0
    manager._config_revisions["user"] = 1
    manager._agent_config_stamps["user:thread"] = None

    async def fail_create(**_kwargs):
        raise RuntimeError("new client failed")

    async def no_remote_tools(*_args, **_kwargs):
        return [], []

    monkeypatch.setattr(gateway, "create_agent", fail_create)
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", no_remote_tools)
    monkeypatch.setattr(gateway, "_get_db", lambda: object())
    monkeypatch.setattr(
        gateway,
        "_resolve_agent_primary_model",
        lambda *_args: SimpleNamespace(provider=SimpleNamespace(name="custom"), model_id="model"),
    )
    with pytest.raises(RuntimeError, match="new client failed"):
        asyncio.run(manager.get_or_create("thread", user_id="user"))
    assert manager._agents["user:thread"] is old_agent
    assert manager._agent_config_revisions["user:thread"] == 0


def test_agent_manager_switches_on_next_turn_without_interrupting_active_stream(monkeypatch) -> None:
    async def scenario() -> None:
        manager = gateway.AgentManager()
        entered = asyncio.Event()
        release = asyncio.Event()
        created = []
        active_revision = ["a" * 64]

        class FakeAgent:
            def __init__(self, model: str) -> None:
                self.model = model
                self.closed = False

            async def lazy_init(self): return None
            async def close(self): self.closed = True

            async def run_stream(self, *, task, cancellation_token):
                if self.model == "model-a":
                    entered.set()
                    await release.wait()
                yield SimpleNamespace(model=self.model, task=task)

        async def create_agent(**kwargs):
            agent = FakeAgent(kwargs["defult_config_name"])
            created.append(agent)
            return agent

        async def noop(*_args, **_kwargs): return None
        monkeypatch.setattr(gateway, "create_agent", create_agent)
        monkeypatch.setattr(gateway, "_load_remote_hepai_tools", lambda: _async_value(([], [])))
        monkeypatch.setattr(gateway, "_get_db", lambda: object())
        monkeypatch.setattr(gateway, "model_config_revision", lambda *_args: active_revision[0])
        monkeypatch.setattr(manager, "_load_thread_state", noop)
        monkeypatch.setattr(manager, "_get_or_create_thread", noop)
        monkeypatch.setattr(manager, "_update_thread_status", noop)
        monkeypatch.setattr(manager, "_save_thread_state", noop)

        async def collect(model: str):
            return [item async for item in manager.run_stream("task", "thread", "user", model)]

        first_task = asyncio.create_task(collect("model-a"))
        await asyncio.wait_for(entered.wait(), 5)
        active_revision[0] = "b" * 64
        await manager.mark_user_config_stale("user")
        assert created[0].closed is False
        release.set()
        first = await first_task
        second = await collect("model-b")

        assert first[0].model == "model-a"
        assert second[0].model == "model-b"
        assert created[0].closed is True
        assert created[1].closed is False

    asyncio.run(scenario())


def test_agent_manager_never_reuses_client_across_provider_bindings(monkeypatch) -> None:
    async def scenario() -> None:
        manager = gateway.AgentManager()
        created: list[tuple[str | None, str | None]] = []

        class FakeAgent:
            async def lazy_init(self): return None
            async def close(self): return None
            async def run_stream(self, *, task, cancellation_token):
                yield SimpleNamespace(task=task)

        async def create_agent(**kwargs):
            created.append((kwargs.get("model_provider"), kwargs.get("model_id")))
            return FakeAgent()

        async def noop(*_args, **_kwargs): return None
        monkeypatch.setattr(gateway, "create_agent", create_agent)
        monkeypatch.setattr(gateway, "_load_remote_hepai_tools", lambda: _async_value(([], [])))
        monkeypatch.setattr(gateway, "_get_db", lambda: object())
        monkeypatch.setattr(gateway, "model_config_revision", lambda *_args: "a" * 64)
        monkeypatch.setattr(manager, "_load_thread_state", noop)
        monkeypatch.setattr(manager, "_get_or_create_thread", noop)
        monkeypatch.setattr(manager, "_update_thread_status", noop)
        monkeypatch.setattr(manager, "_save_thread_state", noop)

        async def collect(provider: str):
            return [item async for item in manager.run_stream(
                "task", "thread", "user", "shared-upstream",
                model_provider=provider, model_id="shared-model",
                config_revision_binding="config-a", model_catalog_revision="catalog-a",
            )]

        await collect("provider-a")
        await collect("provider-a")
        await collect("provider-b")
        assert created == [("provider-a", "shared-model"), ("provider-b", "shared-model")]

    asyncio.run(scenario())


def test_put_provider_never_returns_submitted_key(monkeypatch) -> None:
    captured = {}

    def commit(request, **_kwargs):
        captured["request"] = request
        config = _custom_config()
        return SimpleNamespace(
            config=config,
            resolved=gateway.resolve_model_config(config, environ={}, require_credentials=False),
            revision="b" * 64,
            warnings=(),
        )

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway, "manager", _Manager())
    request = gateway.ModelProviderConfigRequest(
        base_url="https://provider.example/v1",
        api_key="gateway-secret",
    )
    payload = asyncio.run(gateway.put_model_provider_config("custom", request))

    assert "api_key" not in captured["request"].provider_values
    assert captured["request"].provider_secret == "gateway-secret"
    assert payload["provider"]["has_api_key"] is True
    assert payload["evicted_sessions"] == 0
    assert payload["config_revision"] == 7
    assert "gateway-secret" not in repr(payload)


def test_global_model_commit_is_retired() -> None:
    with pytest.raises(gateway.HTTPException) as retired:
        asyncio.run(gateway.set_active_model_config(gateway.ActiveModelConfigRequest(
            model="custom-model", model_provider="custom", api_key="one-transaction-secret",
        )))
    assert retired.value.status_code == 410
    assert retired.value.detail["code"] == "global_model_removed"


def test_global_model_commit_cannot_mutate_runtime_selection() -> None:
    with pytest.raises(gateway.HTTPException) as retired:
        asyncio.run(gateway.set_active_model_config(gateway.ActiveModelConfigRequest(
            model="custom-model", model_provider="custom",
        )))
    assert retired.value.status_code == 410


def test_global_model_preview_is_retired() -> None:
    with pytest.raises(gateway.HTTPException) as retired:
        asyncio.run(gateway.preview_active_model_config(gateway.ActiveModelConfigRequest(
            model="custom-model", model_provider="custom", api_key="preview-secret",
        )))
    assert retired.value.status_code == 410
    assert retired.value.detail["code"] == "global_model_removed"


def test_delete_active_provider_requires_explicit_migration(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    def commit(request, **_kwargs):
        calls.append(request)
        config = _custom_config()
        return SimpleNamespace(config=config, resolved=None, revision="b" * 64, warnings=())

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "manager", _Manager())
    with pytest.raises(gateway.HTTPException) as blocked:
        asyncio.run(gateway.remove_model_provider_config("custom"))
    assert blocked.value.status_code == 409
    assert blocked.value.detail["code"] == "provider_references_present"
    assert calls == []


def test_delete_provider_can_keep_credential(monkeypatch) -> None:
    calls = []
    config = parse_user_config({
        "model": "active-model", "model_provider": "active",
        "model_providers": {
            "active": {"base_url": "https://active.example/v1", "requires_api_key": False},
            "custom": {"base_url": "https://provider.example/v1", "requires_api_key": False},
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    active_policy = AgentModelPolicy(
        "my-drsai", primary_model=AgentModelSelection("explicit", ModelRef("active", "active-model")),
    )
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _agent: SimpleNamespace(policy=active_policy))
    monkeypatch.setattr(gateway, "commit_model_config_update", lambda request, **_kwargs: calls.append(request) or SimpleNamespace(revision="b" * 64))
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "manager", _Manager())
    payload = asyncio.run(gateway.remove_model_provider_config("custom", delete_credential=False))
    assert calls[0].delete_provider_credential is False
    assert calls[0].model_provider is None
    assert payload["active"] == "active"


def test_provider_edit_without_new_key_preserves_stored_credential(monkeypatch) -> None:
    config = parse_user_config({
        "model": "custom-model",
        "model_provider": "custom",
        "model_providers": {
            "custom": {
                "base_url": "https://provider.example/v1",
                "api_key_credential": "drsai-credential:00000000-0000-0000-0000-000000000001",
            }
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    def commit(request, **_kwargs):
        return SimpleNamespace(
            config=config,
            resolved=gateway.resolve_model_config(config, environ={}, require_credentials=False),
            revision="b" * 64,
            warnings=(),
        )

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "manager", _Manager())

    payload = asyncio.run(gateway.put_model_provider_config(
        "custom",
        gateway.ModelProviderConfigRequest(base_url="https://new.example/v1"),
    ))

    assert payload["ok"] is True


class _Response:
    status_code = 401


class _FakeHttpClient:
    def __init__(self, *, timeout: float):
        self.timeout = timeout
        self.seen_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, _url, *, headers):
        self.seen_headers = headers
        return _Response()

    async def post(self, _url, *, headers, json):
        self.seen_headers = headers
        return _Response()


def test_connection_test_classifies_authentication_without_leaking_key(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway.httpx, "AsyncClient", _FakeHttpClient)
    payload = asyncio.run(
        gateway.test_model_provider_config(
            "custom", gateway.ModelProviderTestRequest(model="custom-model")
        )
    )

    assert payload["ok"] is False
    assert payload["error"] == "authentication_failed"
    assert payload["status_code"] == 401
    assert payload["guidance"]["code"] == "authentication_failed"
    assert "gateway-secret" not in repr(payload)


def test_marking_model_config_stale_does_not_interrupt_active_agent() -> None:
    class ActiveAgent:
        closed = False

        async def close(self):
            self.closed = True

    manager = gateway.AgentManager()
    agent = ActiveAgent()
    manager._agents["user:thread"] = agent

    revision = asyncio.run(manager.mark_user_config_stale("user"))

    assert revision == 1
    assert manager._agents["user:thread"] is agent
    assert agent.closed is False


def test_failed_config_refresh_keeps_previous_agent_available(monkeypatch) -> None:
    class ActiveAgent:
        closed = False

        async def close(self):
            self.closed = True

    async def no_remote_tools():
        return [], None

    def fail_create(**_kwargs):
        raise RuntimeError("invalid replacement config")

    manager = gateway.AgentManager()
    agent = ActiveAgent()
    manager._agents["user:thread"] = agent
    manager._agent_config_revisions["user:thread"] = 0
    manager._config_revisions["user"] = 0
    manager._agent_config_stamps["user:thread"] = (1, 10)
    monkeypatch.setattr(gateway, "_model_config_stamp", lambda: (2, 20))
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", no_remote_tools)
    monkeypatch.setattr(gateway, "_get_db", lambda: object())
    monkeypatch.setattr(gateway, "_get_default_model_alias", lambda: "default-model")
    monkeypatch.setattr(gateway, "create_agent", fail_create)
    monkeypatch.setattr(
        gateway,
        "_resolve_agent_primary_model",
        lambda *_args: SimpleNamespace(provider=SimpleNamespace(name="custom"), model_id="model"),
    )

    with pytest.raises(RuntimeError, match="invalid replacement"):
        asyncio.run(manager.get_or_create("thread", "user"))

    assert manager._agents["user:thread"] is agent
    assert agent.closed is False


def test_gateway_draft_probe_does_not_persist_or_return_key(monkeypatch) -> None:
    captured = {}

    async def probe(draft, **kwargs):
        captured["draft"] = draft
        captured["mode"] = kwargs["mode"]
        return {"ok": True, "persisted": False, "mode": kwargs["mode"]}

    monkeypatch.setattr(gateway, "probe_provider_draft", probe)
    request = gateway.ModelProviderDraftTestRequest(
        name="draft",
        base_url="https://provider.example/v1",
        model="draft-model",
        api_key="one-time-secret",
        mode="basic",
    )

    payload = asyncio.run(gateway.test_model_provider_draft(request))

    assert payload == {"ok": True, "persisted": False, "mode": "basic"}
    assert captured["draft"].api_key == "one-time-secret"
    assert "one-time-secret" not in repr(payload)


def test_gateway_draft_probe_reuses_saved_credential_reference(monkeypatch) -> None:
    captured = {}

    async def probe(draft, **kwargs):
        captured["draft"] = draft
        return {"ok": True, "persisted": False}

    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: gateway.DrSaiConfig(
        providers={"zhizengzeng": gateway.ProviderInput(
            name="zhizengzeng",
            base_url="https://api.zhizengzeng.com/v1",
            api_key_credential="drsai:model-provider:zhizengzeng",
        )},
    ))
    monkeypatch.setattr(gateway, "probe_provider_draft", probe)
    request = gateway.ModelProviderDraftTestRequest(
        name="zhizengzeng",
        base_url="https://api.zhizengzeng.com/v1",
        model="deepseek-chat",
        mode="basic",
    )

    payload = asyncio.run(gateway.test_model_provider_draft(request))

    assert payload["ok"] is True
    assert captured["draft"].api_key is None
    assert captured["draft"].api_key_credential == "drsai:model-provider:zhizengzeng"
