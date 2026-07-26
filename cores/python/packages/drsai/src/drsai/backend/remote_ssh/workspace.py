"""Dependency-light Remote SSH workspace path policy."""

from __future__ import annotations

from pathlib import Path

PROTOCOL_VERSION = 1


def ensure_protocol(version: int) -> None:
    if version != PROTOCOL_VERSION:
        raise ValueError("Remote protocol version is incompatible")


def canonical_workspace(path: str) -> Path:
    if not path or len(path) > 4096 or "\x00" in path:
        raise ValueError("Invalid workspace path")
    candidate = Path(path).expanduser().resolve(strict=True)
    if not candidate.is_dir():
        raise ValueError("Workspace path must be a directory")
    return candidate


def workspace_child(root: Path, path: str) -> Path:
    if not path or len(path) > 4096 or "\x00" in path:
        raise ValueError("Invalid workspace child path")
    candidate = Path(path)
    target = (root / candidate).resolve(strict=True) if not candidate.is_absolute() else candidate.resolve(strict=True)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise PermissionError("Path escapes the workspace root") from exc
    return target


def list_directories(root: Path, path: str = ".") -> list[dict[str, object]]:
    directory = workspace_child(root, path)
    if not directory.is_dir():
        raise ValueError("Path must be a directory")
    rows: list[dict[str, object]] = []
    for entry in directory.iterdir():
        try:
            resolved = workspace_child(root, str(entry))
        except (OSError, PermissionError, ValueError):
            continue
        if resolved.is_dir():
            rows.append({"name": entry.name, "path": str(resolved), "directory": True})
    return sorted(rows, key=lambda item: str(item["name"]).lower())
