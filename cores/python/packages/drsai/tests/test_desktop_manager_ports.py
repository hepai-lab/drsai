from __future__ import annotations

from autogen_agentchat.base import Response
from autogen_agentchat.messages import TextMessage
from autogen_core import CancellationToken
import pytest

from drsai.backend.runtime.desktop_manager_ports import DesktopAgentManagerPorts


class _Skills:
    skills = {"pdf": {"required_tools": ["run_read"]}}

    def run_skill(self, name):
        return f"instructions:{name}"


class _Todo:
    _last_warning = "normalized"

    def update(self, items):
        self.items = items

    def get_task_prompt(self):
        return "one task"


class _Profile:
    def update_user_config(self, **values):
        return f"updated:{values['nickname']}"


class _Regression:
    def execute(self, name, arguments):
        assert name == "regression_list_cases"
        assert arguments == {"suite_id": "p3-desktop"}
        return '{"cases":[{"id":"qa.greeting.hello"}]}'


class _Agent:
    _cached_skills_loader = _Skills()
    _todo_manager = _Todo()
    _user_profile_manager = _Profile()
    _regression_manager = _Regression()

    def __init__(self):
        self.elevated = []

    def _elevate_tools_for_skill(self, tools, skill):
        self.elevated.append((tools, skill))

    async def _execute_subagent(self, **_kwargs):
        yield Response(chat_message=TextMessage(content="subagent result", source="worker"))


def _payload(name, arguments):
    return {"call_id": f"{name}-1", "name": name, "arguments": arguments}


@pytest.mark.asyncio
async def test_skill_todo_profile_and_delegate_manager_ports_preserve_results() -> None:
    agent = _Agent()
    ports = DesktopAgentManagerPorts(agent, CancellationToken()).ports({
        "Skill", "TodoWrite", "UpdateUserConfig", "Delegate",
    })

    skill = await ports["Skill"](_payload("Skill", {"skill": "pdf"}))
    todo = await ports["TodoWrite"](_payload("TodoWrite", {"items": [{"title": "x"}]}))
    profile = await ports["UpdateUserConfig"](_payload("UpdateUserConfig", {"nickname": "Ada"}))
    delegate = await ports["Delegate"](_payload("Delegate", {"agent_type": "explore", "prompt": "inspect"}))

    assert all(value.succeeded for value in (skill, todo, profile, delegate))
    assert "instructions:pdf" in skill.content["content"]
    assert "one task" in todo.content["content"]
    assert profile.content["content"] == "updated:Ada"
    assert delegate.content["content"] == "subagent result"
    assert agent.elevated == [(["run_read"], "pdf")]


def test_unknown_manager_tool_gets_explicit_fail_closed_port() -> None:
    ports = DesktopAgentManagerPorts(_Agent(), CancellationToken()).ports({"UnknownManager"})
    assert set(ports) == {"UnknownManager"}


@pytest.mark.asyncio
async def test_regression_manager_port_dispatches_visible_native_tool() -> None:
    ports = DesktopAgentManagerPorts(_Agent(), CancellationToken()).ports({"regression_list_cases"})
    result = await ports["regression_list_cases"](_payload(
        "regression_list_cases", {"suite_id": "p3-desktop"},
    ))

    assert result.succeeded is True
    assert '"qa.greeting.hello"' in result.content["content"]
