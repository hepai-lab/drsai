"""AppContext — process-level shared state container for DrSai desktop app.

Architecture (multi-window):
    AppContext          — process-level singleton (cfg, db, loop, tray, IPC)
    SessionContext      — per-session state (agent, stats, ui, chat_window)

    _sessions: dict[str, SessionContext]
        session_id → SessionContext (may or may not have a window)
    _windows: dict[str, tk.Toplevel]
        session_id → Toplevel (visible window; some sessions may be tray-only)

Design principle: AppContext is a **data container**, not a service.
It holds references to shared resources and manages session/window
lifecycle orchestration by delegating to DrSaiDesktopApp.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Optional


class AppContext:
    """Process-level shared state for the DrSai desktop application.

    Mutable by design — components update fields as the app runs.
    """

    def __init__(self) -> None:
        # ── Configuration ──────────────────────────────────────────────────
        self.cfg: dict = {}

        # ── Convenience (derived from cfg after sync) ──────────────────────
        self.user_id: str = "anonymous"
        self.default_model: str = ""
        self._work_dir: str = ""
        self._show_reasoning: bool = False

        # ── Shared infrastructure ──────────────────────────────────────────
        self.db_manager: Optional[Any] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread: Optional[threading.Thread] = None
        self._init_done: threading.Event = threading.Event()
        self._init_error: Optional[str] = None
        self._needs_setup: bool = True
        self._config_file_is_new: bool = False    # config file was auto-generated (first time)
        self._setup_is_optional: bool = False      # can cancel setup and still run (env key exists)

        # ── IPC server (single-instance management) ────────────────────────
        self._ipc_server: Optional[Any] = None          # IPCServer

        # ── System tray (process-wide, one tray icon) ──────────────────────
        self._tray_app: Optional[Any] = None            # DrSaiTrayApp

        # ── Hidden root window (tk.Tk, never shown) ────────────────────────
        self._root: Optional[Any] = None                # tk.Tk (hidden)

        # ── Multi-session management ───────────────────────────────────────
        self._sessions: dict[str, Any] = {}              # session_id → SessionContext
        self._windows: dict[str, Any] = {}               # session_id → Toplevel
        self._active_session_id: str = ""                # currently focused session

        # ── Back-reference to orchestrator ─────────────────────────────────
        self._app: Optional[Any] = None                  # DrSaiDesktopApp

        # ── Legacy / deprecated (for migration compatibility) ─────────────
        self.agent: Optional[Any] = None                 # → use sessions[].agent
        self.stats: Optional[Any] = None                 # → use sessions[].stats
        self.current_session_id: Optional[str] = None    # → use _active_session_id
        self.current_thread: Optional[Any] = None        # → use sessions[].current_thread
        self.ui: Optional[Any] = None                    # → use sessions[].ui
        self._chat_window: Optional[Any] = None          # → use sessions[]._chat_window
        self.agent_manager: Optional[Any] = None         # deprecated
        self.chat_controller: Optional[Any] = None       # deprecated
        self.command_dispatcher: Optional[Any] = None    # CommandDispatcher
        self._current_chat_task: Optional[Any] = None    # → use sessions[]
        self._interrupt_count: int = 0                   # → use sessions[]
        self._in_initial_setup: bool = False              # True while first-time setup dialog is open

    # ── Convenience properties ─────────────────────────────────────────────

    @property
    def defult_config_name(self) -> str:
        return self.cfg.get("defult_config_name", self.default_model)

    @property
    def sessions(self) -> dict[str, Any]:
        return self._sessions

    @property
    def windows(self) -> dict[str, Any]:
        return self._windows

    @property
    def active_session_id(self) -> str:
        return self._active_session_id

    @property
    def ipc_server(self) -> Optional[Any]:
        return self._ipc_server

    @property
    def loop(self) -> Optional[asyncio.AbstractEventLoop]:
        return self._loop

    # ── Config sync ────────────────────────────────────────────────────────

    def sync_from_cfg(self) -> None:
        """Pull commonly-used fields from cfg into top-level attributes."""
        self.user_id = self.cfg.get("user_id", "anonymous")
        self.default_model = self.cfg.get("defult_config_name", "hepai/minimax-m2.7-highspeed")
        self._work_dir = self.cfg.get("work_dir", "") or ""
        self._show_reasoning = self.cfg.get("show_reasoning", False)

    def _save_cfg_global(self, key: str, value: Any) -> None:
        """Save a config key-value to the persistent config file."""
        self.cfg[key] = value
        from drsai.backend.cli import config as cli_config
        cli_config.save_config(self.cfg)
        self.sync_from_cfg()

    # ── Active session ─────────────────────────────────────────────────────

    def get_active_session(self) -> Optional[Any]:
        """Get the currently active SessionContext."""
        if self._active_session_id and self._active_session_id in self._sessions:
            return self._sessions[self._active_session_id]
        return None

    def get_active_session_ui(self) -> Optional[Any]:
        """Get the UIFormatter from the currently active SessionContext.

        This is safer than accessing self.ui directly, because self.ui
        may be None if set_active_session() hasn't been called yet or
        if the active session's ui hasn't been initialized.
        """
        sctx = self.get_active_session()
        if sctx and sctx.ui is not None:
            return sctx.ui
        # Fallback: check all sessions for one with a ui
        for sctx in self._sessions.values():
            if sctx.ui is not None:
                return sctx.ui
        return None

    def set_active_session(self, session_id: str) -> None:
        """Set the active session and sync legacy fields."""
        self._active_session_id = session_id
        s = self._sessions.get(session_id)
        if s:
            # Sync legacy fields for backward compatibility
            self.agent = s.agent
            self.stats = s.stats
            self.current_session_id = s.session_id
            self.current_thread = s.current_thread
            self.ui = s.ui
            self._chat_window = s._chat_window

    # ── Session lifecycle ──────────────────────────────────────────────────

    def register_session(self, session_id: str, session_ctx: Any) -> None:
        """Register a new SessionContext (may or may not have a window yet)."""
        self._sessions[session_id] = session_ctx
        self._active_session_id = session_id
        self.set_active_session(session_id)

    def unregister_session(self, session_id: str) -> None:
        """Remove a session completely (close + forget)."""
        self._sessions.pop(session_id, None)
        self._windows.pop(session_id, None)
        if self._active_session_id == session_id:
            # Activate another session if available
            remaining = list(self._sessions.keys())
            if remaining:
                self._active_session_id = remaining[-1]
                self.set_active_session(self._active_session_id)
            else:
                self._active_session_id = ""
                self.agent = None
                self.stats = None
                self.current_session_id = None
                self.current_thread = None
                self.ui = None
                self._chat_window = None

    def has_visible_windows(self) -> bool:
        """Return True if any session has a visible (non-withdrawn) window."""
        for win in self._windows.values():
            try:
                if win.winfo_exists() and win.state() != "withdrawn":
                    return True
            except Exception:
                pass
        return False

    def get_session_ids(self) -> list[str]:
        """Return all session IDs in creation order."""
        return list(self._sessions.keys())

    def get_session_names(self) -> dict[str, str]:
        """Return {session_id: display_name} for all sessions."""
        return {
            sid: ctx.session_name or sid[:8]
            for sid, ctx in self._sessions.items()
        }

    # ── Window management ──────────────────────────────────────────────────

    def register_window(self, session_id: str, window: Any) -> None:
        """Register a Toplevel window for a session."""
        self._windows[session_id] = window

    def unregister_window(self, session_id: str) -> None:
        """Remove window from registry (session may still be alive)."""
        self._windows.pop(session_id, None)

    def focus_session_window(self, session_id: str) -> bool:
        """Focus and show the window for a session. Returns True if window exists."""
        win = self._windows.get(session_id)
        if win and win.winfo_exists():
            try:
                win.deiconify()
                win.lift()
                win.focus_force()
                # Briefly set topmost
                win.attributes("-topmost", True)
                win.after(200, lambda w=win: w.attributes("-topmost", False) if w.winfo_exists() else None)
            except Exception:
                pass
            self.set_active_session(session_id)
            return True
        return False
