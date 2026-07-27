from __future__ import annotations

import json
from pathlib import Path

import pytest

from drsai.backend.runtime.desktop_threads import DesktopThreadProjection


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def test_projects_only_matching_workspace_threads(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    _write(tmp_path / "desktop" / "threads.json", [
        {"id": "thread-current", "title": "当前任务", "workspacePath": str(workspace),
         "boundAgentId": "my-codex", "createdAt": "2026-07-01T00:00:00Z",
         "updatedAt": "2026-07-03T00:00:00Z"},
        {"id": "thread-archived", "title": "已归档", "workspacePath": str(workspace),
         "boundAgentId": "my-drsai", "archived": True, "createdAt": "2026-07-01T00:00:00Z",
         "updatedAt": "2026-07-02T00:00:00Z"},
        {"id": "thread-other", "title": "其他", "workspacePath": str(other),
         "createdAt": "2026-07-01T00:00:00Z", "updatedAt": "2026-07-04T00:00:00Z"},
    ])

    rows = DesktopThreadProjection(tmp_path).threads_for_workspace(str(workspace))

    assert [row["session_id"] for row in rows] == ["thread-current", "thread-archived"]
    assert rows[0]["agent_definition"] == "codex@1"
    assert rows[0]["backend_id"] == "codex"
    assert rows[1]["agent_definition"] == "opendrsai@1"
    assert rows[1]["backend_id"] == "opendrsai"
    assert rows[1]["archived"] is True


def test_unknown_platform_agent_binding_is_not_guessed(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _write(tmp_path / "desktop" / "threads.json", [{
        "id": "thread-platform",
        "workspacePath": str(workspace),
        "boundAgentId": "platform:agent-123",
        "updatedAt": "2026-07-03T00:00:00Z",
    }])

    [row] = DesktopThreadProjection(tmp_path).threads_for_workspace(str(workspace))

    assert row["agent_definition"] is None
    assert row["backend_id"] is None


def test_projects_desktop_snapshot_as_conversation(tmp_path: Path) -> None:
    _write(tmp_path / "desktop" / "threads.json", [{"id": "thread-one"}])
    _write(tmp_path / "desktop" / "thread-snapshots.json", {
        "thread-one": {"updatedAt": 1_774_915_200_000, "messages": [
            {"id": "m1", "role": "user", "content": "你好"},
            {"id": "m2", "role": "assistant", "content": "你好，我在。"},
            {"id": "hidden", "role": "tool", "content": "not exposed"},
        ]},
    })

    projection = DesktopThreadProjection(tmp_path)
    items = projection.conversation("thread-one")

    assert [item["kind"] for item in items] == ["message.user", "message.assistant"]
    assert [item["payload"]["content"] for item in items] == ["你好", "你好，我在。"]
    assert all(item["payload"]["source"] == "desktop_thread" for item in items)
    assert all(item["timestamp"].endswith("+00:00") for item in items)


def test_cursor_round_trip_and_invalid_cursor_fail_closed(tmp_path: Path) -> None:
    projection = DesktopThreadProjection(tmp_path)
    cursor = projection.encode_cursor(37)
    assert projection.decode_cursor(cursor) == 37
    with pytest.raises(ValueError, match="Invalid Desktop Conversation cursor"):
        projection.decode_cursor("runtime-cursor")


def test_symlinked_store_is_not_read(tmp_path: Path) -> None:
    source = tmp_path / "outside.json"
    _write(source, [{"id": "thread-secret", "workspacePath": str(tmp_path)}])
    desktop = tmp_path / "desktop"
    desktop.mkdir()
    try:
        (desktop / "threads.json").symlink_to(source)
    except OSError:
        pytest.skip("symlinks are unavailable")
    assert DesktopThreadProjection(tmp_path).threads_for_workspace(str(tmp_path)) == []
