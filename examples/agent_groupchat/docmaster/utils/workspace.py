"""
Workspace utilities for DocMaster.
Handles file tracking, snapshots, and change detection.
"""

from pathlib import Path
from typing import Set


def snapshot_workspace(work_dir: Path, extensions: Set[str], excluded_dirs: Set[str]) -> dict[str, float]:
    """
    Create a snapshot of all tracked files in the workspace.

    Takes a recursive glob over all files with tracked extensions in the
    given work directory, skipping any directories in the excluded set.
    Records modification times (mtime) for change detection.

    Args:
        work_dir: Root directory to scan (usually user profile work_dir)
        extensions: Set of file extensions to track (e.g., {'.docx', '.pdf'})
        excluded_dirs: Set of directory names to exclude (e.g., {'skills', '__pycache__'})

    Returns:
        Dictionary mapping file paths to modification times
    """
    snapshot: dict[str, float] = {}
    for ext in extensions:
        for f in work_dir.rglob(f'*{ext}'):
            if f.is_file():
                # Skip files in excluded directories
                if any(excluded in f.parts for excluded in excluded_dirs):
                    continue
                try:
                    snapshot[str(f)] = f.stat().st_mtime
                except OSError:
                    pass
    return snapshot


def detect_changed_files(before: dict[str, float], after: dict[str, float]) -> list[str]:
    """
    Compare current workspace state with a previous snapshot.

    Detects files that are either new (not in 'before') or modified
    (mtime changed since 'before').

    Args:
        before: Previous snapshot (path -> mtime)
        after: Current snapshot (path -> mtime)

    Returns:
        List of file paths that are new or modified
    """
    changed: list[str] = []
    for fpath, mtime in after.items():
        if fpath not in before or mtime > before[fpath]:
            changed.append(fpath)
    return changed
