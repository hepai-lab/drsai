"""Stable content revisions for optimistic model configuration updates."""

from __future__ import annotations

import hashlib
from pathlib import Path

from .loader import default_config_path


def config_revision(path: str | Path | None = None) -> str:
    target = Path(path) if path is not None else default_config_path()
    try:
        content = target.read_bytes()
    except FileNotFoundError:
        content = b""
    return hashlib.sha256(content).hexdigest()
