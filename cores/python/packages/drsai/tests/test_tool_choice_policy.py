from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import build_tool_choice_policy, build_tool_decision_requirement
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core


def _start(input_text: str, tools: list[dict]) -> dict:
    core = create_mobile_agent_core()
    outbound = core.handle(RuntimeEnvelope(
        message_type=MessageType.START_RUN,
        request_id="request-0",
        run_id="run-choice",
        session_id="session-choice",
        sequence=0,
        idempotency_key="start-choice",
        payload={"input": input_text, "model_id": "model", "tools": tools},
    ))
    return next(value.payload for value in outbound if value.message_type is MessageType.MODEL_REQUEST)


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
        "oaep_output_type": None,
    }


def test_tool_choice_auto_for_stable_ordinary_request() -> None:
    requirement = build_tool_decision_requirement("Rewrite this paragraph", ["web.search", "workspace.read"])
    policy = build_tool_choice_policy(requirement, ["web.search", "workspace.read"])
    assert policy["mode"] == "auto"
    assert policy["policy_version"] == "p9-tool-choice-v1"


def test_tool_choice_required_for_unverified_host_fact_but_auto_after_tool_result() -> None:
    requirement = build_tool_decision_requirement("HEPiX2026是什么", ["web.search", "workspace.read"])
    required = build_tool_choice_policy(requirement, ["web.search", "workspace.read"])
    assert required["mode"] == "required"
    assert required["matching_tools"] == ["web.search"]
    assert build_tool_choice_policy(requirement, ["web.search", "workspace.read"], prior_tool_use=True)["mode"] == "auto"


def test_tool_choice_none_without_visible_tools() -> None:
    requirement = build_tool_decision_requirement("hello", [])
    assert build_tool_choice_policy(requirement, [])["mode"] == "none"


def test_tool_choice_specific_tool_is_pinned_and_unavailable_name_fails_closed() -> None:
    requirement = build_tool_decision_requirement("search", ["web.search", "workspace.read"])
    policy = build_tool_choice_policy(
        requirement, ["web.search", "workspace.read"], specified_tool="web.search",
    )
    assert policy["mode"] == "specified"
    assert policy["specified_tool"] == "web.search"
    with pytest.raises(ValueError, match="tool_choice_specified_tool_unavailable"):
        build_tool_choice_policy(requirement, ["web.search"], specified_tool="workspace.read")


def test_mobile_kernel_attaches_none_auto_and_required_to_real_model_requests() -> None:
    assert _start("hello", [])["tool_choice"]["mode"] == "none"
    assert _start("Rewrite this paragraph", [_tool("web.search")])["tool_choice"]["mode"] == "auto"
    assert _start("HEPiX2026是什么", [_tool("web.search")])["tool_choice"]["mode"] == "required"
