from __future__ import annotations

import base64
import hashlib
import mimetypes
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from drsai.backend.workspace.paths import WorkspacePathError, resolve_workspace_path


class RuntimeArtifactError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RuntimeArtifactStore:
    """Persistent, Workspace-scoped Artifact references owned by one Full Runtime."""

    def __init__(self, database: Path, workspace_root) -> None:
        self.database, self.workspace_root = Path(database), workspace_root
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_artifacts(
              artifact_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
              run_id TEXT NOT NULL, relative_path TEXT NOT NULL, display_name TEXT NOT NULL,
              mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
            )""")

    def _connect(self):
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def publish(self, context, arguments: Mapping[str, Any]) -> dict[str, Any]:
        relative = str(arguments.get("path") or "")
        root = Path(self.workspace_root(context.workspace_id)).resolve(strict=True)
        try:
            path = resolve_workspace_path(root, relative, strict=True)
        except (WorkspacePathError, OSError) as exc:
            raise RuntimeArtifactError(getattr(exc, "code", "artifact_path_invalid"), "Artifact path is invalid") from exc
        if not path.is_file():
            raise RuntimeArtifactError("artifact_not_file", "Artifact must reference a regular file")
        size = path.stat().st_size
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
            "size": size, "sha256": digest.hexdigest(), "created_at": datetime.now(UTC).isoformat(),
        }
        with self._connect() as db:
            db.execute("INSERT INTO runtime_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)", tuple(item.values()))
        return item

    def metadata(self, workspace_id: str, artifact_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_artifacts WHERE workspace_id=? AND artifact_id=?",
                             (workspace_id, artifact_id)).fetchone()
        if row is None:
            raise RuntimeArtifactError("artifact_not_found", "Artifact was not found in this Workspace")
        return dict(row)

    def chunk(self, workspace_id: str, artifact_id: str, offset: int, length: int) -> dict[str, Any]:
        if offset < 0 or length < 1 or length > 1024 * 1024:
            raise RuntimeArtifactError("artifact_range_invalid", "Artifact range is invalid")
        item = self.metadata(workspace_id, artifact_id)
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

