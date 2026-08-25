"""Workspace file tree and single-file read (features 2.3 and 4.1).

Copied from ``gateway_legacy.py`` L7986-8100 rather than rewritten. It is the
only handler pair in the 16 whose body is real logic instead of a wrapper, and
the parts that look incidental are the parts that matter:

- **git status overlay** -- a directory shows a change badge when anything
  beneath it changed, which is why the parent lookup walks ``changed_path``
  prefixes instead of matching exact paths.
- **``.gitignore`` + fixed ignore set** -- without it, one ``node_modules``
  turns a workspace tree into tens of thousands of entries.
- **``scan_limit``** -- bounds the walk itself, not just the response, so a
  pathological tree cannot hold the event loop.
- **``resolve(strict=True)`` then ``relative_to(root)``** -- rejects symlinks
  that point outside the Workspace. This is the containment check; a plain
  ``startswith`` on the path string would not catch it.

The read path returns UTF-8 text when it decodes and a ``data:`` URL otherwise,
so the renderer's preview pane needs one branch, not a content-type table.
"""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import subprocess
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from drsai.backend.remote_ssh.workspace import workspace_child

from . import _state

IGNORED_DIRECTORIES = {
    ".git", ".hg", ".svn", "node_modules", ".venv",
    "__pycache__", ".mypy_cache", ".pytest_cache",
}


def workspace_path(workspace_id: str, path: str) -> Path:
    """Resolve a Workspace-relative path, refusing anything that escapes it."""
    root = _state.workspace_root(workspace_id)
    try:
        return workspace_child(root, path)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Path escapes the workspace") from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _git_statuses(root: Path) -> dict[str, str]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {}
    if completed.returncode != 0:
        return {}
    statuses: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if len(line) < 4:
            continue
        code, changed = line[:2], line[3:]
        if " -> " in changed:
            changed = changed.split(" -> ", 1)[1]
        changed = changed.strip('"').replace("\\", "/")
        statuses[changed] = (
            "untracked" if code == "??"
            else "renamed" if "R" in code
            else "deleted" if "D" in code
            else "added" if "A" in code
            else "modified"
        )
    return statuses


def _ignore_patterns(root: Path) -> list[str]:
    try:
        text = (root / ".gitignore").read_text("utf-8", errors="replace")
    except OSError:
        return []
    return [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def list_files(
    workspace_id: str,
    *,
    path: str = ".",
    depth: int = 2,
    query: str = "",
    offset: int = 0,
    max_entries: int = 500,
) -> dict[str, Any]:
    root = _state.workspace_root(workspace_id)
    start = workspace_path(workspace_id, path)
    if not start.is_dir():
        raise HTTPException(status_code=400, detail="Path must be a directory")

    git_statuses = _git_statuses(root)
    patterns = _ignore_patterns(root)
    scan_limit = min(50_000, max(5_000, offset + max_entries + 1_000))
    scanned = 0
    scan_truncated = False

    def ignored(relative: str, directory: bool) -> bool:
        if any(part in IGNORED_DIRECTORIES for part in Path(relative).parts):
            return True
        normalized = relative.replace("\\", "/")
        for raw in patterns:
            negate = raw.startswith("!")
            pattern = (raw[1:] if negate else raw)
            directory_only = pattern.endswith("/")
            pattern = pattern.rstrip("/")
            if directory_only and not directory:
                continue
            if (
                fnmatch(normalized, pattern)
                or fnmatch(Path(normalized).name, pattern)
                or fnmatch(normalized, f"*/{pattern}")
            ):
                if not negate:
                    return True
        return False

    def visit(directory: Path, remaining: int) -> list[dict[str, Any]]:
        nonlocal scanned, scan_truncated
        rows: list[dict[str, Any]] = []
        for entry in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
            if scanned >= scan_limit:
                scan_truncated = True
                break
            try:
                resolved = entry.resolve(strict=True)
                resolved.relative_to(root)
            except (OSError, ValueError):
                continue
            relative = str(resolved.relative_to(root)).replace("\\", "/")
            if ignored(relative, resolved.is_dir()):
                continue
            scanned += 1
            stat = resolved.stat()
            row: dict[str, Any] = {
                "name": entry.name,
                "path": relative,
                "directory": resolved.is_dir(),
                "size": stat.st_size,
                "modified_at": stat.st_mtime,
            }
            if resolved.is_dir() and remaining > 0:
                row["children"] = visit(resolved, remaining - 1)
                descendant = next(
                    (
                        status for changed, status in git_statuses.items()
                        if changed == relative or changed.startswith(relative + "/")
                    ),
                    None,
                )
                if descendant:
                    row["git_status"] = descendant
            elif relative in git_statuses:
                row["git_status"] = git_statuses[relative]
            rows.append(row)
        return rows

    tree = visit(start, depth)
    needle = query.casefold().strip()
    matched: list[dict[str, Any]] = []

    def collect(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            if not needle or needle in row["path"].casefold():
                matched.append({key: value for key, value in row.items() if key != "children"})
            collect(row.get("children", []))

    collect(tree)
    page = matched[offset:offset + max_entries]
    truncated = scan_truncated or offset + len(page) < len(matched)
    # A plain browse returns the nested tree; a search or a paged request returns
    # the flat matches, because a filtered tree is not renderable -- its interior
    # nodes need not match.  The client cannot infer which it received: a flat
    # listing and a tree whose entries happen to have no children look identical,
    # so the shape is stated rather than guessed.
    flat = bool(needle or offset or len(matched) > max_entries)
    return {
        "workspace_id": workspace_id,
        "shape": "flat" if flat else "tree",
        "data": page if flat else tree,
        "total": len(matched),
        "offset": offset,
        "next_offset": offset + len(page) if truncated and len(page) else None,
        "truncated": truncated,
        "scan_limit": scan_limit,
    }


def _sha256(target: Path) -> str:
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_file(workspace_id: str, path: str, *, max_bytes: int = 262_144) -> dict[str, Any]:
    target = workspace_path(workspace_id, path)
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path must be a file")
    size = target.stat().st_size
    with target.open("rb") as handle:
        raw = handle.read(max_bytes + 1)
    sample = raw[:max_bytes]
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    try:
        content = sample.decode("utf-8")
        # A NUL byte in the first 8 KiB means the file is binary even when the
        # prefix happened to decode.
        binary = b"\x00" in sample[:8192]
    except UnicodeDecodeError:
        content = ""
        binary = True
    common = {
        "path": str(target.relative_to(_state.workspace_root(workspace_id))).replace("\\", "/"),
        "mime": mime,
        "truncated": size > max_bytes,
        "size": size,
        "modified_at": target.stat().st_mtime,
        "sha256": _sha256(target),
    }
    if binary:
        return {
            **common,
            "data_url": f"data:{mime};base64,{base64.b64encode(sample).decode('ascii')}",
            "binary": True,
            "encoding": None,
        }
    return {**common, "content": content, "binary": False, "encoding": "utf-8"}
