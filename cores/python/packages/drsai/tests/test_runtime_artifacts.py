from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from drsai.backend.runtime.artifacts import RuntimeArtifactError, RuntimeArtifactStore


def _context(workspace_id: str = "workspace-a"):
    return SimpleNamespace(workspace_id=workspace_id, session_id="session-a", run_id="run-a")


def test_artifact_is_persistent_scoped_and_chunked_with_digest(tmp_path: Path) -> None:
    roots = {"workspace-a": tmp_path / "a", "workspace-b": tmp_path / "b"}
    roots["workspace-a"].mkdir()
    roots["workspace-b"].mkdir()
    content = b"android-runtime-artifact"
    (roots["workspace-a"] / "result.bin").write_bytes(content)
    database = tmp_path / "artifacts.sqlite3"

    published = RuntimeArtifactStore(database, roots.__getitem__).publish(
        _context(), {"path": "result.bin", "display_name": "Result"})
    assert published["sha256"] == hashlib.sha256(content).hexdigest()

    restarted = RuntimeArtifactStore(database, roots.__getitem__)
    metadata = restarted.metadata("workspace-a", published["artifact_id"])
    chunk = restarted.chunk("workspace-a", published["artifact_id"], 0, 7)
    assert metadata["run_id"] == "run-a"
    assert base64.b64decode(chunk["content_base64"]) == content[:7]
    assert chunk["eof"] is False

    with pytest.raises(RuntimeArtifactError, match="this Workspace") as cross_workspace:
        restarted.metadata("workspace-b", published["artifact_id"])
    assert cross_workspace.value.code == "artifact_not_found"


@pytest.mark.parametrize("offset,length", [(-1, 1), (0, 0), (0, 1024 * 1024 + 1)])
def test_artifact_rejects_invalid_ranges(tmp_path: Path, offset: int, length: int) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "result.txt").write_text("result", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)
    artifact = store.publish(_context(), {"path": "result.txt"})

    with pytest.raises(RuntimeArtifactError) as error:
        store.chunk("workspace-a", artifact["artifact_id"], offset, length)
    assert error.value.code == "artifact_range_invalid"


def test_artifact_publish_rejects_path_escape_and_directory(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    outside = tmp_path / "secret.txt"
    outside.write_text("secret", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    with pytest.raises(RuntimeArtifactError) as escaped:
        store.publish(_context(), {"path": "../secret.txt"})
    assert escaped.value.code == "workspace_escape_rejected"

    with pytest.raises(RuntimeArtifactError) as directory:
        store.publish(_context(), {"path": "."})
    assert directory.value.code == "artifact_not_file"
