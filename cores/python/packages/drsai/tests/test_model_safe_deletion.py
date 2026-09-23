from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from drsai.backend.desktop_gateway.routes import config_providers as routes
from drsai.config import service


def _selection(provider: str, model: str):
    return SimpleNamespace(ref=SimpleNamespace(provider_id=provider, model_id=model))


def _policy(provider: str = "target", model: str = "wanted"):
    return SimpleNamespace(
        primary_model=_selection(provider, model),
        image_generation_model=_selection(provider, model),
        image_model=_selection(provider, model),
        image_understanding_model=_selection(provider, model),
        text_to_speech_model=_selection(provider, model),
        speech_to_text_model=_selection(provider, model),
        realtime_voice_model=_selection(provider, model),
    )


def test_model_references_require_provider_and_model_and_cover_all_roles(monkeypatch):
    policies = {
        "matching": _policy(),
        "wrong-model": _policy(model="other"),
        "wrong-provider": _policy(provider="other"),
    }
    monkeypatch.setattr(routes, "list_agent_names", lambda: list(policies))
    monkeypatch.setattr(routes, "load_agent_model_policy", lambda name: SimpleNamespace(policy=policies[name]))

    references = routes._model_provider_references(SimpleNamespace(), "target", "wanted")

    assert {item["kind"] for item in references} == {
        "agent_model_policy",
        "agent_image_generation_model_policy",
        "agent_legacy_image_model_policy",
        "agent_image_understanding_model_policy",
        "agent_text_to_speech_model_policy",
        "agent_speech_to_text_model_policy",
        "agent_realtime_voice_model_policy",
    }
    assert {item["id"] for item in references} == {"matching"}
    assert {item["model_id"] for item in references} == {"wanted"}


@pytest.mark.asyncio
async def test_model_preflight_not_found_is_404(monkeypatch):
    monkeypatch.setattr(routes, "load_model_provider_config", lambda: SimpleNamespace(providers={}))
    with pytest.raises(HTTPException) as raised:
        await routes.list_model_references("missing", "model")
    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_rechecks_references_and_forwards_expected_revision(monkeypatch):
    model = SimpleNamespace(origin="user")
    config = SimpleNamespace(providers={"provider": SimpleNamespace(model_configs={"model": model})})
    monkeypatch.setattr(routes, "load_model_provider_config", lambda: config)
    checks = iter([[], [{"kind": "agent_model_policy"}]])
    monkeypatch.setattr(routes, "_model_provider_references", lambda *_args: next(checks))
    captured = {}

    def fake_delete(provider, model_id, **kwargs):
        captured.update(provider=provider, model_id=model_id, expected_revision=kwargs["expected_revision"])
        if kwargs["reference_check"](config, provider, model_id):
            raise routes.ModelProviderConfigConflict("Model is referenced")
        raise AssertionError("race check must block the commit")

    monkeypatch.setattr(routes, "delete_provider_model", fake_delete)
    with pytest.raises(HTTPException) as raised:
        await routes.delete_model("provider", "model", "a" * 64)
    assert raised.value.status_code == 409
    assert captured == {"provider": "provider", "model_id": "model", "expected_revision": "a" * 64}


def _model(origin: str, enabled: bool = True):
    return SimpleNamespace(origin=origin, public_dict=lambda: {"enabled": enabled, "alias": origin})


@pytest.mark.parametrize(
    ("origin", "expected_models"),
    [
        ("user", {"keep": {"enabled": True, "alias": "user"}}),
        ("product", {"target": {"enabled": False, "alias": "product"}, "keep": {"enabled": True, "alias": "user"}}),
    ],
)
def test_service_deletes_only_user_model_or_disables_product_and_retains_provider(monkeypatch, origin, expected_models):
    provider = SimpleNamespace(
        model_configs={"target": _model(origin), "keep": _model("user")},
        base_url="https://example.invalid/v1",
        wire_api="openai",
        requires_api_key=True,
        anthropic_base_url=None,
        google_base_url=None,
        api_key_env="EXAMPLE_KEY",
        api_key_credential="credential-id",
        use_responses_api=None,
    )
    config = SimpleNamespace(providers={"provider": provider})
    monkeypatch.setattr(service, "ensure_model_config_writes_enabled", lambda: None)
    monkeypatch.setattr(service, "config_revision", lambda _path: "r1")
    monkeypatch.setattr(service, "load_user_config", lambda _path: config)
    captured = {}

    def fake_commit(request, **kwargs):
        captured["request"] = request
        captured.update(kwargs)
        request.pre_commit_check(config)
        return SimpleNamespace(revision="r2")

    monkeypatch.setattr(service, "commit_update", fake_commit)
    service.delete_provider_model("provider", "target", expected_revision="r1", path="isolated.toml", reference_check=lambda *_: [])

    values = captured["request"].provider_values
    assert captured["request"].provider_name == "provider"
    assert values["models"] == expected_models
    assert values["base_url"] == provider.base_url
    assert values["api_key_env"] == "EXAMPLE_KEY"
    assert values["api_key_credential"] == "credential-id"
    assert captured["expected_revision"] == "r1"


def test_service_missing_model_and_revision_conflict(monkeypatch):
    monkeypatch.setattr(service, "ensure_model_config_writes_enabled", lambda: None)
    monkeypatch.setattr(service, "config_revision", lambda _path: "current")
    monkeypatch.setattr(service, "load_user_config", lambda _path: SimpleNamespace(providers={}))
    with pytest.raises(service.ConfigConflict):
        service.delete_provider_model("provider", "model", expected_revision="stale", path="isolated.toml")
    with pytest.raises(service.ConfigError, match="not found"):
        service.delete_provider_model("provider", "model", expected_revision="current", path="isolated.toml")
