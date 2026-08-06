from __future__ import annotations

import asyncio
from types import SimpleNamespace

from drsai.backend import gateway
from drsai.config.capability_probe import CapabilityProbeResult, ProbeAssertion
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef


def _config():
    return parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "requires_api_key": False,
        "models": {"deepseek-v4-flash": {
            "input_modalities": ["text"], "output_modalities": ["text"],
            "capabilities": ["chat", "tool_calling", "reasoning"],
        }},
    }}})


def test_gateway_capability_probe_uses_agent_bound_model_and_returns_redacted_result(monkeypatch) -> None:
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "deepseek-v4-flash")),
    )
    monkeypatch.setattr(gateway, "load_model_provider_config", _config)
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _agent: SimpleNamespace(policy=policy, revision="sha256:" + "a" * 64))
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "b" * 64)
    monkeypatch.setattr(gateway, "_runtime_model_catalog_payload", lambda _config: {"revision": "sha256:" + "c" * 64})

    class Service:
        async def probe(self, resolved, **kwargs):
            assert resolved.ref == ModelRef("zhizengzeng", "deepseek-v4-flash")
            assert kwargs["protocol"] == "openai_responses"
            return CapabilityProbeResult(
                "probe-1", "my-drsai", "zhizengzeng", "deepseek-v4-flash", "deepseek-v4-flash",
                "chat", "openai_responses", "verified", "2026-08-06T00:00:00+00:00", 10,
                (ProbeAssertion("exact_pong", True),), revisions=kwargs["revisions"],
            ), None

    monkeypatch.setattr(gateway, "CapabilityProbeService", Service)
    response = asyncio.run(gateway.probe_model_provider_capability(
        "zhizengzeng", gateway.ModelCapabilityProbeRequest(role="primary_model", operation="chat"),
    ))
    result = response["result"]
    assert result["status"] == "verified"
    assert result["protocol"] == "openai_responses"
    assert "api_key" not in result
    fetched = asyncio.run(gateway.get_model_provider_capability_probe("zhizengzeng", "probe-1"))
    assert fetched["result"] == result
    status = asyncio.run(gateway.get_agent_model_capability_status("my-drsai"))
    assert status["capabilities"] == [result]


def test_gateway_matrix_probe_explores_undeclared_operation_with_exact_agent_ref(monkeypatch) -> None:
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example", "requires_api_key": False,
        "models": {"gemini-3.6-flash": {
            "input_modalities": ["text", "image"], "output_modalities": ["text"],
            "capabilities": ["chat"],
        }},
    }}})
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        image_understanding_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "gemini-3.6-flash")),
    )
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    monkeypatch.setattr(gateway, "load_agent_model_policy", lambda _agent: SimpleNamespace(
        policy=policy, revision="sha256:" + "a" * 64,
    ))
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "b" * 64)
    monkeypatch.setattr(gateway, "_runtime_model_catalog_payload", lambda _config: {"revision": "sha256:" + "c" * 64})
    class Service:
        async def probe(self, resolved, **kwargs):
            assert resolved.ref == ModelRef("zhizengzeng", "gemini-3.6-flash")
            assert kwargs["protocol"] == "gemini_generate_content"
            return CapabilityProbeResult(
                "probe-gemini-tool", "my-drsai", "zhizengzeng", "gemini-3.6-flash", "gemini-3.6-flash",
                "tool_calling", "gemini_generate_content", "verified", "2026-08-06T00:00:00+00:00", 1,
                (ProbeAssertion("structured_tool_call", True),), revisions=kwargs["revisions"],
            ), None
    monkeypatch.setattr(gateway, "CapabilityProbeService", Service)
    result = asyncio.run(gateway.probe_model_provider_capability(
        "zhizengzeng", gateway.ModelCapabilityProbeRequest(
            role="image_understanding_model", operation="tool_calling", protocol="gemini_generate_content",
        ),
    ))["result"]
    assert result["model_id"] == "gemini-3.6-flash"
    assert result["status"] == "verified"
    assert result["evidence_kind"] == "real_provider"
