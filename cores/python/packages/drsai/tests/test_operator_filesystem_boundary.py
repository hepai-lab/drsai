from __future__ import annotations

import os
from pathlib import Path

import pytest

from drsai.modules.agents.skills_agent.managers.operater_funs import get_operator_funcs


def _tool(root: Path, name: str):
    tools = get_operator_funcs(root, "security-boundary-test", storage_dir=root / ".runtime-state")
    return next(tool for tool in tools if tool.__name__ == name)


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
