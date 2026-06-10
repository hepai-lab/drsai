"""Hatchling build hook — auto-compile the ui-tui React/Ink frontend.

This hook runs **before** the wheel is assembled so that
``[tool.hatch.build.targets.wheel.force-include]`` can find the pre-built
``apps/ui-tui/dist/entry.mjs`` bundle.

It tries, in order:  pnpm → npm → node (with npx).  If none of them is
available the hook prints a loud warning but does **not** abort the build —
``force-include`` will still fail for clean checkouts, but users with a
pre-existing build will succeed.

Usage (pyproject.toml)::

    [tool.hatch.build.hooks.custom]
    path = "build_hook.py"

"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class BuildTuiHook(BuildHookInterface):
    """Hatchling build-hook that auto-compiles the ui-tui frontend."""

    PLUGIN_NAME = "build-tui"

    def __init__(
        self,
        root: str,
        config: dict[str, Any],
        *args: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(root, config, *args, **kwargs)
        self._root = Path(root).resolve()

    # -- discovery -----------------------------------------------------------

    def _find_ui_tui_dir(self) -> Path | None:
        """Resolve ``apps/ui-tui`` relative to the monorepo root.

        The ``root`` passed by hatchling is the directory containing
        ``pyproject.toml``, i.e. ``<repo>/cores/python/packages/drsai/``.
        From there we walk **up** until we find ``apps/ui-tui/package.json``.
        """
        candidate = self._root
        for _ in range(10):  # safety limit
            tui = candidate / "apps" / "ui-tui"
            if (tui / "package.json").is_file():
                return tui.resolve()
            # Also try legacy repo-root/ui-tui location
            tui = candidate / "ui-tui"
            if (tui / "package.json").is_file():
                return tui.resolve()
            parent = candidate.parent
            if parent == candidate:  # reached filesystem root
                break
            candidate = parent
        return None

    # -- package-manager detection ------------------------------------------

    @staticmethod
    def _which(name: str) -> str | None:
        """``which``-style lookup; returns the full path or *None*."""
        path = os.environ.get("PATH", os.defpath)
        for directory in path.split(os.pathsep):
            candidate = Path(directory) / name
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
        return None

    def _run_cmd(self, cmd: list[str], cwd: Path) -> bool:
        """Run *cmd* in *cwd*, streaming output.  Returns ``True`` on success."""
        print(f"  [build-tui] {' '.join(cmd)}  (cwd={cwd})", file=sys.stderr)
        try:
            subprocess.run(
                cmd,
                cwd=str(cwd),
                check=True,
                stdout=sys.stderr.fileno(),
                stderr=sys.stderr.fileno(),
            )
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            print(f"  [build-tui] ❌ command failed: {exc}", file=sys.stderr)
            return False
        return True

    # -- main hook entry point ----------------------------------------------

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        """Called by hatchling before every build."""
        tui_dir = self._find_ui_tui_dir()
        if tui_dir is None:
            print(
                "  [build-tui] ⚠ Could not locate apps/ui-tui directory; "
                "skipping auto-build.\n"
                "  If you are building from source, clone the full monorepo:\n"
                "    git clone https://github.com/hepaihub/drsai.git",
                file=sys.stderr,
            )
            return

        bundle = tui_dir / "dist" / "entry.mjs"
        if bundle.is_file():
            print(
                f"  [build-tui] ✓ bundle already up-to-date: {bundle}",
                file=sys.stderr,
            )
            return

        print(
            f"  [build-tui] 🔨 Building ui-tui frontend …\n"
            f"  [build-tui]    source: {tui_dir}",
            file=sys.stderr,
        )

        # -- try pnpm first (project uses pnpm-lock.yaml) -------------------
        pnpm = self._which("pnpm")
        if pnpm:
            if self._run_cmd([pnpm, "install"], tui_dir):
                if self._run_cmd([pnpm, "run", "build"], tui_dir):
                    print(
                        "  [build-tui] ✓ pnpm build succeeded",
                        file=sys.stderr,
                    )
                    return

        # -- fall back to npm ------------------------------------------------
        npm = self._which("npm")
        if npm:
            if self._run_cmd([npm, "install"], tui_dir):
                if self._run_cmd([npm, "run", "build"], tui_dir):
                    print(
                        "  [build-tui] ✓ npm build succeeded",
                        file=sys.stderr,
                    )
                    return

        # -- last resort: node + npx ----------------------------------------
        node = self._which("node")
        if node:
            npx = self._which("npx")
            if npx:
                if self._run_cmd([npx, "pnpm", "install"], tui_dir):
                    if self._run_cmd([npx, "pnpm", "run", "build"], tui_dir):
                        print(
                            "  [build-tui] ✓ npx build succeeded",
                            file=sys.stderr,
                        )
                        return

        print(
            "\n  [build-tui] ⚠ Could not auto-build the TUI frontend.\n"
            "  Please install Node.js + pnpm and build manually:\n"
            f"    cd {tui_dir}\n"
            "    pnpm install && pnpm build\n"
            "  or set DRSAI_UI_TUI_DIR to point to an existing build.\n",
            file=sys.stderr,
        )
