"""Slash command definitions and autocomplete for the DrSai CLI.

Central registry for all slash commands. Every consumer -- CLI help, REPL
dispatch, autocomplete -- derives its data from ``COMMAND_REGISTRY``.

To add a command: add a ``CommandDef`` entry to ``COMMAND_REGISTRY``.
To add an alias: set ``aliases=("short",)`` on the existing ``CommandDef``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class CommandDef:
    """Definition of a single slash command."""

    name: str                          # canonical name without slash: "background"
    description: str                   # human-readable description
    category: str                      # "Session", "Configuration", etc.
    aliases: tuple[str, ...] = ()      # alternative names: ("bg",)
    args_hint: str = ""                # argument placeholder: "<prompt>", "[name]"
    subcommands: tuple[str, ...] = ()  # tab-completable subcommands
    cli_only: bool = False             # only available in CLI REPL
    gateway_only: bool = False         # only available in gateway/messaging
    gateway_config_gate: Optional[str] = None  # config dotpath; when truthy, overrides cli_only for gateway


# ─────────────────────────────────────────────────────────────────────────────
# Central registry -- single source of truth
# ─────────────────────────────────────────────────────────────────────────────

COMMAND_REGISTRY: list[CommandDef] = [
    # ── Session ───────────────────────────────────────────────────────────────
    CommandDef(
        "new",
        "Create a new session",
        "Session",
        args_hint="[name]",
    ),
    CommandDef(
        "switch",
        "Switch to another session",
        "Session",
        args_hint="<id|name>",
    ),
    CommandDef(
        "list",
        "List all saved sessions",
        "Session",
        aliases=("ls",),
    ),
    CommandDef(
        "rename",
        "Rename the current session",
        "Session",
        args_hint="<name>",
    ),
    CommandDef(
        "clear",
        "Clear screen and start a new session",
        "Session",
        aliases=("cls",),
    ),
    CommandDef(
        "history",
        "Show conversation history",
        "Session",
        cli_only=True,
    ),
    CommandDef(
        "save",
        "Save the current conversation",
        "Session",
        cli_only=True,
    ),
    CommandDef(
        "retry",
        "Retry the last message",
        "Session",
    ),
    CommandDef(
        "resume",
        "Resume a previous session (replays history into the agent)",
        "Session",
        args_hint="<id|name>",
    ),
    CommandDef(
        "search",
        "Search your past sessions (substring, case-insensitive)",
        "Session",
        args_hint="<query>",
    ),
    CommandDef(
        "copy",
        "Copy the n-th-to-last assistant reply to the clipboard",
        "Session",
        args_hint="[n]",
    ),

    # ── Display / runtime ────────────────────────────────────────────────────
    CommandDef(
        "reasoning",
        "Toggle or tune the reasoning box",
        "Display",
        args_hint="show|hide|off|low|medium|high",
    ),
    CommandDef(
        "verbose",
        "Toggle the per-turn stats footer",
        "Display",
    ),
    CommandDef(
        "bell",
        "Ring the terminal bell when a response finishes",
        "Display",
        args_hint="on|off",
    ),
    CommandDef(
        "fast",
        "Switch to the fastest alias in the llm_mode_config",
        "Display",
        args_hint="on|off",
    ),

    # ── Configuration ─────────────────────────────────────────────────────────
    CommandDef(
        "config",
        "Show current connection configuration",
        "Configuration",
        cli_only=True,
    ),
    CommandDef(
        "model",
        "Show/switch model or show model details: /model [name|info]",
        "Configuration",
        args_hint="[name|info]",
        aliases=("m",),
    ),
    CommandDef(
        "models",
        "List all available models with reasoning support",
        "Configuration",
        aliases=("listmodels",),
        cli_only=True,
    ),
    CommandDef(
        "status",
        "Show agent and session status",
        "Info",
    ),
    CommandDef(
        "info",
        "Show session configuration, tools and skills",
        "Info",
        cli_only=True,
    ),

    # ── Plan / Prompt ────────────────────────────────────────────────────────
    CommandDef(
        "plan_mode",
        "Enable/disable plan mode (AI interviews you before acting)",
        "Plan",
        aliases=("pm",),
        args_hint="on|off|status",
    ),
    CommandDef(
        "inject",
        "Inject custom prompts into system message",
        "Plan",
        args_hint="prefix|suffix|clear|status",
    ),

    # ── Meta ─────────────────────────────────────────────────────────────────
    CommandDef(
        "help",
        "Show this help",
        "Info",
        aliases=("h", "?"),
    ),
    CommandDef(
        "quit",
        "Save and exit",
        "Info",
        aliases=("exit", "q"),
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# Lookup helpers
# ─────────────────────────────────────────────────────────────────────────────

def resolve_command(name: str) -> Optional[CommandDef]:
    """Resolve a command name (or alias) to its CommandDef.

    Args:
        name: command string, with or without leading slash, case-insensitive

    Returns:
        CommandDef if found, None otherwise
    """
    name = name.lstrip("/").lower()
    for cmd in COMMAND_REGISTRY:
        if cmd.name == name or name in cmd.aliases:
            return cmd
    return None


def commands_by_category() -> dict[str, list[CommandDef]]:
    """Return commands grouped by category, in fixed category order."""
    order = ["Session", "Display", "Configuration", "Plan", "Info"]
    groups: dict[str, list[CommandDef]] = {cat: [] for cat in order}
    for cmd in COMMAND_REGISTRY:
        if cmd.category in groups:
            groups[cmd.category].append(cmd)
    return groups


def format_help() -> str:
    """Return a formatted help string organized by category."""
    lines = ["", "  Available commands:", ""]
    for cat, cmds in commands_by_category().items():
        if not cmds:
            continue
        lines.append(f"  {cat}:")
        for cmd in cmds:
            hint = f" {cmd.args_hint}" if cmd.args_hint else ""
            alias_part = "".join(f" (alias: /{a})" for a in cmd.aliases)
            lines.append(f"    /{cmd.name}{hint:<22} — {cmd.description}{alias_part}")
        lines.append("")
    return "\n".join(lines)
