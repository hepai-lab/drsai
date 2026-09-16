"""Verify the Desktop and TUI turn-injection paths share one source of truth.

These are the invariants that were broken before U1-U3: the TUI wrote
``_injected_prefix`` by hand from a raw constant, Desktop never passed the CLI
config or project instructions at all.
"""

from __future__ import annotations

import inspect

import pytest


# ── U1: both surfaces build the plan-mode prefix through the registry ────────

def test_tui_uses_registry_for_plan_mode_prefix():
    from drsai.backend.tui_gateway.adapter import agent_runner

    source = inspect.getsource(agent_runner)
    assert "build_turn_prefix" in source
    # The raw constant must not be reached for any more.
    assert "from drsai.backend.run_drsai_agent_factory import PLAN_MODE_SYSTEM_PROMPT" not in source


def test_tui_and_desktop_agree_on_plan_mode_prefix():
    from drsai.backend import prompt_registry as pr

    # Both surfaces call this builder; the value must equal the raw constant so
    # existing plans do not shift.
    assert pr.build_turn_prefix(plan_mode=True) == pr.PLAN_MODE_SYSTEM_PROMPT
    assert pr.build_turn_prefix(plan_mode=False) == ""


def test_desktop_uses_registry_turn_builders():
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    source = inspect.getsource(mgr)
    assert "build_turn_prefix(" in source
    assert "build_turn_suffix(" in source
    assert "SURFACE_DESKTOP" in source


# ── U2: Desktop passes the live CLI config, like the TUI ────────────────────

def test_desktop_passes_cli_cfg_to_create_agent():
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    source = inspect.getsource(mgr.DesktopAgentManager._build_agent)
    assert "cli_cfg=" in source, "Desktop must not let the factory fall back to load_config()"


def test_tui_passes_cli_cfg_to_create_agent():
    from drsai.backend.tui_gateway.adapter import agent_runner

    source = inspect.getsource(agent_runner)
    assert "cli_cfg=self.cli_cfg" in source


# ── U3: both surfaces inject project instructions ───────────────────────────

def test_desktop_applies_project_instructions():
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    assert hasattr(mgr.DesktopAgentManager, "_apply_project_instructions")
    source = inspect.getsource(mgr.DesktopAgentManager._build_agent)
    assert "_apply_project_instructions" in source


def test_desktop_project_instructions_use_the_tui_loader():
    """One loader, so DRSAI.md discovery order cannot differ between surfaces."""
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    source = inspect.getsource(mgr.DesktopAgentManager._apply_project_instructions)
    assert "drsaimd_loader" in source
    assert "load_project_instructions" in source


def test_tui_project_instructions_use_the_same_loader():
    from drsai.backend.tui_gateway.handlers import slash

    source = inspect.getsource(slash)
    assert "load_project_instructions" in source


# ── Behaviour: the loader actually feeds the prompt layer ───────────────────

@pytest.mark.asyncio
async def test_apply_project_instructions_injects_discovered_file(tmp_path):
    """A DRSAI.md in the session's cwd must reach the agent's injected state."""
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    (tmp_path / "DRSAI.md").write_text("# Project\nUse ruff.\n", encoding="utf-8")

    class FakeAgent:
        def __init__(self):
            self.injected = None

        def inject_system_prompt(self, **kwargs):
            self.injected = kwargs

    agent = FakeAgent()
    await mgr.DesktopAgentManager._apply_project_instructions(agent, str(tmp_path))
    assert agent.injected is not None
    assert "Use ruff." in agent.injected["project_instructions"]


@pytest.mark.asyncio
async def test_apply_project_instructions_is_a_noop_without_files(tmp_path):
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    class FakeAgent:
        def __init__(self):
            self.called = False

        def inject_system_prompt(self, **kwargs):
            self.called = True

    agent = FakeAgent()
    await mgr.DesktopAgentManager._apply_project_instructions(agent, str(tmp_path))
    assert agent.called is False


@pytest.mark.asyncio
async def test_apply_project_instructions_survives_a_bad_directory():
    """A missing/unreadable cwd must not stop the session from starting."""
    from drsai.backend.desktop_gateway import _agent_manager as mgr

    class FakeAgent:
        def inject_system_prompt(self, **kwargs):
            raise AssertionError("must not be called")

    # Should log and return, never raise.
    await mgr.DesktopAgentManager._apply_project_instructions(FakeAgent(), None)
