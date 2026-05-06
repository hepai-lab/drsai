"""DrSai CLI package.

Modules:
    commands  - Slash command registry (CommandDef, resolve_command, format_help)
    config    - Config and session persistence with sensitive-value masking
    status    - Status display (show_status, show_quick_status)
    display   - Hermes-style display: KawaiiSpinner, tool previews, diff rendering
    interrupt - Thread-level interrupt signaling for concurrent sessions
    callbacks - Interactive prompts: clarify, approval, secret input
    curses_ui - Curses UI components for terminal interactions
"""

from drsai.backend.cli.commands import (
    COMMAND_REGISTRY,
    resolve_command,
    format_help,
    commands_by_category,
)
from drsai.backend.cli.config import (
    CLI_CONFIG_PATH,
    CLI_SESSIONS_PATH,
    DEFAULT_CONFIG,
    load_config,
    save_config,
    load_sessions,
    save_sessions,
    show_config,
    mask_key,
    config_as_dict_for_export,
)
from drsai.backend.cli.status import show_status, show_quick_status

# Hermes-style TUI modules (optional - may fail in minimal environments)
try:
    from drsai.backend.cli.display import (
        build_tool_preview,
        get_cute_tool_message,
        KawaiiSpinner,
        LocalEditSnapshot,
        capture_local_edit_snapshot,
        render_edit_diff_with_delta,
        set_tool_preview_max_len,
        get_tool_preview_max_len,
    )
    HAS_TUI_DISPLAY = True
except ImportError:
    HAS_TUI_DISPLAY = False

try:
    from drsai.backend.cli.interrupt import (
        set_interrupt,
        is_interrupted,
        clear_interrupt,
        get_current_thread_id,
        InterruptScope,
    )
    HAS_TUI_INTERRUPT = True
except ImportError:
    HAS_TUI_INTERRUPT = False

try:
    from drsai.backend.cli.callbacks import (
        CallbackState,
        get_callback_state,
        clarify_callback,
        approval_callback,
        prompt_for_secret,
        submit_clarify_response,
        submit_approval_response,
        submit_secret_response,
        is_dangerous_command,
    )
    HAS_TUI_CALLBACKS = True
except ImportError:
    HAS_TUI_CALLBACKS = False

try:
    from drsai.backend.cli.curses_ui import (
        curses_checklist,
        curses_radiolist,
        curses_single_select,
        Colors,
        color,
        flush_stdin,
    )
    HAS_TUI_CURSES = True
except ImportError:
    HAS_TUI_CURSES = False


__all__ = [
    # commands
    "COMMAND_REGISTRY",
    "resolve_command",
    "format_help",
    "commands_by_category",
    # config
    "CLI_CONFIG_PATH",
    "CLI_SESSIONS_PATH",
    "DEFAULT_CONFIG",
    "load_config",
    "save_config",
    "load_sessions",
    "save_sessions",
    "show_config",
    "mask_key",
    "config_as_dict_for_export",
    # status
    "show_status",
    "show_quick_status",
    # Hermes-style TUI (optional)
    "HAS_TUI_DISPLAY",
    "HAS_TUI_INTERRUPT",
    "HAS_TUI_CALLBACKS",
    "HAS_TUI_CURSES",
]
