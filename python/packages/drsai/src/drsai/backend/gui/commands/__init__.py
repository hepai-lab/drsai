"""Command dispatcher package — registry-driven slash command dispatch.

This package provides CommandDispatcher, which replaces the previous
149-line if-chain in run_tray.py's _on_command.  Command implementations
are split across category-specific modules:

    config_cmds     — /config, /models, /verbose, /bell
    session_cmds    — /new, /switch, /resume, /history, /search, /rename, /list, /copy
    model_cmds      — /model, /model_global, /fast, /reasoning
    file_cmds       — /cd, /init, /save, /install
    chat_cmds       — /help, /clear, /info, /tray, /retry
    workspace_cmds  — /workspace, /dangerous, /inject, /memory, /status, /plan_mode, /pm_global
    window_cmds     — /win_new, /win_close, /win_list, /win_switch

Note: /setup and /quit are handled by DrSaiDesktopApp directly
(lifecycle concerns requiring state re-initialization / shutdown).

Each module contains a class that takes AppContext reference and provides
_cmd_xxx methods.  CommandDispatcher aggregates all modules and routes
commands via COMMAND_REGISTRY's handler field.
"""

from drsai.backend.gui.commands.dispatcher import CommandDispatcher

__all__ = ["CommandDispatcher"]