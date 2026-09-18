"""Workspace file tree and single-file read (features 2.3 and 4.1).

Copied from ``gateway_legacy.py`` L7986-8100 rather than rewritten. It is the
only handler pair in the 16 whose body is real logic instead of a wrapper, and
the parts that look incidental are the parts that matter:

- **git status overlay** -- a directory shows a change badge when anything
  beneath it changed, which is why the parent lookup walks ``changed_path``
  prefixes instead of matching exact paths.
- **fixed noisy-directory set** -- the file tree does not apply ``.gitignore``;
  otherwise valid Workspace files disappear. Large dependency and VCS metadata
  directories remain excluded so one ``node_modules`` cannot exhaust the scan.
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
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from drsai.backend.remote_ssh.workspace import workspace_child

from . import _state

IGNORED_DIRECTORIES = {
    ".git", ".hg", ".svn", "node_modules", ".venv",
    "__pycache__", ".mypy_cache", ".pytest_cache",
}

# git.exe is a console application.  When the gateway itself has no console
# (packaged Electron launch from the Start Menu), spawning git without
# CREATE_NO_WINDOW makes Windows allocate a console host window that flashes
# on screen for every file-tree request.  Never do that.
_NO_WINDOW: int = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

# Short-lived cache so rapidly expanding several folders does not spawn a
# fresh `git status` (and its console) for each click.  Two seconds matches
# interactive click rates while staying transparent to real edits.
_GIT_STATUS_TTL_SECONDS = 2.0
_GIT_STATUS_CACHE: dict[str, tuple[float, dict[str, str]]] = {}


def workspace_path(workspace_id: str, path: str) -> Path:
    """Resolve a Workspace-relative path, refusing anything that escapes it."""
    root = _state.workspace_root(workspace_id)
    try:
        return workspace_child(root, path)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Path escapes the workspace") from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _has_git_repo(start: Path) -> bool:
    """True when a .git marker exists at or above ``start`` (cheap pre-check)."""
    current = start
    for _ in range(16):
        if (current / ".git").exists():
            return True
        if current.parent == current:
            break
        current = current.parent
    return False


def _git_statuses(root: Path) -> dict[str, str]:
    if not _has_git_repo(root):
        # Not a repository (and maybe git is not even installed): skip the
        # subprocess entirely.  The tree still works, just without badges.
        return {}
    cached = _GIT_STATUS_CACHE.get(str(root))
    if cached is not None and (time.monotonic() - cached[0]) < _GIT_STATUS_TTL_SECONDS:
        return cached[1]
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
            capture_output=True, text=True, timeout=10, check=False,
            creationflags=_NO_WINDOW,
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
    _GIT_STATUS_CACHE[str(root)] = (time.monotonic(), statuses)
    return statuses


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
    scan_limit = min(50_000, max(5_000, offset + max_entries + 1_000))
    scanned = 0
    scan_truncated = False

    def ignored(relative: str, directory: bool) -> bool:
        # Only the fixed noisy-directory set is excluded.  The tree must NOT
        # apply the workspace's .gitignore: doing so hides real files the user
        # expects to see (e.g. .gitignore itself, build outputs, configs), and
        # the previous refactor left a dangling `patterns` reference here that
        # crashed the whole route with NameError.
        return any(part in IGNORED_DIRECTORIES for part in Path(relative).parts)

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
            if resolved.is_dir():
                if remaining > 0:
                    row["children"] = visit(resolved, remaining - 1)
                    row["has_children"] = bool(row["children"])
                    descendant = next(
                        (
                            status for changed, status in git_statuses.items()
                            if changed == relative or changed.startswith(relative + "/")
                        ),
                        None,
                    )
                    if descendant:
                        row["git_status"] = descendant
                else:
                    # At the depth boundary we cannot know without listing,
                    # so flag conservatively to let the client show an expand
                    # arrow and lazy-load on demand.
                    row["has_children"] = True
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
    total = len(matched)
    page = matched[offset:offset + max_entries]
    truncated = scan_truncated or offset + len(page) < total
    next_offset = offset + len(page) if truncated and len(page) else None
    # A plain browse returns the nested tree; a search or a paged request returns
    # the flat matches.  The client cannot infer which it received -- a flat
    # listing and a tree whose entries happen to have no children look identical,
    # so the shape is stated rather than guessed.
    flat = bool(needle or offset or total > max_entries)
    if flat:
        # Synthesize ancestor directory entries for the page so the client can
        # rebuild a proper tree from path prefixes.  Without this, a match at
        # "src/components/FilesTree.tsx" would have no "src" or
        # "src/components" nodes to hang from.  Ancestors are computed per
        # page so `total` stays the true match count and offsets paginate
        # over real matches only; the client merges pages by path.
        page_by_path: dict[str, dict[str, Any]] = {}
        for item in page:
            parts = item["path"].split("/")
            for i in range(1, len(parts)):
                ancestor_path = "/".join(parts[:i])
                if ancestor_path not in page_by_path:
                    page_by_path[ancestor_path] = {
                        "name": parts[i - 1],
                        "path": ancestor_path,
                        "directory": True,
                        "size": 0,
                        "modified_at": item.get("modified_at", 0),
                        "has_children": True,
                    }
            page_by_path[item["path"]] = item
        page = sorted(page_by_path.values(), key=lambda r: r["path"])
    return {
        "workspace_id": workspace_id,
        "shape": "flat" if flat else "tree",
        "data": page if flat else tree,
        "total": total,
        "offset": offset,
        "next_offset": next_offset,
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
