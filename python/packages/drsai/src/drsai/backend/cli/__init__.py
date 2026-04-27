"""DrSai CLI package.

Modules:
    commands  - Slash command registry (CommandDef, resolve_command, format_help)
    config    - Config and session persistence with sensitive-value masking
    status    - Status display (show_status, show_quick_status)
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
]
