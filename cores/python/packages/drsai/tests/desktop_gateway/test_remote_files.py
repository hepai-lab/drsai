"""Focused tests for remote FilesEvent materialisation (方案 A).

A remote DrSaiAssistant delivers ``FilesEvent`` payloads that carry the file
content by ``url`` (HepAI filesystem) or ``base64_content`` (upload fallback),
selected by ``download_method``.  These tests cover the two halves of the fix:

1. the shared translator keeps ``url`` / ``base64_content`` / ``download_method``
   on the emitted ``artifact.created`` payload, and
2. ``_remote_files.materialize_remote_file`` turns either payload into a stored
   Workspace Artifact whose descriptor the Desktop can preview and download.
"""

from __future__ import annotations

import base64

import pytest

from drsai.backend.desktop_gateway import _remote_files


class _FakeStore:
    """Stand-in for ``RuntimeArtifactStore`` that records ``publish_content``."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def publish_content(self, context, content: bytes, *, display_name: str, mime_type: str):
        self.calls.append({
            "workspace_id": context.workspace_id,
            "content": content,
            "display_name": display_name,
            "mime_type": mime_type,
        })
        return {
            "artifact_id": f"artifact-{len(self.calls)}",
            "workspace_id": context.workspace_id,
            "session_id": context.session_id,
            "run_id": context.run_id,
            "relative_path": f"artifact-{len(self.calls)}.bin",
            "display_name": display_name,
            "mime_type": mime_type,
            "size": len(content),
            "sha256": "0" * 64,
            "created_at": "2026-01-01T00:00:00+00:00",
            "storage_kind": "runtime",
            "artifact_type": "image" if mime_type.startswith("image/") else "file",
            "name": display_name,
            "downloadable": True,
            "previewable": mime_type.startswith(("image/", "text/")),
        }


class _Context:
    workspace_id = "workspace-1"
    session_id = "session-1"
    run_id = "run-1"


@pytest.fixture()
def fake_store(monkeypatch):
    store = _FakeStore()
    monkeypatch.setattr(_remote_files._state, "artifact_store", lambda: store)
    return store


def test_translator_keeps_url_base64_and_download_method() -> None:
    from drsai.backend.events.agent_event_translator import TurnState, translate
    from drsai.modules.managers.messages.agent_messages import (
        FileInfo,
        FilesContent,
        FilesEvent,
    )

    for download_method, file_info in (
        ("url", FileInfo(name="短诗.docx", url="https://files.example/s.pdf", download_method="url")),
        ("base64", FileInfo(name="report.pdf", base64_content="QUJD", download_method="base64")),
    ):
        message = FilesEvent(
            source="RemoteWorker",
            content=FilesContent(files=[file_info], title="Tool output", description="desc"),
        )
        emitted = translate(message, TurnState())
        assert len(emitted) == 1
        event_type, payload = emitted[0]
        assert event_type == "artifact.created"
        assert payload["download_method"] == download_method
        assert payload["downloadable"] is True
        if download_method == "url":
            assert payload["url"] == "https://files.example/s.pdf"
        else:
            assert payload["base64_content"] == "QUJD"


def test_translator_marks_internal_spill_not_downloadable() -> None:
    from drsai.backend.events.agent_event_translator import TurnState, translate
    from drsai.modules.managers.messages.agent_messages import (
        FileInfo,
        FilesContent,
        FilesEvent,
    )

    message = FilesEvent(
        source="agent",
        content=FilesContent(
            files=[FileInfo(name="tool-output.txt", download_method="none", downloadable=False)],
        ),
    )
    event_type, payload = translate(message, TurnState())[0]
    assert event_type == "artifact.created"
    assert payload["downloadable"] is False


def test_materialize_base64_publishes_stored_artifact(fake_store) -> None:
    payload = {
        "artifact_id": "file:report.pdf:0",
        "name": "报告.pdf",
        "mime": "application/pdf",
        "download_method": "base64",
        "base64_content": base64.b64encode(b"%PDF-1.4 hello").decode("ascii"),
        "downloadable": True,
    }

    stored = _remote_files.materialize_remote_file(_Context(), payload)

    assert stored is not None
    assert fake_store.calls[0]["content"] == b"%PDF-1.4 hello"
    assert fake_store.calls[0]["display_name"] == "报告.pdf"
    assert fake_store.calls[0]["mime_type"] == "application/pdf"
    # The stored descriptor must be locally downloadable and keep the remote id.
    assert stored["downloadable"] is True
    assert stored["download_method"] == "base64"
    assert stored["remote_artifact_id"] == "file:report.pdf:0"


def test_materialize_url_downloads_content(fake_store, monkeypatch) -> None:
    monkeypatch.setattr(_remote_files, "_download", lambda url: b"image-bytes")
    payload = {
        "artifact_id": "file:chart.png:0",
        "name": "chart.png",
        "url": "https://files.example/chart.png",
        "mime": "image/png",
        "download_method": "url",
    }

    stored = _remote_files.materialize_remote_file(_Context(), payload)

    assert stored is not None
    assert fake_store.calls[0]["content"] == b"image-bytes"
    assert stored["download_method"] == "url"
    assert stored["artifact_type"] == "image"


def test_materialize_returns_none_for_local_or_metadata_only_payload(fake_store) -> None:
    # A local artifact (no url/base64) is not remote-materialisable.
    assert _remote_files.materialize_remote_file(_Context(), {"name": "local.txt", "path": "artifacts/local.txt"}) is None
    assert not fake_store.calls


def test_materialize_rejects_unsafe_name(fake_store) -> None:
    payload = {
        "name": "../../etc/passwd",
        "base64_content": base64.b64encode(b"x").decode("ascii"),
        "download_method": "base64",
    }
    stored = _remote_files.materialize_remote_file(_Context(), payload)
    # The path separators are stripped; only the leaf survives.
    assert fake_store.calls[0]["display_name"] == "passwd"
    assert stored is not None


def test_try_materialize_never_raises(fake_store, monkeypatch) -> None:
    def boom(url: str) -> bytes:
        raise _remote_files.RemoteFileMaterializationError("remote_file_download_failed")

    monkeypatch.setattr(_remote_files, "_download", boom)
    assert _remote_files.try_materialize(_Context(), {"name": "x.bin", "url": "https://x/y"}) is None


def test_download_rejects_non_http_scheme() -> None:
    with pytest.raises(_remote_files.RemoteFileMaterializationError):
        _remote_files._download("file:///etc/passwd")
