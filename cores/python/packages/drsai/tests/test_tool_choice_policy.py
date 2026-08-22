from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import build_tool_choice_policy, build_tool_decision_requirement, resolve_tool_decision


def test_image_request_requires_the_available_generation_tool() -> None:
    requirement = build_tool_decision_requirement(
        "请生成一张 16:9 插图并输出 PNG 图片", ["image_generation"],
    )
    assert requirement["required_domains"] == ["image_generation"]
    assert requirement["available_domains"] == ["image_generation"]
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
    assert required["mode"] == "specified"
    assert required["specified_tool"] == "web.search"
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


@pytest.mark.parametrize(("prompt", "expected"), [
    ("读取授权项目中的 README.md", "workspace.read"),
    ("列出授权项目根目录里的文件", "workspace.list"),
    ("定位名称包含 settings 的文件", "workspace.search"),
    ("创建 notes/today.txt，内容写完成", "workspace.write"),
    ("建立一个三步执行计划", "core.update_plan"),
    ("把三个评估分别交给专门分析者", "delegate"),
])
def test_natural_task_can_pin_one_unambiguous_host_tool(prompt: str, expected: str) -> None:
    tools = [
        "workspace.list", "workspace.read", "workspace.search", "workspace.write",
        "core.update_plan", "delegate",
    ]
    requirement = build_tool_decision_requirement(prompt, tools)
    choice = build_tool_choice_policy(requirement, tools)
    assert choice["mode"] == "specified"
    assert choice["specified_tool"] == expected


def test_unavailable_required_capability_disables_unrelated_tools() -> None:
    requirement = build_tool_decision_requirement(
        "核实今天最新新闻；如果无法联网请说明", ["get_current_time", "get_device_info"],
    )
    choice = build_tool_choice_policy(requirement, ["get_current_time", "get_device_info"])
    assert requirement["required_domains"] == ["retrieval"]
    assert choice["mode"] == "none"


def test_wrong_prior_tool_domain_does_not_satisfy_required_process() -> None:
    requirement = build_tool_decision_requirement(
        "这个 Workspace 的测试失败了，请诊断根因", ["run_read", "run_powershell"],
    )

    policy = build_tool_choice_policy(
        requirement, ["run_read", "run_powershell"],
        prior_tool_use=True, prior_tool_domains=["workspace"],
    )
    decision = resolve_tool_decision(
        requirement, [], prior_tool_use=True, prior_tool_domains=["workspace"],
    )

    assert requirement["required_domains"] == ["process"]
    assert policy["mode"] == "specified"
    assert policy["specified_tool"] == "run_powershell"
    assert policy["matching_tools"] == ["run_powershell"]
    assert decision["category"] == "required_tool_omitted"


def test_mobile_kernel_attaches_none_auto_and_required_to_real_model_requests() -> None:
    assert _start("hello", [])["tool_choice"]["mode"] == "none"
    assert _start("Rewrite this paragraph", [_tool("web.search")])["tool_choice"]["mode"] == "auto"
    required = _start("HEPiX2026是什么", [_tool("web.search")])["tool_choice"]
    assert required["mode"] == "specified"
    assert required["specified_tool"] == "web.search"


def test_named_regression_workflow_only_exposes_regression_tools() -> None:
    tools = [
        "web_search", "run_read", "regression_preflight", "regression_start",
        "regression_events", "regression_get",
    ]
    requirement = build_tool_decision_requirement(
        "Start the regression case with preflight, monitor events, and get the terminal result.",
        tools,
    )

    assert requirement["required_domains"] == ["regression"]
    policy = build_tool_choice_policy(requirement, tools)
    assert policy["mode"] == "required"
    assert policy["matching_tools"] == [
        "regression_events", "regression_get", "regression_preflight", "regression_start",
    ]


def test_regression_result_references_do_not_require_public_web_retrieval() -> None:
    requirement = build_tool_decision_requirement(
        "Run the regression test, verify its terminal result, and report interactive references.",
        ["web_search", "regression_preflight", "regression_get"],
    )

    assert requirement["required_domains"] == ["regression"]


def test_exact_regression_result_prompt_keeps_interactive_uris_local() -> None:
    prompt = (
        "Use regression_get to check evaluation eval-78153865-9ef0-442d-a1c3-3ed81163b10a. "
        "Report its authoritative verdict and include every interactive Result and Evidence reference URI "
        "returned by the tool."
    )
    requirement = build_tool_decision_requirement(prompt, ["web_search", "regression_get"])

    assert requirement["required_domains"] == ["regression"]
