from __future__ import annotations

import os
from pathlib import Path

import pytest

from drsai.modules.agents.skills_agent.managers.operater_funs import (
    get_operator_funcs,
    runtime_tool_approval_scope,
)


def _tool(root: Path, name: str):
    tools = get_operator_funcs(root, "security-boundary-test", storage_dir=root / ".runtime-state")
    return next(tool for tool in tools if tool.__name__ == name)


@pytest.mark.asyncio
async def test_tui_script_guard_remains_session_scoped_and_actionable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from drsai.backend.tui_gateway.adapter import callbacks

    root = tmp_path / "workspace"
    root.mkdir()
    monkeypatch.setattr(callbacks, "approval_callback", lambda **_kwargs: "deny")

    result = await _tool(root, "run_bash")("python make_document.py")

    assert result == (
        "Error: Script execution denied by user. "
        "Use /dangerous on to authorize for the rest of the session."
    )


@pytest.mark.asyncio
async def test_runtime_single_call_approval_bypasses_only_the_duplicate_tui_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from drsai.backend.tui_gateway.adapter import callbacks

    root = tmp_path / "workspace"
    root.mkdir()

    async def execution_reached(*_args, **_kwargs):
        raise RuntimeError("execution_reached")

    monkeypatch.setattr("asyncio.create_subprocess_shell", execution_reached)
    monkeypatch.setattr(callbacks, "approval_callback", lambda **_kwargs: "deny")
    with runtime_tool_approval_scope(granted=True):
        result = await _tool(root, "run_bash")("python make_document.py")

    assert "Script execution denied" not in result
    # The proof is one-shot: after leaving the scope the TUI guard is active.
    assert await _tool(root, "run_bash")("python make_document.py") == (
        "Error: Script execution denied by user. "
        "Use /dangerous on to authorize for the rest of the session."
    )


@pytest.mark.skipif(os.name != "nt", reason="handle-backed production file tool migration is Windows-specific")
@pytest.mark.asyncio
async def test_actual_run_read_uses_handle_backed_workspace_boundary(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "notes.txt").write_text("first\nsecond", encoding="utf-8")

    result = await _tool(root, "run_read")("notes.txt")

    assert result == "first\nsecond"


@pytest.mark.skipif(os.name != "nt", reason="handle-backed production file tool migration is Windows-specific")
@pytest.mark.asyncio
async def test_actual_run_read_denies_control_paths_and_hardlinks(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("secret", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("outside-secret", encoding="utf-8")
    os.link(outside, root / "linked.txt")
    run_read = _tool(root, "run_read")

    control = await run_read(".git/config")
    hardlink = await run_read("linked.txt")

    assert control.startswith("Error:") and "control paths" in control
    assert hardlink.startswith("Error:") and "multiple hard links" in hardlink
    assert "secret" not in control and "outside-secret" not in hardlink
