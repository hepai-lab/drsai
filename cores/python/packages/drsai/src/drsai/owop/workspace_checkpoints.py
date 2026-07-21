"""Workspace state checkpoints, isolated from Runtime execution checkpoints."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from drsai.owop.protocol import OWOPError


IGNORED = frozenset({".git", ".drsai", "node_modules", "__pycache__"})


def _digest_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


class WorkspaceCheckpointStore:
    def __init__(self, state_root: Path, workspace_id: str, workspace_root: Path):
        self.state_root = Path(state_root).resolve(strict=False) / "workspace-checkpoints" / workspace_id
        self.state_root.mkdir(parents=True, exist_ok=True)
        self.workspace_id = workspace_id
        self.workspace_root = Path(workspace_root).resolve(strict=True)

    def create(self, params: Mapping[str, Any]) -> dict[str, Any]:
        checkpoint_id = f"workspace-checkpoint-{uuid.uuid4()}"
        directory = self.state_root / checkpoint_id
        snapshots = directory / "files"
        snapshots.mkdir(parents=True)
        max_file_bytes = int(params.get("max_file_bytes") or 10 * 1024 * 1024)
        entries = []
        for path in self._files():
            relative = path.relative_to(self.workspace_root).as_posix()
            size = path.stat().st_size
            stored = size <= max_file_bytes
            entry = {"path": relative, "size": size, "digest": _digest_file(path), "stored": stored}
            if stored:
                destination = snapshots / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
            else:
                entry["skipped_reason"] = "large_file"
            entries.append(entry)
        manifest = {
            "schema": "owop.workspace-checkpoint.v1",
            "checkpoint_id": checkpoint_id,
            "workspace_id": self.workspace_id,
            "label": str(params.get("label") or "Workspace checkpoint")[:240],
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "entries": entries,
        }
        self._write_manifest(directory, manifest)
        return self._summary(manifest)

    def preview(self, checkpoint_id: str) -> dict[str, Any]:
        manifest = self._manifest(checkpoint_id)
        before = {entry["path"]: entry for entry in manifest["entries"]}
        current = {path.relative_to(self.workspace_root).as_posix(): path for path in self._files()}
        changes = []
        for relative in sorted(set(before).union(current)):
            entry, path = before.get(relative), current.get(relative)
            if entry is None:
                changes.append({"path": relative, "change": "added", "restorable": True})
            elif path is None:
                changes.append({"path": relative, "change": "deleted", "restorable": bool(entry["stored"])})
            else:
                current_digest = _digest_file(path)
                if current_digest != entry["digest"]:
                    changes.append({"path": relative, "change": "modified", "restorable": bool(entry["stored"]), "current_digest": current_digest, "checkpoint_digest": entry["digest"]})
        canonical = json.dumps(changes, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return {
            "schema": "owop.workspace-checkpoint-preview.v1",
            "checkpoint_id": checkpoint_id,
            "workspace_id": self.workspace_id,
            "changes": changes,
            "preview_digest": _digest_bytes(canonical),
            "skipped_count": sum(1 for entry in manifest["entries"] if not entry["stored"]),
        }

    def restore(self, checkpoint_id: str, preview_digest: str) -> dict[str, Any]:
        preview = self.preview(checkpoint_id)
        if preview["preview_digest"] != preview_digest:
            raise OWOPError("owop_conflict", "Workspace changed after checkpoint preview.", "operation")
        manifest = self._manifest(checkpoint_id)
        directory = self.state_root / checkpoint_id / "files"
        before = {entry["path"]: entry for entry in manifest["entries"]}
        restored = removed = skipped = 0
        for path in list(self._files()):
            relative = path.relative_to(self.workspace_root).as_posix()
            if relative not in before:
                path.unlink()
                removed += 1
        for relative, entry in before.items():
            target = self.workspace_root / Path(relative)
            if not entry["stored"]:
                skipped += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(f".{target.name}.checkpoint-{uuid.uuid4().hex}")
            try:
                shutil.copy2(directory / Path(relative), temporary)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
            restored += 1
        return {
            "checkpoint_id": checkpoint_id,
            "workspace_id": self.workspace_id,
            "restored_count": restored,
            "removed_count": removed,
            "skipped_count": skipped,
        }

    def accept(self, checkpoint_id: str) -> dict[str, Any]:
        directory = self.state_root / checkpoint_id
        manifest = self._manifest(checkpoint_id)
        manifest["status"] = "accepted"
        manifest["accepted_at"] = datetime.now(timezone.utc).isoformat()
        self._write_manifest(directory, manifest)
        return self._summary(manifest)

    def _files(self) -> list[Path]:
        result = []
        for directory, names, files in os.walk(self.workspace_root):
            names[:] = [name for name in names if name not in IGNORED]
            result.extend(Path(directory) / name for name in files)
        return sorted(result, key=lambda path: path.relative_to(self.workspace_root).as_posix().casefold())

    def _manifest(self, checkpoint_id: str) -> dict[str, Any]:
        if not checkpoint_id.startswith("workspace-checkpoint-") or any(character in checkpoint_id for character in "/\\\0"):
            raise OWOPError("checkpoint_id_invalid", "Workspace Checkpoint id is invalid.", "operation")
        try:
            manifest = json.loads((self.state_root / checkpoint_id / "manifest.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError) as exc:
            raise OWOPError("checkpoint_not_found", "Workspace Checkpoint was not found.", "operation") from exc
        if manifest.get("workspace_id") != self.workspace_id or manifest.get("schema") != "owop.workspace-checkpoint.v1":
            raise OWOPError("checkpoint_invalid", "Workspace Checkpoint identity is invalid.", "operation")
        return manifest

    @staticmethod
    def _write_manifest(directory: Path, manifest: Mapping[str, Any]) -> None:
        temporary = directory / ".manifest.tmp"
        temporary.write_text(json.dumps(dict(manifest), separators=(",", ":"), sort_keys=True), encoding="utf-8")
        os.replace(temporary, directory / "manifest.json")

    @staticmethod
    def _summary(manifest: Mapping[str, Any]) -> dict[str, Any]:
        entries = manifest["entries"]
        return {
            "schema": manifest["schema"],
            "checkpoint_id": manifest["checkpoint_id"],
            "workspace_id": manifest["workspace_id"],
            "label": manifest["label"],
            "status": manifest["status"],
            "created_at": manifest["created_at"],
            "file_count": len(entries),
            "stored_count": sum(1 for entry in entries if entry["stored"]),
            "skipped_count": sum(1 for entry in entries if not entry["stored"]),
        }
