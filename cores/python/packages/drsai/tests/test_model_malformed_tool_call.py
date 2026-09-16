"""A tool call that lost its name/id in transport is retriable, not fatal.

Bug this pins down: when a provider put text *and* the tool-call header in the
**same** SSE delta (Qwen/GLM/Kimi-style gateways do this), ``create_stream``
skipped the whole ``tool_calls`` branch behind a ``continue`` ("for OpenAI,
content and tool_calls are mutually exclusive"). The assembled ``FunctionCall``
therefore kept ``name=""``/``id=""``, and the turn died in
``agent_kernel.verify_model_tool_calls`` with the unactionable, non-retryable
``ValueError: model_tool_not_in_snapshot:unknown`` — no re-sampling, no hint
that the payload (not the model's intent) was broken.

Three properties are pinned here:

1. the parser no longer drops the header when content and tool_calls share a
   chunk (``test_stream_that_carries_text_and_tool_header_in_one_chunk_...``);
2. a nameless call produced *despite* that is classified retriable
   (``ModelMalformedToolCallError`` is a ``ModelEmptyStreamError``), so the
   existing agent-level retry loop re-samples the turn — and it never reaches
   the caller as a half-finished ``CreateResult``;
3. the kernel contract check is unchanged: an out-of-snapshot *name* and a
   nameless call both still fail closed. Only the diagnostic suffix
   (``@call=...:arguments=...``) was added, and a genuine contract violation
   must stay **non**-retryable, otherwise a tool call emitted during a
   tool-free finalization turn would retry forever.
"""

from __future__ import annotations

from typing import Any

import pytest
from autogen_core import FunctionCall
from autogen_core.models import CreateResult, RequestUsage, UserMessage
from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import (
    Choice,
    ChoiceDelta,
    ChoiceDeltaToolCall,
    ChoiceDeltaToolCallFunction,
)

from drsai.backend.runtime.agent_kernel import (
    freeze_model_tool_snapshot,
    verify_model_tool_calls,
)
from drsai.modules.baseagent.drsaiagent import ModelEmptyStreamError
from drsai.modules.components.model_client.LLMClient import HepAIChatCompletionClient
from drsai.modules.model_errors import (
    ModelMalformedToolCallError,
    assert_well_formed_model_result,
)
from drsai.platform_auth import classify_model_error

# The desktop agent imports this from drsai_assistant at runtime (see
# drsai_assistant.py:227); pull it the same way so a moved/renamed helper
# breaks this test instead of silently untested retry behaviour.
from drsai.modules.agents.skills_agent.drsai_assistant import is_retryable_llm_error

MODEL_INFO: dict[str, Any] = {
    "vision": False,
    "function_calling": True,
    "json_output": True,
    "structured_output": False,
    "family": "gpt-4o",
    "multiple_system_messages": True,
    "token_model": "gpt-4o",
}

# A real frozen snapshot (not a hand-rolled mapping) so the kernel tests below
# exercise the same object shape production produces.
READ_ONLY_SNAPSHOT = freeze_model_tool_snapshot(
    "desktop",
    [{"name": "read", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}],
)


def _chunk(delta: ChoiceDelta, finish: str | None = None) -> ChatCompletionChunk:
    return ChatCompletionChunk(
        id="c1",
        created=0,
        model="fake",
        object="chat.completion.chunk",
        choices=[Choice(index=0, delta=delta, finish_reason=finish)],
    )


def _tool_call_delta(
    *, name: str | None = None, call_id: str | None = None, arguments: str | None = None
) -> ChoiceDeltaToolCall:
    return ChoiceDeltaToolCall(
        index=0,
        id=call_id,
        type="function" if call_id else None,
        function=ChoiceDeltaToolCallFunction(name=name, arguments=arguments),
    )


def _result(content: Any) -> CreateResult:
    return CreateResult(
        finish_reason="stop",
        content=content,
        usage=RequestUsage(prompt_tokens=0, completion_tokens=0),
        cached=False,
    )


async def _stream(
    chunks: list[ChatCompletionChunk],
) -> list[str | CreateResult]:
    """Run the real client parser over a fake provider chunk stream."""
    client = HepAIChatCompletionClient(
        model="gpt-4o", api_key="x", base_url="http://localhost/v1", model_info=MODEL_INFO
    )

    async def _fake_chunks(*_args: Any, **_kwargs: Any):  # noqa: ANN202 - async generator
        for item in chunks:
            yield item

    client._create_stream_chunks = _fake_chunks  # type: ignore[assignment]
    return [
        item
        async for item in client.create_stream([UserMessage(content="hi", source="user")])
    ]


