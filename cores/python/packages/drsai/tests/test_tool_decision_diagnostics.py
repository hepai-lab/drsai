from __future__ import annotations

import json

from drsai.backend.runtime.agent_kernel import build_tool_decision_requirement, resolve_tool_decision
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


def _tool(name: str) -> dict:
    return {
        "name": name,
        "version": 1,
        "source": "android-host",
        "classification": "local-equivalent",
        "description": name,
        "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [],
        "risk": "read_only",
        "requires_approval": False,
    }


def _command(kind: MessageType, sequence: int, payload: dict) -> RuntimeEnvelope:
    return RuntimeEnvelope(kind, f"request-{sequence}", "run-1", "session-1", sequence, f"key-{sequence}", payload)


def _decision(input_text: str, tools: list[dict], calls: list[dict]) -> dict:
    core = create_mobile_agent_core()
    core.handle(_command(MessageType.START_RUN, 0, {
        "input": input_text, "model_id": "model", "tools": tools,
    }))
    events = core.handle(_command(MessageType.MODEL_COMPLETED, 1, {
        "content": "answer" if not calls else "", "tool_calls": calls,
    }))
    return next(item.payload for item in events if item.payload.get("kind") == "tool.decision")


def test_required_available_task_records_selected_or_omitted_without_prompt() -> None:
    prompt = "核实今天最新的 AI 新闻并给出来源，私密标记 secret-123"
    selected = _decision(prompt, [_tool("web.search")], [
        {"call_id": "search-1", "name": "web.search", "arguments": {}},
    ])
    omitted = _decision(prompt, [_tool("web.search")], [])

    assert selected["category"] == "required_tool_selected"
    assert omitted["category"] == "required_tool_omitted"
    assert selected["policy_version"] == "p9-tool-decision-v2"
    assert "secret-123" not in json.dumps(selected, ensure_ascii=False)
    assert set(selected) == {
        "kind", "policy_version", "requirement_sha256", "category", "reason",
        "required_domain_count", "available_domain_count", "selected_tool_count", "tool_round_count",
        "required_domains",
    }


def test_required_missing_capability_and_no_tool_task_have_distinct_categories() -> None:
    unavailable = _decision("核实今天最新的 AI 新闻并给出来源", [_tool("get_current_time")], [])
    direct = _decision("把 Quality over speed 翻译成中文", [_tool("get_current_time")], [])

    assert unavailable["category"] == "required_tool_unavailable"
    assert unavailable["reason"] == "required_capability_not_available"
    assert direct["category"] == "direct_answer"
    assert direct["reason"] == "tool_not_required"


def test_unavailable_required_capability_beats_an_unrelated_selected_tool() -> None:
    decision = _decision("Verify the latest AI news with sources", [_tool("image_generation")], [
        {"call_id": "image-1", "name": "image_generation", "arguments": {}},
    ])

    assert decision["category"] == "required_tool_unavailable"
    assert decision["reason"] == "required_capability_not_available"


def test_requirement_and_resolution_are_deterministic_and_redacted() -> None:
    first = build_tool_decision_requirement("现在几点？", ["get_current_time"])
    second = build_tool_decision_requirement("现在几点？", ["get_current_time"])
    decision = resolve_tool_decision(first, ["get_current_time"])

    assert first == second
    assert first["required_domains"] == ["time"]
    assert decision["category"] == "required_tool_selected"
    assert "现在几点" not in json.dumps(first, ensure_ascii=False)


def test_current_local_device_and_time_facts_do_not_require_web_retrieval() -> None:
    device = build_tool_decision_requirement(
        "这台安卓设备当前的系统版本和语言环境是什么？不要猜。",
        ["get_device_info"],
    )
    time = build_tool_decision_requirement(
        "现在几点？请按我当前时区回答。",
        ["get_current_time"],
    )

    assert device["required_domains"] == ["device"]
    assert time["required_domains"] == ["time"]
    assert resolve_tool_decision(device, ["get_device_info"])["category"] == "required_tool_selected"
    assert resolve_tool_decision(time, ["get_current_time"])["category"] == "required_tool_selected"


def test_current_volatile_public_fact_still_requires_retrieval() -> None:
    requirement = build_tool_decision_requirement("当前美元汇率是多少？", ["web.search"])

    assert requirement["required_domains"] == ["retrieval"]


def test_search_saved_memory_phrase_does_not_require_public_web() -> None:
    requirement = build_tool_decision_requirement(
        "你保存过我希望使用什么称呼吗？请查一下。",
        ["search_memory"],
    )

    assert requirement["required_domains"] == ["memory"]
    assert resolve_tool_decision(requirement, ["search_memory"])["category"] == "required_tool_selected"
