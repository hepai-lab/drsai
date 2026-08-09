#!/usr/bin/env python3
"""Synchronize the DrSai product version across packages."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "cores/VERSION"

CORE_VERSION = ROOT / "cores/python/packages/drsai/src/drsai/version.py"
WEBUI_VERSION = ROOT / "apps/webui/backend/src/drsai_ui/ui_backend/version.py"
DESKTOP_LOCK = ROOT / "apps/desktop/package-lock.json"
WINDOWS_DESKTOP_PACKAGE = ROOT / "apps/desktop/windows/package.json"
MACOS_DESKTOP_PACKAGE = ROOT / "apps/desktop/macos/package.json"

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


def read_target_version(argv: list[str]) -> str:
    if len(argv) > 2:
        raise SystemExit("Usage: python scripts/sync_version.py [version]")
    if len(argv) == 2:
        version = argv[1].strip()
    else:
        version = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not SEMVER_RE.match(version):
        raise SystemExit(f"Invalid version: {version!r}")
    return version


def replace(path: Path, pattern: str, replacement: str, expected: int = 1) -> None:
    text = path.read_text(encoding="utf-8")
    new_text, count = re.subn(pattern, replacement, text, count=expected, flags=re.MULTILINE)
    if count != expected:
        raise SystemExit(f"Expected {expected} replacement(s) in {path}, got {count}")
    path.write_text(new_text, encoding="utf-8")


def update_json_version(path: Path, version: str) -> None:
    replace(path, r'("version"\s*:\s*)"[^"]+"', rf'\g<1>"{version}"')


def update_workspace_lock_version(path: Path, workspace: str, version: str) -> None:
    """Update only a named workspace entry, never a dependency version."""
    replace(
        path,
        rf'(^\s{{4}}"{re.escape(workspace)}"\s*:\s*\{{\s*\n'
        rf'\s{{6}}"name"\s*:\s*"[^"]+",\s*\n'
        rf'\s{{6}}"version"\s*:\s*)"[^"]+"',
        rf'\g<1>"{version}"',
    )


def main(argv: list[str]) -> int:
    version = read_target_version(argv)
    VERSION_FILE.write_text(version + "\n", encoding="utf-8")

    replace(
        CORE_VERSION,
        r'^__version__\s*=\s*"[^"]+"',
        f'__version__ = "{version}"',
    )
    replace(
        WEBUI_VERSION,
        r'^VERSION\s*=\s*"[^"]+"',
        f'VERSION = "{version}"',
    )
    replace(
        WEBUI_VERSION,
        r'^__version__\s*=\s*"[^"]+"',
        f'__version__ = "{version}"',
    )
    update_json_version(WINDOWS_DESKTOP_PACKAGE, version)
    update_json_version(MACOS_DESKTOP_PACKAGE, version)
    update_workspace_lock_version(DESKTOP_LOCK, "macos", version)

    print(f"Synchronized DrSai version to {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
