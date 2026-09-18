"""Filesystem half of the ``/v1/skills`` surface.

The *installed* skills of a user live under
``$DRSAI_HOME/<user>/configs/skills/<skill>/SKILL.md``; the *bundled* catalogue
ships read-only inside the package.  A bundled skill the user removes is
recorded in ``skills_deleted.json`` -- a tombstone next to the skills directory
-- so that the next sync cycle does not silently re-install it.

This module is deliberately free of FastAPI imports: the TUI setup handler and
the skills Agent read the same tombstones, and they should not have to import a
route module (with its ``drsai.config`` / Agent-policy reads) to do it.

The route module is ``desktop_gateway/routes/skills.py``.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from drsai.backend.desktop_gateway._auth import effective_user_id

# Directories that are build artifacts or caches — never copied into
# the installed skill tree.  Note: node_modules IS copied because some
# skills (e.g. presentations) bundle vendored packages via npm file:
# links and the user's machine may not have npm available to regenerate
# them.  Symlinks/junctions within node_modules are resolved by the
# realpath logic in copy_physical_tree.
_SKIP_DIRS = frozenset({
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
    ".mypy_cache",
    "__MACOSX",
    ".DS_Store",
})

# File suffixes to skip.
_SKIP_FILE_SUFFIXES = (".pyc", ".pyo")


def skills_dir(user_id: str | None = None) -> Path:
    """The user's installed-skills directory."""
    uid = effective_user_id(user_id)
    from drsai.backend.run_drsai_agent_factory import WORKDIR

    return Path(WORKDIR) / uid / "configs" / "skills"


def available_skills_dirs() -> list[Path]:
    """Bundled/extra skills collections shipped with the package.

    Prefers the explicit ``SYSTEM_SKILLS_DIR`` catalogue when set (TUI / source
    checkout). Otherwise falls back to the Desktop's packaged seed source
    (``OPENDRSAI_BUNDLED_SKILLS_DIR``) so the "install from bundled" catalogue
    still lists the shipped Skills without re-enabling per-launch syncing.
    """
    from drsai.modules.components.skills import resolve_builtin_skills_dir

    root = resolve_builtin_skills_dir(search_from=(Path(__file__), Path.cwd()))
    if root is not None:
        return [root]
    seed = bundled_seed_dir()
    return [seed] if seed is not None else []


def seed_marker_path(user_id: str | None = None) -> Path:
    """One-time seeding marker beside the user's skills directory.

    Its presence means the packaged built-in catalogue has already been copied
    into the user's ``configs/skills``. Everything afterwards is user-owned:
    the catalogue is never re-consulted, so edits and deletions stick.
    """
    return skills_dir(user_id).parent / "skills_seeded.json"


def bundled_seed_dir() -> Path | None:
    """The packaged catalogue to seed from, published by the Desktop shell.

    The Desktop exports ``OPENDRSAI_BUNDLED_SKILLS_DIR`` (the payload copy at
    ``<drsai-agent>/skills/skills``) into the gateway child. This is a **seed
    source**, not the live ``SYSTEM_SKILLS_DIR`` catalogue: unlike that variable
    it is never used for per-launch syncing, so seeding a user's directory once
    has no ongoing effect on it.
    """
    import os

    configured = (os.environ.get("OPENDRSAI_BUNDLED_SKILLS_DIR") or "").strip()
    if not configured:
        return None
    candidate = Path(configured).expanduser()
    return candidate.resolve() if candidate.is_dir() else None


