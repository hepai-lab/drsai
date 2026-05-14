"""SessionContext — per-session state container for DrSai desktop app.

Each desktop window has exactly one SessionContext.  It holds the agent,
session identity, stats tracker, UI formatter, and window reference.

Shared resources (cfg, db_manager, asyncio loop, tray app) are accessed
via the ``app`` reference (AppContext / DrSaiDesktopApp) which is a
process-wide singleton.

Lifecycle:
    1. Created by AppContext.create_session_context(session_id)
    2. Agent initialized via init_agent() (async)
    3. Window attached via attach_window(chat_window)
    4. On /new or session close: save_state() → close_agent()
    5. On shutdown: all SessionContexts are iterated and closed
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional
from dataclasses import dataclass, field


@dataclass
class SessionContext:
    """Per-session state for one DrSai desktop conversation window.

    All fields are mutable — components update them as the session runs.
    """

    # ── Session identity ──────────────────────────────────────────────────
    session_id: str
    session_name: str = ""

    # ── Back-reference to process-level shared state ──────────────────────
    app: Optional[Any] = None               # DrSaiDesktopApp (orchestrator)

    # ── Agent state ───────────────────────────────────────────────────────
    agent: Optional[Any] = None             # DrSaiCLIAssistant
    current_thread: Optional[Any] = None    # Thread (datamodel)

    # ── Stats tracking ────────────────────────────────────────────────────
    stats: Optional[Any] = None             # SessionStats

    # ── GUI components ────────────────────────────────────────────────────
    _chat_window: Optional[Any] = None      # DrSaiChatWindow
    ui: Optional[Any] = None                # UIFormatter (bound to chat_window)

    # ── Session-local preferences ─────────────────────────────────────────
    _show_reasoning: bool = False
    _interrupt_count: int = 0
    _current_chat_task: Optional[asyncio.Future] = None

    # ── Derived from cfg (for quick access) ───────────────────────────────
    @property
    def user_id(self) -> str:
        return self.app.ctx.cfg.get("user_id", "anonymous") if self.app else "anonymous"

    @property
    def defult_config_name(self) -> str:
        """Current model alias (from agent or config)."""
        if self.agent and hasattr(self.agent, '_defult_config_name'):
            return self.agent._defult_config_name
        if self.app:
            return self.app.ctx.cfg.get("defult_config_name", "")
        return ""

    @property
    def _work_dir(self) -> str:
        if self.app:
            return self.app.ctx.cfg.get("work_dir", "") or ""
        return ""

    @property
    def is_alive(self) -> bool:
        """Session still has an initialized agent."""
        return self.agent is not None

    # ── ChatWindow management ────────────────────────────────────────────

    def attach_window(self, chat_window: Any) -> None:
        """Bind a DrSaiChatWindow to this session."""
        self._chat_window = chat_window
        if self.ui is None and chat_window is not None:
            from drsai.backend.gui.ui_formatter import UIFormatter
            self.ui = UIFormatter(chat_window)

    def detach_window(self) -> None:
        """Unbind chat window (window being destroyed / minimized to tray)."""
        self._chat_window = None
        # Keep ui reference for pending state saves

    # ── Session-local status bar ─────────────────────────────────────────

    def build_status_bar(self) -> str:
        """Build status bar text for this session's window."""
        user_id = self.user_id
        model_name = self.defult_config_name or "auto"
        if len(model_name) > 40:
            model_name = model_name[:37] + "..."

        parts = [f"{user_id} @ {model_name}"]

        if self.stats and self.stats.turns:
            parts.append(f"turns: {self.stats.turns}")
        if self._show_reasoning:
            parts.append("R+")

        agent = self.agent
        # Plan mode
        injected_prefix = getattr(agent, '_injected_prefix', "") or ""
        if injected_prefix:
            parts.append("plan:on")

        # Workspace restriction
        ws_enabled = getattr(agent, '_only_in_workspace', None)
        if ws_enabled is True:
            parts.append("🔒 workdir-only")
        elif ws_enabled is False:
            parts.append("⚠️ any-path")

        # Dangerous mode
        dangerous_allowed_fn = getattr(agent, '_get_dangerous_allowed', None)
        if dangerous_allowed_fn is not None:
            da = dangerous_allowed_fn()
            parts.append("⚠️ all-cmd" if da else "🛡 safe-cmd")

        return "  ·  ".join(parts)

    def update_status_bar(self) -> None:
        """Push status bar update to this session's window."""
        if self._chat_window and not getattr(self._chat_window, '_destroyed', False):
            self._chat_window.set_status_info(self.build_status_bar())
