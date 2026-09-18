"""Regression tests for tool-call assembly in the streaming Responses client.

``HepAIChatCompletionClient._create_responses_stream`` used to key its
accumulator on one field of each stream event. An OpenAI-compatible gateway
that omits ``item.id`` on ``response.output_item.added`` and reports it only on
the final ``response.completed`` item therefore accumulated the *same* logical
call twice, both entries carrying the same ``call_id`` -- and
``agent_kernel.validate_tool_call_batch`` failed the whole run with
``tool_call_id_duplicate`` ("❌ 工具批次校验失败").

The events below are the shapes seen from real deployments; `_run()` drives the
real client method against a faked ``self._client.responses.create`` stream, so
no network access is required.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, Iterable, List

import pytest

from drsai.backend.runtime.agent_kernel import validate_tool_call_batch
from drsai.modules.components.model_client.LLMClient import (
    HepAIChatCompletionClient,
    merge_duplicate_function_calls,
)


class _FakeAsyncStream:
    """Minimal async iterable standing in for the OpenAI SDK stream object."""

    def __init__(self, events: Iterable[Any]) -> None:
        self._events = list(events)

    def __aiter__(self):
        async def _gen():
            for event in self._events:
                yield event

        return _gen()


def _item(**kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)


def _event(event_type: str, **kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(type=event_type, **kwargs)


def _response(items: List[Any]) -> SimpleNamespace:
    return SimpleNamespace(
        status="completed",
        usage=SimpleNamespace(input_tokens=11, output_tokens=7),
        output=items,
    )


def _client(events: Iterable[Any]) -> HepAIChatCompletionClient:
    client = HepAIChatCompletionClient(
        model="openai/gpt-5.6-sol",
        api_key="sk-test",
        base_url="https://example.invalid/v1",
        model_info={
            "vision": False,
            "function_calling": True,
            "json_output": False,
            "family": "unknown",
            "structured_output": False,
        },
        use_responses_api=True,
    )

    async def _create(**kwargs: Any) -> _FakeAsyncStream:
        return _FakeAsyncStream(events)

    client._client = SimpleNamespace(  # type: ignore[attr-defined]
        responses=SimpleNamespace(create=_create),
        api_key="sk-test",
        base_url="https://example.invalid/v1",
    )
    return client


def _run(events: Iterable[Any]) -> List[Any]:
    """Drive the real stream adapter and return the assembled tool calls."""

    async def _drain() -> List[Any]:
        client = _client(events)
        result = None
        async for chunk in client._create_responses_stream(
            [],
            tools=[],
            json_output=None,
            extra_create_args={},
            cancellation_token=None,
        ):
            result = chunk
        assert result is not None
        assert isinstance(result.content, list)
        return result.content

    return asyncio.run(_drain())


@pytest.fixture
def kernel_registry(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Stub only the registry lookup so the kernel's batch invariants stay live."""

    monkeypatch.setattr(
        "drsai.backend.runtime.agent_kernel.execution_tool_record",
        lambda registry, name: {
            "name": name,
            "risk": "local_write",
            "approval_mode": "none",
            "executor_id": f"manager:{name}",
        },
    )
    return {"sha256": "test"}


def test_item_id_only_on_final_item_assembles_one_call() -> None:
    """`added` without `item.id` must not create a second entry for the call."""

    calls = _run([
        _event(
            "response.output_item.added",
            output_index=0,
            item=_item(
                type="function_call",
                id=None,
                call_id="call_A",
                name="TodoWrite",
                arguments="",
            ),
        ),
        _event(
            "response.function_call_arguments.delta",
            item_id="fc_A",
            delta='{"items":[{"content":"x","status":"completed"}]}',
        ),
        _event(
            "response.completed",
            response=_response([
                _item(
                    type="function_call",
                    id="fc_A",
                    call_id="call_A",
                    name="TodoWrite",
                    arguments='{"items":[{"content":"x","status":"completed"}]}',
                ),
            ]),
        ),
    ])

    assert [call.id for call in calls] == ["call_A"]
    assert [call.name for call in calls] == ["TodoWrite"]
    assert calls[0].arguments == '{"items":[{"content":"x","status":"completed"}]}'


