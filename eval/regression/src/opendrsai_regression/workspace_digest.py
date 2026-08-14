from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterator


_IGNORED_DIRECTORY_NAMES = frozenset({"__pycache__", ".pytest_cache"})
_IGNORED_FILE_SUFFIXES = frozenset({".pyc", ".pyo"})


def _iter_identity_files(root: Path) -> Iterator[Path]:
    """Yield only source-controlled fixture content in canonical path order."""
    for item in sorted(path for path in root.rglob("*") if path.is_file()):
        relative = item.relative_to(root)
        if any(part in _IGNORED_DIRECTORY_NAMES for part in relative.parts):
            continue
        if item.suffix.lower() in _IGNORED_FILE_SUFFIXES:
            continue
        yield item


def directory_snapshot(root: Path) -> dict[str, str]:
    return {
        item.relative_to(root).as_posix(): hashlib.sha256(item.read_bytes()).hexdigest()
        for item in _iter_identity_files(root)
    }


def directory_digest(root: Path) -> str:
    canonical = b"".join(
        relative.encode("utf-8") + b"\0" + bytes.fromhex(digest) + b"\0"
        for relative, digest in directory_snapshot(root).items()
    )
    return hashlib.sha256(canonical).hexdigest()
