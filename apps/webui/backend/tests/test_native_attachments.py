import asyncio
import io
import sys
import time
import types
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers


package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)
backend = types.ModuleType("drsai_ui.ui_backend.backend")
backend.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui" / "ui_backend" / "backend")]
sys.modules.setdefault("drsai_ui.ui_backend.backend", backend)

from drsai_ui.ui_backend.backend.web import native_attachments
from drsai_ui.ui_backend.backend.web.native_attachments import (
    NativeAttachmentStore,
    detect_attachment_type,
    sanitize_filename,
)


def upload(name: str, content: bytes, mime: str) -> UploadFile:
    return UploadFile(
        filename=name,
        file=io.BytesIO(content),
        headers=Headers({"content-type": mime}),
    )


def detail_code(error: HTTPException) -> str:
    return error.detail["code"]


def test_filename_sanitization_and_type_detection_reject_spoofing():
    assert sanitize_filename("../../报告 1.txt") == "报告 1.txt"
    assert detect_attachment_type(".png", b"\x89PNG\r\n\x1a\nrest", "image/png") == ("image", "image/png")
    with pytest.raises(HTTPException) as spoofed:
        detect_attachment_type(".png", b"not-a-png", "image/png")
    assert spoofed.value.status_code == 422
    assert detail_code(spoofed.value) == "attachment_invalid"


def test_save_get_context_delete_and_user_isolation(tmp_path):
    store = NativeAttachmentStore(tmp_path)
    item = asyncio.run(store.save(upload("notes.md", "你好\nOpenDrSai".encode(), "text/markdown"), "user-a", "thread-1", "run-1"))
    assert item.public()["processing_status"] == "ready"
    assert item.sha256
    assert item.path.is_file()
    assert store.get(item.id, "user-a", thread_id="thread-1").name == "notes.md"
    assert store.context(item)["text"] == "你好\nOpenDrSai"

    with pytest.raises(HTTPException) as other_user:
        store.get(item.id, "user-b")
    assert other_user.value.status_code == 404
    assert detail_code(other_user.value) == "attachment_not_found"

    with pytest.raises(HTTPException) as other_thread:
        store.get(item.id, "user-a", thread_id="thread-2")
    assert other_thread.value.status_code == 403
    assert detail_code(other_thread.value) == "attachment_forbidden"

    store.delete(item.id, "user-a")
    with pytest.raises(HTTPException):
        store.get(item.id, "user-a")


def test_size_empty_extension_duplicate_and_count_limits(tmp_path, monkeypatch):
    store = NativeAttachmentStore(tmp_path)
    monkeypatch.setattr(native_attachments, "MAX_ATTACHMENT_BYTES", 3)
    with pytest.raises(HTTPException) as too_large:
        asyncio.run(store.save(upload("x.txt", b"four", "text/plain"), "u", "t", None))
    assert too_large.value.status_code == 413
    assert detail_code(too_large.value) == "attachment_too_large"

    with pytest.raises(HTTPException) as empty:
        asyncio.run(store.save(upload("x.txt", b"", "text/plain"), "u", "t", None))
    assert detail_code(empty.value) == "attachment_invalid"

    with pytest.raises(HTTPException) as unsupported:
        asyncio.run(store.save(upload("x.exe", b"MZ", "application/octet-stream"), "u", "t", None))
    assert detail_code(unsupported.value) == "unsupported_attachment_type"

    monkeypatch.setattr(native_attachments, "MAX_ATTACHMENT_BYTES", 10 * 1024 * 1024)
    item = asyncio.run(store.save(upload("x.txt", b"ok", "text/plain"), "u", "t", None))
    with pytest.raises(HTTPException) as duplicate:
        store.resolve_many([{"id": item.id}, {"id": item.id}], "u", "t")
    assert detail_code(duplicate.value) == "attachment_invalid"
    with pytest.raises(HTTPException) as too_many:
        store.resolve_many([{"id": item.id}] * 6, "u", "t")
    assert too_many.value.status_code == 413


def test_expiry_cleanup_removes_payload_and_metadata(tmp_path):
    store = NativeAttachmentStore(tmp_path)
    item = asyncio.run(store.save(upload("x.txt", b"ok", "text/plain"), "u", "t", None))
    assert store.cleanup_expired(now=time.time() + native_attachments.ATTACHMENT_TTL_SECONDS + 1) == 1
    assert not item.path.parent.exists()


def test_image_context_never_returns_binary_or_base64(tmp_path):
    store = NativeAttachmentStore(tmp_path)
    item = asyncio.run(store.save(upload("photo.png", b"\x89PNG\r\n\x1a\nbytes", "image/png"), "u", "t", None))
    context = store.context(item)
    assert context == {
        "id": item.id,
        "kind": "image",
        "mime_type": "image/png",
        "text": None,
        "truncated": False,
    }


def test_runtime_artifact_is_copied_into_owned_store(tmp_path):
    source = tmp_path / "result.txt"
    source.write_text("generated result", encoding="utf-8")
    store = NativeAttachmentStore(tmp_path / "store")
    item = store.import_runtime_file(source, "u", "thread", "run")
    source.write_text("changed", encoding="utf-8")
    assert item.path.read_text(encoding="utf-8") == "generated result"
    assert store.get(item.id, "u").name == "result.txt"


def test_gfs_mirror_uses_user_upload_prefix_and_can_restore_payload(tmp_path):
    class FakeGfs:
        def __init__(self):
            self.objects = {}
            self.deleted = []
        def upload_file(self, local, remote):
            self.objects[remote] = Path(local).read_bytes()
        def download_file(self, remote, local):
            Path(local).parent.mkdir(parents=True, exist_ok=True)
            Path(local).write_bytes(self.objects[remote])
        def delete(self, remote):
            self.deleted.append(remote)
            self.objects.pop(remote, None)

    clients = {}
    factory = lambda user: clients.setdefault(user, FakeGfs())
    store = NativeAttachmentStore(tmp_path / "store", gfs_factory=factory)
    item = asyncio.run(store.save(upload("x.txt", b"durable", "text/plain"), "user@example.com", "thread-1", None))
    assert item.gfs_path.startswith("uploads/native/thread-1/")
    item.path.unlink()
    restored = store.get(item.id, "user@example.com")
    assert restored.path.read_bytes() == b"durable"
    store.delete(item.id, "user@example.com")
    assert item.gfs_path in clients["user@example.com"].deleted