def test_repaired_batch_passes_the_kernel_validator(kernel_registry) -> None:
    """End-to-end: the batch that used to die with `tool_call_id_duplicate`."""

    calls = _run([
        _event(
            "response.output_item.added",
            output_index=0,
            item=_item(type="function_call", id=None, call_id="call_A", name="TodoWrite", arguments=""),
        ),
        _event(
            "response.completed",
            response=_response([
                _item(
                    type="function_call",
                    id="fc_A",
                    call_id="call_A",
                    name="TodoWrite",
                    arguments='{"items":[]}',
                ),
            ]),
        ),
    ])

    records = validate_tool_call_batch(kernel_registry, calls, max_parallel_tool_calls=8)
    assert [record["name"] for record in records] == ["TodoWrite"]


def test_duplicate_ids_are_still_rejected_by_the_kernel(kernel_registry) -> None:
    """The producer was fixed; the kernel invariant must stay fail-closed."""

    duplicated = [
        SimpleNamespace(id="call_A", name="TodoWrite", arguments="{}"),
        SimpleNamespace(id="call_A", name="TodoWrite", arguments="{}"),
    ]
    with pytest.raises(ValueError, match="tool_call_id_duplicate"):
        validate_tool_call_batch(kernel_registry, duplicated, max_parallel_tool_calls=8)


def test_headerless_added_event_is_dropped_not_reported_as_malformed() -> None:
    """A header-less stub plus a well-formed final item is one usable call."""

    calls = _run([
        _event(
            "response.output_item.added",
            output_index=0,
            item=_item(type="function_call", id=None, call_id=None, name="", arguments=""),
        ),
        _event(
            "response.completed",
            response=_response([
                _item(
                    type="function_call",
                    id="fc_A",
                    call_id="call_A",
                    name="TodoWrite",
                    arguments='{"items":[]}',
                ),
            ]),
        ),
    ])

    assert [(call.id, call.name) for call in calls] == [("call_A", "TodoWrite")]


def test_canonical_event_shape_is_unchanged() -> None:
    calls = _run([
        _event(
            "response.output_item.added",
            output_index=0,
            item=_item(type="function_call", id="fc_A", call_id="call_A", name="read", arguments=""),
        ),
        _event("response.function_call_arguments.delta", item_id="fc_A", delta='{"path":"a.txt"}'),
        _event(
            "response.completed",
            response=_response([
                _item(type="function_call", id="fc_A", call_id="call_A", name="read", arguments='{"path":"a.txt"}'),
            ]),
        ),
    ])

    assert [(call.id, call.name, call.arguments) for call in calls] == [
        ("call_A", "read", '{"path":"a.txt"}'),
    ]


def test_parallel_calls_keep_their_arguments_and_order() -> None:
    calls = _run([
        _event(
            "response.output_item.added",
            output_index=0,
            item=_item(type="function_call", id="fc_A", call_id="call_A", name="read", arguments=""),
        ),
        _event(
            "response.output_item.added",
            output_index=1,
            item=_item(type="function_call", id="fc_B", call_id="call_B", name="glob", arguments=""),
        ),
        _event("response.function_call_arguments.delta", item_id="fc_A", delta='{"path":"a.txt"}'),
        _event("response.function_call_arguments.delta", item_id="fc_B", delta='{"pattern":"*.py"}'),
        _event(
            "response.completed",
            response=_response([
                _item(type="function_call", id="fc_A", call_id="call_A", name="read", arguments='{"path":"a.txt"}'),
                _item(type="function_call", id="fc_B", call_id="call_B", name="glob", arguments='{"pattern":"*.py"}'),
            ]),
        ),
    ])

    assert [(call.id, call.name, call.arguments) for call in calls] == [
        ("call_A", "read", '{"path":"a.txt"}'),
        ("call_B", "glob", '{"pattern":"*.py"}'),
    ]


def test_merge_duplicate_function_calls_keeps_first_position_and_richest_args() -> None:
    from autogen_core import FunctionCall

    merged = merge_duplicate_function_calls([
        FunctionCall(id="call_A", name="", arguments=""),
        FunctionCall(id="call_B", name="glob", arguments='{"pattern":"*.py"}'),
        FunctionCall(id="call_A", name="read", arguments='{"path":"a.txt"}'),
    ])

    assert [(call.id, call.name, call.arguments) for call in merged] == [
        ("call_A", "read", '{"path":"a.txt"}'),
        ("call_B", "glob", '{"pattern":"*.py"}'),
    ]
