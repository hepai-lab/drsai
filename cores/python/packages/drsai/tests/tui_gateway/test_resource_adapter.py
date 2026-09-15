from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from drsai.backend.tui_gateway.handlers import resource as resource_handler
from drsai.backend.tui_gateway.handlers.slash import SlashContext, cmd_resource
from drsai.backend.tui_gateway.resources import (
    oaep_resource_ref,
    register_tui_resource,
    resolve_tui_resource,
    tui_workspace_id,
)


def test_tui_resource_registration_is_opaque_persistent_and_path_private(tmp_path: Path, monkeypatch) -> None:
    state = tmp_path / "state"
    workspace = tmp_path / "TUI 中文 Workspace"
    (workspace / "docs").mkdir(parents=True)
    (workspace / "docs" / "方案.md").write_text("P1", encoding="utf-8")
    monkeypatch.setenv("DRSAI_HOME", str(state))

    first = register_tui_resource("user-a", workspace, "docs/方案.md")
    second = register_tui_resource("user-a", workspace, "docs/方案.md")
    reference = oaep_resource_ref(
        first,
        workspace_id=tui_workspace_id("user-a", workspace),
        relation="input_reference",
        presentation="inline",
    )

    assert first["file_id"] == second["file_id"]
    assert first["file_id"].startswith("file-")
    assert first["path"] == "docs/方案.md"
    assert reference["protocol"] == "owop/1"
    assert reference["resource_id"] == first["file_id"]
    assert reference["digest"].startswith("sha256:")
    assert str(workspace) not in repr(first)
    assert str(workspace) not in repr(reference)


def test_tui_resource_reports_changed_moved_and_deleted(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "state"))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = workspace / "draft.txt"
    source.write_text("v1", encoding="utf-8")
    registered = register_tui_resource("user-a", workspace, "draft.txt")

    source.write_text("v2", encoding="utf-8")
    changed = resolve_tui_resource("user-a", workspace, registered["file_id"])
    assert changed["state"] == "changed"

    destination = workspace / "final.txt"
    source.replace(destination)
    moved = resolve_tui_resource("user-a", workspace, registered["file_id"])
    assert moved["state"] == "moved"
    assert moved["path"] == "final.txt"

    destination.unlink()
    deleted = resolve_tui_resource("user-a", workspace, registered["file_id"])
    assert deleted["state"] == "deleted"
    assert not any(deleted["capabilities"].values())


def test_tui_resource_id_cannot_be_resolved_by_another_user(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "state"))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "private.txt").write_text("secret", encoding="utf-8")
    registered = register_tui_resource("user-a", workspace, "private.txt")

    try:
        resolve_tui_resource("user-b", workspace, registered["file_id"])
    except Exception as exc:
        assert getattr(exc, "code", None) == "resource_not_found"
    else:
        raise AssertionError("another user resolved a private resource id")


def test_tui_resource_rpc_is_bound_to_session_workspace(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "state"))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "result.txt").write_text("visible", encoding="utf-8")
    monkeypatch.setattr(resource_handler, "_workdir", lambda _session_id: workspace.resolve())
    monkeypatch.setattr(resource_handler, "_resolve_user_id", lambda: "user-a")

    registered = resource_handler.files_register("r1", {"session_id": "session-a", "path": "result.txt"})
    resource = registered["result"]["resource"]
    denied = resource_handler.files_resolve("r2", {
        "session_id": "session-a",
        "workspace_id": "workspace-not-current",
        "file_id": resource["file_id"],
    })
    resolved = resource_handler.files_resolve("r3", {
        "session_id": "session-a",
        "workspace_id": tui_workspace_id("user-a", workspace),
        "file_id": resource["file_id"],
    })
    escaped = resource_handler.files_read("r4", {
        "session_id": "session-a", "path": "../outside.txt", "offset": 0, "length": 10,
    })

    assert denied["error"]["code"] == 4031
    assert resolved["result"]["resource"]["path"] == "result.txt"
    assert escaped["error"]["message"] == "workspace_escape_rejected"
    assert str(workspace) not in repr(registered)
    assert str(workspace) not in repr(resolved)


def test_tui_resource_slash_command_reads_text_without_absolute_path(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "state"))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "result.txt").write_text("visible result", encoding="utf-8")
    registered = register_tui_resource("user-a", workspace, "result.txt")
    monkeypatch.setattr(resource_handler, "_workdir", lambda _session_id: workspace.resolve())
    context = SlashContext(
        SimpleNamespace(session_id="session-a", user_id="user-a"),
        f"{registered['file_id']} read",
    )

    result = cmd_resource(context)

    assert "visible result" in result["output"]
    assert registered["file_id"] in result["output"]
    assert "State: available" in result["output"]
    assert str(workspace) not in result["output"]
