"""Slash command handlers for tui_gateway.

Migrates all slash command logic from run_cli.py into RPC-callable handlers.
Each handler is a pure function (session, args) → str | dict that can be
invoked via slash.exec RPC.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from ..server import _ok, _err, method, _emit
from ..adapter.agent_runner import AgentSession
from . import session as session_module  # For _ensure_agent_session

from drsai.backend.cli import commands
from drsai.backend.cli.config import (
    load_config,
    save_config,
    show_config,
    set_workdir_session,
)
from drsai.backend.run_drsai_agent_factory import load_llm_mode_config


# ─────────────────────────────────────────────────────────────────────────────
# Config helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_config_manager(user_id: str) -> dict:
    """Get config dict for user_id. Acts as mutable dict.

    NOTE: mutations are NOT auto-persisted. Use ``save_global_config(cfg)``
    after editing if the change should outlive this session.
    """
    # For now, use global config (per-user config TBD)
    return load_config()


def save_global_config(cfg: dict) -> None:
    """Persist the cli_config.json file."""
    try:
        save_config(cfg)
    except Exception:
        logger.exception("save_config failed")


logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Slash command handler registry
# ─────────────────────────────────────────────────────────────────────────────

class SlashContext:
    """Context passed to each slash command handler."""
    def __init__(self, session: AgentSession | None, args: str):
        self.session = session
        self.args = args.strip()
        self.user_id = session.user_id if session else session_module._resolve_user_id()
        self.session_id = session.session_id if session else ""

    def refresh_info(self) -> None:
        """Re-emit session.info so the UI updates badges/StatusBar after state changes."""
        if self.session is None or not self.session_id:
            return
        try:
            _emit("session.info", self.session_id, self.session.info())
        except Exception:
            logger.exception("session.info refresh failed")


# ── Info / Meta ───────────────────────────────────────────────────────────────

def cmd_help(ctx: SlashContext) -> str:
    """Show available slash commands."""
    return commands.format_help()


def cmd_info(ctx: SlashContext) -> str:
    """Show session configuration, tools and skills."""
    if not ctx.session:
        return "Error: session required for /info command"
    info = ctx.session.info()
    cfg = get_config_manager(ctx.user_id)

    # Skills dir
    skills_path = None
    skills_dir = os.environ.get("SYSTEM_SKILLS_DIR") or cfg.get("skills_dir")
    if skills_dir:
        p = Path(skills_dir)
        if p.exists():
            skills_path = p
    if not skills_path:
        default_skills = Path.home() / ".drsai" / "workspace" / "runs" / ctx.user_id / "configs" / "skills"
        if default_skills.exists():
            skills_path = default_skills

    tool_count = len(info.get("tools", []))
    lines = [
        "",
        f"  Session: {ctx.session_id[:8]}",
        f"  User:    {ctx.user_id}",
        f"  Model:   {info.get('model', '?')}",
        f"  Workdir: {info.get('workdir', str(Path.cwd()))}",
        f"  Tools:   {tool_count}",
    ]
    if skills_path:
        lines.append(f"  Skills:  {skills_path}")
    if info.get("plan_mode"):
        lines.append("  Plan:    enabled")
    if info.get("allow_dangerous_commands"):
        lines.append("  Dangerous commands: allowed")
    return "\n".join(lines)


# ── Configuration ─────────────────────────────────────────────────────────────

def cmd_config(ctx: SlashContext) -> str:
    """Show current connection configuration (sensitive values masked)."""
    cfg = get_config_manager(ctx.user_id)
    from drsai.backend.cli.config import mask_key

    lines = ["", "  Configuration:"]
    sensitive = {"api_key", "anthropic_api_key", "openai_api_key"}
    for key in sorted(cfg.keys()):
        val = cfg[key]
        if val is None or val == "":
            shown = "<unset>"
        elif key in sensitive:
            try:
                shown = mask_key(str(val))
            except Exception:
                shown = "***"
        else:
            shown = str(val)
        lines.append(f"    {key:<28} {shown}")
    return "\n".join(lines)


def cmd_model(ctx: SlashContext) -> dict:
    """Show/switch model (session-local), or open the model editor.

    Subcommands:
        /model                  → show current
        /model <alias>          → switch to alias
        /model info <alias>     → show model details
        /model add [alias]      → open editor for a NEW model
        /model edit [alias]     → open editor; if alias omitted, picker first
        /model rm <alias>       → delete an alias (UI confirms)
    """
    args = ctx.args
    info = ctx.session.info()
    current_model = info.get("model", "?")
    cfg = get_config_manager(ctx.user_id)
    global_default = cfg.get("defult_config_name") or "<default>"

    if not args:
        # Show current
        if current_model != global_default:
            return {
                "output": f"Current model: {current_model} (session-local)\nGlobal default: {global_default}",
            }
        else:
            return {"output": f"Current model: {current_model} (default)"}

    # ── Editor subcommands ────────────────────────────────────────────────
    lower = args.lower()
    first, _, rest = args.partition(" ")
    first_lc = first.lower()
    rest = rest.strip()

    if first_lc == "add":
        return {
            "output": "Opening model editor (new)…",
            "ui_action": "model.add",
            "alias": rest or None,
        }
    if first_lc == "edit":
        return {
            "output": "Opening model editor…",
            "ui_action": "model.edit",
            "alias": rest or None,
        }
    if first_lc in ("rm", "remove", "delete", "del"):
        if not rest:
            return {"output": "Usage: /model rm <alias>"}
        return {
            "output": f"Delete model alias '{rest}'?",
            "ui_action": "model.rm",
            "alias": rest,
        }

    # Handle "info" subcommand
    if lower.startswith("info "):
        model_name = args[5:].strip()
        return _model_info(ctx.user_id, model_name)

    if lower == "info":
        return {"output": "Usage: /model info <alias>"}

    # Validate model alias
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    llm_mode_config = load_llm_mode_config(llm_config_path)
    if args not in llm_mode_config:
        available = ", ".join(sorted(llm_mode_config.keys()))
        return {"output": f"Unknown model alias: {args}\nAvailable aliases: {available}"}

    # Switch model (session-local)
    try:
        ctx.session.switch_model(args)
        ctx.refresh_info()
        return {"output": f"Model switched to {args} (session-local)"}
    except Exception as e:
        logger.exception("switch_model failed")
        return {"output": f"Warning: model switch failed: {e}"}


def cmd_model_global(ctx: SlashContext) -> dict:
    """Switch model for current session AND save as global default."""
    args = ctx.args
    cfg = get_config_manager(ctx.user_id)

    if not args:
        # Show global default
        global_default = cfg.get("defult_config_name") or "<default>"
        return {"output": f"Global default model: {global_default}"}

    # Validate
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    llm_mode_config = load_llm_mode_config(llm_config_path)
    if args not in llm_mode_config:
        available = ", ".join(sorted(llm_mode_config.keys()))
        return {"output": f"Unknown model alias: {args}\nAvailable: {available}"}

    # Switch session + save global
    try:
        ctx.session.switch_model(args)
        cfg["defult_config_name"] = args
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": f"Model switched to {args} (session + global default, saved to disk)"}
    except Exception as e:
        logger.exception("model_global failed")
        return {"output": f"Warning: failed: {e}"}


def cmd_models(ctx: SlashContext) -> str:
    """List all available models with reasoning support."""
    cfg = get_config_manager(ctx.user_id)
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    llm_mode_config = load_llm_mode_config(llm_config_path)

    lines = ["\n  Available models:\n"]
    for alias in sorted(llm_mode_config.keys()):
        entry = llm_mode_config[alias]
        model_name = getattr(entry, "model", alias)
        reasoning = getattr(entry, "reasoning", None)
        reasoning_label = ""
        if reasoning:
            # reasoning might be a ReasoningConfig object, not a dict
            if hasattr(reasoning, "levels"):
                levels = getattr(reasoning, "levels", {})
                if levels:
                    reasoning_label = f" [reasoning: {', '.join(levels.keys())}]"
            elif isinstance(reasoning, dict):
                levels = reasoning.get("levels", {})
                if levels:
                    reasoning_label = f" [reasoning: {', '.join(levels.keys())}]"
        lines.append(f"    {alias:<20} — {model_name}{reasoning_label}")
    return "\n".join(lines)


def _model_info(user_id: str, alias: str) -> dict:
    """Show detailed model information."""
    cfg = get_config_manager(user_id)
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    llm_mode_config = load_llm_mode_config(llm_config_path)

    if alias not in llm_mode_config:
        return {"output": f"Unknown model alias: {alias}"}

    entry = llm_mode_config[alias]
    info_lines = [f"\nModel: {alias}"]
    info_lines.append(f"  Name:        {getattr(entry, 'model', '?')}")
    info_lines.append(f"  Token limit: {getattr(entry, 'token_limit', '?')}")

    reasoning = getattr(entry, "reasoning", {})
    if reasoning:
        info_lines.append("  Reasoning:")
        for level, params in reasoning.get("levels", {}).items():
            budget = params.get("budget", "?")
            info_lines.append(f"    {level}: budget={budget}")

    return {"output": "\n".join(info_lines)}


# ── Display ───────────────────────────────────────────────────────────────────

def cmd_reasoning(ctx: SlashContext) -> dict:
    """Toggle or tune the reasoning box."""
    args = ctx.args.lower()

    if not args:
        # Show status
        state = ctx.session.get_state_value("reasoning_effort") or "off"
        return {"output": f"Reasoning effort: {state}"}

    if args in ("show", "hide", "off"):
        # UI-side toggle; gateway doesn't need to change agent state
        return {"output": f"Reasoning display: {args}", "ui_action": f"reasoning.{args}"}

    if args in ("low", "medium", "high"):
        ctx.session.set_state_value("reasoning_effort", args)
        return {"output": f"Reasoning effort set to {args}"}

    return {"output": "Usage: /reasoning show|hide|off|low|medium|high"}


def cmd_verbose(ctx: SlashContext) -> dict:
    """Toggle the per-turn stats footer."""
    current = ctx.session.get_state_value("verbose", False)
    new = not current
    ctx.session.set_state_value("verbose", new)
    return {"output": f"Verbose mode: {'on' if new else 'off'}", "ui_action": f"verbose.{new}"}


def cmd_bell(ctx: SlashContext) -> dict:
    """Ring the terminal bell when a response finishes."""
    args = ctx.args.lower()
    if not args:
        current = ctx.session.get_state_value("bell", False)
        return {"output": f"Bell: {'on' if current else 'off'}"}

    if args == "on":
        ctx.session.set_state_value("bell", True)
        return {"output": "Bell enabled"}
    elif args == "off":
        ctx.session.set_state_value("bell", False)
        return {"output": "Bell disabled"}
    else:
        return {"output": "Usage: /bell on|off"}


def cmd_fast(ctx: SlashContext) -> dict:
    """Switch to the fastest alias in the llm_mode_config (session-local)."""
    args = ctx.args.lower()

    if not args or args == "on":
        # Find "fast" alias
        cfg = get_config_manager(ctx.user_id)
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)
        if "fast" in llm_mode_config:
            ctx.session.switch_model("fast")
            return {"output": "Fast mode enabled (switched to 'fast' model)"}
        else:
            return {"output": "No 'fast' model alias found in config"}
    elif args == "off":
        # Revert to global default
        cfg = get_config_manager(ctx.user_id)
        default = cfg.get("defult_config_name", "default")
        ctx.session.switch_model(default)
        return {"output": f"Fast mode disabled (switched to '{default}')"}
    else:
        return {"output": "Usage: /fast on|off"}


# ── Session (delegated to session.py) ─────────────────────────────────────────

def cmd_clear(ctx: SlashContext) -> dict:
    """Clear screen and refresh session."""
    return {"output": f"Session: {ctx.session_id[:8]}", "ui_action": "clear"}


def cmd_retry(ctx: SlashContext) -> dict:
    """Retry the last message."""
    # Store retry request in session state for UI to pick up
    return {"output": "Retrying last message…", "ui_action": "retry"}


def cmd_save(ctx: SlashContext) -> str:
    """Save the current conversation (stub; auto-saved)."""
    return f"Session {ctx.session_id[:8]} (auto-saved)"


def cmd_history(ctx: SlashContext) -> dict:
    """Show conversation history (delegate to session.history RPC)."""
    # This should be handled by session.history RPC directly
    return {"output": "Use session.history RPC for full history"}


# ── Plan / Prompt ─────────────────────────────────────────────────────────────

def cmd_plan_mode(ctx: SlashContext) -> dict:
    """Enable/disable plan mode (session-local)."""
    args = ctx.args.lower()

    if not args or args == "status":
        plan_mode = ctx.session.get_state_value("plan_mode", False)
        return {"output": f"Plan mode: {'enabled' if plan_mode else 'disabled'} (session-local)"}

    if args == "on":
        ctx.session.set_state_value("plan_mode", True)
        ctx.refresh_info()
        return {"output": "Plan mode enabled (session-local)"}
    elif args == "off":
        ctx.session.set_state_value("plan_mode", False)
        ctx.refresh_info()
        return {"output": "Plan mode disabled (session-local)"}
    else:
        return {"output": "Usage: /plan_mode on|off|status"}


def cmd_pm_global(ctx: SlashContext) -> dict:
    """Enable/disable plan mode (session + global default)."""
    args = ctx.args.lower()
    cfg = get_config_manager(ctx.user_id)

    if not args or args == "status":
        plan_mode = ctx.session.get_state_value("plan_mode", False)
        global_plan = cfg.get("plan_mode", False)
        return {"output": f"Plan mode: {'enabled' if plan_mode else 'disabled'} (session)\nGlobal: {'enabled' if global_plan else 'disabled'}"}

    if args == "on":
        ctx.session.set_state_value("plan_mode", True)
        cfg["plan_mode"] = True
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Plan mode enabled (session + global, saved)"}
    elif args == "off":
        ctx.session.set_state_value("plan_mode", False)
        cfg["plan_mode"] = False
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Plan mode disabled (session + global, saved)"}
    else:
        return {"output": "Usage: /pm_global on|off|status"}


def cmd_inject(ctx: SlashContext) -> dict:
    """Inject custom prompts into system message."""
    args = ctx.args

    if not args or args == "status":
        prefix = ctx.session.get_state_value("inject_prefix", "")
        suffix = ctx.session.get_state_value("inject_suffix", "")
        lines = ["Injected prompts:"]
        if prefix:
            lines.append(f"  prefix: {prefix[:60]}...")
        if suffix:
            lines.append(f"  suffix: {suffix[:60]}...")
        if not prefix and not suffix:
            lines.append("  (none)")
        return {"output": "\n".join(lines)}

    if args.lower() == "clear":
        ctx.session.set_state_value("inject_prefix", "")
        ctx.session.set_state_value("inject_suffix", "")
        return {"output": "Cleared injected prompts"}

    # Parse "prefix <text>" or "suffix <text>"
    parts = args.split(None, 1)
    if len(parts) < 2:
        return {"output": "Usage: /inject prefix <text>|suffix <text>|clear|status"}

    pos, text = parts[0].lower(), parts[1]
    if pos == "prefix":
        ctx.session.set_state_value("inject_prefix", text)
        return {"output": f"Prefix injected: {text[:60]}..."}
    elif pos == "suffix":
        ctx.session.set_state_value("inject_suffix", text)
        return {"output": f"Suffix injected: {text[:60]}..."}
    else:
        return {"output": "Usage: /inject prefix <text>|suffix <text>|clear|status"}


# ── Project Instructions ──────────────────────────────────────────────────────

def cmd_init(ctx: SlashContext) -> str:
    """Create DRSAI.md project instructions file (Claude Code /init equivalent)."""
    from drsai.backend.cli.drsaimd_loader import init_project_instructions
    try:
        path, is_new = init_project_instructions(str(Path.cwd()))
        header = "Created" if is_new else "Already exists"
        lines = [f"{header}: {path}", ""]
        try:
            content = Path(path).read_text(encoding="utf-8")
            preview = "\n".join(content.splitlines()[:15])
            lines.append("Preview (first 15 lines):")
            lines.append("─" * 60)
            lines.append(preview)
            lines.append("─" * 60)
            if not is_new:
                lines.append("Edit it manually, then run /memory reload to apply.")
        except Exception as exc:
            lines.append(f"(could not read back: {exc})")
        return "\n".join(lines)
    except Exception as e:
        logger.exception("init failed")
        return f"Error: {e}"


def cmd_memory(ctx: SlashContext) -> dict:
    """View/reload project-level instructions (DRSAI.md / CLAUDE.md)."""
    args = ctx.args.lower()

    if not args or args == "status":
        from drsai.backend.cli.drsaimd_loader import get_memory_status
        status = get_memory_status(str(Path.cwd()))
        lines = ["Project instruction files:"]
        org = status.get("org_file")
        if org:
            lines.append(f"  [org]     {org['path']}  ({org['lines']} lines)")
        files = status.get("project_files") or []
        if not files and not org:
            lines.append("  (none found — run /init to create one)")
        else:
            for f in files:
                scope = f.get("scope", "?")
                lines.append(
                    f"  [{scope:<7}] {f['path']}  "
                    f"({f['lines']} lines, {f['size_kb']:.1f} KB)"
                )
        lines.append("")
        lines.append(
            f"Total: {len(files)} project file(s), "
            f"{status.get('total_lines', 0)} lines, "
            f"{status.get('total_size_kb', 0.0):.1f} KB"
        )
        return {"output": "\n".join(lines)}

    if args == "reload":
        from drsai.backend.cli.drsaimd_loader import load_project_instructions
        try:
            content, loaded_paths, warnings = load_project_instructions(str(Path.cwd()))
        except Exception as exc:
            logger.exception("memory reload: load failed")
            return {"output": f"Reload failed: {exc}"}
        if ctx.session is None or ctx.session.agent is None:
            return {"output": "No active session; nothing to reload into."}
        try:
            ctx.session.agent.inject_system_prompt(project_instructions=content)
            ctx.refresh_info()
        except Exception as exc:
            logger.exception("memory reload: inject_system_prompt failed")
            return {"output": f"Reloaded files but agent update failed: {exc}"}
        lines = [f"Reloaded {len(loaded_paths)} project file(s):"]
        for p in loaded_paths:
            lines.append(f"  • {p}")
        for w in warnings:
            lines.append(f"  ⚠ {w}")
        return {"output": "\n".join(lines)}

    if args == "show":
        from drsai.backend.cli.drsaimd_loader import load_project_instructions
        try:
            content, loaded_paths, warnings = load_project_instructions(str(Path.cwd()))
        except Exception as exc:
            return {"output": f"Error: {exc}"}
        if not content:
            return {"output": "No project instructions found (DRSAI.md / CLAUDE.md). Run /init to create one."}
        lines = ["Loaded files:"]
        for p in loaded_paths:
            lines.append(f"  • {p}")
        for w in warnings:
            lines.append(f"  ⚠ {w}")
        lines.append("")
        lines.append("─" * 60)
        lines.append(content)
        lines.append("─" * 60)
        return {"output": "\n".join(lines)}

    return {"output": "Usage: /memory show|reload|status"}


# ── Workspace ─────────────────────────────────────────────────────────────────

def cmd_workspace(ctx: SlashContext) -> dict:
    """Toggle workspace restriction (only_in_workspace) on/off or show status."""
    args = ctx.args.lower()

    if not args or args == "status":
        ws = ctx.session.get_state_value(
            "only_in_workspace",
            ctx.session.info().get("workspace_enabled", False),
        )
        return {"output": f"Workspace restriction: {'enabled' if ws else 'disabled'} (session-local)"}

    if args == "on":
        ctx.session.set_state_value("only_in_workspace", True)
        ctx.refresh_info()
        return {"output": "Workspace restriction enabled (session-local)"}
    elif args == "off":
        ctx.session.set_state_value("only_in_workspace", False)
        ctx.refresh_info()
        return {"output": "Workspace restriction disabled (session-local)"}
    else:
        return {"output": "Usage: /workspace on|off|status"}


def cmd_ws_global(ctx: SlashContext) -> dict:
    """Toggle workspace restriction (session + global default)."""
    args = ctx.args.lower()
    cfg = get_config_manager(ctx.user_id)

    if not args or args == "status":
        ws = ctx.session.get_state_value(
            "only_in_workspace",
            ctx.session.info().get("workspace_enabled", False),
        )
        global_ws = cfg.get("workspace_enabled", cfg.get("only_in_workspace", False))
        return {"output": f"Workspace: {'enabled' if ws else 'disabled'} (session)\nGlobal: {'enabled' if global_ws else 'disabled'}"}

    if args == "on":
        ctx.session.set_state_value("only_in_workspace", True)
        # run_drsai_agent_factory reads workspace_enabled when creating future sessions.
        cfg["workspace_enabled"] = True
        cfg.pop("only_in_workspace", None)  # remove legacy/mismatched key if present
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Workspace restriction enabled (session + global, saved)"}
    elif args == "off":
        ctx.session.set_state_value("only_in_workspace", False)
        # run_drsai_agent_factory reads workspace_enabled when creating future sessions.
        cfg["workspace_enabled"] = False
        cfg.pop("only_in_workspace", None)  # remove legacy/mismatched key if present
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Workspace restriction disabled (session + global, saved)"}
    else:
        return {"output": "Usage: /ws_global on|off|status"}


def cmd_dangerous(ctx: SlashContext) -> dict:
    """Toggle dangerous command execution permission on/off or show status."""
    args = ctx.args.lower()

    if not args or args == "status":
        dg = ctx.session.get_state_value("allow_dangerous_commands", False)
        return {"output": f"Dangerous commands: {'allowed' if dg else 'blocked'} (session-local)"}

    if args == "on":
        ctx.session.set_state_value("allow_dangerous_commands", True)
        ctx.refresh_info()
        return {"output": "Dangerous commands allowed (session-local)"}
    elif args == "off":
        ctx.session.set_state_value("allow_dangerous_commands", False)
        ctx.refresh_info()
        return {"output": "Dangerous commands blocked (session-local)"}
    else:
        return {"output": "Usage: /dangerous on|off|status"}


def cmd_dg_global(ctx: SlashContext) -> dict:
    """Toggle dangerous command permission (session + global default)."""
    args = ctx.args.lower()
    cfg = get_config_manager(ctx.user_id)

    if not args or args == "status":
        dg = ctx.session.get_state_value("allow_dangerous_commands", False)
        global_dg = cfg.get("allow_dangerous_commands", False)
        return {"output": f"Dangerous: {'allowed' if dg else 'blocked'} (session)\nGlobal: {'allowed' if global_dg else 'blocked'}"}

    if args == "on":
        ctx.session.set_state_value("allow_dangerous_commands", True)
        cfg["allow_dangerous_commands"] = True
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Dangerous commands allowed (session + global, saved)"}
    elif args == "off":
        ctx.session.set_state_value("allow_dangerous_commands", False)
        cfg["allow_dangerous_commands"] = False
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Dangerous commands blocked (session + global, saved)"}
    else:
        return {"output": "Usage: /dg_global on|off|status"}


def cmd_cd(ctx: SlashContext) -> str:
    """Switch working directory (Tray GUI only; CLI uses cwd automatically)."""
    # Gateway doesn't change cwd; this is for desktop app
    return "Note: /cd is for desktop app; CLI already uses current directory"


# ── Subagent ──────────────────────────────────────────────────────────────────

def cmd_agent(ctx: SlashContext) -> dict:
    """Set/clear default subagent or list available subagents."""
    args = ctx.args.lower()

    if not args or args == "list":
        # List available subagents
        # TODO: query agent._user_sub_agents
        return {"output": "Available subagents: (feature pending)"}

    if args == "clear":
        ctx.session.set_state_value("default_subagent", "")
        return {"output": "Default subagent cleared"}

    # Set default subagent
    ctx.session.set_state_value("default_subagent", args)
    return {"output": f"Default subagent set to: {args}"}


def cmd_delegate(ctx: SlashContext) -> dict:
    """Manually delegate a task to a subagent."""
    args = ctx.args
    if not args:
        return {"output": "Usage: /delegate <agent_type> <prompt>"}

    parts = args.split(None, 1)
    if len(parts) < 2:
        return {"output": "Usage: /delegate <agent_type> <prompt>"}

    agent_type, prompt_text = parts
    # Emit delegation event for UI to handle
    _emit("subagent.delegate", ctx.session_id, {
        "agent_type": agent_type,
        "prompt": prompt_text,
    })
    return {"output": f"Delegating to {agent_type}…"}


# ── Session management (delegate to session.* RPCs via UI) ───────────────────

def cmd_new(ctx: SlashContext) -> dict:
    """Create a new session. UI side handles the actual session.create RPC."""
    name = ctx.args or None
    return {
        "output": f"Creating new session{' named: ' + name if name else ''}…",
        "ui_action": "session.new",
        "name": name,
    }


def cmd_switch(ctx: SlashContext) -> dict:
    """Switch to another session. UI handles the picker."""
    return {
        "output": "Opening session picker…",
        "ui_action": "session.switch",
        "target": ctx.args or None,
    }


def cmd_list(ctx: SlashContext) -> dict:
    """List sessions (opens picker)."""
    return {
        "output": "Opening session list…",
        "ui_action": "session.list",
    }


def cmd_rename(ctx: SlashContext) -> dict:
    """Rename the current session."""
    if not ctx.args:
        return {"output": "Usage: /rename <new_name>"}
    if not ctx.session:
        return {"output": "Error: no active session"}
    try:
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(ctx.user_id)
        ok = store.rename(ctx.session_id, ctx.args.strip())
        if ok:
            ctx.refresh_info()
            return {"output": f"Renamed to: {ctx.args.strip()}"}
        return {"output": "Rename failed — session not persisted yet"}
    except Exception as e:
        logger.exception("rename failed")
        return {"output": f"Error: {e}"}


def cmd_search(ctx: SlashContext) -> dict:
    """Search past sessions."""
    if not ctx.args:
        return {"output": "Usage: /search <query>"}
    try:
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(ctx.user_id)
        results = store.list(limit=200)
        q = ctx.args.lower()
        hits = [s for s in results if q in (s.name or "").lower()]
        if not hits:
            return {"output": f"No sessions match '{ctx.args}'"}
        lines = [f"Found {len(hits)} session(s):"]
        for s in hits[:20]:
            lines.append(f"  [{s.thread_id[:8]}] {s.name} (msgs={s.message_count})")
        return {"output": "\n".join(lines)}
    except Exception as e:
        logger.exception("search failed")
        return {"output": f"Error: {e}"}


def cmd_resume(ctx: SlashContext) -> dict:
    """Resume a previous session. UI handles session.resume RPC."""
    if not ctx.args:
        return {
            "output": "Opening session picker…",
            "ui_action": "session.switch",
        }
    return {
        "output": f"Resuming session: {ctx.args}",
        "ui_action": "session.switch",
        "target": ctx.args,
    }


def cmd_copy(ctx: SlashContext) -> dict:
    """Copy the n-th-to-last assistant reply (UI-side via OSC 52)."""
    n = 1
    if ctx.args:
        try:
            n = int(ctx.args)
        except ValueError:
            return {"output": f"Usage: /copy [n]  (got: {ctx.args})"}
    return {
        "output": f"Copying last assistant reply #{n} to clipboard…",
        "ui_action": "copy.reply",
        "n": n,
    }


def cmd_status(ctx: SlashContext) -> str:
    """Show agent and session status (compact)."""
    if not ctx.session:
        return "Error: no active session"
    info = ctx.session.info()
    cfg = get_config_manager(ctx.user_id)
    lines = [
        "",
        f"  Session:    {ctx.session_id[:8]}",
        f"  Model:      {info.get('model', '?')}",
        f"  User:       {ctx.user_id}",
        f"  Workdir:    {info.get('workdir', '?')}",
        f"  Tools:      {len(info.get('tools', []))}",
        f"  Plan mode:  {'on' if info.get('plan_mode') else 'off'}",
        f"  Workspace:  {'enforced' if info.get('workspace_enabled') else 'any-path'}",
        f"  Dangerous:  {'allowed' if info.get('allow_dangerous_commands') else 'blocked'}",
    ]
    return "\n".join(lines)


def cmd_setup(ctx: SlashContext) -> str:
    """Setup wizard — point user at CLI command (TUI overlay TBD)."""
    return (
        "Setup wizard is not yet available inside the TUI.\n"
        "Run from shell:  drsai config --show\n"
        "Or edit ~/.drsai/cli_config.json directly."
    )


def cmd_image(ctx: SlashContext) -> str:
    """Fallback handler for /image when not intercepted by TUI frontend.

    The TUI (composerPane.tsx) normally intercepts /image and /img before
    they reach slash.exec.  This handler serves as a safety net when:
      - the user types /image with no image paths
      - the command is invoked from a non-TUI client (CLI REPL, external RPC)
    """
    if ctx.args:
        return (
            "⚠  Could not find any image paths in your input.\n"
            "\n"
            "Usage: /image <path1> [path2...] [description]\n"
            "       /img  <path1> [path2...] [description]\n"
            "\n"
            "Each path must have a supported image extension\n"
            "(.png, .jpg, .jpeg, .gif, .webp, .bmp, .svg).\n"
            "\n"
            "Examples:\n"
            "  /image /tmp/photo.png\n"
            "  /image ./a.png ./b.jpg describe these\n"
            "  /img ~/photo.png what is this?"
        )
    return (
        "Attach one or more images to your prompt.\n"
        "\n"
        "Usage: /image <path1> [path2...] [description]\n"
        "       /img  <path1> [path2...] [description]\n"
        "\n"
        "Examples:\n"
        "  /image /tmp/photo.png\n"
        "  /image ./a.png ./b.jpg describe these\n"
        "  /img ~/photo.png what is this?"
    )



# ─────────────────────────────────────────────────────────────────────────────
# RPC method handlers
# ─────────────────────────────────────────────────────────────────────────────

# Command name → handler function mapping
SLASH_HANDLERS: dict[str, Any] = {
    "help": cmd_help,
    "h": cmd_help,
    "?": cmd_help,
    "info": cmd_info,
    "config": cmd_config,
    "model": cmd_model,
    "m": cmd_model,
    "model_global": cmd_model_global,
    "mg": cmd_model_global,
    "models": cmd_models,
    "listmodels": cmd_models,
    "reasoning": cmd_reasoning,
    "verbose": cmd_verbose,
    "bell": cmd_bell,
    "fast": cmd_fast,
    "clear": cmd_clear,
    "cls": cmd_clear,
    "retry": cmd_retry,
    "save": cmd_save,
    "history": cmd_history,
    "plan_mode": cmd_plan_mode,
    "pm": cmd_plan_mode,
    "pm_global": cmd_pm_global,
    "pmg": cmd_pm_global,
    "inject": cmd_inject,
    "init": cmd_init,
    "memory": cmd_memory,
    "workspace": cmd_workspace,
    "ws": cmd_workspace,
    "ws_global": cmd_ws_global,
    "wsg": cmd_ws_global,
    # Backward-compatible typo aliases that users have typed in the TUI.
    "wg_groble": cmd_ws_global,
    "wg_global": cmd_ws_global,
    "wgg": cmd_ws_global,
    "dangerous": cmd_dangerous,
    "dg": cmd_dangerous,
    "dg_global": cmd_dg_global,
    "dgg": cmd_dg_global,
    "cd": cmd_cd,
    "workdir": cmd_cd,
    "agent": cmd_agent,
    "delegate": cmd_delegate,
    "sub": cmd_delegate,
    # ── Session management ────────────────────────────────────────────────
    "new": cmd_new,
    "switch": cmd_switch,
    "list": cmd_list,
    "ls": cmd_list,
    "rename": cmd_rename,
    "search": cmd_search,
    "resume": cmd_resume,
    "copy": cmd_copy,
    "status": cmd_status,
    "setup": cmd_setup,
    "env": cmd_setup,
    # ── Image (fallback — normally intercepted by TUI frontend) ──────────
    "image": cmd_image,
    "img": cmd_image,
}


@method("slash.exec")
def _slash_exec(rid, params: dict) -> dict:
    """Execute a slash command.

    Args:
        params: {session_id, command, args?}

    Returns:
        {output: str, ui_action?: str, warning?: str}
    """
    command = params.get("command", "").strip().lstrip("/").lower()
    args = params.get("args", "").strip()

    if not command:
        return _err(rid, 4002, "command is required")

    # Get session_id if provided
    session_id = params.get("session_id")
    session = None

    if session_id:
        try:
            # Use the session module's helper to get/ensure agent session
            user_id = session_module._resolve_user_id()
            session = session_module._ensure_agent_session(session_id, user_id)
        except Exception as exc:
            logger.exception("_ensure_agent_session failed")
            return _err(rid, 4001, f"session not found: {exc}")

    handler = SLASH_HANDLERS.get(command)
    if not handler:
        return _err(rid, 4040, f"unknown slash command: {command}")

    try:
        ctx = SlashContext(session, args) if session else SlashContext(None, args)  # type: ignore
        result = handler(ctx)
        if isinstance(result, dict):
            return _ok(rid, result)
        else:
            return _ok(rid, {"output": str(result)})
    except Exception as exc:
        logger.exception(f"slash command failed: {command}")
        return _err(rid, 5033, f"command failed: {type(exc).__name__}: {exc}")


@method("model.options")
def _model_options(rid, params: dict) -> dict:
    """Return list of available models for the UI model picker.

    Returns:
        {
            models: [{alias, model_name, reasoning?: [level, ...]}, ...],
            current: <alias>  # global default
        }
    """
    try:
        cfg = load_config()
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)

        models = []
        for alias in sorted(llm_mode_config.keys()):
            entry = llm_mode_config[alias]
            model_name = str(getattr(entry, "model", alias))
            reasoning_levels: list[str] = []
            reasoning = getattr(entry, "reasoning", None)
            if reasoning:
                if hasattr(reasoning, "levels"):
                    levels = getattr(reasoning, "levels", {})
                    reasoning_levels = list(levels.keys()) if levels else []
                elif isinstance(reasoning, dict):
                    levels = reasoning.get("levels", {})
                    reasoning_levels = list(levels.keys()) if levels else []
            models.append({
                "alias": alias,
                "model_name": model_name,
                "reasoning": reasoning_levels,
                "vision": getattr(entry, "vision", True),
            })

        return _ok(rid, {
            "models": models,
            "current": cfg.get("defult_config_name") or "default",
        })
    except Exception as exc:
        logger.exception("model.options failed")
        return _err(rid, 5034, f"model.options failed: {exc}")


@method("commands.catalog")
def _commands_catalog(rid, params: dict) -> dict:
    """Return the full command registry for UI rendering and completion.

    Returns:
        {
            pairs: [[name, desc], ...],
            categories: {category: [CommandDef, ...]},
            sub: {command: [subcommand, ...]},
            skill_count: int
        }
    """
    pairs = []
    for cmd in commands.COMMAND_REGISTRY:
        desc = cmd.description
        if cmd.aliases:
            desc += f" (alias: {', '.join('/' + a for a in cmd.aliases)})"
        pairs.append([cmd.name, desc])

    categories = commands.commands_by_category()
    # Convert CommandDef to dict for JSON
    categories_dict = {
        cat: [
            {
                "name": c.name,
                "description": c.description,
                "args_hint": c.args_hint,
                "aliases": list(c.aliases),
                "subcommands": list(c.subcommands),
            }
            for c in cmds
        ]
        for cat, cmds in categories.items()
    }

    # Build subcommand map
    sub = {}
    for cmd in commands.COMMAND_REGISTRY:
        if cmd.subcommands:
            sub[cmd.name] = list(cmd.subcommands)

    return _ok(rid, {
        "pairs": pairs,
        "categories": categories_dict,
        "sub": sub,
        "skill_count": 0,  # TODO: query skill manager
    })


@method("complete.slash")
def _complete_slash(rid, params: dict) -> dict:
    """Autocomplete slash commands.

    Args:
        params: {session_id?, prefix}

    Returns:
        {items: [{text, display, meta}, ...]}
    """
    prefix = params.get("prefix", "").lstrip("/").lower()

    items = []
    for cmd in commands.COMMAND_REGISTRY:
        # Match canonical name or aliases
        if cmd.name.startswith(prefix):
            items.append({
                "text": f"/{cmd.name}",
                "display": f"/{cmd.name} {cmd.args_hint}".strip(),
                "meta": cmd.description,
            })
        for alias in cmd.aliases:
            if alias.startswith(prefix):
                items.append({
                    "text": f"/{alias}",
                    "display": f"/{alias} {cmd.args_hint}".strip(),
                    "meta": f"{cmd.description} (alias)",
                })

    return _ok(rid, {"items": items})


@method("complete.path")
def _complete_path(rid, params: dict) -> dict:
    """Autocomplete file paths.

    Args:
        params: {prefix, cwd?}

    Returns:
        {items: [{text, display, meta}, ...]}
    """
    prefix = params.get("prefix", "")
    cwd = params.get("cwd", str(Path.cwd()))

    try:
        p = Path(cwd) / prefix
        parent = p.parent
        if not parent.exists():
            return _ok(rid, {"items": []})

        items = []
        for child in parent.iterdir():
            if child.name.startswith(p.name):
                is_dir = child.is_dir()
                items.append({
                    "text": str(child.relative_to(cwd)),
                    "display": child.name + ("/" if is_dir else ""),
                    "meta": "dir" if is_dir else "file",
                })

        return _ok(rid, {"items": items[:50]})  # limit 50
    except Exception as exc:
        logger.exception("complete.path failed")
        return _ok(rid, {"items": []})


# ─────────────────────────────────────────────────────────────────────────────
# Model catalog mutation
# ─────────────────────────────────────────────────────────────────────────────

# Whitelisted enum values; mirrors the dataclasses in run_drsai_agent_factory.
_VALID_CLIENT_TYPES = frozenset({"auto", "openai", "anthropic"})
_VALID_PARAM_TYPES = frozenset({
    "none", "adaptive", "enabled", "is_r1_model",
    "reasoning_effort", "minimax_format", "zhipu_format",
})


def _validate_alias(alias: str, *, allow_existing: bool, current_aliases) -> str | None:
    """Return an error string if alias is invalid, else None."""
    if not alias or not isinstance(alias, str):
        return "alias is required"
    if any(c.isspace() for c in alias):
        return "alias must not contain whitespace"
    if alias.startswith("_"):
        return "alias must not start with underscore (reserved for YAML metadata)"
    if not (alias[0].isalnum()):
        return "alias must start with a letter or digit"
    if not allow_existing and alias in current_aliases:
        return f"alias '{alias}' already exists; use /model edit instead"
    return None


@method("model.save")
def _model_save(rid, params: dict) -> dict:
    """Create or update a model entry, persisting to the configured YAML.

    Args:
        params: {
            alias: str,
            model: str,                # full model id (e.g. "anthropic/claude-sonnet-4-6")
            token_limit: int,
            max_tokens: int,
            client_type: "auto"|"openai"|"anthropic",
            reasoning: {supported: bool, effort_levels: [str], param_type: str},
            original_alias: str | None,  # set when renaming an existing alias
            is_new: bool,                # true when adding; false when editing
        }

    Returns:
        {ok: true, alias: str, switched_to: str|None}
        or {ok: false, error: str}  (with HTTP-style 4xx code on validation)
    """
    from drsai.backend.run_drsai_agent_factory import (
        load_llm_mode_config,
        save_llm_mode_config,
        ModelEntry,
        ReasoningConfig,
    )

    try:
        alias = str(params.get("alias", "")).strip()
        model_id = str(params.get("model", "")).strip()
        token_limit = int(params.get("token_limit", 128000))
        max_tokens = int(params.get("max_tokens", 0))
        client_type = str(params.get("client_type", "auto")).strip().lower()
        reasoning_raw = params.get("reasoning") or {}
        original_alias = (params.get("original_alias") or "").strip() or None
        is_new = bool(params.get("is_new", False))
    except (TypeError, ValueError) as exc:
        return _err(rid, 4001, f"invalid payload: {exc}")

    cfg = load_config()
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    try:
        catalog = load_llm_mode_config(llm_config_path)
    except Exception as exc:
        logger.exception("model.save: load failed")
        return _err(rid, 5001, f"failed to load model catalog: {exc}")

    # ── Validation ────────────────────────────────────────────────────────
    if not model_id:
        return _err(rid, 4002, "model is required")
    if client_type not in _VALID_CLIENT_TYPES:
        return _err(rid, 4003, f"client_type must be one of: {sorted(_VALID_CLIENT_TYPES)}")
    if token_limit < 0 or max_tokens < 0:
        return _err(rid, 4004, "token_limit and max_tokens must be non-negative")

    supported = bool(reasoning_raw.get("supported", False))
    effort_levels_raw = reasoning_raw.get("effort_levels") or []
    if isinstance(effort_levels_raw, str):
        effort_levels = [s.strip() for s in effort_levels_raw.split(",") if s.strip()]
    else:
        effort_levels = [str(s).strip() for s in effort_levels_raw if str(s).strip()]
    param_type = str(reasoning_raw.get("param_type", "none")).strip().lower() or "none"
    if supported and param_type not in _VALID_PARAM_TYPES:
        return _err(rid, 4005, f"reasoning.param_type must be one of: {sorted(_VALID_PARAM_TYPES)}")
    if not supported:
        # Normalise the disabled state for clean YAML output.
        effort_levels = []
        param_type = "none"

    # When renaming, treat the new alias as "new" relative to the catalog
    # MINUS the old alias.
    existing_aliases = set(catalog.keys())
    if original_alias and original_alias != alias:
        existing_aliases.discard(original_alias)
        is_new_for_validation = True
    else:
        is_new_for_validation = is_new

    err = _validate_alias(alias, allow_existing=not is_new_for_validation,
                          current_aliases=existing_aliases)
    if err:
        return _err(rid, 4006, err)

    if not is_new and alias not in catalog and not original_alias:
        return _err(rid, 4007, f"alias '{alias}' not found; pass is_new=true to create")

    vision = bool(params.get("vision", True))

    entry = ModelEntry(
        model=model_id,
        token_limit=token_limit,
        max_tokens=max_tokens,
        client_type=client_type,
        reasoning=ReasoningConfig(
            supported=supported,
            effort_levels=effort_levels,
            param_type=param_type,
        ),
        vision=vision,
    )

    # Drop the old alias on rename.
    if original_alias and original_alias != alias and original_alias in catalog:
        catalog.pop(original_alias, None)

    catalog[alias] = entry

    default_alias = cfg.get("defult_config_name") or alias
    if default_alias not in catalog:
        # If we just renamed the default away, fall back to the new alias.
        default_alias = alias
        cfg["defult_config_name"] = alias
        save_global_config(cfg)

    try:
        save_llm_mode_config(catalog, default_alias)
    except Exception as exc:
        logger.exception("model.save: write failed")
        return _err(rid, 5002, f"failed to write catalog: {exc}")

    # ── Auto-switch the active session to the new alias ──────────────────
    switched_to = None
    session_id = params.get("session_id")
    if is_new and session_id:
        try:
            user_id = session_module._resolve_user_id()
            session = session_module._ensure_agent_session(session_id, user_id)
            if session is not None:
                session.switch_model(alias)
                _emit("session.info", session_id, session.info())
                switched_to = alias
        except Exception:
            logger.exception("model.save: auto-switch failed")

    return _ok(rid, {
        "ok": True,
        "alias": alias,
        "is_new": is_new or bool(original_alias and original_alias != alias),
        "switched_to": switched_to,
    })


@method("model.delete")
def _model_delete(rid, params: dict) -> dict:
    """Delete a model alias from the catalog.

    Args:
        params: {alias: str, session_id?: str}

    Returns:
        {ok: true, fell_back_to: str|None}
        or {ok: false, error: str}
    """
    from drsai.backend.run_drsai_agent_factory import (
        load_llm_mode_config,
        save_llm_mode_config,
    )

    alias = str(params.get("alias", "")).strip()
    if not alias:
        return _err(rid, 4002, "alias is required")

    cfg = load_config()
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    try:
        catalog = load_llm_mode_config(llm_config_path)
    except Exception as exc:
        logger.exception("model.delete: load failed")
        return _err(rid, 5001, f"failed to load model catalog: {exc}")

    if alias not in catalog:
        return _err(rid, 4040, f"alias '{alias}' not found")
    if len(catalog) <= 1:
        return _err(rid, 4009, "cannot delete the last remaining model alias")

    catalog.pop(alias, None)
    default_alias = cfg.get("defult_config_name") or next(iter(catalog))
    fell_back_to = None
    if default_alias not in catalog:
        # The deleted alias was the global default — fall back to first.
        fell_back_to = next(iter(catalog))
        cfg["defult_config_name"] = fell_back_to
        save_global_config(cfg)
        default_alias = fell_back_to

    try:
        save_llm_mode_config(catalog, default_alias)
    except Exception as exc:
        logger.exception("model.delete: write failed")
        return _err(rid, 5002, f"failed to write catalog: {exc}")

    # If the deleted alias was the active session's model, switch to fallback.
    session_id = params.get("session_id")
    if session_id:
        try:
            user_id = session_module._resolve_user_id()
            session = session_module._ensure_agent_session(session_id, user_id)
            if session is not None:
                info = session.info()
                current_alias = info.get("model")
                if current_alias == alias:
                    target = fell_back_to or next(iter(catalog))
                    session.switch_model(target)
                    _emit("session.info", session_id, session.info())
                    fell_back_to = target
        except Exception:
            logger.exception("model.delete: post-delete switch failed")

    return _ok(rid, {"ok": True, "fell_back_to": fell_back_to})


@method("model.get")
def _model_get(rid, params: dict) -> dict:
    """Return the full ModelEntry for an alias (used to pre-fill the editor).

    Args:
        params: {alias: str}

    Returns:
        {alias, model, token_limit, max_tokens, client_type,
         reasoning: {supported, effort_levels, param_type}}
    """
    from drsai.backend.run_drsai_agent_factory import load_llm_mode_config

    alias = str(params.get("alias", "")).strip()
    if not alias:
        return _err(rid, 4002, "alias is required")

    cfg = load_config()
    llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
    try:
        catalog = load_llm_mode_config(llm_config_path)
    except Exception as exc:
        logger.exception("model.get: load failed")
        return _err(rid, 5001, f"failed to load model catalog: {exc}")

    entry = catalog.get(alias)
    if entry is None:
        return _err(rid, 4040, f"alias '{alias}' not found")

    return _ok(rid, {
        "alias": alias,
        "model": entry.model,
        "token_limit": entry.token_limit,
        "max_tokens": entry.max_tokens,
        "client_type": entry.client_type,
        "reasoning": {
            "supported": entry.reasoning.supported,
            "effort_levels": list(entry.reasoning.effort_levels),
            "param_type": entry.reasoning.param_type,
        },
    })
