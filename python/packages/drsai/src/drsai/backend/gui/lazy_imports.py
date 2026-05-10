"""Lazy imports — centralized deferred import helpers with caching.

Heavy dependencies are imported at runtime to avoid import-chain crashes
in PyInstaller packaged exe (console=False mode silently kills the process
on module-level import failures).

Previously, these were scattered as:
  - 9 _import_* static methods in DrSaiDesktopApp
  - 8 inline `from drsai.backend.cli.history import CLISessionStore`
  - 4 inline `from drsai.backend.run_drsai_agent_factory import load_llm_mode_config`
  - 2 inline `import tkinter.messagebox as messagebox`

Now all deferred imports go through this module's cached accessor functions.
First call does the real import; subsequent calls return the cached result.
"""

from __future__ import annotations

import sys
from typing import Any

# ── Global cache ──────────────────────────────────────────────────────────
_cache: dict[str, Any] = {}


def _get(key: str, import_fn) -> Any:
    """Cache wrapper: import once, return cached result thereafter."""
    if key not in _cache:
        _cache[key] = import_fn()
    return _cache[key]


# ── Agent / Core ──────────────────────────────────────────────────────────

def get_create_agent():
    """Lazily import create_agent from run_drsai_agent_factory."""
    return _get("create_agent", lambda: __import__(
        "drsai.backend.run_drsai_agent_factory", fromlist=["create_agent"]
    ).create_agent)


def get_load_llm_mode_config():
    """Lazily import load_llm_mode_config from run_drsai_agent_factory."""
    return _get("load_llm_mode_config", lambda: __import__(
        "drsai.backend.run_drsai_agent_factory", fromlist=["load_llm_mode_config"]
    ).load_llm_mode_config)


def get_DatabaseManager():
    """Lazily import DatabaseManager from managers.database."""
    return _get("DatabaseManager", lambda: __import__(
        "drsai.modules.managers.database", fromlist=["DatabaseManager"]
    ).DatabaseManager)


# ── CLI utilities ──────────────────────────────────────────────────────────

def get_SessionStats():
    """Lazily import SessionStats from cli.stats."""
    return _get("SessionStats", lambda: __import__(
        "drsai.backend.cli.stats", fromlist=["SessionStats"]
    ).SessionStats)


def get_CLISessionStore():
    """Lazily import CLISessionStore from cli.history."""
    return _get("CLISessionStore", lambda: __import__(
        "drsai.backend.cli.history", fromlist=["CLISessionStore"]
    ).CLISessionStore)


def get_config_as_dict_for_export():
    """Lazily import config_as_dict_for_export from cli.config."""
    return _get("config_as_dict_for_export", lambda: __import__(
        "drsai.backend.cli.config", fromlist=["config_as_dict_for_export"]
    ).config_as_dict_for_export)


# ── GUI components ─────────────────────────────────────────────────────────

def get_DrSaiChatWindow():
    """Lazily import DrSaiChatWindow from gui.chat_window."""
    return _get("DrSaiChatWindow", lambda: __import__(
        "drsai.backend.gui.chat_window", fromlist=["DrSaiChatWindow"]
    ).DrSaiChatWindow)


def get_DrSaiGUIRenderer():
    """Lazily import DrSaiGUIRenderer from gui.gui_renderer."""
    return _get("DrSaiGUIRenderer", lambda: __import__(
        "drsai.backend.gui.gui_renderer", fromlist=["DrSaiGUIRenderer"]
    ).DrSaiGUIRenderer)


def get_DrSaiTrayApp():
    """Lazily import DrSaiTrayApp from gui.tray_icon."""
    return _get("DrSaiTrayApp", lambda: __import__(
        "drsai.backend.gui.tray_icon", fromlist=["DrSaiTrayApp"]
    ).DrSaiTrayApp)


# ── Datamodel ──────────────────────────────────────────────────────────────

def get_datamodel():
    """Lazily import Thread, RunStatus, Response from datamodel."""
    return _get("datamodel", lambda: (
        __import__("drsai.modules.managers.datamodel", fromlist=["Thread"]).Thread,
        __import__("drsai.modules.managers.datamodel.db", fromlist=["RunStatus"]).RunStatus,
        __import__("drsai.modules.managers.datamodel.types", fromlist=["Response"]).Response,
    ))


def get_Thread():
    Thread, _, _ = get_datamodel()
    return Thread

def get_RunStatus():
    _, RunStatus, _ = get_datamodel()
    return RunStatus

def get_Response():
    _, _, Response = get_datamodel()
    return Response


# ── State utils ────────────────────────────────────────────────────────────

def get_compress_state():
    """Lazily import compress_state from utils.utils."""
    return _get("compress_state", lambda: __import__(
        "drsai.utils.utils", fromlist=["compress_state"]
    ).compress_state)


def get_decompress_state():
    """Lazily import decompress_state from utils.utils."""
    return _get("decompress_state", lambda: __import__(
        "drsai.utils.utils", fromlist=["decompress_state"]
    ).decompress_state)


# ── Desktop-specific ───────────────────────────────────────────────────────

def get_messagebox():
    """Lazily import tkinter.messagebox."""
    return _get("messagebox", lambda: __import__("tkinter.messagebox"))


def get_pyperclip():
    """Lazily import pyperclip."""
    return _get("pyperclip", lambda: __import__("pyperclip"))


def get_shortcut_installer():
    """Lazily import shortcut_installer module."""
    return _get("shortcut_installer", lambda: __import__(
        "drsai.backend.gui.shortcut_installer"
    ))


def get_init_project_instructions():
    """Lazily import init_project_instructions from cli.drsaimd_loader."""
    return _get("init_project_instructions", lambda: __import__(
        "drsai.backend.cli.drsaimd_loader", fromlist=["init_project_instructions"]
    ).init_project_instructions)


def get_load_project_instructions():
    """Lazily import load_project_instructions from cli.drsaimd_loader."""
    return _get("load_project_instructions", lambda: __import__(
        "drsai.backend.cli.drsaimd_loader", fromlist=["load_project_instructions"]
    ).load_project_instructions)


def get_signal():
    """Lazily import signal module."""
    return _get("signal", lambda: __import__("signal"))


# ── Diagnostic ─────────────────────────────────────────────────────────────

def cache_info() -> dict[str, bool]:
    """Return which imports have been resolved (for debugging)."""
    return {key: key in _cache for key in sorted(_cache)}