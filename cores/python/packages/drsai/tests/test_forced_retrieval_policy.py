from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import build_tool_decision_requirement
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


def tool(name: str = "web.search") -> dict:
    return {
        "name": name, "version": 1, "source": "android-host", "classification": "local-equivalent",
        "description": name, "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def command(kind: MessageType, sequence: int, payload: dict) -> RuntimeEnvelope:
    return RuntimeEnvelope(kind, f"request-{sequence}", "run-forced", "session-forced", sequence, f"key-{sequence}", payload)


def kinds(events) -> list[str]:
    return [item.payload["kind"] for item in events if item.message_type is MessageType.RUNTIME_EVENT]


@pytest.mark.parametrize("prompt", [
    "HEPiX2026是什么？",
    "HEPiX 2026 是什么？",
    "Hepix2026是什么",
    "请介绍一下 HEPiX 2026",
    "Who is HEPiX2026?",
    "截至2026年8月，Android 最新版本是什么？",
    "查一下最近的 AI Agent 新闻并给出来源",
])
def test_fresh_or_unfamiliar_natural_questions_require_retrieval(prompt: str) -> None:
    requirement = build_tool_decision_requirement(prompt, ["web.search"])
    assert requirement["policy_version"] == "p9-tool-decision-v2"
    assert requirement["required_domains"] == ["retrieval"]
    assert requirement["available_domains"] == ["retrieval"]


@pytest.mark.parametrize("prompt", [
    "2 + 2 等于多少？",
    "法国的首都是哪里？",
    "把这段话改得更简洁",
    "你喜欢清晰还是华丽的技术文档？",
])
def test_stable_or_transformational_questions_remain_direct(prompt: str) -> None:
    assert build_tool_decision_requirement(prompt, ["web.search"])["required_domains"] == []


def test_supplied_presentation_content_does_not_treat_citation_noun_as_research_request() -> None:
    prompt = """请创建一份中文演示文稿。页面内容如下：第 3 页：OAEP 描述消息、工具调用、审批、引用和产物。"""

    assert build_tool_decision_requirement(prompt, ["web.search"])["required_domains"] == []


def test_supplied_presentation_with_explicit_source_request_still_requires_retrieval() -> None:
    prompt = """请创建一份中文演示文稿。页面内容如下：第 1 页：行业概览。请在每页注明来源。"""

    assert build_tool_decision_requirement(prompt, ["web.search"])["required_domains"] == ["retrieval"]


def test_workspace_test_diagnosis_uses_local_tools_not_public_retrieval() -> None:
    prompt = """这个 Workspace 中的 test_success_rate_empty_returns_zero 测试失败了。请诊断根因，建议怎样修复，以及哪些测试应该用于验证修复。只进行诊断，不要修改文件。"""

    requirement = build_tool_decision_requirement(
        prompt, ["run_read", "run_grep", "run_glob", "run_powershell", "web.search"],
    )

    assert requirement["required_domains"] == ["process"]
    assert requirement["available_domains"] == ["process", "retrieval", "workspace"]


def test_workspace_diagnosis_keeps_explicit_public_web_request() -> None:
    prompt = "诊断这个 Workspace 的测试失败，并联网搜索官方网站的最新修复说明和来源链接。"

    requirement = build_tool_decision_requirement(prompt, ["run_read", "web.search"])

    assert requirement["required_domains"] == ["retrieval", "workspace"]


def test_model_guess_is_hidden_and_reprompted_to_search() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "HEPiX2026是什么？", "model_id": "model", "tools": [tool()],
    }))
    assert core.handle(command(MessageType.MODEL_CHUNK, 1, {"delta": "这是未经检索的猜测"})) == ()
    retry = core.handle(command(MessageType.MODEL_COMPLETED, 2, {"content": "这是未经检索的猜测"}))
    assert kinds(retry) == ["tool.decision", "verification.required"]
    assert retry[-1].message_type is MessageType.MODEL_REQUEST
    assert "这是未经检索的猜测" not in str(retry)


def test_first_model_search_selection_runs_the_real_host_tool_contract() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "HEPiX2026是什么？", "model_id": "model", "tools": [tool()],
    }))
    events = core.handle(command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [
        {"call_id": "search-1", "name": "web.search", "arguments": {"query": "HEPiX 2026"}},
    ]}))
    decision = next(item.payload for item in events if item.payload.get("kind") == "tool.decision")
    assert decision["category"] == "required_tool_selected"
    request = next(item for item in events if item.message_type is MessageType.TOOL_CALL_REQUEST)
    assert request.payload["name"] == "web.search"
    assert request.payload["arguments"] == {"query": "HEPiX 2026"}


def test_missing_retrieval_capability_returns_limitation_not_model_guess() -> None:
    core = create_mobile_agent_core()
    core.handle(command(MessageType.START_RUN, 0, {
        "input": "HEPiX2026是什么？", "model_id": "model", "tools": [tool("get_current_time")],
    }))
    events = core.handle(command(MessageType.MODEL_COMPLETED, 1, {"content": "这是模型编造的答案"}))
    assert kinds(events) == ["tool.decision", "verification.unavailable", "message.completed", "run.completed"]
    assert "这是模型编造的答案" not in str(events)
