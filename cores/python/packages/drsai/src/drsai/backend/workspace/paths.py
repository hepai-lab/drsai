"""Cross-platform Workspace path vocabulary with relative-only business paths."""

from __future__ import annotations

from pathlib import Path, PurePosixPath, PureWindowsPath


class WorkspacePathError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def relative_parts(value: str) -> tuple[str, ...]:
    """Normalize either separator while rejecting every absolute/rooted form."""
    if not isinstance(value, str) or not value or len(value) > 4096 or "\x00" in value:
        raise WorkspacePathError("workspace_path_invalid", "Workspace relative path is invalid.")
    windows = PureWindowsPath(value)
    posix = PurePosixPath(value)
    if windows.is_absolute() or windows.drive or windows.root or posix.is_absolute():
        raise WorkspacePathError(
            "workspace_absolute_path_rejected",
            "Business operations require a Workspace-relative path resolved by the Runtime Registry.",
        )
    normalized = value.replace("\\", "/")
    parts = tuple(part for part in normalized.split("/") if part not in {"", "."})
    if not parts:
        return ()
    if any(part == ".." for part in parts):
        raise WorkspacePathError("workspace_escape_rejected", "Workspace relative path cannot traverse its root.")
    if any(":" in part for part in parts):
        raise WorkspacePathError("workspace_path_invalid", "Workspace path cannot contain a drive or stream name.")
    return parts


def resolve_workspace_path(root: Path, value: str, *, strict: bool = False) -> Path:
    """Resolve a business path below a Registry-owned canonical Workspace root."""
    canonical_root = Path(root).resolve(strict=True)
    parts = relative_parts(value)
    candidate = canonical_root.joinpath(*parts).resolve(strict=strict)
    if candidate != canonical_root and canonical_root not in candidate.parents:
        raise WorkspacePathError("workspace_escape_rejected", "Resolved path escapes its Workspace root.")
    return candidate