# ── 1. the parser defect itself ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stream_that_carries_text_and_tool_header_in_one_chunk_keeps_name_and_id() -> None:
    """The regression: text and the header in ONE delta used to drop both."""
    events = await _stream(
        [
            _chunk(
                ChoiceDelta(
                    content="我来读取文件。",
                    tool_calls=[_tool_call_delta(name="read", call_id="call_abc")],
                )
            ),
            _chunk(ChoiceDelta(tool_calls=[_tool_call_delta(arguments='{"path":"a.py"}')])),
            _chunk(ChoiceDelta(), finish="tool_calls"),
        ]
    )
    result = events[-1]
    assert isinstance(result, CreateResult)
    assert [(call.id, call.name) for call in result.content] == [("call_abc", "read")]
    assert result.content[0].arguments == '{"path":"a.py"}'


@pytest.mark.asyncio
async def test_stream_that_splits_text_and_header_still_parses_identically() -> None:
    """The layout that always worked must keep working (no name doubling)."""
    events = await _stream(
        [
            _chunk(ChoiceDelta(content="我来读取文件。")),
            _chunk(ChoiceDelta(tool_calls=[_tool_call_delta(name="read", call_id="call_abc")])),
            _chunk(ChoiceDelta(tool_calls=[_tool_call_delta(arguments='{"path":"a.py"}')])),
            _chunk(ChoiceDelta(), finish="tool_calls"),
        ]
    )
    result = events[-1]
    assert isinstance(result, CreateResult)
    assert [(call.id, call.name) for call in result.content] == [("call_abc", "read")]
    assert result.content[0].arguments == '{"path":"a.py"}'


@pytest.mark.asyncio
async def test_headerless_tool_call_raises_a_retriable_error_and_yields_no_result() -> None:
    """A genuinely nameless call must fail *before* any CreateResult is handed out.

    Downstream (``drsai_assistant._process_model_result``) resolves calls by
    name; a nameless one can never be executed, so the parser is the last place
    that can still turn it into a re-sampled turn.
    """
    with pytest.raises(ModelMalformedToolCallError) as excinfo:
        await _stream(
            [
                _chunk(ChoiceDelta(tool_calls=[_tool_call_delta(arguments='{"path":"a.py"}')])),
                _chunk(ChoiceDelta(), finish="tool_calls"),
            ]
        )
    assert "model_malformed_tool_call" in str(excinfo.value)


@pytest.mark.asyncio
async def test_text_only_stream_is_unaffected() -> None:
    events = await _stream(
        [
            _chunk(ChoiceDelta(content="hello")),
            _chunk(ChoiceDelta(), finish="stop"),
        ]
    )
    result = events[-1]
    assert isinstance(result, CreateResult)
    assert result.content == "hello"


# ── 2. retry classification ────────────────────────────────────────────────


def test_malformed_tool_call_is_a_model_empty_stream_error() -> None:
    """Subclassing is the whole mechanism: it inherits the retriable branch."""
    assert issubclass(ModelMalformedToolCallError, ModelEmptyStreamError)


def test_malformed_tool_call_is_retriable() -> None:
    assert is_retryable_llm_error(ModelMalformedToolCallError("model_malformed_tool_call")) is True


def test_retry_classification_survives_exception_wrapping() -> None:
    """The loop walks ``__cause__``/``__context__``; keep that path working."""
    wrapped = RuntimeError("wrapper")
    wrapped.__cause__ = ModelMalformedToolCallError("model_malformed_tool_call")
    assert is_retryable_llm_error(wrapped) is True


def test_kernel_contract_violation_stays_non_retryable() -> None:
    """A *named* out-of-snapshot call is real model misbehaviour, not transport.

    Retrying it would loop forever (e.g. a tool call emitted during a
    tool-free finalization turn).
    """
    assert (
        is_retryable_llm_error(
            ValueError("model_tool_not_in_snapshot:write@call=c1:arguments='{\"path\":\"a.py\"}'")
        )
        is False
    )


def test_model_empty_stream_error_reexport_points_at_the_same_class() -> None:
    from drsai.modules.baseagent import ModelEmptyStreamError as package_level
    from drsai.modules.baseagent.drsaiagent import ModelEmptyStreamError as module_level

    assert package_level is module_level is ModelEmptyStreamError


# ── 3. the well-formedness gate ────────────────────────────────────────────


