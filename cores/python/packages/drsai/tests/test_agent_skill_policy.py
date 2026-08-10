from __future__ import annotations

import pytest

from drsai.modules.agents.skills_agent.drsai_assistant import filter_agent_skills


def test_explicit_agent_skill_policy_excludes_installed_but_unselected_skills() -> None:
    installed = {"research": object(), "spreadsheet": object(), "unsafe": object()}
    selected = filter_agent_skills(
        installed, mode="explicit", enabled=("research", "unsafe"), disabled=("unsafe",),
    )
    assert list(selected) == ["research"]


def test_inherited_agent_skill_policy_applies_deny_list() -> None:
    installed = {"research": object(), "spreadsheet": object()}
    selected = filter_agent_skills(
        installed, mode="inherit", enabled=(), disabled=("spreadsheet",),
    )
    assert list(selected) == ["research"]


def test_agent_skill_policy_fails_closed_for_unknown_mode() -> None:
    with pytest.raises(ValueError, match="mode"):
        filter_agent_skills({}, mode="unknown", enabled=(), disabled=())
