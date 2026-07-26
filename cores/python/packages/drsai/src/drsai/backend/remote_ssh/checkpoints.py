"""Workspace-scoped checkpoint storage for Remote SSH Gateway."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(131072), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _root(workspace_id: str) -> Path:
    path = Path.home() / ".local" / "share" / "opendrsai" / "remote" / "checkpoints" / workspace_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _changed(root: Path) -> list[tuple[str, str]]:
    result = subprocess.run(["git", "-C", str(root), "status", "--porcelain=v1", "-z", "--untracked-files=all"], capture_output=True, check=False)
    if result.returncode != 0:
        return []
    rows: list[tuple[str, str]] = []
    parts = result.stdout.decode("utf-8", "replace").split("\0")
    index = 0
    while index < len(parts) and parts[index]:
        row = parts[index]; code = row[:2]; path = row[3:]
        if "R" in code and index + 1 < len(parts):
            index += 1; path = parts[index]
        status = "untracked" if code == "??" else "deleted" if "D" in code else "added" if "A" in code else "renamed" if "R" in code else "modified"
        rows.append((path.replace("\\", "/"), status)); index += 1
    return rows


def list_checkpoints(workspace_id: str) -> list[dict[str, Any]]:
    rows = []
    for meta in _root(workspace_id).glob("*/meta.json"):
        try: rows.append(json.loads(meta.read_text("utf-8")))
        except (OSError, ValueError): pass
    return sorted(rows, key=lambda item: item["createdAt"], reverse=True)[:20]


def create_checkpoint(workspace_id: str, workspace: Path, request: dict[str, Any]) -> dict[str, Any]:
    max_files = max(1, min(int(request.get("maxFiles") or 80), 200)); max_bytes = max(8000, min(int(request.get("maxBytesPerFile") or 600000), 2000000))
    changed = _changed(workspace); checkpoint_id = f"wcp-{int(time.time()*1000):x}-{hashlib.sha256(str(workspace).encode()).hexdigest()[:8]}"
    directory = _root(workspace_id) / checkpoint_id; directory.mkdir()
    entries = []
    for relative, status in changed[:max_files]:
        try:
            target = (workspace / relative).resolve(strict=False)
            target.relative_to(workspace)
        except (OSError, ValueError):
            # Never snapshot a symlink or a concurrently swapped path outside
            # the authoritative Workspace root.
            continue
        existed = target.is_file(); size = target.stat().st_size if existed else 0; stored = existed and size <= max_bytes
        entry = {"path": str(target), "relativePath": relative, "status": status, "size": size, "stored": stored, "existed": existed}
        if stored:
            snapshot_index = len(entries)
            entry["fileHash"] = _hash(target); shutil.copy2(target, directory / f"{snapshot_index}.snapshot")
        elif existed: entry["skippedReason"] = f"larger than {max_bytes} bytes"
        entries.append(entry)
    head = subprocess.run(["git", "-C", str(workspace), "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    kind = request.get("kind") or "manual"
    result = {"id": checkpoint_id, "workspacePath": str(workspace), "label": str(request.get("label") or "Workspace checkpoint")[:120], "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "baseRef": head.stdout.strip() or None, "changedFileCount": len(entries), "storedFileCount": sum(1 for e in entries if e["stored"]), "skippedFileCount": sum(1 for e in entries if e["existed"] and not e["stored"]), "truncated": len(changed) > max_files, "entries": entries, "kind": kind}
    if request.get("runId"): result["runId"] = str(request["runId"])
    if kind == "agent_run_baseline": result["reviewStatus"] = "pending"
    (directory / "meta.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
    return result


def preview_checkpoint(workspace_id: str, workspace: Path, checkpoint_id: str, max_files: int = 20, max_chars: int = 4000) -> dict[str, Any]:
    checkpoint = next((row for row in list_checkpoints(workspace_id) if row["id"] == checkpoint_id), None)
    if not checkpoint: raise FileNotFoundError(checkpoint_id)
    rows = []
    for entry in checkpoint["entries"][:max_files]:
        target = (workspace / entry["relativePath"]).resolve(); target.relative_to(workspace); exists = target.is_file(); current_hash = _hash(target) if exists else None
        change = "unchanged" if current_hash == entry.get("fileHash") else "modified" if exists and entry.get("existed") else "added" if exists else "deleted"
        rows.append({"path": str(target), "relativePath": entry["relativePath"], "checkpointStatus": entry["status"], "change": change, "stored": entry["stored"], "existedAtCheckpoint": entry["existed"], "currentExists": exists, "checkpointHash": entry.get("fileHash"), "currentHash": current_hash, "checkpointSize": entry["size"], "currentSize": target.stat().st_size if exists else None, "currentSnippet": target.read_text("utf-8", errors="replace")[:max_chars] if exists else None, "message": change})
    changed = sum(1 for row in rows if row["change"] != "unchanged")
    return {"workspacePath": str(workspace), "checkpointId": checkpoint_id, "label": checkpoint["label"], "createdAt": checkpoint["createdAt"], "totalEntries": len(checkpoint["entries"]), "changedEntryCount": changed, "skippedEntryCount": sum(1 for row in rows if not row["stored"]), "truncated": len(rows) < len(checkpoint["entries"]), "entries": rows, "message": f"{changed} checkpoint entries differ."}


def restore_checkpoint(workspace_id: str, workspace: Path, checkpoint_id: str) -> dict[str, Any]:
    checkpoint = next((row for row in list_checkpoints(workspace_id) if row["id"] == checkpoint_id), None)
    if not checkpoint: raise FileNotFoundError(checkpoint_id)
    directory = _root(workspace_id) / checkpoint_id; restored = removed = skipped = 0
    for index, entry in enumerate(checkpoint["entries"]):
        target = (workspace / entry["relativePath"]).resolve(); target.relative_to(workspace)
        if entry["stored"] and entry["existed"]:
            target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(directory / f"{index}.snapshot", target); restored += 1
        elif not entry["existed"] and target.is_file(): target.unlink(); removed += 1
        else: skipped += 1
    return {"workspacePath": str(workspace), "checkpointId": checkpoint_id, "restored": True, "restoredFileCount": restored, "removedFileCount": removed, "skippedFileCount": skipped, "message": "Remote checkpoint restored."}


def accept_checkpoint(workspace_id: str, checkpoint_id: str) -> dict[str, Any]:
    checkpoint = next((row for row in list_checkpoints(workspace_id) if row["id"] == checkpoint_id), None)
    if not checkpoint: raise FileNotFoundError(checkpoint_id)
    checkpoint["reviewStatus"] = "accepted"; checkpoint["reviewedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (_root(workspace_id) / checkpoint_id / "meta.json").write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2), "utf-8")
    return checkpoint
