from __future__ import annotations

import base64
import hashlib
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from drsai.backend.runtime.artifacts import RuntimeArtifactError, RuntimeArtifactStore


def _context(workspace_id: str = "workspace-a", run_id: str = "run-a"):
    return SimpleNamespace(workspace_id=workspace_id, session_id="session-a", run_id=run_id)


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


def test_runtime_owned_tool_output_is_persistent_opaque_and_chunked(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    database = tmp_path / "runtime" / "artifacts.sqlite3"
    content = b"\x00\x01binary-tool-output"
    store = RuntimeArtifactStore(database, lambda _: root)

    published = store.publish_content(
        _context(), content, display_name="tool-output.bin", mime_type="application/octet-stream"
    )
    assert "path" not in published
    assert published["sha256"] == hashlib.sha256(content).hexdigest()
    assert not (root / published["relative_path"]).exists()

    restarted = RuntimeArtifactStore(database, lambda _: root)
    metadata = restarted.metadata("workspace-a", published["artifact_id"])
    chunk = restarted.chunk("workspace-a", published["artifact_id"], 0, len(content))
    assert metadata["storage_kind"] == "runtime"
    assert base64.b64decode(chunk["content_base64"]) == content
    assert chunk["eof"] is True


def test_stale_workspace_metadata_does_not_prevent_store_startup(tmp_path: Path) -> None:
    database = tmp_path / "runtime" / "artifacts.sqlite3"
    store = RuntimeArtifactStore(database, lambda _: tmp_path)
    store.publish_content(_context(), b"stale", display_name="stale.txt", mime_type="text/plain")

    def missing_workspace(_workspace_id: str) -> Path:
        raise RuntimeError("Workspace is not open")

    RuntimeArtifactStore(database, missing_workspace)


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


def test_image_mime_publishes_as_image_artifact_type(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    image_path = root / "artifacts" / "opendrsai-agent-runtime.png"
    image_path.parent.mkdir(parents=True)
    image_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    published = store.publish(
        _context(),
        {
            "path": "artifacts/opendrsai-agent-runtime.png",
            "display_name": "opendrsai-agent-runtime.png",
            "mime_type": "image/png",
        },
    )
    assert published["artifact_type"] == "image"
    assert published["previewable"] is True
    assert published["path"] == "artifacts/opendrsai-agent-runtime.png"

    opaque = store.publish_content(
        _context(),
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,
        display_name="inline.png",
        mime_type="image/png",
    )
    assert opaque["artifact_type"] == "image"
    assert opaque["previewable"] is True


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


def test_deliver_artifact_copies_to_artifacts_and_preserves_unicode(tmp_path: Path) -> None:
    root = tmp_path / "默认 工作区"
    root.mkdir()
    source = root / "tmp" / "poem.docx"
    source.parent.mkdir()
    source.write_bytes(b"docx-content")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    delivered = store.deliver(_context(), {
        "source_path": "tmp/poem.docx",
        "destination_name": "短诗_静夜.docx",
    })

    target = root / "artifacts" / "短诗_静夜.docx"
    assert target.read_bytes() == b"docx-content"
    assert delivered["relative_path"] == "artifacts/短诗_静夜.docx"
    assert delivered["storage_kind"] == "workspace"
    assert delivered["sha256"] == hashlib.sha256(b"docx-content").hexdigest()
    assert str(root) not in repr(delivered)


def test_deliver_artifact_uses_non_overwriting_conflict_name(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "first.txt").write_text("one", encoding="utf-8")
    (root / "second.txt").write_text("two", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    first = store.deliver(_context(), {"source_path": "first.txt", "destination_name": "result.txt"})
    second = store.deliver(_context(), {"source_path": "second.txt", "destination_name": "result.txt"})

    assert first["relative_path"] == "artifacts/result.txt"
    assert second["relative_path"] == "artifacts/result (2).txt"
    assert (root / first["relative_path"]).read_text(encoding="utf-8") == "one"
    assert (root / second["relative_path"]).read_text(encoding="utf-8") == "two"


def test_deliver_artifact_does_not_overwrite_concurrent_winner(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "source.txt").write_text("ours", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)
    real_link = os.link
    calls = 0

    def racing_link(source, destination):
        nonlocal calls
        calls += 1
        if calls == 1:
            Path(destination).write_text("theirs", encoding="utf-8")
            raise FileExistsError(destination)
        return real_link(source, destination)

    monkeypatch.setattr(os, "link", racing_link)
    delivered = store.deliver(_context(), {
        "source_path": "source.txt", "destination_name": "result.txt",
    })

    assert (root / "artifacts" / "result.txt").read_text(encoding="utf-8") == "theirs"
    assert delivered["relative_path"] == "artifacts/result (2).txt"
    assert (root / delivered["relative_path"]).read_text(encoding="utf-8") == "ours"


def test_deliver_artifact_rejects_linked_artifacts_directory(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (root / "source.txt").write_text("safe", encoding="utf-8")
    try:
        (root / "artifacts").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks are unavailable on this host")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    with pytest.raises(RuntimeArtifactError) as caught:
        store.deliver(_context(), {"source_path": "source.txt"})

    assert caught.value.code == "artifact_destination_outside_scope"
    assert not list(outside.iterdir())


@pytest.mark.parametrize("name", ["../secret.txt", "folder/result.txt", "C:\\result.txt", ".."])
def test_deliver_artifact_rejects_destination_paths(tmp_path: Path, name: str) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "source.txt").write_text("safe", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    with pytest.raises(RuntimeArtifactError) as caught:
        store.deliver(_context(), {"source_path": "source.txt", "destination_name": name})
    assert caught.value.code == "artifact_destination_invalid"


def test_deliver_artifact_rejects_source_outside_workspace(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    with pytest.raises(RuntimeArtifactError) as caught:
        store.deliver(_context(), {"source_path": "../secret.txt"})
    assert caught.value.code == "artifact_source_outside_scope"


def test_deliver_artifact_bounds_long_unicode_name_and_sanitizes_windows_device_name(tmp_path: Path) -> None:
    root = tmp_path / "中文 工作区"
    root.mkdir()
    (root / "source.txt").write_text("safe", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    long_name = store.deliver(_context(), {
        "source_path": "source.txt", "destination_name": f"{'诗' * 200}.txt",
    })
    device_name = store.deliver(_context(run_id="run-b"), {
        "source_path": "source.txt", "destination_name": "CON.txt",
    })

    assert len(Path(long_name["relative_path"]).name.encode("utf-8")) <= 240
    assert Path(long_name["relative_path"]).suffix == ".txt"
    assert device_name["relative_path"] == "artifacts/_CON.txt"


def test_deliver_artifact_is_idempotent_per_workspace_and_run(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "result.txt").write_text("result", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)
    request = {
        "source_path": "result.txt", "destination_name": "result.txt",
        "idempotency_key": "tool-call-1",
    }

    first = store.deliver(_context(), request)
    second = store.deliver(_context(), request)

    assert second["artifact_id"] == first["artifact_id"]
    assert second["idempotent_replay"] is True
    assert "idempotent_replay" not in first
    assert second["relative_path"] == first["relative_path"]
    assert len(list((root / "artifacts").iterdir())) == 1


def test_concurrent_idempotent_delivery_keeps_one_metadata_record_and_one_file(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "result.txt").write_text("result", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)
    request = {
        "source_path": "result.txt", "destination_name": "result.txt",
        "idempotency_key": "concurrent-tool-call",
    }

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: store.deliver(_context(), request), range(2)))

    assert len({result["artifact_id"] for result in results}) == 1
    assert len(store.list_for_run("workspace-a", "run-a")) == 1
    assert [path.name for path in (root / "artifacts").iterdir()] == ["result.txt"]


def test_artifact_store_enforces_file_and_run_quotas(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "large.bin").write_bytes(b"12345")
    limited = RuntimeArtifactStore(
        tmp_path / "limited.sqlite3", lambda _: root, max_file_bytes=4,
    )
    with pytest.raises(RuntimeArtifactError) as too_large:
        limited.deliver(_context(), {"source_path": "large.bin"})
    assert too_large.value.code == "artifact_quota_exceeded"

    (root / "one.txt").write_text("1", encoding="utf-8")
    (root / "two.txt").write_text("2", encoding="utf-8")
    one_only = RuntimeArtifactStore(
        tmp_path / "one.sqlite3", lambda _: root, max_artifacts_per_run=1,
    )
    one_only.deliver(_context(), {"source_path": "one.txt"})
    with pytest.raises(RuntimeArtifactError) as too_many:
        one_only.deliver(_context(), {"source_path": "two.txt"})
    assert too_many.value.code == "artifact_quota_exceeded"


def test_artifact_store_enforces_total_capacity_and_cleans_only_stale_staging(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "one.txt").write_bytes(b"123")
    (root / "two.txt").write_bytes(b"456")
    store = RuntimeArtifactStore(
        tmp_path / "capacity.sqlite3", lambda _: root,
        max_total_bytes=5, staging_max_age_seconds=60,
    )
    store.deliver(_context(), {"source_path": "one.txt"})
    artifacts = root / "artifacts"
    stale = artifacts / ".old.result.staging"
    fresh = artifacts / ".new.result.staging"
    stale.write_bytes(b"old")
    fresh.write_bytes(b"new")
    old = time.time() - 120
    os.utime(stale, (old, old))

    with pytest.raises(RuntimeArtifactError) as capacity:
        store.deliver(_context(run_id="run-b"), {"source_path": "two.txt"})

    assert capacity.value.code == "artifact_quota_exceeded"
    assert not stale.exists()
    assert fresh.exists()


def test_deliver_rolls_back_destination_and_staging_when_metadata_publish_fails(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "source.txt").write_text("content", encoding="utf-8")

    class FailingStore(RuntimeArtifactStore):
        def publish(self, context, arguments):
            raise RuntimeArtifactError("artifact_metadata_failed", "metadata failed")

    store = FailingStore(tmp_path / "artifacts.sqlite3", lambda _: root)
    with pytest.raises(RuntimeArtifactError) as caught:
        store.deliver(_context(), {"source_path": "source.txt", "destination_name": "result.txt"})

    assert caught.value.code == "artifact_metadata_failed"
    assert not (root / "artifacts" / "result.txt").exists()
    assert not list((root / "artifacts").glob("*.staging"))


def test_deliver_move_removes_source_only_after_durable_publish(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    source = root / "source.txt"
    source.write_text("move me", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)

    delivered = store.deliver(_context(), {
        "source_path": "source.txt", "destination_name": "result.txt", "disposition": "move",
    })

    assert not source.exists()
    assert (root / delivered["relative_path"]).read_text(encoding="utf-8") == "move me"


def test_deliver_move_rolls_back_metadata_and_destination_when_source_remove_fails(
    tmp_path: Path, monkeypatch,
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    source = root / "source.txt"
    source.write_text("keep me", encoding="utf-8")
    store = RuntimeArtifactStore(tmp_path / "artifacts.sqlite3", lambda _: root)
    real_unlink = Path.unlink

    def guarded_unlink(path, *args, **kwargs):
        if path == source:
            raise PermissionError("locked")
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", guarded_unlink)
    with pytest.raises(RuntimeArtifactError) as caught:
        store.deliver(_context(), {
            "source_path": "source.txt", "destination_name": "result.txt", "disposition": "move",
        })

    assert caught.value.code == "artifact_publish_failed"
    assert source.exists()
    assert not (root / "artifacts" / "result.txt").exists()
    assert store.list_for_run("workspace-a", "run-a") == []