def test_assert_accepts_text_only_and_well_formed_calls() -> None:
    assert_well_formed_model_result(_result("plain text"))
    assert_well_formed_model_result(_result([]))
    assert_well_formed_model_result(
        _result([FunctionCall(id="call_1", name="read", arguments='{"path":"a.py"}')])
    )


@pytest.mark.parametrize(
    "call",
    [
        FunctionCall(id="call_1", name="", arguments="{}"),
        FunctionCall(id="", name="read", arguments="{}"),
        FunctionCall(id="call_1", name=None, arguments="{}"),  # type: ignore[arg-type]
        {"id": "call_1", "name": "", "arguments": "{}"},
        {"id": "", "name": "read", "arguments": "{}"},
    ],
    ids=["empty-name", "empty-id", "none-name", "mapping-empty-name", "mapping-empty-id"],
)
def test_assert_rejects_calls_without_a_usable_name_or_id(call: Any) -> None:
    with pytest.raises(ModelMalformedToolCallError) as excinfo:
        assert_well_formed_model_result(_result([call]))
    # The message must name the offending index/values so the log is actionable.
    assert "model_malformed_tool_call:index=0" in str(excinfo.value)


def test_assert_reports_the_offending_index() -> None:
    with pytest.raises(ModelMalformedToolCallError) as excinfo:
        assert_well_formed_model_result(
            _result(
                [
                    FunctionCall(id="call_1", name="read", arguments="{}"),
                    FunctionCall(id="call_2", name="", arguments="{}"),
                ]
            )
        )
    assert "index=1" in str(excinfo.value)
    assert "index=0" not in str(excinfo.value)


# ── 4. the kernel invariant must not have loosened ─────────────────────────


def test_snapshot_accepts_a_call_within_its_frozen_tool_set() -> None:
    verify_model_tool_calls(
        READ_ONLY_SNAPSHOT,
        [FunctionCall(id="call_1", name="read", arguments='{"path":"a.py"}')],
    )


def test_out_of_snapshot_name_still_fails_closed_with_diagnostics() -> None:
    with pytest.raises(ValueError) as excinfo:
        verify_model_tool_calls(
            READ_ONLY_SNAPSHOT,
            [FunctionCall(id="call_1", name="write", arguments='{"path":"a.py"}')],
        )
    message = str(excinfo.value)
    # Historical prefix is load-bearing: callers/tests match on it.
    assert message.startswith("model_tool_not_in_snapshot:write")
    # …plus the new suffix that tells a transport defect from model misbehaviour.
    assert "@call=call_1" in message
    assert "a.py" in message


def test_nameless_call_is_still_rejected_by_the_kernel() -> None:
    """The parser fix is a mitigation, not a licence to execute nameless calls."""
    with pytest.raises(ValueError) as excinfo:
        verify_model_tool_calls(
            READ_ONLY_SNAPSHOT, [FunctionCall(id="call_1", name="", arguments="{}")]
        )
    assert str(excinfo.value).startswith("model_tool_not_in_snapshot:unknown")


def test_mapping_shaped_calls_are_checked_too() -> None:
    with pytest.raises(ValueError) as excinfo:
        verify_model_tool_calls(
            READ_ONLY_SNAPSHOT, [{"id": "call_1", "name": "", "arguments": "{}"}]
        )
    assert str(excinfo.value).startswith("model_tool_not_in_snapshot:unknown@call=call_1")


def test_missing_or_stale_snapshot_is_a_distinct_failure() -> None:
    for snapshot in ({}, {"snapshot_version": "p9-model-tools-v0", "tools": []}):
        with pytest.raises(ValueError, match="model_tool_snapshot_invalid"):
            verify_model_tool_calls(snapshot, [FunctionCall(id="c", name="read", arguments="{}")])


def test_platform_auth_still_reports_the_contract_violation_as_non_retryable() -> None:
    """The classifier keys off the prefix, so the new suffix must not break it."""
    classified = classify_model_error(
        ValueError("model_tool_not_in_snapshot:write@call=c1:arguments='{\"path\":\"a.py\"}'")
    )
    assert classified["code"] == "model_tool_contract_violation"
    assert classified["retryable"] is False


def test_platform_auth_does_not_classify_the_malformed_call_as_a_contract_violation() -> None:
    """A transport defect must not be surfaced as "the model asked for a forbidden tool"."""
    classified = classify_model_error(ModelMalformedToolCallError("model_malformed_tool_call:index=0"))
    assert classified["code"] != "model_tool_contract_violation"