def seed_user_skills_once(user_id: str | None = None) -> list[str]:
    """Copy the packaged catalogue into the user's skills dir exactly once.

    Guarded by :func:`seed_marker_path`: if the marker already exists this is a
    no-op, so a user who deleted or edited a seeded Skill is never overwritten.
    Returns the Skill folder names copied on this call (empty once seeded).
    """
    target = skills_dir(user_id)
    marker = seed_marker_path(user_id)
    if marker.exists():
        return []

    source = bundled_seed_dir()
    if source is None:
        return []

    copied: list[str] = []
    target.mkdir(parents=True, exist_ok=True)
    for skill_folder in sorted(source.iterdir()):
        if not skill_folder.is_dir():
            continue
        if not (skill_folder / "SKILL.md").exists():
            continue
        destination = target / skill_folder.name
        if destination.exists():
            continue
        copy_physical_tree(skill_folder, destination)
        copied.append(skill_folder.name)

    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps(sorted(copied), ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        # A read-only home must not break the skills surface; the marker is an
        # optimisation, and an unmarked run simply re-checks (and finds) the
        # already-present folders on the next call.
        pass
    return copied


def deleted_skills_path(user_id: str | None = None) -> Path:
    """Return the persistent tombstone file for user-deleted bundled skills."""
    return skills_dir(user_id).parent / "skills_deleted.json"


def load_deleted_skills(user_id: str | None = None) -> set[str]:
    """Bundled skills the user deleted; they must not be re-synced."""
    path = deleted_skills_path(user_id)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return (
            {str(item) for item in value if isinstance(item, str)}
            if isinstance(value, list)
            else set()
        )
    except (OSError, ValueError, TypeError):
        return set()


def save_deleted_skills(names: set[str], user_id: str | None = None) -> None:
    path = deleted_skills_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(names), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def is_symlink_or_junction(path: Path) -> bool:
    """Return True if *path* is a symbolic link, junction, or reparse point.

    Uses ``Path.is_symlink()`` which on Windows detects both POSIX symlinks
    and NTFS junctions.  A ``stat(follow_symlinks=False)`` cross-check is
    done for robustness on older Python runtimes.
    """
    try:
        if path.is_symlink():
            return True
        # On some Windows/Python combos, junctions slip through is_symlink().
        # Check the reparse-point attribute via os.lstat.
        import os
        import stat as stat_mod

        st = os.lstat(str(path))
        # FILE_ATTRIBUTE_REPARSE_POINT = 0x400
        if stat_mod.S_ISLNK(st.st_mode) or (getattr(st, "st_reparse_tag", 0) != 0):
            return True
    except OSError:
        pass
    return False


def copy_physical_tree(src: Path, dst: Path) -> None:
    """Recursively copy *src* into *dst* as physical files/directories.

    Build artifacts and package-manager caches (``.git``, ``__pycache__``,
    etc.) are skipped entirely — they are regenerated at the destination by
    the skill's setup script.

    Symbolic links / junctions are **resolved and followed** rather than
    rejected, so a vendored package linked via npm's ``file:`` protocol
    is materialised as real files at the destination.
    """
    if is_symlink_or_junction(src):
        resolved = src.resolve()
        if not resolved.exists():
            return  # broken symlink — skip silently
        if resolved.is_dir():
            copy_physical_tree(resolved, dst)
        elif resolved.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(resolved), str(dst))
        return

    if not src.is_dir():
        raise ValueError(f"Source is not a directory: {src}")

    dst.mkdir(parents=True, exist_ok=True)

    for entry in sorted(src.iterdir()):
        if entry.name in _SKIP_DIRS:
            continue
        if any(entry.name.endswith(suffix) for suffix in _SKIP_FILE_SUFFIXES):
            continue

        src_entry = entry
        dst_entry = dst / entry.name

        if is_symlink_or_junction(src_entry):
            resolved = src_entry.resolve()
            if not resolved.exists():
                continue  # broken symlink — skip silently
            if resolved.is_dir():
                copy_physical_tree(resolved, dst_entry)
            elif resolved.is_file():
                shutil.copy2(str(resolved), str(dst_entry))
            continue

        if src_entry.is_dir():
            copy_physical_tree(src_entry, dst_entry)
        elif src_entry.is_file():
            shutil.copy2(str(src_entry), str(dst_entry))
        # Skip special files (sockets, devices, FIFOs) silently.


def resolve_bundled_skill_root(name: str, source: str | None = None) -> Path | None:
    """The bundled directory named *name*, optionally restricted to a collection."""
    for directory in available_skills_dirs():
        if source and directory.name != source:
            continue
        candidate = directory / name
        if (candidate / "SKILL.md").exists():
            return candidate

    # docx ships under anthropic_skills_collection until promoted to skills/skills.
    if name == "docx" and not source:
        for directory in available_skills_dirs():
            extra = directory.parent / "anthropic_skills_collection" / name
            if (extra / "SKILL.md").exists():
                return extra
    return None


def find_bundled_skill_md(name: str, source: str | None = None) -> Path | None:
    root = resolve_bundled_skill_root(name, source)
    return (root / "SKILL.md") if root is not None else None


def skill_summary_from_dir(
    skill_dir: Path, *, source_name: str, installed_names: set[str]
) -> dict:
    """The catalogue entry the Desktop skills picker renders."""
    skill_md = skill_dir / "SKILL.md"
    try:
        content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
        name, description, _category = parse_skill_frontmatter(content)
        name = name or skill_dir.name
        return {
            "name": name,
            "description": description or "",
            "category": source_name,
            "source": source_name,
            "installed": name in installed_names or skill_dir.name in installed_names,
            "bundled_id": skill_dir.name,
        }
    except Exception:
        return {
            "name": skill_dir.name,
            "description": "",
            "category": source_name,
            "source": source_name,
            "installed": skill_dir.name in installed_names,
            "bundled_id": skill_dir.name,
        }


def parse_skill_frontmatter(content: str) -> tuple[str, str, str]:
    """``(name, description, category)`` from ``SKILL.md`` YAML frontmatter."""
    name, description, category = "", "", ""
    if not content.startswith("---"):
        heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)
        if heading:
            name = heading.group(1).strip()
        para = re.search(r"^(?!#)(?!---).+", content, re.MULTILINE)
        if para:
            description = para.group(0).strip()[:120]
        return name, description, category

    end_idx = content.find("---", 3)
    if end_idx == -1:
        return name, description, category

    frontmatter = content[3:end_idx]
    name_match = re.search(r"^\s*name:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if name_match:
        name = name_match.group(1).strip()
    desc_match = re.search(r"^\s*description:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if desc_match:
        description = desc_match.group(1).strip()
    cat_match = re.search(r"^\s*category:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if cat_match:
        category = cat_match.group(1).strip()
    return name, description, category
