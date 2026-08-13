from __future__ import annotations

import asyncio

from drsai.config import ProviderDraft, probe_provider_draft
from drsai.config import probe as probe_module
from drsai.config import resolver as resolver_module
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


def test_draft_probe_is_explicitly_non_persistent(monkeypatch) -> None:
    captured = {}

    async def fake_probe(resolved, *, timeout, mode, record_history):
        assert record_history is False
        captured["secret"] = resolved.provider.api_key.reveal()
        captured["mode"] = mode
        return {"ok": True, "provider": resolved.provider.name, "wire_api": resolved.provider.wire_api, "mode": mode}

    monkeypatch.setattr(probe_module, "test_provider_connection", fake_probe)
    result = asyncio.run(probe_provider_draft(
        ProviderDraft(
            name="draft",
            base_url="https://provider.example/v1",
            model="draft-model",
            api_key="draft-secret",
        ),
        mode="basic",
        environ={},
    ))

    assert result["ok"] is True
    assert result["persisted"] is False
    assert result["may_incur_cost"] is False
    assert captured == {"secret": "draft-secret", "mode": "basic"}
    assert "draft-secret" not in repr(result)


def test_draft_probe_resolves_saved_credential_reference(monkeypatch) -> None:
    captured = {}

    async def fake_probe(resolved, *, timeout, mode, record_history):
        assert record_history is False
        captured["secret"] = resolved.provider.api_key.reveal()
        captured["source"] = resolved.provider.api_key_source
        return {"ok": True, "provider": resolved.provider.name, "mode": mode}

    monkeypatch.setattr(probe_module, "test_provider_connection", fake_probe)
    monkeypatch.setattr(resolver_module, "resolve_credential", lambda target: "saved-secret" if target == "saved-target" else None)
    result = asyncio.run(probe_provider_draft(
        ProviderDraft(
            name="saved",
            base_url="https://provider.example/v1",
            model="saved-model",
            api_key_credential="saved-target",
        ),
        mode="basic",
        environ={},
    ))

    assert result["ok"] is True
    assert captured == {"secret": "saved-secret", "source": "credential"}


def test_model_probe_marks_possible_cost(monkeypatch) -> None:
    async def fake_probe(resolved, *, timeout, mode, record_history):
        assert record_history is False
        return {"ok": True, "provider": resolved.provider.name, "wire_api": resolved.provider.wire_api, "mode": mode}

    monkeypatch.setattr(probe_module, "test_provider_connection", fake_probe)
    result = asyncio.run(probe_provider_draft(
        ProviderDraft(
            name="local",
            base_url="http://127.0.0.1:11434/v1",
            model="qwen",
            requires_api_key=False,
        ),
        mode="model",
        environ={},
    ))

    assert result["may_incur_cost"] is True


def test_hepai_draft_probe_uses_request_scoped_oidc_credentials(monkeypatch) -> None:
    captured = {}

    async def fake_probe(resolved, *, timeout, mode, record_history):
        assert record_history is False
        captured["base_url"] = resolved.provider.base_url
        captured["secret"] = resolved.provider.api_key.reveal()
        return {"ok": True, "provider": resolved.provider.name, "mode": mode}

    monkeypatch.setattr(probe_module, "test_provider_connection", fake_probe)
    auth = PlatformAuthContext(
        access_token="oidc-test-token",
        subject="test-user",
        issuer="https://issuer.example",
        expires_at=4_102_444_800,
        model_base_url="https://models.example/apiv2/v1",
    )

    with platform_auth_scope(auth):
        result = asyncio.run(probe_provider_draft(
            ProviderDraft(
                name="hepai",
                base_url="https://legacy.example/apiv2",
                model="deepseek-v4-pro",
            ),
            mode="basic",
            environ={},
        ))

    assert result["ok"] is True
    assert captured == {
        "base_url": "https://models.example/apiv2/v1",
        "secret": "oidc-test-token",
    }
