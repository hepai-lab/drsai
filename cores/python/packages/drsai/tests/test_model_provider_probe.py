from __future__ import annotations

import asyncio

from drsai.config import ProviderDraft, probe_provider_draft
from drsai.config import probe as probe_module


def test_draft_probe_is_explicitly_non_persistent(monkeypatch) -> None:
    captured = {}

    async def fake_probe(resolved, *, timeout, mode):
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


def test_model_probe_marks_possible_cost(monkeypatch) -> None:
    async def fake_probe(resolved, *, timeout, mode):
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
