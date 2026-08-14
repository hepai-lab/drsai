from __future__ import annotations

import pytest

from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


def _tool(name: str) -> dict:
    return {
        "name": name, "version": 1, "source": "android-host", "classification": "local-equivalent",
        "description": name, "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def _command(kind: MessageType, sequence: int, payload: dict, *, key: str | None = None) -> RuntimeEnvelope:
    return RuntimeEnvelope(kind, f"request-{sequence}", "run-1", "session-1", sequence, key or f"key-{sequence}", payload)


def _kinds(events) -> list[str]:
    return [item.payload["kind"] for item in events if item.message_type is MessageType.RUNTIME_EVENT]


def test_recent_task_buffers_unverified_stream_and_reprompts_for_available_tool() -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "核实今天最新的 AI 新闻并给出来源", "model_id": "model", "tools": [_tool("web.search")],
    }))

    assert core.handle(_command(MessageType.MODEL_CHUNK, 1, {"delta": "未经核实的答案"})) == ()
    retry = core.handle(_command(MessageType.MODEL_COMPLETED, 2, {"content": "未经核实的答案"}))

    assert _kinds(retry) == ["tool.decision", "verification.required"]
    assert retry[-1].message_type is MessageType.MODEL_REQUEST
    assert retry[-1].payload["tools"][0]["name"] == "web.search"
    assert "未经核实的答案" not in str(retry)
    assert core.snapshot("run-1")["verification_retry_count"] == 1


def test_matching_retrieval_tool_is_allowed_after_verification_retry() -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "Verify today's latest AI news with sources", "model_id": "model", "tools": [_tool("web.search")],
    }))
    core.handle(_command(MessageType.MODEL_COMPLETED, 1, {"content": "guess"}))
    selected = core.handle(_command(MessageType.MODEL_COMPLETED, 2, {"tool_calls": [
        {"call_id": "search-1", "name": "web.search", "arguments": {}},
    ]}))

    assert "required_tool_selected" in [
        item.payload.get("category") for item in selected if item.payload.get("kind") == "tool.decision"
    ]
    assert any(item.message_type is MessageType.TOOL_CALL_REQUEST for item in selected)


@pytest.mark.parametrize("tool_name", [
    "web.search", "web_search", "knowledge_search", "browser.search", "mcp.search",
])
def test_desktop_and_android_retrieval_tool_aliases_satisfy_same_policy(tool_name: str) -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "HEPiX是什么？", "model_id": "model", "tools": [_tool(tool_name)],
    }))
    selected = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "search-1", "name": tool_name, "arguments": {}},
    ]}))

    decision = next(item.payload for item in selected if item.payload.get("kind") == "tool.decision")
    assert decision["category"] == "required_tool_selected"
    assert any(item.message_type is MessageType.TOOL_CALL_REQUEST for item in selected)


def test_wrong_tool_cannot_satisfy_required_retrieval() -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "Verify today's latest AI news with sources", "model_id": "model",
        "tools": [_tool("web.search"), _tool("get_current_time")],
    }))
    retry = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "wrong-1", "name": "get_current_time", "arguments": {}},
    ]}))

    assert _kinds(retry) == ["tool.decision", "verification.required"]
    assert not any(item.message_type is MessageType.TOOL_CALL_REQUEST for item in retry)
    assert core.snapshot("run-1")["completed_side_effects"] == []


def test_hepix_without_retrieval_overrides_model_guess_with_clear_limitation() -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "HEPiX2026是什么？", "model_id": "model", "tools": [_tool("get_current_time")],
    }))
    completed = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {"content": "HEPiX2026 是一个虚构答案"}))

    assert _kinds(completed) == [
        "tool.decision", "verification.unavailable", "message.completed", "run.completed",
    ]
    message = next(item.payload["text"] for item in completed if item.payload.get("kind") == "message.completed")
    assert "缺少" in message and "Desktop Runtime" in message
    assert "虚构答案" not in str(completed)
    assert core.snapshot("run-1")["phase"] == "completed"


@pytest.mark.parametrize("prompt", [
    "2 + 2 等于多少？",
    "法国的首都是哪里？",
    "你更喜欢清晰还是华丽的技术文档？",
])
def test_stable_arithmetic_common_knowledge_and_opinion_are_not_forced_to_use_tool(prompt: str) -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": prompt, "model_id": "model", "tools": [_tool("web.search")],
    }))
    completed = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {"content": "direct"}))

    assert _kinds(completed) == ["tool.decision", "message.completed", "run.completed"]
    decision = next(item.payload for item in completed if item.payload.get("kind") == "tool.decision")
    assert decision["category"] == "direct_answer"


def test_satisfied_required_retrieval_allows_later_multistep_tools() -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "搜索 HEPiX 2026，再读取本地方案并生成比较报告",
        "model_id": "model",
        "tools": [_tool("web.search"), _tool("workspace.read")],
    }))
    selected = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {
        "tool_calls": [{"call_id": "search-1", "name": "web.search", "arguments": {"query": "HEPiX 2026"}}],
    }))
    assert "tool.started" in _kinds(selected)
    core.handle(_command(MessageType.TOOL_RESULT, 2, {
        "call_id": "search-1", "succeeded": True,
        "content": {"items": [{"title": "HEPiX", "url": "https://www.hepix.org/"}]},
    }))

    continued = core.handle(_command(MessageType.MODEL_COMPLETED, 3, {
        "tool_calls": [{"call_id": "read-1", "name": "workspace.read", "arguments": {"path": "notes.md"}}],
    }))

    assert _kinds(continued)[:2] == ["tool.decision", "tool.started"]
    decision = next(item.payload for item in continued if item.payload.get("kind") == "tool.decision")
    assert decision["category"] == "required_tool_satisfied"
    assert decision["reason"] == "prior_matching_tool_result_available"


def test_second_required_tool_omission_fails_closed_and_retry_count_survives_checkpoint() -> None:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": "Verify today's latest AI news with sources", "model_id": "model", "tools": [_tool("web.search")],
    }))
    first = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {"content": "guess"}))
    checkpoint = next(item for item in first if item.message_type is MessageType.CHECKPOINT_REQUEST)
    recovered = create_mobile_agent_core()
    recovered.handle(_command(MessageType.RESUME_RUN, 2, {"state": checkpoint.payload["state"]}, key="resume"))
    failed = recovered.handle(_command(MessageType.MODEL_COMPLETED, 3, {"content": "guess again"}, key="second"))

    assert _kinds(failed) == ["tool.decision", "run.failed"]
    failure = next(item.payload for item in failed if item.payload.get("kind") == "run.failed")
    assert failure["code"] == "verification_required_tool_omitted"
