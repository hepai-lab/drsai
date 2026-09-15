from __future__ import annotations

from pathlib import Path
import base64
from types import SimpleNamespace

from drsai.backend.tui_gateway.adapter.agent_runner import _artifact_snapshot, _new_artifact_descriptors
from drsai.backend.tui_gateway.handlers import artifact as artifact_handler
from drsai.backend.tui_gateway.handlers.slash import SlashContext, cmd_artifact


def test_legacy_tui_adapter_emits_only_new_workspace_artifacts(tmp_path: Path) -> None:
    workspace = tmp_path / "TUI 中文 工作区"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "old.txt").write_text("old", encoding="utf-8")
    baseline = _artifact_snapshot(str(workspace))

    (artifacts / "短诗.docx").write_bytes(b"docx")
    descriptors = _new_artifact_descriptors(str(workspace), baseline, "session-a")

    assert len(descriptors) == 1
    artifact = descriptors[0]
    assert artifact["name"] == "短诗.docx"
    assert artifact["path"] == "artifacts/短诗.docx"
    assert artifact["downloadable"] is True
    assert artifact["previewable"] is False
    assert str(workspace) not in repr(artifact)


def test_legacy_tui_artifact_id_is_stable_for_same_session_path_and_content(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "result.txt").write_text("result", encoding="utf-8")

    first = _new_artifact_descriptors(str(workspace), {}, "session-a")[0]
    second = _new_artifact_descriptors(str(workspace), {}, "session-a")[0]

    assert first["artifact_id"] == second["artifact_id"]


def test_legacy_tui_artifact_metadata_and_bounded_download(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "TUI 中文 工作区"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "result.txt").write_text("downloadable", encoding="utf-8")
    descriptor = _new_artifact_descriptors(str(workspace), {}, "session-a")[0]
    monkeypatch.setattr(artifact_handler, "_workdir", lambda _session_id: workspace.resolve())

    metadata = artifact_handler.artifact_metadata("request-1", {
        "session_id": "session-a", "artifact_id": descriptor["artifact_id"],
    })
    chunk = artifact_handler.artifact_chunk("request-2", {
        "session_id": "session-a", "artifact_id": descriptor["artifact_id"],
        "offset": 0, "length": 1024,
    })

    assert metadata["result"]["path"] == "artifacts/result.txt"
    assert str(workspace) not in repr(metadata)
    assert base64.b64decode(chunk["result"]["content_base64"]) == b"downloadable"
    assert chunk["result"]["eof"] is True


def test_legacy_tui_artifact_download_rejects_other_session_id(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "result.txt").write_text("private", encoding="utf-8")
    descriptor = _new_artifact_descriptors(str(workspace), {}, "session-a")[0]
    monkeypatch.setattr(artifact_handler, "_workdir", lambda _session_id: workspace.resolve())

    denied = artifact_handler.artifact_metadata("request-3", {
        "session_id": "session-b", "artifact_id": descriptor["artifact_id"],
    })

    assert denied["error"]["message"] == "artifact_unavailable"


def test_tui_artifact_slash_command_reads_text_without_absolute_path(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    path = artifacts / "result.txt"
    path.write_text("visible result", encoding="utf-8")
    descriptor = _new_artifact_descriptors(str(workspace), {}, "session-a")[0]
    monkeypatch.setattr(artifact_handler, "_find", lambda _session, _artifact: (path, descriptor))
    # cmd_artifact imports _find when invoked, so replacing the module binding
    # exercises the same route used by the RPC handler.
    context = SlashContext(SimpleNamespace(session_id="session-a", user_id="user-a"), f"{descriptor['artifact_id']} read")

    result = cmd_artifact(context)

    assert "visible result" in result["output"]
    assert descriptor["artifact_id"] in result["output"]
    assert str(workspace) not in result["output"]
