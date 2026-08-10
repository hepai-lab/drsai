import asyncio
from types import SimpleNamespace

from autogen_core.models import CreateResult, RequestUsage
from drsai.modules.components.model_client.LLMClient import HepAIChatCompletionClient


def test_responses_request_translates_chat_messages_tools_and_token_limit() -> None:
    params = SimpleNamespace(
        messages=[
            {"role": "system", "content": "be useful"},
            {"role": "user", "content": "weather?"},
            {"role": "assistant", "content": None, "tool_calls": [{
                "id": "call-1",
                "type": "function",
                "function": {"name": "weather", "arguments": '{"city":"Beijing"}'},
            }]},
            {"role": "tool", "tool_call_id": "call-1", "content": "sunny"},
        ],
        tools=[{"type": "function", "function": {
            "name": "weather",
            "description": "Get weather",
            "parameters": {"type": "object"},
            "strict": True,
        }}],
        create_args={
            "model": "deepseek-v4-flash",
            "max_tokens": 2048,
            "response_format": {"type": "json_object"},
        },
        response_format=None,
    )

    request = HepAIChatCompletionClient._responses_request(params)

    assert request["model"] == "deepseek-v4-flash"
    assert request["max_output_tokens"] == 2048
    assert "max_tokens" not in request
    assert "response_format" not in request
    assert request["text"] == {"format": {"type": "json_object"}}
    assert request["input"][2] == {
        "type": "function_call",
        "call_id": "call-1",
        "name": "weather",
        "arguments": '{"city":"Beijing"}',
    }
    assert request["input"][3] == {
        "type": "function_call_output",
        "call_id": "call-1",
        "output": "sunny",
    }
    assert request["tools"] == [{
        "type": "function",
        "name": "weather",
        "description": "Get weather",
        "parameters": {"type": "object"},
        "strict": True,
    }]


def test_responses_stream_maps_function_call_and_usage() -> None:
    class _Stream:
        def __init__(self) -> None:
            self._events = iter([
                SimpleNamespace(
                    type="response.output_item.added",
                    output_index=0,
                    item=SimpleNamespace(
                        type="function_call", id="item-1", call_id="call-1",
                        name="weather", arguments="",
                    ),
                ),
                SimpleNamespace(
                    type="response.function_call_arguments.delta",
                    item_id="item-1",
                    delta='{"city":"Beijing"}',
                ),
                SimpleNamespace(
                    type="response.completed",
                    response=SimpleNamespace(
                        status="completed",
                        output=[],
                        usage=SimpleNamespace(input_tokens=12, output_tokens=7),
                    ),
                ),
            ])

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._events)
            except StopIteration:
                raise StopAsyncIteration

    captured = {}

    async def create(**kwargs):
        captured.update(kwargs)
        return _Stream()

    client = object.__new__(HepAIChatCompletionClient)
    client._client = SimpleNamespace(responses=SimpleNamespace(create=create))
    client._total_usage = RequestUsage(prompt_tokens=0, completion_tokens=0)
    client._actual_usage = RequestUsage(prompt_tokens=0, completion_tokens=0)
    params = SimpleNamespace(
        messages=[{"role": "user", "content": "weather?"}],
        tools=[],
        create_args={"model": "deepseek-v4-flash"},
        response_format=None,
    )
    client._process_create_args = lambda *_args, **_kwargs: params

    async def collect():
        return [item async for item in client._create_responses_stream(
            [], tools=[], json_output=None, extra_create_args={}, cancellation_token=None,
        )]

    items = asyncio.run(collect())
    result = next(item for item in items if isinstance(item, CreateResult))
    assert captured["stream"] is True
    assert captured["input"] == [{"role": "user", "content": "weather?"}]
    assert result.content[0].id == "call-1"
    assert result.content[0].name == "weather"
    assert result.content[0].arguments == '{"city":"Beijing"}'
    assert result.usage == RequestUsage(prompt_tokens=12, completion_tokens=7)
