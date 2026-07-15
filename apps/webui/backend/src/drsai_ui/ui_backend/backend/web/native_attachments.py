"""Authenticated, user-isolated storage for Native API chat attachments."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException, UploadFile


MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_CONTEXT_CHARS = 80_000
MAX_PDF_PAGES = 100
ATTACHMENT_TTL_SECONDS = 24 * 60 * 60
SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp",
    ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log",
    ".pdf",
}
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"}


@dataclass(frozen=True)
class StoredAttachment:
    id: str
    user_id: str
    thread_id: str
    run_id: str | None
    name: str
    kind: str
    mime_type: str
    size: int
    sha256: str
    path: Path
    created_at: float
    expires_at: float
    gfs_path: str | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "mime_type": self.mime_type,
            "size": self.size,
            "sha256": self.sha256,
            "processing_status": "ready",
            "expires_at": _iso_utc(self.expires_at),
        }

    def runtime_file(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "type": self.mime_type,
            "size": self.size,
            "sha256": self.sha256,
            "path": str(self.path),
        }


class NativeAttachmentStore:
    """Filesystem-backed store with opaque IDs and per-user directories.

    The root can point at a shared persistent volume in production. Metadata is
    stored next to the payload so multiple workers see the same records.
    """

    def __init__(self, root: Path | None = None, gfs_factory: Callable[[str], Any] | None = None) -> None:
        configured = os.getenv("OPENDRSAI_NATIVE_ATTACHMENT_ROOT")
        self.root = root or Path(configured) if configured else root or Path.home() / ".drsai_ui" / "files" / "native_attachments"
        self.root.mkdir(parents=True, exist_ok=True)
        self._gfs_factory = gfs_factory
        if self._gfs_factory is None and os.getenv("OPENDRSAI_NATIVE_ATTACHMENT_GFS", "false").lower() in {"1", "true", "yes", "on"}:
            from drsai.modules.managers.gfs import get_user_client
            self._gfs_factory = get_user_client

    async def save(self, upload: UploadFile, user_id: str, thread_id: str, run_id: str | None) -> StoredAttachment:
        name = sanitize_filename(upload.filename or "")
        suffix = Path(name).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            _error(400, "unsupported_attachment_type", "Unsupported attachment type")
        attachment_id = f"att_{uuid.uuid4().hex}"
        directory = self._user_root(user_id) / attachment_id
        directory.mkdir(parents=True, exist_ok=False)
        payload = directory / f"payload{suffix}"
        digest = hashlib.sha256()
        size = 0
        head = bytearray()
        try:
            with payload.open("wb") as target:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_ATTACHMENT_BYTES:
                        _error(413, "attachment_too_large", "Attachment exceeds the 10 MB limit")
                    if len(head) < 512:
                        head.extend(chunk[: 512 - len(head)])
                    digest.update(chunk)
                    target.write(chunk)
            if size == 0:
                _error(422, "attachment_invalid", "Attachment is empty")
            kind, mime_type = detect_attachment_type(suffix, bytes(head), upload.content_type)
            now = time.time()
            item = StoredAttachment(
                id=attachment_id,
                user_id=user_id,
                thread_id=thread_id,
                run_id=run_id,
                name=name,
                kind=kind,
                mime_type=mime_type,
                size=size,
                sha256=digest.hexdigest(),
                path=payload,
                created_at=now,
                expires_at=now + ATTACHMENT_TTL_SECONDS,
            )
            item = self._upload_to_gfs(item)
            self._write_metadata(directory, item)
            return item
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        finally:
            await upload.close()

    def import_runtime_file(self, source: Path, user_id: str, thread_id: str, run_id: str | None) -> StoredAttachment:
        if not source.is_file() or source.stat().st_size <= 0 or source.stat().st_size > MAX_ATTACHMENT_BYTES:
            _error(422, "attachment_invalid", "Runtime artifact is unavailable or too large")
        name = sanitize_filename(source.name)
        suffix = source.suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            _error(400, "unsupported_attachment_type", "Unsupported runtime artifact type")
        with source.open("rb") as stream:
            head = stream.read(512)
        kind, mime_type = detect_attachment_type(suffix, head, None)
        attachment_id = f"att_{uuid.uuid4().hex}"
        directory = self._user_root(user_id) / attachment_id
        directory.mkdir(parents=True, exist_ok=False)
        payload = directory / f"payload{suffix}"
        digest = hashlib.sha256()
        size = 0
        try:
            with source.open("rb") as input_stream, payload.open("wb") as output:
                while chunk := input_stream.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)
                    output.write(chunk)
            now = time.time()
            item = StoredAttachment(
                id=attachment_id, user_id=user_id, thread_id=thread_id, run_id=run_id,
                name=name, kind=kind, mime_type=mime_type, size=size, sha256=digest.hexdigest(),
                path=payload, created_at=now, expires_at=now + ATTACHMENT_TTL_SECONDS,
            )
            item = self._upload_to_gfs(item)
            self._write_metadata(directory, item)
            return item
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise

    def get(self, attachment_id: str, user_id: str, *, thread_id: str | None = None) -> StoredAttachment:
        if not re.fullmatch(r"att_[a-f0-9]{32}", attachment_id):
            _error(404, "attachment_not_found", "Attachment not found")
        directory = self._user_root(user_id) / attachment_id
        metadata_path = directory / "metadata.json"
        if not metadata_path.is_file():
            _error(404, "attachment_not_found", "Attachment not found")
        try:
            raw = json.loads(metadata_path.read_text(encoding="utf-8"))
            payload = directory / raw["payload"]
            item = StoredAttachment(
                id=raw["id"], user_id=raw["user_id"], thread_id=raw["thread_id"],
                run_id=raw.get("run_id"), name=raw["name"], kind=raw["kind"],
                mime_type=raw["mime_type"], size=int(raw["size"]), sha256=raw["sha256"],
                path=payload, created_at=float(raw["created_at"]), expires_at=float(raw["expires_at"]),
                gfs_path=raw.get("gfs_path"),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            _error(422, "attachment_invalid", "Attachment metadata is invalid")
        if item.user_id != user_id:
            _error(404, "attachment_not_found", "Attachment not found")
        if not item.path.is_file() and item.gfs_path and self._gfs_factory:
            try:
                self._gfs_factory(user_id).download_file(item.gfs_path, str(item.path))
            except Exception:
                _error(503, "attachment_storage_unavailable", "Attachment storage is unavailable")
        if not item.path.is_file():
            _error(404, "attachment_not_found", "Attachment not found")
        if item.expires_at <= time.time():
            shutil.rmtree(directory, ignore_errors=True)
            _error(404, "attachment_not_found", "Attachment expired")
        if thread_id is not None and item.thread_id != thread_id:
            _error(403, "attachment_forbidden", "Attachment belongs to another conversation")
        return item

    def delete(self, attachment_id: str, user_id: str) -> None:
        item = self.get(attachment_id, user_id)
        if item.gfs_path and self._gfs_factory:
            try:
                self._gfs_factory(user_id).delete(item.gfs_path)
            except Exception:
                pass
        shutil.rmtree(item.path.parent, ignore_errors=True)

    def resolve_many(self, attachments: list[dict[str, Any]], user_id: str, thread_id: str) -> list[StoredAttachment]:
        if len(attachments) > 5:
            _error(413, "attachment_too_large", "A message cannot contain more than 5 attachments")
        resolved: list[StoredAttachment] = []
        total = 0
        seen: set[str] = set()
        for reference in attachments:
            attachment_id = reference.get("id") if isinstance(reference, dict) else None
            if not isinstance(attachment_id, str) or attachment_id in seen:
                _error(422, "attachment_invalid", "Attachment reference is invalid")
            item = self.get(attachment_id, user_id, thread_id=thread_id)
            total += item.size
            if total > 25 * 1024 * 1024:
                _error(413, "attachment_too_large", "Attachments exceed the 25 MB message limit")
            resolved.append(item)
            seen.add(attachment_id)
        return resolved

    def context(self, item: StoredAttachment) -> dict[str, Any]:
        if item.kind == "image":
            return {"id": item.id, "kind": "image", "mime_type": item.mime_type, "text": None, "truncated": False}
        if item.mime_type == "application/pdf":
            text, truncated = extract_pdf_text(item.path)
        else:
            text, truncated = extract_utf8_text(item.path)
        return {
            "id": item.id,
            "kind": "document",
            "mime_type": item.mime_type,
            "text": text,
            "truncated": truncated,
        }

    def cleanup_expired(self, now: float | None = None) -> int:
        threshold = now or time.time()
        removed = 0
        for metadata_path in self.root.glob("*/*/metadata.json"):
            raw: dict[str, Any] = {}
            try:
                raw = json.loads(metadata_path.read_text(encoding="utf-8"))
                expired = float(raw.get("expires_at", 0)) <= threshold
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                expired = True
            if expired:
                if self._gfs_factory and raw.get("gfs_path") and raw.get("user_id"):
                    try:
                        self._gfs_factory(str(raw["user_id"])).delete(str(raw["gfs_path"]))
                    except Exception:
                        pass
                shutil.rmtree(metadata_path.parent, ignore_errors=True)
                removed += 1
        return removed

    def _user_root(self, user_id: str) -> Path:
        digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
        path = self.root / digest
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _write_metadata(directory: Path, item: StoredAttachment) -> None:
        data = {
            "id": item.id, "user_id": item.user_id, "thread_id": item.thread_id,
            "run_id": item.run_id, "name": item.name, "kind": item.kind,
            "mime_type": item.mime_type, "size": item.size, "sha256": item.sha256,
            "payload": item.path.name, "created_at": item.created_at, "expires_at": item.expires_at,
            "gfs_path": item.gfs_path,
        }
        temporary = directory / "metadata.tmp"
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temporary.replace(directory / "metadata.json")

    def _upload_to_gfs(self, item: StoredAttachment) -> StoredAttachment:
        if not self._gfs_factory:
            return item
        safe_thread = re.sub(r"[^a-zA-Z0-9_.:-]", "_", item.thread_id)[:160]
        remote_path = f"uploads/native/{safe_thread}/{item.id}/{item.path.name}"
        try:
            self._gfs_factory(item.user_id).upload_file(str(item.path), remote_path)
        except Exception:
            shutil.rmtree(item.path.parent, ignore_errors=True)
            _error(503, "attachment_storage_unavailable", "Attachment storage is unavailable")
        return StoredAttachment(**{**item.__dict__, "gfs_path": remote_path})


def sanitize_filename(raw: str) -> str:
    name = Path(raw.replace("\\", "/")).name.strip().replace("\r", "").replace("\n", "")
    name = re.sub(r"[^\w.()\-\u4e00-\u9fff ]", "_", name, flags=re.UNICODE)
    name = name[:200].strip(" .")
    if not name or name in {".", ".."}:
        _error(422, "attachment_invalid", "Attachment filename is invalid")
    return name


def detect_attachment_type(suffix: str, head: bytes, declared_mime: str | None) -> tuple[str, str]:
    signatures = {
        ".jpg": (b"\xff\xd8\xff", "image/jpeg"),
        ".jpeg": (b"\xff\xd8\xff", "image/jpeg"),
        ".png": (b"\x89PNG\r\n\x1a\n", "image/png"),
        ".pdf": (b"%PDF-", "application/pdf"),
    }
    if suffix in signatures:
        signature, mime = signatures[suffix]
        if not head.startswith(signature):
            _error(422, "attachment_invalid", "Attachment content does not match its filename")
        return ("image" if suffix != ".pdf" else "file", mime)
    if suffix == ".webp":
        if len(head) < 12 or not (head.startswith(b"RIFF") and head[8:12] == b"WEBP"):
            _error(422, "attachment_invalid", "Attachment content does not match its filename")
        return "image", "image/webp"
    if suffix in TEXT_EXTENSIONS:
        try:
            head.decode("utf-8")
        except UnicodeDecodeError:
            _error(422, "attachment_invalid", "Text attachment must be UTF-8")
        mime = declared_mime if declared_mime and declared_mime.startswith("text/") else "text/plain"
        return "file", mime[:120]
    _error(400, "unsupported_attachment_type", "Unsupported attachment type")


def extract_utf8_text(path: Path) -> tuple[str, bool]:
    with path.open("rb") as stream:
        raw = stream.read(MAX_CONTEXT_CHARS * 4 + 1)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        _error(422, "attachment_invalid", "Text attachment must be UTF-8")
    text = text.replace("\x00", "").strip()
    truncated = len(text) > MAX_CONTEXT_CHARS or len(raw) > MAX_CONTEXT_CHARS * 4
    return text[:MAX_CONTEXT_CHARS], truncated


def extract_pdf_text(path: Path) -> tuple[str, bool]:
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path), strict=False)
        pages = reader.pages[:MAX_PDF_PAGES]
        parts: list[str] = []
        length = 0
        for page in pages:
            content = (page.extract_text() or "").replace("\x00", "").strip()
            remaining = MAX_CONTEXT_CHARS - length
            if remaining <= 0:
                break
            parts.append(content[:remaining])
            length += min(len(content), remaining)
        truncated = len(reader.pages) > len(pages) or length >= MAX_CONTEXT_CHARS
        return "\n\n".join(part for part in parts if part), truncated
    except HTTPException:
        raise
    except Exception as error:
        _error(422, "attachment_invalid", f"PDF content could not be extracted: {type(error).__name__}")


def _iso_utc(timestamp: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def _error(status: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


_STORE: NativeAttachmentStore | None = None


def get_native_attachment_store() -> NativeAttachmentStore:
    global _STORE
    if _STORE is None:
        _STORE = NativeAttachmentStore()
    return _STORE
