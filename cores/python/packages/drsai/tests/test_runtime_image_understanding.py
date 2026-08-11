from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace

from drsai.backend import gateway
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _config():
    return parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "google_base_url": "https://provider.example/google",
        "requires_api_key": False,
        "models": {"gemini-3.6-flash": {
            "input_modalities": ["text", "image"], "output_modalities": ["text"],
            "api_protocol": "openai", "capabilities": ["chat"],
        }},
    }}})


def _policy():
    return AgentModelPolicy(
        "my-drsai",
        image_understanding_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "gemini-3.6-flash")),
    )


def test_runtime_vision_uses_bound_role_and_responses_before_primary_agent(tmp_path, monkeypatch) -> None:
    (tmp_path / "shot.png").write_bytes(PNG)
    resources = ({
        "protocol": "oaep.input/1", "resource_id": "shot", "kind": "file", "name": "shot.png",
        "reference": "shot.png", "mime": "image/png", "permission": "read", "status": "encoded",
    },)
    seen = {}

    class Adapter:
        async def create(self, resolved, **kwargs):
            seen["ref"] = resolved.ref
            seen.update(kwargs)
            return SimpleNamespace(text="red error panel with code model_unauthorized")

    monkeypatch.setattr(gateway, "OpenAITextOperationAdapter", Adapter)
    summary, evidence = asyncio.run(gateway._understand_runtime_images(
        _config(), _policy(), resources, workspace_path=tmp_path,
    ))
    assert seen["ref"] == ModelRef("zhizengzeng", "gemini-3.6-flash")
    assert seen["protocol"] == "openai_responses"
    assert seen["input_value"][0]["content"][1]["image_url"].startswith("data:image/png;base64,")
    assert "model_unauthorized" in summary
    assert evidence["model_ref"] == {"provider_id": "zhizengzeng", "model_id": "gemini-3.6-flash"}


def test_runtime_vision_falls_back_only_for_explicit_endpoint_absence(tmp_path, monkeypatch) -> None:
    (tmp_path / "shot.png").write_bytes(PNG)
    resources = ({
        "protocol": "oaep.input/1", "resource_id": "shot", "kind": "file", "name": "shot.png",
        "reference": "shot.png", "mime": "image/png", "permission": "read", "status": "encoded",
    },)
    protocols = []

    class Adapter:
        async def create(self, _resolved, **kwargs):
            protocols.append(kwargs["protocol"])
            if kwargs["protocol"] == "openai_responses":
                raise ModelProtocolError("endpoint_not_found", "missing")
            return SimpleNamespace(text="visible blue circle")

    monkeypatch.setattr(gateway, "OpenAITextOperationAdapter", Adapter)
    summary, _ = asyncio.run(gateway._understand_runtime_images(
        _config(), _policy(), resources, workspace_path=tmp_path,
    ))
    assert protocols == ["openai_responses", "openai_chat_completions"]
    assert "blue circle" in summary


def test_runtime_vision_does_not_fallback_on_authentication_failure(tmp_path, monkeypatch) -> None:
    (tmp_path / "shot.png").write_bytes(PNG)
    resources = ({
        "protocol": "oaep.input/1", "resource_id": "shot", "kind": "file", "name": "shot.png",
        "reference": "shot.png", "mime": "image/png", "permission": "read", "status": "encoded",
    },)
    protocols = []

    class Adapter:
        async def create(self, _resolved, **kwargs):
            protocols.append(kwargs["protocol"])
            raise ModelProtocolError("authentication_failed", "denied")

    monkeypatch.setattr(gateway, "OpenAITextOperationAdapter", Adapter)
    try:
        asyncio.run(gateway._understand_runtime_images(_config(), _policy(), resources, workspace_path=tmp_path))
        raise AssertionError("expected failure")
    except gateway.RuntimeExecutionError as error:
        assert error.code == "image_understanding_failed"
    assert protocols == ["openai_responses"]
