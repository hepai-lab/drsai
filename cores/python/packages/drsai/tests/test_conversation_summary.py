from __future__ import annotations

from drsai.backend.runtime.agent_kernel import (
    assemble_agent_context,
    build_conversation_summary,
)
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


def history(turns: int) -> list[dict]:
    values: list[dict] = [
        {"role": "user", "content": "Constraint: answers must cite verified sources."},
        {"role": "assistant", "content": "TODO pending: compare Android and Desktop behavior."},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "call-verify", "name": "search", "arguments": {}}]},
        {"role": "tool", "tool_call_id": "call-verify", "name": "search", "content": "verified receipt", "succeeded": True},
    ]
    values.extend(
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"ordinary turn {index} " + "x" * 120}
        for index in range(turns * 2 - len(values))
    )
    return values


def test_summary_is_idempotent_and_pins_constraints_open_items_and_tool_receipts() -> None:
    summary = build_conversation_summary(history(100), max_chars=2_048)

    assert build_conversation_summary([{"role": "system", "content": summary}], max_chars=2_048) == summary
    assert "answers must cite verified sources" in summary
    assert "TODO pending" in summary
    assert "call_id=call-verify" in summary
    assert "sha256=" in summary


def test_100_and_500_turn_compaction_keep_critical_state_within_budget() -> None:
    for turns in (100, 500):
        result = assemble_agent_context(
            history(turns), "Continue the unfinished comparison",
            context_budget={
                "context_window_tokens": 4_096,
                "reserved_output_tokens": 1_024,
                "max_messages": 18,
                "summary_tokens": 512,
            },
        )
        summary = next(item["content"] for item in result if "EARLIER_CONVERSATION_SUMMARY" in item["content"])
        assert "answers must cite verified sources" in summary
        assert "TODO pending" in summary
        assert "call_id=call-verify" in summary
        assert result[-1]["content"] == "Continue the unfinished comparison"


def test_summary_is_deterministic_across_crash_recomputation() -> None:
    before_crash = build_conversation_summary(history(500), max_chars=4_096)
    after_restart = build_conversation_summary(history(500), max_chars=4_096)

    assert before_crash == after_restart


def test_checkpoint_after_compaction_restores_identical_model_context() -> None:
    start = RuntimeEnvelope(MessageType.START_RUN, "request-start", "run-summary", "session-summary", 0, "start", {
        "input": "Continue the unfinished comparison",
        "model_id": "fixture-model",
        "tools": [],
        "history": history(500),
        "context_budget": {
            "context_window_tokens": 4_096, "reserved_output_tokens": 1_024,
            "max_messages": 18, "summary_tokens": 512,
        },
    })
    first = create_mobile_agent_core().handle(start)
    checkpoint = next(item for item in first if item.message_type is MessageType.CHECKPOINT_REQUEST)
    before = next(item for item in first if item.message_type is MessageType.MODEL_REQUEST)
    resumed = create_mobile_agent_core().handle(RuntimeEnvelope(
        MessageType.RESUME_RUN, "request-resume", "run-summary", "session-summary", 1, "resume",
        {"state": checkpoint.payload["state"]},
    ))
    after = next(item for item in resumed if item.message_type is MessageType.MODEL_REQUEST)

    assert before.payload["messages"] == after.payload["messages"]
