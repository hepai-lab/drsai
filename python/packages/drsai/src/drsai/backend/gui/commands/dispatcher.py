"""CommandDispatcher — registry-driven slash command routing.

Replaces the 149-line if-chain in the original run_tray.py.
Dispatch is driven by COMMAND_REGISTRY's handler field AND actual
handler function inspection:

    handler is async coroutine  → asyncio.run_coroutine_threadsafe(handler, ctx._loop)
    handler is sync function    → direct call on main thread

Each command implementation lives in a category module:
    config_cmds, session_cmds, model_cmds, file_cmds, chat_cmds, workspace_cmds

The dispatch method uses asyncio.iscoroutinefunction() to determine
whether the actual handler is async or sync, regardless of the
COMMAND_REGISTRY's handler field.  This prevents TypeError when a
command is declared as "async" in the registry but implemented as
sync in the GUI (or vice versa).
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from loguru import logger

from drsai.backend.cli.commands import resolve_command, COMMAND_REGISTRY, CommandDef
from drsai.backend.gui.app_context import AppContext
from drsai.backend.gui.commands.config_cmds import ConfigCommands
from drsai.backend.gui.commands.session_cmds import SessionCommands
from drsai.backend.gui.commands.model_cmds import ModelCommands
from drsai.backend.gui.commands.file_cmds import FileCommands
from drsai.backend.gui.commands.chat_cmds import ChatCommands
from drsai.backend.gui.commands.workspace_cmds import WorkspaceCommands
from drsai.backend.gui.commands.window_cmds import WindowCommands


class CommandDispatcher:
    """Registry-driven command dispatcher for DrSai desktop app.

    Routes /command input to the correct handler method, automatically
    choosing sync vs async execution based on asyncio.iscoroutinefunction()
    inspection of the actual handler — not just COMMAND_REGISTRY metadata.
    """

    def __init__(self, ctx: AppContext) -> None:
        self.ctx = ctx

        # ── Command module instances (each holds _cmd_xxx methods) ──
        self._config = ConfigCommands(ctx)
        self._session = SessionCommands(ctx)
        self._model = ModelCommands(ctx)
        self._file = FileCommands(ctx)
        self._chat = ChatCommands(ctx)
        self._workspace = WorkspaceCommands(ctx)
        self._window = WindowCommands(ctx)

        # ── Handler lookup: command_name → (module_instance, method_name) ──
        self._handler_map: dict[str, tuple[Any, str]] = {
            # config_cmds
            "config":       (self._config, "cmd_config"),
            "models":       (self._config, "cmd_models"),
            "verbose":      (self._config, "cmd_verbose"),
            "bell":         (self._config, "cmd_bell"),
            # session_cmds
            "new":          (self._session, "cmd_new"),
            "switch":       (self._session, "cmd_switch"),
            "list":         (self._session, "cmd_list"),
            "copy":         (self._session, "cmd_copy"),
            "resume":       (self._session, "cmd_resume"),
            "history":      (self._session, "cmd_history"),
            "search":       (self._session, "cmd_search"),
            "rename":       (self._session, "cmd_rename"),
            # model_cmds
            "model":        (self._model, "cmd_model"),
            "model_global": (self._model, "cmd_model_global"),
            "fast":         (self._model, "cmd_fast"),
            "reasoning":    (self._model, "cmd_reasoning"),
            # file_cmds
            "cd":           (self._file, "cmd_cd"),
            "init":         (self._file, "cmd_init"),
            "save":         (self._file, "cmd_save"),
            "install":      (self._file, "cmd_install"),
            # chat_cmds
            "help":         (self._chat, "cmd_help"),
            "clear":        (self._chat, "cmd_clear"),
            "info":         (self._chat, "cmd_info"),
            "tray":         (self._chat, "cmd_tray"),
            "retry":        (self._chat, "cmd_retry"),
            # workspace_cmds
            "workspace":    (self._workspace, "cmd_workspace"),
            "dangerous":    (self._workspace, "cmd_dangerous"),
            "inject":       (self._workspace, "cmd_inject"),
            "memory":       (self._workspace, "cmd_memory"),
            "status":       (self._workspace, "cmd_status"),
            "plan_mode":    (self._workspace, "cmd_plan_mode"),
            "pm_global":    (self._workspace, "cmd_pm_global"),
            # window_cmds
            "win_new":      (self._window, "cmd_win_new"),
            "win_close":    (self._window, "cmd_win_close"),
            "win_list":     (self._window, "cmd_win_list"),
            "win_switch":   (self._window, "cmd_win_switch"),
        }

    def dispatch(self, cmd_name: str, cmd_args: str) -> bool:
        """Dispatch a slash command. Returns True if handled locally.

        Routes via COMMAND_REGISTRY to determine handler type (async/sync/special).
        Falls back to handler_map for the actual method to call.
        """
        # ── Special commands: quit ──────────────────────────────────────
        if cmd_name in ("quit", "exit", "q"):
            # Quit must be handled by DrSaiDesktopApp directly (it manages lifecycle)
            # Signal the app to quit via ctx
            return False  # Let it pass through to DrSaiDesktopApp._on_quit

        # ── Resolve command via registry ────────────────────────────────
        resolved: Optional[CommandDef] = resolve_command(cmd_name)
        if resolved is None:
            return False  # Unknown command → send as chat message

        # ── Find handler method ─────────────────────────────────────────
        entry = self._handler_map.get(resolved.name)
        if entry is None:
            logger.warning(f"No handler for command: {resolved.name}")
            return False

        module, method_name = entry
        handler_fn = getattr(module, method_name, None)
        if handler_fn is None:
            logger.warning(f"Handler method {method_name} not found on {type(module).__name__}")
            return False

        # ── Dispatch based on actual handler type ────────────────────────
        # Inspect whether the handler is actually an async coroutine function.
        # This is safer than relying solely on COMMAND_REGISTRY's handler field,
        # because the GUI command modules may implement a handler as sync even
        # when the registry declares it as "async" (or vice versa).
        if asyncio.iscoroutinefunction(handler_fn):
            coro = handler_fn(cmd_args)
            self._call_async(coro)
        else:
            # Sync handler — call directly on the main (tkinter) thread.
            # If the registry says "async" but the implementation is sync,
            # we still call it directly.  This is safe because sync handlers
            # in the GUI only do GUI updates (which must run on the main
            # thread anyway).
            handler_fn(cmd_args)

        return True

    # ── Thread bridge helpers ──────────────────────────────────────────

    def _call_async(self, coro) -> None:
        """Schedule an async coroutine on the background asyncio loop."""
        if self.ctx._loop is not None and self.ctx._loop.is_running():
            asyncio.run_coroutine_threadsafe(coro, self.ctx._loop)
        else:
            logger.warning("Asyncio loop not available — command dropped")

    def _call_gui(self, fn, *args) -> None:
        """Schedule a GUI call on the tkinter main thread."""
        if self.ctx._chat_window is not None:
            self.ctx._chat_window.after(0, lambda: fn(*args))