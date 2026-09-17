"""Resolve presentation helper dependencies from the local OpenDrSai environment."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def _exe_names(name: str) -> list[str]:
    if os.name != "nt" or Path(name).suffix:
        return [name]
    return [name + ".cmd", name + ".exe", name]


def _candidate_dependency_roots() -> list[Path]:
    roots: list[Path] = []
    for env_name in ("DRSAI_RUNTIME_DEPENDENCIES", "PRESENTATIONS_DEPENDENCIES"):
        value = os.environ.get(env_name)
        if value:
            roots.append(Path(value).expanduser())

    # A virtual environment or project-local runtime may contain helper binaries.
    executable = Path(sys.executable).resolve()
    for parent in executable.parents:
        if (parent / "bin").is_dir() or (parent / "Scripts").is_dir():
            roots.append(parent)

    project_root = Path.cwd()
    roots.extend((project_root, project_root / "node_modules"))

    seen: set[Path] = set()
    unique: list[Path] = []
    for root in roots:
        resolved = root.resolve()
        if resolved not in seen:
            unique.append(resolved)
            seen.add(resolved)
    return unique


def dependency_root() -> Path:
    for root in _candidate_dependency_roots():
        if root.exists():
            return root
    return Path.cwd()


def runtime_bin_dir() -> str:
    root = dependency_root()
    for name in ("bin", "Scripts"):
        candidate = root / name
        if candidate.is_dir():
            return str(candidate)
    return str(root)


def runtime_binary(name: str) -> str:
    for root in _candidate_dependency_roots():
        for bin_name in ("bin", "Scripts"):
            for exe_name in _exe_names(name):
                candidate = root / bin_name / exe_name
                if candidate.exists():
                    return str(candidate)
        for exe_name in _exe_names(name):
            candidate = root / exe_name
            if candidate.exists():
                return str(candidate)

    path_candidate = shutil.which(name)
    return path_candidate or name


def poppler_bin_dir() -> str | None:
    binaries = [Path(runtime_binary(name)) for name in ("pdfinfo", "pdftoppm")]
    if not all(binary.is_file() for binary in binaries):
        return None
    bin_dirs = {binary.resolve().parent for binary in binaries}
    return str(bin_dirs.pop()) if len(bin_dirs) == 1 else None


def node_binary() -> str:
    return runtime_binary("node")


def node_modules_dir() -> str:
    configured = os.environ.get("ARTIFACT_TOOL_NODE_MODULES")
    if configured:
        return str(Path(configured).expanduser())
    return str(dependency_root() / "node_modules")


def runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    path_entries = [entry for entry in env.get("PATH", "").split(os.pathsep) if entry]
    local_bin = runtime_bin_dir()
    if local_bin and Path(local_bin).is_dir():
        path_entries.insert(0, local_bin)
    env["PATH"] = os.pathsep.join(dict.fromkeys(path_entries))
    env.setdefault("NODE_PATH", node_modules_dir())
    return env
