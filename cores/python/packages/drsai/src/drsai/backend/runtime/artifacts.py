from __future__ import annotations

import base64
import hashlib
import mimetypes
import os
import re
import shutil
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from drsai.backend.workspace.paths import WorkspacePathError, resolve_workspace_path
from drsai.backend.runtime.sqlite_connection import ClosingConnection


class RuntimeArtifactError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RuntimeArtifactStore:
    """Persistent, Workspace-scoped Artifact references owned by one Full Runtime."""

    def __init__(
        self,
        database: Path,
        workspace_root,
        *,
        max_file_bytes: int = 256 * 1024 * 1024,
        max_artifacts_per_run: int = 32,
        max_total_bytes: int | None = None,
        staging_max_age_seconds: int = 24 * 60 * 60,
    ) -> None:
        self.database, self.workspace_root = Path(database), workspace_root
        self.max_file_bytes = max(1, int(max_file_bytes))
        self.max_artifacts_per_run = max(1, int(max_artifacts_per_run))
        self.max_total_bytes = None if max_total_bytes is None else max(1, int(max_total_bytes))
        self.staging_max_age_seconds = max(60, int(staging_max_age_seconds))
        self.payload_root = self.database.parent / "payloads"
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.payload_root.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_artifacts(
              artifact_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
              run_id TEXT NOT NULL, relative_path TEXT NOT NULL, display_name TEXT NOT NULL,
              mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
              storage_kind TEXT NOT NULL DEFAULT 'workspace'
            )""")
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(runtime_artifacts)")}
            if "storage_kind" not in columns:
                db.execute(
                    "ALTER TABLE runtime_artifacts ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'workspace'"
                )
            if "idempotency_key" not in columns:
                db.execute("ALTER TABLE runtime_artifacts ADD COLUMN idempotency_key TEXT")
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS runtime_artifacts_idempotency "
                "ON runtime_artifacts(workspace_id,run_id,idempotency_key) WHERE idempotency_key IS NOT NULL"
            )
        self.cleanup_staging()

    def _connect(self):
        db = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        return db

    def publish(self, context, arguments: Mapping[str, Any]) -> dict[str, Any]:
        idempotency_key = self._idempotency_key(arguments)
        existing = self._by_idempotency(context.workspace_id, context.run_id, idempotency_key)
        if existing is not None:
            return existing
        relative = str(arguments.get("path") or "")
        root = Path(self.workspace_root(context.workspace_id)).resolve(strict=True)
        try:
            path = resolve_workspace_path(root, relative, strict=True)
        except (WorkspacePathError, OSError) as exc:
            raise RuntimeArtifactError(getattr(exc, "code", "artifact_path_invalid"), "Artifact path is invalid") from exc
        if not path.is_file():
            raise RuntimeArtifactError("artifact_not_file", "Artifact must reference a regular file")
        size = path.stat().st_size
        self._enforce_quota(context.workspace_id, context.run_id, size)
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        artifact_id = f"artifact-{uuid4()}"
        item = {
            "artifact_id": artifact_id, "workspace_id": context.workspace_id, "session_id": context.session_id,
            "run_id": context.run_id, "relative_path": path.relative_to(root).as_posix(),
            "display_name": str(arguments.get("display_name") or path.name)[:240],
            "mime_type": str(arguments.get("mime_type") or mimetypes.guess_type(path.name)[0] or "application/octet-stream"),
            "size": size,             "sha256": digest.hexdigest(), "created_at": datetime.now(UTC).isoformat(),
            # Runtime metadata/chunk handlers make every registered file locally
            # downloadable. Preview remains MIME-specific and is intentionally
            # not claimed for Office packages.
            "artifact_type": (
                "image" if str(arguments.get("mime_type") or mimetypes.guess_type(path.name)[0] or "").startswith("image/")
                else "file"
            ),
            "name": path.name, "path": path.relative_to(root).as_posix(),
            "storage_kind": "workspace",
            "downloadable": True, "previewable": str(arguments.get("mime_type") or mimetypes.guess_type(path.name)[0] or "").startswith(("image/", "text/")),
        }
        try:
            with self._connect() as db:
                db.execute(
                    """INSERT INTO runtime_artifacts(
                      artifact_id,workspace_id,session_id,run_id,relative_path,display_name,
                      mime_type,size,sha256,created_at,storage_kind,idempotency_key
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (*(item[key] for key in ("artifact_id", "workspace_id", "session_id", "run_id", "relative_path", "display_name", "mime_type", "size", "sha256", "created_at")), "workspace", idempotency_key),
                )
        except sqlite3.IntegrityError as exc:
            replay = self._by_idempotency(context.workspace_id, context.run_id, idempotency_key)
            if replay is not None:
                return replay
            raise RuntimeArtifactError("artifact_metadata_failed", "Artifact metadata could not be committed") from exc
        return item

    def deliver(self, context, arguments: Mapping[str, Any]) -> dict[str, Any]:
        """Atomically place a Workspace file under ``artifacts/`` and publish it.

        The Runtime supplies ``context``; callers cannot select another
        Workspace, Session, Run, or tenant.  P1 intentionally accepts sources
        only from the bound Workspace.  Hosts with private scratch or object
        storage can implement the same port with an equivalent scoped source
        resolver without exposing physical paths to the Agent.
        """
        self.cleanup_staging()
        source_reference = str(arguments.get("source_path") or "").strip()
        if not source_reference:
            raise RuntimeArtifactError("artifact_source_invalid", "Artifact source is required")
        root = Path(self.workspace_root(context.workspace_id)).resolve(strict=True)
        try:
            source = resolve_workspace_path(root, source_reference, strict=True)
        except (WorkspacePathError, OSError) as exc:
            code = getattr(exc, "code", "artifact_source_invalid")
            if code == "workspace_escape_rejected":
                code = "artifact_source_outside_scope"
            raise RuntimeArtifactError(code, "Artifact source is invalid") from exc
        if not source.is_file():
            raise RuntimeArtifactError("artifact_source_invalid", "Artifact source must be a regular file")
        disposition = str(arguments.get("disposition") or "copy").lower()
        if disposition not in {"copy", "move"}:
            raise RuntimeArtifactError("artifact_destination_invalid", "Artifact disposition is invalid")
        idempotency_key = self._idempotency_key(arguments)
        existing = self._by_idempotency(context.workspace_id, context.run_id, idempotency_key)
        if existing is not None:
            return existing
        if source.stat().st_size > self.max_file_bytes:
            raise RuntimeArtifactError("artifact_quota_exceeded", "Artifact exceeds the per-file size limit")

        requested_name = str(
            arguments.get("destination_name") or arguments.get("display_name") or source.name
        ).strip()
        safe_name = self._safe_destination_name(requested_name)
        artifacts_root = self._verified_artifacts_root(root)

        # A file already written directly to artifacts is ready to register;
        # do not create a duplicate merely to satisfy the explicit delivery
        # protocol.
        if source.parent.resolve() == artifacts_root.resolve() and source.name == safe_name:
            relative = source.relative_to(root).as_posix()
            return self.publish(context, {
                "path": relative,
                "display_name": arguments.get("display_name") or source.name,
                "mime_type": arguments.get("mime_type"),
                "idempotency_key": idempotency_key,
            })

        staging = artifacts_root / f".{safe_name}.{uuid4().hex}.staging"
        destination: Path | None = None
        try:
            with source.open("rb") as reader:
                try:
                    source.resolve(strict=True).relative_to(root)
                    opened = os.fstat(reader.fileno())
                    current = source.stat()
                    if (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino):
                        raise OSError("Artifact source changed while opening")
                except (OSError, ValueError) as exc:
                    raise RuntimeArtifactError(
                        "artifact_source_invalid", "Artifact source changed during delivery",
                    ) from exc
                with staging.open("xb") as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
                    writer.flush()
                    os.fsync(writer.fileno())
            destination = self._commit_without_overwrite(staging, artifacts_root, safe_name)
            descriptor = self.publish(context, {
                "path": destination.relative_to(root).as_posix(),
                "display_name": arguments.get("display_name") or destination.name,
                "mime_type": arguments.get("mime_type"),
                "idempotency_key": idempotency_key,
            })
            if descriptor.get("idempotent_replay") is True and descriptor.get("relative_path") != destination.relative_to(root).as_posix():
                destination.unlink(missing_ok=True)
                destination = None
            if disposition == "move":
                try:
                    source.unlink()
                except OSError as exc:
                    self._delete_metadata(str(descriptor["artifact_id"]))
                    raise RuntimeArtifactError(
                        "artifact_publish_failed", "Artifact source could not be removed after delivery",
                    ) from exc
            return descriptor
        except RuntimeArtifactError:
            if destination is not None:
                destination.unlink(missing_ok=True)
            raise
        except OSError as exc:
            if destination is not None:
                destination.unlink(missing_ok=True)
            raise RuntimeArtifactError("artifact_publish_failed", "Artifact could not be delivered") from exc
        finally:
            staging.unlink(missing_ok=True)

    def replay(self, context, idempotency_key: str | None) -> dict[str, Any] | None:
        """Return a prior delivery before admission/rate accounting on retries."""
        key = self._idempotency_key({"idempotency_key": idempotency_key})
        return self._by_idempotency(context.workspace_id, context.run_id, key)

    def _delete_metadata(self, artifact_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM runtime_artifacts WHERE artifact_id=?", (artifact_id,))

    @staticmethod
    def _safe_destination_name(value: str) -> str:
        # P1 accepts a single filename, not a model-selected destination path.
        if not value or Path(value).name != value or value in {".", ".."}:
            raise RuntimeArtifactError("artifact_destination_invalid", "Artifact destination name is invalid")
        cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).rstrip(" .")
        if not cleaned or cleaned in {".", ".."}:
            raise RuntimeArtifactError("artifact_destination_invalid", "Artifact destination name is invalid")
        if Path(cleaned).stem.upper() in {
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5",
            "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4",
            "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        }:
            cleaned = f"_{cleaned}"
        # Keep names bounded across local filesystems and object-store adapters.
        if len(cleaned.encode("utf-8")) > 240:
            suffix = Path(cleaned).suffix
            if len(suffix.encode("utf-8")) > 40:
                suffix = ""
            suffix_bytes = len(suffix.encode("utf-8"))
            budget = max(1, 240 - suffix_bytes)
            stem_chars: list[str] = []
            used = 0
            for character in Path(cleaned).stem:
                width = len(character.encode("utf-8"))
                if used + width > budget:
                    break
                stem_chars.append(character)
                used += width
            stem = "".join(stem_chars).rstrip(" .") or "artifact"
            cleaned = f"{stem}{suffix}"
        return cleaned

    @staticmethod
    def _verified_artifacts_root(workspace_root: Path) -> Path:
        artifacts_root = workspace_root / "artifacts"
        artifacts_root.mkdir(parents=True, exist_ok=True)
        try:
            resolved = artifacts_root.resolve(strict=True)
            resolved.relative_to(workspace_root)
        except (OSError, ValueError) as exc:
            raise RuntimeArtifactError(
                "artifact_destination_outside_scope",
                "Artifact destination is outside the Workspace",
            ) from exc
        if not resolved.is_dir():
            raise RuntimeArtifactError("artifact_destination_invalid", "Artifact destination is invalid")
        return resolved

    @staticmethod
    def _commit_without_overwrite(staging: Path, root: Path, name: str) -> Path:
        """Expose a fully-written staging inode without replacing any file.

        A hard link is an atomic no-overwrite commit on the same filesystem.
        If another delivery wins the requested name, retry with the next
        deterministic conflict suffix.  The staging link is removed by the
        caller after metadata publication.
        """
        path = Path(name)
        candidates = [root / name]
        candidates.extend(root / f"{path.stem} ({index}){path.suffix}" for index in range(2, 10_002))
        for candidate in candidates:
            try:
                os.link(staging, candidate)
                return candidate
            except FileExistsError:
                continue
        raise RuntimeArtifactError("artifact_name_conflict", "No available Artifact destination name")

    @staticmethod
    def _idempotency_key(arguments: Mapping[str, Any]) -> str | None:
        raw = arguments.get("idempotency_key")
        if raw is None:
            return None
        value = str(raw).strip()
        if not value or len(value) > 160 or any(ord(character) < 32 for character in value):
            raise RuntimeArtifactError("artifact_destination_invalid", "Artifact idempotency key is invalid")
        return value

    def _by_idempotency(self, workspace_id: str, run_id: str, key: str | None) -> dict[str, Any] | None:
        if key is None:
            return None
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_artifacts WHERE workspace_id=? AND run_id=? AND idempotency_key=?",
                (workspace_id, run_id, key),
            ).fetchone()
        if row is None:
            return None
        return {**self._public_descriptor(row), "idempotent_replay": True}

    def _enforce_quota(self, workspace_id: str, run_id: str, size: int) -> None:
        if size > self.max_file_bytes:
            raise RuntimeArtifactError("artifact_quota_exceeded", "Artifact exceeds the per-file size limit")
        with self._connect() as db:
            count = int(db.execute(
                "SELECT COUNT(*) FROM runtime_artifacts WHERE workspace_id=? AND run_id=?",
                (workspace_id, run_id),
            ).fetchone()[0])
            total_bytes = int(db.execute("SELECT COALESCE(SUM(size),0) FROM runtime_artifacts").fetchone()[0])
        if count >= self.max_artifacts_per_run:
            raise RuntimeArtifactError("artifact_quota_exceeded", "Run Artifact count limit was reached")
        if self.max_total_bytes is not None and total_bytes + size > self.max_total_bytes:
            raise RuntimeArtifactError("artifact_quota_exceeded", "Artifact storage capacity limit was reached")

    def cleanup_staging(self, *, now: float | None = None) -> int:
        """Remove only expired staging files from known Artifact roots.

        Workspace roots are discovered from durable metadata, while a new
        Workspace is cleaned when it is first delivered to. Fresh staging
        files are never touched, so concurrent publishers remain safe.
        """
        cutoff = (time.time() if now is None else now) - self.staging_max_age_seconds
        roots: set[Path] = set()
        with self._connect() as db:
            workspace_ids = {str(row[0]) for row in db.execute("SELECT DISTINCT workspace_id FROM runtime_artifacts")}
        for workspace_id in workspace_ids:
            try:
                roots.add(self._verified_artifacts_root(Path(self.workspace_root(workspace_id)).resolve(strict=True)))
            except Exception:
                # Stale Artifact metadata must never prevent Runtime startup.
                continue
        removed = 0
        for root in roots:
            for candidate in root.glob(".*.staging"):
                try:
                    if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                        candidate.unlink()
                        removed += 1
                except OSError:
                    continue
        return removed

    @staticmethod
    def _public_descriptor(row: Mapping[str, Any]) -> dict[str, Any]:
        item = dict(row)
        mime = str(item.get("mime_type") or "application/octet-stream")
        relative_name = Path(str(item.get("relative_path") or "")).name
        name = relative_name if item.get("storage_kind") == "workspace" and relative_name else str(item.get("display_name") or "artifact")
        return {
            **{key: item[key] for key in (
                "artifact_id", "workspace_id", "session_id", "run_id", "relative_path",
                "display_name", "mime_type", "size", "sha256", "created_at", "storage_kind",
            ) if key in item},
            "artifact_type": "file", "name": name,
            **({"path": str(item["relative_path"])} if item.get("storage_kind") == "workspace" else {}),
            "downloadable": True,
            "previewable": mime.startswith(("image/", "text/")),
        }

    def publish_content(
        self,
        context,
        content: bytes,
        *,
        display_name: str,
        mime_type: str = "application/octet-stream",
    ) -> dict[str, Any]:
        """Persist an opaque Runtime-owned payload without exposing a host path."""
        if not isinstance(content, bytes):
            raise RuntimeArtifactError("artifact_content_invalid", "Artifact content must be bytes")
        self._enforce_quota(str(context.workspace_id), str(context.run_id), len(content))
        artifact_id = f"artifact-{uuid4()}"
        storage_name = f"{artifact_id}.bin"
        target = self.payload_root / storage_name
        target.write_bytes(content)
        item = {
            "artifact_id": artifact_id,
            "workspace_id": str(context.workspace_id),
            "session_id": str(context.session_id),
            "run_id": str(context.run_id),
            "relative_path": storage_name,
            "display_name": str(display_name or "tool-output")[:240],
            "mime_type": str(mime_type or "application/octet-stream")[:256],
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
            "created_at": datetime.now(UTC).isoformat(),
            "artifact_type": "image" if str(mime_type or "").startswith("image/") else "file",
            "name": str(display_name or "tool-output")[:240],
            "downloadable": True,
            "previewable": str(mime_type or "").startswith(("image/", "text/")),
            "storage_kind": "runtime",
        }
        try:
            with self._connect() as db:
                db.execute(
                    """INSERT INTO runtime_artifacts(
                      artifact_id,workspace_id,session_id,run_id,relative_path,display_name,
                      mime_type,size,sha256,created_at,storage_kind
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (*(item[key] for key in ("artifact_id", "workspace_id", "session_id", "run_id", "relative_path", "display_name", "mime_type", "size", "sha256", "created_at")), "runtime"),
                )
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return item

    def list_for_run(self, workspace_id: str, run_id: str) -> list[dict[str, Any]]:
        """Return public descriptors already registered by one Run."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT artifact_id,workspace_id,session_id,run_id,relative_path,display_name,"
                "mime_type,size,sha256,created_at,storage_kind FROM runtime_artifacts "
                "WHERE workspace_id=? AND run_id=? ORDER BY created_at,artifact_id",
                (workspace_id, run_id),
            ).fetchall()
        return [self._public_descriptor(row) for row in rows]

    def metadata(self, workspace_id: str, artifact_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_artifacts WHERE workspace_id=? AND artifact_id=?",
                             (workspace_id, artifact_id)).fetchone()
        if row is None:
            raise RuntimeArtifactError("artifact_not_found", "Artifact was not found in this Workspace")
        return self._public_descriptor(row)

    def chunk(self, workspace_id: str, artifact_id: str, offset: int, length: int) -> dict[str, Any]:
        if offset < 0 or length < 1 or length > 1024 * 1024:
            raise RuntimeArtifactError("artifact_range_invalid", "Artifact range is invalid")
        item = self.metadata(workspace_id, artifact_id)
        if item.get("storage_kind") == "runtime":
            try:
                path = (self.payload_root / str(item["relative_path"])).resolve(strict=True)
                path.relative_to(self.payload_root.resolve(strict=True))
            except (ValueError, OSError) as exc:
                raise RuntimeArtifactError("artifact_unavailable", "Artifact file is unavailable") from exc
        else:
            root = Path(self.workspace_root(workspace_id)).resolve(strict=True)
            try:
                path = resolve_workspace_path(root, item["relative_path"], strict=True)
            except (WorkspacePathError, OSError) as exc:
                raise RuntimeArtifactError("artifact_unavailable", "Artifact file is unavailable") from exc
        with path.open("rb") as handle:
            handle.seek(offset)
            data = handle.read(length)
        return {"artifact_id": artifact_id, "offset": offset, "length": len(data),
                "content_base64": base64.b64encode(data).decode("ascii"),
                "eof": offset + len(data) >= int(item["size"]), "sha256": item["sha256"]}

    def handlers(self, workspace_id: str):
        return {
            "artifact.metadata": lambda params: self.metadata(workspace_id, str(params["artifact_id"])),
            "artifact.chunk": lambda params: self.chunk(workspace_id, str(params["artifact_id"]),
                                                        int(params["offset"]), int(params["length"])),
        }

