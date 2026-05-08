# -*- mode: python ; coding: utf-8 -*-
# DrSai Tray — PyInstaller spec (onedir, windowed)
# Run via: pyinstaller drsai-tray.spec  (or via build.ps1)

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_submodules,
)

# SPECPATH is injected by PyInstaller at spec-load time and points to the
# directory containing this .spec file. Using it makes the spec invariant
# to the caller's cwd.
PROJECT_ROOT = Path(SPECPATH).resolve()
SRC_DIR      = PROJECT_ROOT / "src"
ENTRY        = SRC_DIR / "drsai" / "backend" / "gui" / "run_tray.py"
ICON_FILE    = PROJECT_ROOT / "build" / "icons" / "drsai_robot.ico"

is_windows = sys.platform.startswith("win")

# ── Bulk-collect packages with heavy dynamic imports / data files ─────────
# collect_all returns (hiddenimports, datas, binaries) and walks the package
# tree, so it survives upstream version bumps better than a manual list.
hidden_imports: list[str] = []
datas:          list[tuple[str, str]] = []
binaries:       list[tuple[str, str]] = []

_BULK_PACKAGES = [
    "autogen_agentchat",
    "autogen_core",
    "autogen_ext",
    "hepai",
    "tiktoken",
    "tiktoken_ext",
    "sqlmodel",
    "alembic",
    "pystray",
    "PIL",
    "qrcode",
    "prompt_toolkit",
    "pydantic",
    "pydantic_settings",
]
for _pkg in _BULK_PACKAGES:
    try:
        # PyInstaller's collect_all returns (datas, binaries, hiddenimports)
        _d, _b, _h = collect_all(_pkg)
        datas          += _d
        binaries       += _b
        hidden_imports += _h
    except Exception as _err:
        # A missing optional package shouldn't fail the whole build.
        print(f"[drsai-tray.spec] WARN: collect_all({_pkg!r}) failed: {_err}")

# ── drsai internal submodules (not collected automatically because the
#    package is installed as editable / hatchling and uses lazy imports) ──
hidden_imports += collect_submodules("drsai")

# ── Platform-specific imports PyInstaller misses ──────────────────────────
hidden_imports += [
    "PIL._tkinter_finder",       # pystray ↔ tkinter glue
    "tiktoken_ext.openai_public",
]
if is_windows:
    hidden_imports += [
        "pystray._win32",
        "prompt_toolkit.output.win32",
        "prompt_toolkit.input.win32",
        "prompt_toolkit.win32_types",
    ]

# Deduplicate while preserving order (PyInstaller doesn't care, but logs are nicer)
hidden_imports = list(dict.fromkeys(hidden_imports))

# ── Excludes: trim packages pulled in transitively but not used by the GUI.
# Keep this list conservative — over-excluding causes runtime ImportError.
excludes = [
    "matplotlib",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
    "sphinx",
    "playwright",
]

a = Analysis(
    [str(ENTRY)],
    pathex=[str(SRC_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

_icon = str(ICON_FILE) if ICON_FILE.exists() else None

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="drsai-tray",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,                 # windowed — no black console flash
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="drsai-tray",            # → dist/drsai-tray/drsai-tray.exe
)
