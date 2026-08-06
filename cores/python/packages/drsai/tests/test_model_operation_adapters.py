from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError, OpenAITextOperationAdapter
from drsai.config.model_operation_routing import resolve_agent_operation


def _resolved(operation="chat"):
    config = parse_user_config({
        "model_providers": {"zhizengzeng": {
            "base_url": "https://provider.example/v1", "requires_api_key": False,
            "models": {"deepseek-v4-flash": {
                "input_modalities": ["text"], "output_modalities": ["text"],
                "capabilities": ["chat", "tool_calling", "reasoning"],
            }},
        }},
    })
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "deepseek-v4-flash")),
    )
    return resolve_agent_operation(config, policy, role="primary_model", operation=operation, require_credentials=False)


def test_responses_text_reasoning_and_usage_are_normalized_without_chain_text() -> None:
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["payload"] = json.loads(request.content)
        return httpx.Response(200, json={
            "id": "resp_1", "status": "completed",
            "output": [
                {"type": "reasoning", "id": "rs_1", "summary": [{"text": "private"}]},
                {"type": "message", "content": [{"type": "output_text", "text": "42"}]},
            ],
            "usage": {"input_tokens": 12, "output_tokens": 7},
        })
    result = asyncio.run(OpenAITextOperationAdapter(transport=httpx.MockTransport(handler)).create(
        _resolved("reasoning"), protocol="openai_responses", input_value="17+25", reasoning_effort="high",
    ))
    assert seen["path"] == "/v1/responses"
    assert seen["payload"]["reasoning"] == {"effort": "high"}
    assert result.text == "42" and result.reasoning_observed is True
    assert result.input_tokens == 12 and result.output_tokens == 7
    assert "private" not in json.dumps(result.public_dict())


def test_responses_function_call_is_structured() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["tools"][0]["name"] == "calculator_add"
        return httpx.Response(200, json={
            "id": "resp_tools", "status": "completed",
            "output": [{"type": "function_call", "call_id": "call_1", "name": "calculator_add", "arguments": "{\"a\":17,\"b\":25}"}],
        })
    tool = {"type": "function", "name": "calculator_add", "parameters": {"type": "object"}}
    result = asyncio.run(OpenAITextOperationAdapter(transport=httpx.MockTransport(handler)).create(
        _resolved("tool_calling"), protocol="openai_responses", input_value="add", tools=[tool],
    ))
    assert result.tool_calls[0].arguments == {"a": 17, "b": 25}


def test_chat_tool_schema_and_result_are_normalized() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["tools"][0]["function"]["name"] == "calculator_add"
        return httpx.Response(200, json={
            "id": "chat_1", "choices": [{"finish_reason": "tool_calls", "message": {
                "content": None, "reasoning_content": "not persisted",
                "tool_calls": [{"id": "call_2", "function": {"name": "calculator_add", "arguments": "{\"a\":17,\"b\":25}"}}],
            }}], "usage": {"prompt_tokens": 9, "completion_tokens": 3},
        })
    tool = {"type": "function", "name": "calculator_add", "parameters": {"type": "object"}}
    result = asyncio.run(OpenAITextOperationAdapter(transport=httpx.MockTransport(handler)).create(
        _resolved("tool_calling"), protocol="openai_chat_completions", input_value="add", tools=[tool],
    ))
    assert result.tool_calls[0].name == "calculator_add"
    assert result.reasoning_observed is True
    assert "not persisted" not in json.dumps(result.public_dict())


@pytest.mark.parametrize(("status", "code", "retryable"), [
    (401, "authentication_failed", False), (403, "permission_denied", False),
    (404, "endpoint_not_found", False), (429, "quota_exceeded", True),
    (503, "provider_rejected", True),
])
def test_stable_http_error_classification(status, code, retryable) -> None:
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(lambda _request: httpx.Response(status)))
    with pytest.raises(ModelProtocolError) as raised:
        asyncio.run(adapter.create(_resolved(), protocol="openai_responses", input_value="ping"))
    assert raised.value.code == code and raised.value.retryable is retryable


def test_openai_compatible_502_body_classifies_model_not_found_without_leaking_body() -> None:
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(
        lambda _request: httpx.Response(502, json={"error": {"message": "Unknown model secret-internal-name"}}),
    ))
    with pytest.raises(ModelProtocolError) as raised:
        asyncio.run(adapter.create(_resolved(), protocol="openai_responses", input_value="ping"))
    assert raised.value.code == "model_not_found"
    assert raised.value.retryable is False
    assert "secret-internal-name" not in str(raised.value)


def test_invalid_tool_arguments_fail_closed() -> None:
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={
        "id": "bad", "status": "completed",
        "output": [{"type": "function_call", "call_id": "call", "name": "tool", "arguments": "not-json"}],
    })))
    with pytest.raises(ModelProtocolError) as raised:
        asyncio.run(adapter.create(_resolved("tool_calling"), protocol="openai_responses", input_value="call"))
    assert raised.value.code == "invalid_provider_response"


def test_responses_stream_normalizes_text_and_fragmented_tool_arguments() -> None:
    content = "\n".join([
        'data: {"type":"response.created","response":{"id":"resp-stream"}}',
        'data: {"type":"response.output_text.delta","delta":"answer "}',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"calculator_add","arguments":""}}',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"a\\":17,"}',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"\\"b\\":25}"}',
        'data: {"type":"response.completed","response":{"id":"resp-stream","status":"completed","usage":{"input_tokens":4,"output_tokens":3}}}',
        "data: [DONE]", "",
    ])
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(lambda _request: httpx.Response(
        200, text=content, headers={"content-type": "text/event-stream"},
    )))

    async def collect():
        return [event async for event in adapter.stream(
            _resolved("tool_calling"), protocol="openai_responses", input_value="add",
        )]

    events = asyncio.run(collect())
    assert events[0].text_delta == "answer "
    result = events[-1].result
    assert result is not None and result.response_id == "resp-stream"
    assert result.tool_calls[0].arguments == {"a": 17, "b": 25}
    assert result.input_tokens == 4 and result.output_tokens == 3


def test_chat_stream_assembles_tool_delta_and_never_persists_reasoning() -> None:
    content = "\n".join([
        'data: {"id":"chat-stream","choices":[{"delta":{"reasoning_content":"private","tool_calls":[{"index":0,"id":"call-2","function":{"name":"calculator_","arguments":"{\\"a\\":17,"}}]},"finish_reason":null}]}',
        'data: {"id":"chat-stream","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"add","arguments":"\\"b\\":25}"}}]},"finish_reason":"tool_calls"}]}',
        'data: {"id":"chat-stream","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        "data: [DONE]", "",
    ])
    adapter = OpenAITextOperationAdapter(transport=httpx.MockTransport(lambda _request: httpx.Response(
        200, text=content, headers={"content-type": "text/event-stream"},
    )))

    async def collect():
        return [event async for event in adapter.stream(
            _resolved("tool_calling"), protocol="openai_chat_completions", input_value="add",
        )]

    result = asyncio.run(collect())[-1].result
    assert result is not None and result.reasoning_observed
    assert result.tool_calls[0].name == "calculator_add"
    assert "private" not in json.dumps(result.public_dict())
