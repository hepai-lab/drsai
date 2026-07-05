"""Hatchling build hook — auto-compile the ui-tui React/Ink frontend.

This hook runs **before** the wheel is assembled so that
``[tool.hatch.build.targets.wheel.force-include]`` can find the pre-built
``apps/ui-tui/dist/entry.mjs`` bundle.

If Node.js and/or pnpm are missing, this hook attempts to **install them
automatically**:

  - **Node.js** — winget (Windows) / fnm / nvm / conda / direct binary download
  - **pnpm**    — corepack (preferred) / ``npm install -g pnpm``

If the auto-install fails or the user explicitly opts out, the hook removes
the TUI ``force-include`` entries from *build_data* so that ``pip install``
can still succeed — only the TUI feature is disabled.

Environment variables
---------------------

``DRSAI_SKIP_TUI_BUILD=1``
    Skip the TUI build entirely (TUI features will be disabled).

Usage (pyproject.toml)::

    [tool.hatch.build.hooks.custom]
    path = "build_hook.py"
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class BuildTuiHook(BuildHookInterface):
    """Hatchling build-hook that auto-compiles the ui-tui frontend.

    When the pre-built ``dist/entry.mjs`` bundle is missing the hook will:

    1. Locate the ``apps/ui-tui`` source directory.
    2. Ensure **Node.js** is available (auto-install if needed).
    3. Ensure **pnpm** is available (auto-install if needed).
    4. Run ``pnpm install && pnpm build``.
    5. If any step fails, gracefully remove TUI ``force-include`` entries
       so the wheel build can still succeed.
    """

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

    # ==================================================================
    #  UI-TUI directory discovery
    # ==================================================================

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

    # ==================================================================
    #  Tool detection
    # ==================================================================

    @staticmethod
    def _which(name: str) -> str | None:
        """Find *name* in ``PATH`` (with Windows ``PATHEXT`` support).

        Uses :func:`shutil.which` as the primary lookup (it correctly
        handles ``.exe``/``.cmd``/``.bat`` on Windows), then falls back
        to a manual search that also checks common extensions.
        """
        result = shutil.which(name)
        if result:
            return result

        # Fallback manual search (covers edge-cases where shutil.which
        # misses, e.g. newly-installed binaries not yet in PATH cache)
        path_env = os.environ.get("PATH", os.defpath)
        if platform.system() == "Windows":
            # On Windows, check PATHEXT extensions FIRST so that
            # ``pnpm.cmd`` is found before ``pnpm`` (a POSIX shell
            # script that cannot be executed by CreateProcess).
            exts = os.environ.get(
                "PATHEXT", ".COM;.EXE;.BAT;.CMD"
            ).split(";")
            exts += [".cmd", ".exe", ".bat", ".ps1"]
            # Check extensionless files LAST — they are often POSIX
            # shell scripts that cannot be run directly on Windows.
            exts.append("")
        else:
            exts = [""]
        for directory in path_env.split(os.pathsep):
            if not directory:
                continue
            for ext in exts:
                candidate = Path(directory) / f"{name}{ext}"
                if candidate.is_file():
                    return str(candidate)
        return None

    def _find_companion_binary(
        self, node_dir: Path, name: str
    ) -> str | None:
        """Find a binary (npm, npx, corepack, pnpm) near the *node* binary.

        On Windows these are ``name.cmd`` / ``name.exe`` in the same
        directory as ``node.exe``.  On Unix they are typically in the
        same ``bin/`` directory.
        """
        system = platform.system()
        if system == "Windows":
            candidates = [
                node_dir / f"{name}.cmd",
                node_dir / f"{name}.exe",
                node_dir / f"{name}.bat",
                node_dir / f"{name}.ps1",
                node_dir / name,
            ]
        else:
            candidates = [
                node_dir / name,
                node_dir.parent / name,
                node_dir.parent / "bin" / name,
            ]
        for c in candidates:
            if c.is_file():
                return str(c)
        # Also try PATH (the companion might be installed elsewhere)
        return self._which(name)

    @staticmethod
    def _prepare_cmd(cmd: list[str]) -> list[str]:
        """Prepare a command list for :func:`subprocess.run`.

        On Windows, ``CreateProcess`` can only execute ``.exe`` files
        directly.  Files with ``.cmd``/``.bat`` extensions — or
        extensionless shell scripts — must be wrapped with
        ``cmd.exe /c``.

        This is a no-op on non-Windows platforms.
        """
        if not cmd:
            return cmd
        if platform.system() == "Windows":
            suffix = Path(cmd[0]).suffix.lower()
            if suffix in (".cmd", ".bat") or suffix == "":
                return ["cmd.exe", "/c"] + cmd
        return cmd

    def _run_cmd(
        self, cmd: list[str], cwd: Path | None = None
    ) -> bool:
        """Run *cmd*, streaming output.  Returns ``True`` on success."""
        print(f"  [build-tui] {' '.join(cmd)}  (cwd={cwd})", file=sys.stderr)
        run_cmd = self._prepare_cmd(cmd)
        try:
            subprocess.run(
                run_cmd,
                cwd=str(cwd) if cwd else None,
                check=True,
                stdout=sys.stderr.fileno(),
                stderr=sys.stderr.fileno(),
            )
        except (
            subprocess.CalledProcessError,
            FileNotFoundError,
            OSError,
        ) as exc:
            print(f"  [build-tui] ❌ command failed: {exc}", file=sys.stderr)
            return False
        return True

    # ==================================================================
    #  Node.js management
    # ==================================================================

    def _ensure_node(self) -> str | None:
        """Ensure Node.js is available.

        Returns the path to the ``node`` binary, or *None* if it could
        not be found or auto-installed.
        """
        node = self._which("node")
        if node:
            try:
                result = subprocess.run(
                    [node, "--version"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                version = result.stdout.strip()
                print(
                    f"  [build-tui] ✓ Node.js found: {node} ({version})",
                    file=sys.stderr,
                )
                return node
            except Exception:
                pass

        print(
            "  [build-tui] ⚠ Node.js not found in PATH.",
            file=sys.stderr,
        )
        print(
            "  [build-tui] Attempting auto-install …",
            file=sys.stderr,
        )

        node = self._install_node()
        if node:
            print(
                f"  [build-tui] ✓ Node.js ready: {node}",
                file=sys.stderr,
            )
            # Prepend the bin directory to PATH so companion tools
            # (npm, npx, corepack) are discoverable.
            bin_dir = str(Path(node).parent)
            os.environ["PATH"] = (
                bin_dir + os.pathsep + os.environ.get("PATH", "")
            )
        else:
            print(
                "  [build-tui] ❌ Could not auto-install Node.js.",
                file=sys.stderr,
            )
            self._print_node_install_instructions()
        return node

    # -- Node.js install strategies (tried in order) -------------------

    def _install_node(self) -> str | None:
        """Try every available strategy to get Node.js onto the system."""
        system = platform.system()

        # Windows: winget
        if system == "Windows":
            node = self._install_node_via_winget()
            if node:
                return node

        # Unix: fnm
        if system != "Windows":
            node = self._install_node_via_fnm()
            if node:
                return node

            # Unix: nvm
            node = self._install_node_via_nvm()
            if node:
                return node

        # All platforms: conda
        node = self._install_node_via_conda()
        if node:
            return node

        # Last resort: direct binary download
        return self._download_node_portable()

    def _install_node_via_winget(self) -> str | None:
        """Install Node.js LTS via ``winget`` (Windows only)."""
        winget = self._which("winget")
        if not winget:
            return None
        print(
            "  [build-tui] Installing Node.js via winget …",
            file=sys.stderr,
        )
        try:
            subprocess.run(
                [
                    winget,
                    "install",
                    "OpenJS.NodeJS.LTS",
                    "--accept-source-agreements",
                    "--accept-package-agreements",
                ],
                check=True,
                timeout=300,
                stdout=sys.stderr.fileno(),
                stderr=sys.stderr.fileno(),
            )
            return self._find_node_after_install()
        except Exception as exc:
            print(
                f"  [build-tui] winget install failed: {exc}",
                file=sys.stderr,
            )
            return None

    def _install_node_via_fnm(self) -> str | None:
        """Install Node.js LTS via ``fnm`` (Fast Node Manager)."""
        fnm = self._which("fnm")
        if not fnm:
            return None
        print(
            "  [build-tui] Installing Node.js via fnm …",
            file=sys.stderr,
        )
        try:
            subprocess.run(
                [fnm, "install", "--lts"],
                check=True,
                timeout=120,
                stdout=sys.stderr.fileno(),
                stderr=sys.stderr.fileno(),
            )
            # fnm needs shell integration; use ``fnm env`` to locate node
            result = subprocess.run(
                ["bash", "-c", f'eval "$({fnm} env --shell bash)" && which node'],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                node_path = result.stdout.strip().split("\n")[-1].strip()
                if node_path and Path(node_path).exists():
                    return node_path
            # Fallback: scan fnm's default install location
            fnm_dir = Path.home() / ".fnm" / "node-versions"
            if fnm_dir.is_dir():
                for v in sorted(fnm_dir.iterdir(), reverse=True):
                    node = v / "installation" / "bin" / "node"
                    if node.is_file():
                        return str(node)
        except Exception as exc:
            print(
                f"  [build-tui] fnm install failed: {exc}",
                file=sys.stderr,
            )
        return None

    def _install_node_via_nvm(self) -> str | None:
        """Install Node.js LTS via ``nvm`` (Node Version Manager)."""
        nvm_dir = os.environ.get("NVM_DIR") or os.path.expanduser("~/.nvm")
        if not Path(nvm_dir).is_dir():
            return None
        print(
            "  [build-tui] Installing Node.js via nvm …",
            file=sys.stderr,
        )
        try:
            cmd = (
                f'source "{nvm_dir}/nvm.sh" '
                f"&& nvm install --lts "
                f"&& nvm use --lts "
                f"&& which node"
            )
            result = subprocess.run(
                ["bash", "-c", cmd],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                lines = [
                    line.strip()
                    for line in result.stdout.strip().split("\n")
                    if line.strip()
                ]
                if lines:
                    node_path = lines[-1]
                    if Path(node_path).exists():
                        return node_path
        except Exception as exc:
            print(
                f"  [build-tui] nvm install failed: {exc}",
                file=sys.stderr,
            )
        return None

    def _install_node_via_conda(self) -> str | None:
        """Install Node.js via ``conda`` (if a conda environment is active)."""
        conda = self._which("conda")
        if not conda:
            return None
        print(
            "  [build-tui] Installing Node.js via conda …",
            file=sys.stderr,
        )
        try:
            subprocess.run(
                self._prepare_cmd(
                    [conda, "install", "-y", "-c", "conda-forge", "nodejs"]
                ),
                check=True,
                timeout=300,
                stdout=sys.stderr.fileno(),
                stderr=sys.stderr.fileno(),
            )
            return self._which("node")
        except Exception as exc:
            print(
                f"  [build-tui] conda install failed: {exc}",
                file=sys.stderr,
            )
        return None

    def _download_node_portable(self) -> str | None:
        """Download a portable Node.js binary to ``~/.drsai/nodejs/``.

        This is the last-resort strategy that works on any platform
        without requiring a package manager.
        """
        system = platform.system()
        machine = platform.machine().lower()

        if system == "Windows":
            os_name = "win"
            ext = "zip"
            arch = "x64" if machine in ("amd64", "x86_64") else machine
        elif system == "Linux":
            os_name = "linux"
            ext = "tar.xz"
            arch = (
                "x64"
                if machine in ("amd64", "x86_64")
                else "arm64"
                if machine in ("arm64", "aarch64")
                else machine
            )
        elif system == "Darwin":
            os_name = "darwin"
            ext = "tar.xz"
            arch = (
                "x64"
                if machine in ("amd64", "x86_64")
                else "arm64"
                if machine in ("arm64", "aarch64")
                else machine
            )
        else:
            print(
                f"  [build-tui] ❌ Unsupported platform: {system}",
                file=sys.stderr,
            )
            return None

        version = self._get_latest_lts_version() or "v22.14.0"
        dirname = f"node-{version}-{os_name}-{arch}"
        url = f"https://nodejs.org/dist/{version}/{dirname}.{ext}"

        install_dir = Path.home() / ".drsai" / "nodejs"
        install_dir.mkdir(parents=True, exist_ok=True)
        extract_dir = install_dir / dirname

        # Reuse existing download
        if extract_dir.exists():
            node = self._find_node_in_dir(extract_dir)
            if node:
                return node

        archive_path = install_dir / f"{dirname}.{ext}"
        print(
            f"  [build-tui] Downloading Node.js {version} from nodejs.org …",
            file=sys.stderr,
        )
        try:
            urllib.request.urlretrieve(url, archive_path)
        except Exception as exc:
            print(
                f"  [build-tui] ❌ Download failed: {exc}",
                file=sys.stderr,
            )
            return None

        print(
            f"  [build-tui] Extracting to {extract_dir} …",
            file=sys.stderr,
        )
        try:
            if ext == "zip":
                with zipfile.ZipFile(archive_path) as z:
                    z.extractall(install_dir)
            else:
                with tarfile.open(archive_path, "r:xz") as t:
                    t.extractall(install_dir)
        except Exception as exc:
            print(
                f"  [build-tui] ❌ Extraction failed: {exc}",
                file=sys.stderr,
            )
            return None
        finally:
            archive_path.unlink(missing_ok=True)

        return self._find_node_in_dir(extract_dir)

    # -- Node.js helpers ------------------------------------------------

    def _get_latest_lts_version(self) -> str | None:
        """Fetch the latest Node.js LTS version from nodejs.org."""
        try:
            with urllib.request.urlopen(
                "https://nodejs.org/dist/index.json", timeout=10
            ) as resp:
                data = json.loads(resp.read())
            for entry in data:
                if entry.get("lts"):
                    return entry["version"]
        except Exception:
            pass
        return None

    @staticmethod
    def _find_node_in_dir(directory: Path) -> str | None:
        """Find the ``node`` binary inside *directory*."""
        for name in ("node", "node.exe"):
            for sub in ("bin", ""):
                candidate = directory / sub / name
                if candidate.is_file():
                    return str(candidate)
        return None

    def _find_node_after_install(self) -> str | None:
        """Try to locate ``node`` in common install locations."""
        system = platform.system()
        candidates: list[Path] = []
        if system == "Windows":
            candidates = [
                Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
                / "nodejs"
                / "node.exe",
                Path(
                    os.environ.get(
                        "PROGRAMFILES(X86)", r"C:\Program Files (x86)"
                    )
                )
                / "nodejs"
                / "node.exe",
                Path(os.environ.get("LOCALAPPDATA", ""))
                / "nodejs"
                / "node.exe",
            ]
        else:
            candidates = [
                Path("/usr/local/bin/node"),
                Path("/usr/bin/node"),
                Path.home() / ".local" / "bin" / "node",
            ]
        for p in candidates:
            if p.is_file():
                bin_dir = str(p.parent)
                os.environ["PATH"] = (
                    bin_dir + os.pathsep + os.environ.get("PATH", "")
                )
                return str(p)
        return self._which("node")

    def _print_node_install_instructions(self) -> None:
        """Print platform-specific manual Node.js installation instructions."""
        system = platform.system()
        print(file=sys.stderr)
        print(
            "  [build-tui] 📋 To install Node.js manually:",
            file=sys.stderr,
        )
        if system == "Windows":
            print(
                "    winget install OpenJS.NodeJS.LTS",
                file=sys.stderr,
            )
            print(
                "    # or download from https://nodejs.org/",
                file=sys.stderr,
            )
            print(
                "    # or: conda install -c conda-forge nodejs",
                file=sys.stderr,
            )
        elif system == "Darwin":
            print(
                "    brew install node",
                file=sys.stderr,
            )
            print(
                "    # or: curl -fsSL https://fnm.vercel.app/install | bash "
                "&& source ~/.bashrc && fnm install --lts",
                file=sys.stderr,
            )
            print(
                "    # or: download from https://nodejs.org/",
                file=sys.stderr,
            )
        else:
            print(
                "    curl -fsSL https://fnm.vercel.app/install | bash "
                "&& source ~/.bashrc && fnm install --lts",
                file=sys.stderr,
            )
            print(
                "    # or: nvm install --lts  (if nvm is installed)",
                file=sys.stderr,
            )
            print(
                "    # or: conda install -c conda-forge nodejs",
                file=sys.stderr,
            )
            print(
                "    # or: sudo apt install nodejs npm  (Ubuntu/Debian)",
                file=sys.stderr,
            )
        print(file=sys.stderr)

    # ==================================================================
    #  pnpm management
    # ==================================================================

    def _ensure_pnpm(self, node_path: str) -> str | None:
        """Ensure pnpm is available.

        Returns the path to the ``pnpm`` binary, or *None* if it could
        not be found or auto-installed.
        """
        pnpm = self._which("pnpm")
        if pnpm:
            print(
                f"  [build-tui] ✓ pnpm found: {pnpm}",
                file=sys.stderr,
            )
            return pnpm

        print(
            "  [build-tui] ⚠ pnpm not found, attempting auto-install …",
            file=sys.stderr,
        )

        node_dir = Path(node_path).parent

        # Method 1: corepack (bundled with Node.js ≥ 16.9.0)
        corepack = self._find_companion_binary(node_dir, "corepack")
        if corepack:
            print(
                "  [build-tui] Enabling pnpm via corepack …",
                file=sys.stderr,
            )
            try:
                subprocess.run(
                    self._prepare_cmd([corepack, "enable", "pnpm"]),
                    check=True,
                    timeout=30,
                    stdout=sys.stderr.fileno(),
                    stderr=sys.stderr.fileno(),
                )
                pnpm = self._which("pnpm")
                if not pnpm:
                    pnpm = self._find_companion_binary(node_dir, "pnpm")
                if pnpm:
                    print(
                        f"  [build-tui] ✓ pnpm ready via corepack: {pnpm}",
                        file=sys.stderr,
                    )
                    return pnpm
            except Exception as exc:
                print(
                    f"  [build-tui] corepack failed: {exc}",
                    file=sys.stderr,
                )

        # Method 2: npm install -g pnpm
        npm = self._find_companion_binary(node_dir, "npm")
        if npm:
            print(
                "  [build-tui] Installing pnpm via npm …",
                file=sys.stderr,
            )
            try:
                subprocess.run(
                    self._prepare_cmd([npm, "install", "-g", "pnpm"]),
                    check=True,
                    timeout=120,
                    stdout=sys.stderr.fileno(),
                    stderr=sys.stderr.fileno(),
                )
                pnpm = self._which("pnpm")
                if not pnpm:
                    pnpm = self._find_companion_binary(node_dir, "pnpm")
                if pnpm:
                    print(
                        f"  [build-tui] ✓ pnpm ready via npm: {pnpm}",
                        file=sys.stderr,
                    )
                    return pnpm
            except Exception as exc:
                print(
                    f"  [build-tui] npm install pnpm failed: {exc}",
                    file=sys.stderr,
                )

        print(
            "  [build-tui] ❌ Could not auto-install pnpm.",
            file=sys.stderr,
        )
        return None

    # ==================================================================
    #  TUI build
    # ==================================================================

    def _build_tui(self, tui_dir: Path, node_path: str) -> bool:
        """Build the TUI frontend.

        Returns ``True`` on success.
        """
        pnpm = self._ensure_pnpm(node_path)

        if pnpm:
            if self._run_cmd([pnpm, "install"], tui_dir):
                if self._run_cmd([pnpm, "run", "build"], tui_dir):
                    return True

        # Fallback: use npm directly
        npm = self._find_companion_binary(
            Path(node_path).parent, "npm"
        ) or self._which("npm")
        if npm:
            print(
                "  [build-tui] Falling back to npm …",
                file=sys.stderr,
            )
            if self._run_cmd([npm, "install"], tui_dir):
                if self._run_cmd([npm, "run", "build"], tui_dir):
                    return True

        return False

    # ==================================================================
    #  force-include management
    # ==================================================================

    def _remove_tui_force_includes(
        self, build_data: dict[str, Any]
    ) -> None:
        """Remove TUI ``force-include`` entries from *build_data*.

        When the TUI bundle is not available, the ``force-include``
        directives in ``pyproject.toml`` would cause a
        ``FileNotFoundError``.  This method removes those entries so
        that ``pip install`` can still succeed — only TUI features
        are disabled.
        """
        removed = False
        for key in ("force_include", "force_include_editable"):
            if key not in build_data or not isinstance(
                build_data[key], dict
            ):
                continue
            to_remove: list[str] = []
            for src in list(build_data[key].keys()):
                src_lower = src.lower().replace("\\", "/")
                if (
                    "entry.mjs" in src_lower
                    or (
                        "ui-tui" in src_lower
                        and "package.json" in src_lower
                    )
                ):
                    to_remove.append(src)
            for src in to_remove:
                del build_data[key][src]
                removed = True
        if removed:
            print(
                "  [build-tui] Removed TUI force-include entries "
                "to allow build without TUI.",
                file=sys.stderr,
            )

    # ==================================================================
    #  Main entry point
    # ==================================================================

    def initialize(
        self, version: str, build_data: dict[str, Any]
    ) -> None:
        """Called by hatchling before every build."""
        skip = os.environ.get("DRSAI_SKIP_TUI_BUILD", "").lower() in (
            "1",
            "true",
            "yes",
        )

        # -- 1. locate the ui-tui source directory ----------------------
        tui_dir = self._find_ui_tui_dir()
        if tui_dir is None:
            if not skip:
                print(
                    "  [build-tui] ⚠ Could not locate apps/ui-tui directory; "
                    "skipping TUI build.\n"
                    "  If you are building from source, clone the full "
                    "monorepo:\n"
                    "    git clone https://github.com/hepaihub/drsai.git",
                    file=sys.stderr,
                )
            self._remove_tui_force_includes(build_data)
            return

        # -- 2. check if the bundle already exists -----------------------
        bundle = tui_dir / "dist" / "entry.mjs"
        if bundle.is_file():
            print(
                f"  [build-tui] ✓ bundle already up-to-date: {bundle}",
                file=sys.stderr,
            )
            return

        # -- 3. honour DRSAI_SKIP_TUI_BUILD ------------------------------
        if skip:
            print(
                "  [build-tui] DRSAI_SKIP_TUI_BUILD=1 — skipping TUI build.",
                file=sys.stderr,
            )
            self._remove_tui_force_includes(build_data)
            return

        # -- 4. build the TUI frontend -----------------------------------
        print(
            f"  [build-tui] 🔨 Building ui-tui frontend …\n"
            f"  [build-tui]    source: {tui_dir}",
            file=sys.stderr,
        )

        # Ensure Node.js
        node = self._ensure_node()
        if not node:
            print(
                "  [build-tui] ❌ Cannot build TUI without Node.js.",
                file=sys.stderr,
            )
            self._remove_tui_force_includes(build_data)
            print(
                "  [build-tui] TUI features will be disabled in this "
                "installation.\n"
                "  [build-tui] To enable TUI: install Node.js + pnpm, "
                "then re-run pip install.",
                file=sys.stderr,
            )
            return

        # Build
        success = self._build_tui(tui_dir, node)

        if success:
            print(
                "  [build-tui] ✓ TUI build succeeded",
                file=sys.stderr,
            )
            return

        # -- 5. graceful degradation -------------------------------------
        print(
            "  [build-tui] ❌ TUI build failed.",
            file=sys.stderr,
        )
        self._remove_tui_force_includes(build_data)
        print(
            f"  [build-tui] TUI features will be disabled in this "
            f"installation.\n"
            f"  [build-tui] You can build manually:\n"
            f"    cd {tui_dir}\n"
            f"    pnpm install && pnpm build\n"
            f"  [build-tui] Then re-run: pip install -e "
            f"./cores/python/packages/drsai/",
            file=sys.stderr,
        )
