from __future__ import annotations

import asyncio
from dataclasses import replace
import json

import httpx

from drsai.config.capability_probe import CapabilityProbeService, build_capability_snapshot
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.config.model_operation_adapters import OpenAITextOperationAdapter
from drsai.config.gemini_operation_adapter import GeminiGenerateContentAdapter
from drsai.config.model_operation_routing import resolve_agent_operation


def _resolved(operation):
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "requires_api_key": False,
        "models": {"deepseek-v4-flash": {"input_modalities": ["text"], "output_modalities": ["text"], "capabilities": ["chat", "tool_calling", "reasoning"]}},
    }}})
    policy = AgentModelPolicy(agent_id="my-drsai", primary_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "deepseek-v4-flash")))
    return resolve_agent_operation(config, policy, role="primary_model", operation=operation, require_credentials=False)


def _resolved_gemini(operation):
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example", "requires_api_key": False, "wire_api": "gemini",
        "models": {"gemini-3.6-flash": {"input_modalities": ["text", "image"], "output_modalities": ["text"], "capabilities": ["chat", "tool_calling"]}},
    }}})
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        image_understanding_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "gemini-3.6-flash")),
    )
    return resolve_agent_operation(
        config, policy, role="image_understanding_model", operation=operation, require_credentials=False,
    )


def _resolved_openai_vision(operation="chat"):
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "requires_api_key": False,
        "models": {"gpt-5.6-luna": {
            "input_modalities": ["text", "image"], "output_modalities": ["text"],
            "capabilities": ["chat", "tool_calling"], "api_protocol": "openai",
        }},
    }}})
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        image_understanding_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "gpt-5.6-luna")),
    )
    return resolve_agent_operation(
        config, policy, role="image_understanding_model", operation=operation, require_credentials=False,
    )


def test_chat_probe_requires_semantic_assertion_not_only_http_200() -> None:
    good = CapabilityProbeService(text_adapter=OpenAITextOperationAdapter(transport=httpx.MockTransport(
        lambda _r: httpx.Response(200, json={"id": "r", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "pong"}]}]})
    )))
    result, _ = asyncio.run(good.probe(_resolved("chat"), agent_id="my-drsai", protocol="openai_responses"))
    assert result.status == "verified" and result.assertions[0].passed

    bad = CapabilityProbeService(text_adapter=OpenAITextOperationAdapter(transport=httpx.MockTransport(
        lambda _r: httpx.Response(200, json={"id": "r", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "something else"}]}]})
    )))
    result, _ = asyncio.run(bad.probe(_resolved("chat"), agent_id="my-drsai", protocol="openai_responses"))
    assert result.status == "inconclusive" and result.error_code == "capability_assertion_failed"


def test_tool_probe_requires_structured_name_and_arguments() -> None:
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={
        "id": "r", "status": "completed", "output": [{"type": "function_call", "call_id": "c", "name": "calculator_add", "arguments": "{\"a\":17,\"b\":25}"}],
    })))
    result, _ = asyncio.run(CapabilityProbeService(text_adapter=adapter).probe(
        _resolved("tool_calling"), agent_id="my-drsai", protocol="openai_responses",
    ))
    assert result.status == "verified" and len(result.assertions) == 3


def test_gemini_tool_probe_uses_native_function_declaration() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        declaration = payload["tools"][0]["functionDeclarations"][0]
        assert declaration["name"] == "calculator_add"
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{
            "functionCall": {"name": "calculator_add", "args": {"a": 17, "b": 25}},
        }]}}]})

    service = CapabilityProbeService(
        gemini_adapter=GeminiGenerateContentAdapter(transport=httpx.MockTransport(handler)),
    )
    result, _ = asyncio.run(service.probe(
        _resolved_gemini("tool_calling"), agent_id="my-drsai", protocol="gemini_generate_content",
    ))
    assert result.status == "verified"
    assert all(item.passed for item in result.assertions)


def test_openai_vision_probe_executes_responses_with_image_input() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        payload = json.loads(request.content)
        content = payload["input"][0]["content"]
        assert content[0]["type"] == "input_text"
        assert content[1]["type"] == "input_image"
        assert content[1]["image_url"].startswith("data:image/png;base64,")
        return httpx.Response(200, json={
            "id": "resp-vision", "status": "completed",
            "output": [{"type": "message", "content": [{
                "type": "output_text", "text": '{"background":"red","center":"blue","shape":"circle"}',
            }]}],
        })

    service = CapabilityProbeService(
        text_adapter=OpenAITextOperationAdapter(transport=httpx.MockTransport(handler)),
    )
    result, _ = asyncio.run(service.probe(
        _resolved_openai_vision(), agent_id="my-drsai", protocol="openai_responses",
    ))
    assert result.protocol == "openai_responses"
    assert result.status == "verified"
    assert all(item.passed for item in result.assertions)


def test_snapshot_digest_is_stable_across_creation_time_and_contains_no_secret() -> None:
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={
        "id": "r", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "pong"}]}],
    })))
    result, _ = asyncio.run(CapabilityProbeService(text_adapter=adapter).probe(
        _resolved("chat"), agent_id="my-drsai", protocol="openai_responses",
        revisions={"provider_config": "a", "agent_policy": "b", "model_catalog": "c", "route_rules": "d", "probe_definition": "e"},
    ))
    first = build_capability_snapshot("my-drsai", [result], {"code": "one"})
    second = build_capability_snapshot("my-drsai", [result], {"code": "one"})
    assert first["digest"] == second["digest"]
    third = build_capability_snapshot("my-drsai", [replace(
        result, probe_id="probe-other", started_at="2030-01-01T00:00:00+00:00", duration_ms=result.duration_ms + 999,
    )], {"code": "one"})
    assert first["digest"] == third["digest"]
    assert "authorization" not in json.dumps(first).casefold()
