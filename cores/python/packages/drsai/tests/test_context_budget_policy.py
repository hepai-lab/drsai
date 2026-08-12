from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import (
    CONTEXT_BUDGET_POLICY_VERSION,
    ContextBudgetPolicy,
    assemble_agent_context,
    build_context_observability,
    estimate_context_tokens,
)


def budget(window: int = 4_096, reserve: int = 1_024, messages: int = 20, summary: int = 256) -> dict:
    return {
        "policy_version": CONTEXT_BUDGET_POLICY_VERSION,
        "context_window_tokens": window,
        "reserved_output_tokens": reserve,
        "max_messages": messages,
        "summary_tokens": summary,
    }


def context_cost(messages: list[dict]) -> int:
    return sum(4 + estimate_context_tokens(message) for message in messages)


def test_500_turn_context_is_compacted_with_system_and_current_intent_pinned() -> None:
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"turn-{index} " + "x" * 180}
        for index in range(1_000)
    ]
    policy = ContextBudgetPolicy.from_mapping(budget(messages=18))
    result = assemble_agent_context(history, "CURRENT-INTENT", context_budget=budget(messages=18))

    assert len(result) <= 18
    assert result[0]["role"] == "system"
    assert "[TOOL_POLICY]" in result[0]["content"]
    assert result[-1] == {"role": "user", "content": "CURRENT-INTENT"}
    assert any("EARLIER_CONVERSATION_SUMMARY" in message["content"] for message in result)
    assert context_cost(result) <= policy.input_tokens


def test_unicode_estimator_and_budget_use_utf8_not_character_count() -> None:
    assert estimate_context_tokens("😀" * 100) > estimate_context_tokens("a" * 100)
    result = assemble_agent_context(
        [{"role": "user", "content": "数据😀" * 1_000}],
        "继续",
        context_budget=budget(window=2_048, reserve=512, messages=8, summary=128),
    )
    assert context_cost(result) <= 1_536
    assert result[-1]["content"] == "继续"


def test_recent_tool_call_and_results_are_never_split_by_compaction() -> None:
    call = {"id": "call-1", "type": "function", "function": {"name": "search", "arguments": "{}"}}
    history = [
        *({"role": "user", "content": "old " + "x" * 300} for _ in range(40)),
        {"role": "assistant", "content": "", "tool_calls": [call]},
        {"role": "tool", "tool_call_id": "call-1", "content": '{"verified":true}'},
    ]
    result = assemble_agent_context(history, "finish", context_budget=budget(messages=10))
    assistant_index = next(index for index, value in enumerate(result) if value.get("tool_calls"))
    assert result[assistant_index + 1]["role"] == "tool"
    assert result[assistant_index + 1]["tool_call_id"] == "call-1"


def test_active_tool_chain_long_result_is_bounded_without_dropping_receipt_identity() -> None:
    call = {"id": "call-large", "type": "function", "function": {"name": "read", "arguments": "{}"}}
    original = "数据😀" * 8_000
    result = assemble_agent_context(
        [
            {"role": "assistant", "content": "", "tool_calls": [call]},
            {"role": "tool", "tool_call_id": "call-large", "content": original},
        ],
        "finish",
        context_budget=budget(window=2_048, reserve=512),
    )
    assistant_index = next(index for index, value in enumerate(result) if value.get("tool_calls"))
    receipt = result[assistant_index + 1]
    bounded = __import__("json").loads(receipt["content"])
    assert receipt["tool_call_id"] == "call-large"
    assert bounded["truncated"] is True
    assert bounded["original_chars"] == len(original)
    assert len(bounded["sha256"]) == 64
    assert bounded["preview"] and bounded["preview"] in original
    assert context_cost(result) <= 1_536


def test_multiple_active_tool_receipts_remain_ordered_when_bounded() -> None:
    calls = [
        {"id": "call-a", "type": "function", "function": {"name": "read", "arguments": "{}"}},
        {"id": "call-b", "type": "function", "function": {"name": "search", "arguments": "{}"}},
    ]
    result = assemble_agent_context(
        [
            {"role": "assistant", "content": "", "tool_calls": calls},
            {"role": "tool", "tool_call_id": "call-a", "content": "A" * 20_000},
            {"role": "tool", "tool_call_id": "call-b", "content": "B" * 20_000},
        ],
        "finish",
        context_budget=budget(window=2_048, reserve=512),
    )
    assistant_index = next(index for index, value in enumerate(result) if value.get("tool_calls"))
    assert [value["tool_call_id"] for value in result[assistant_index + 1:assistant_index + 3]] == ["call-a", "call-b"]
    assert all(__import__("json").loads(value["content"])["truncated"] for value in result[assistant_index + 1:assistant_index + 3])


def test_context_observability_is_redacted_and_explains_absent_and_trimmed_layers() -> None:
    agent = {"project_instructions": "secret project body"}
    skills = [{
        "id": "local", "version": 1, "source": "C:\\private\\SKILL.md",
        "availability": "local", "instructions": "secret skill body",
    }]
    history = [{"role": "user", "content": "old secret " + "x" * 300} for _ in range(60)]
    messages = assemble_agent_context(history, "current", agent=agent, skills=skills, context_budget=budget(messages=10))
    diagnostic = build_context_observability(
        agent, skills, messages, budget(messages=10), history_message_count=len(history),
    )
    encoded = str(diagnostic)
    assert "secret project body" not in encoded and "secret skill body" not in encoded
    assert "C:\\private" not in encoded
    assert any(value["id"] == "memory" and value["status"] == "absent" for value in diagnostic["layers"])
    assert diagnostic["omitted_history_messages"] > 0
    assert diagnostic["trim_reason"] == "token_or_message_budget"
    assert diagnostic["context"]["estimated_input_tokens"] <= diagnostic["context"]["input_tokens"]


@pytest.mark.parametrize(
    "value,error",
    [
        ({"context_window_tokens": 1_000}, "context_window_tokens_invalid"),
        ({"reserved_output_tokens": 32_768}, "context_output_reserve_invalid"),
        ({"summary_tokens": -1}, "context_summary_budget_invalid"),
        ({"unknown": 1}, "context_budget_field_unsupported"),
    ],
)
def test_context_budget_contract_fails_closed(value: dict, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        ContextBudgetPolicy.from_mapping(value)
