"""Resolve the single built-in OpenDrSai Skill collection.

The repository contains several Skill collections for source, compatibility,
and development purposes. Only ``skills/skills`` is part of the product's
default Skill catalog. ``SYSTEM_SKILLS_DIR`` may relocate that one catalog,
but callers must not merge arbitrary sibling collections into the runtime.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path


def resolve_builtin_skills_dir(
    explicit: str | os.PathLike[str] | None = None,
    *,
    search_from: Iterable[str | os.PathLike[str]] = (),
) -> Path | None:
    """Return the one configured or auto-discovered built-in Skills root."""

    configured = explicit if explicit is not None else os.environ.get("SYSTEM_SKILLS_DIR")
    if configured:
        candidate = Path(configured).expanduser()
        return candidate.resolve() if candidate.is_dir() else None

    starts = [Path(value).expanduser() for value in search_from]
    starts.extend((Path.cwd(), Path(__file__)))
    visited: set[Path] = set()
    for start in starts:
        anchor = start.parent if start.is_file() else start
        for root in (anchor, *anchor.parents):
            try:
                resolved_root = root.resolve()
            except OSError:
                continue
            if resolved_root in visited:
                continue
            visited.add(resolved_root)
            candidate = resolved_root / "skills" / "skills"
            if candidate.is_dir():
                return candidate.resolve()
    return None
