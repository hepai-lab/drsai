"""Slash command handlers for tui_gateway.

Migrates all slash command logic from run_cli.py into RPC-callable handlers.
Each handler is a pure function (session, args) → str | dict that can be
invoked via slash.exec RPC.
"""

from __future__ import annotations

import logging
import asyncio
import os
import threading
import time
from pathlib import Path
from typing import Any

from ..server import _ok, _err, method, _emit, _get_db_manager
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
from drsai.config import (
    ConfigError as ModelProviderConfigError,
    ConfigUpdateRequest,
    ProviderDraft,
    commit_update,
    config_revision,
    load_user_config,
    resolve_model_config,
    builtin_provider_names,
    discover_provider_models,
    list_provider_presets,
    probe_provider_draft,
    test_provider_connection,
)


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

    # Compact TOML Providers accept any model ID. Legacy mode continues to
    # validate aliases against llm_mode_config.yaml.
    compact = load_user_config()
    compact_active = bool(compact.model or compact.model_provider or compact.providers)
    if not compact_active:
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)
        if args not in llm_mode_config:
            available = ", ".join(sorted(llm_mode_config.keys()))
            return {"output": f"Unknown model alias: {args}\nAvailable aliases: {available}"}

    # Switch model (session-local)
    try:
        if not ctx.session.switch_model(args):
            return {"output": f"Warning: model switch to {args} failed; the previous model is still active"}
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

    compact = load_user_config()
    compact_active = bool(compact.model or compact.model_provider or compact.providers)
    if not compact_active:
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)
        if args not in llm_mode_config:
            available = ", ".join(sorted(llm_mode_config.keys()))
            return {"output": f"Unknown model alias: {args}\nAvailable: {available}"}

    # Switch session + save global
    try:
        if not ctx.session.switch_model(args):
            return {"output": f"Warning: model switch to {args} failed; global configuration was not changed"}
        # TUI bypasses the retired global model-selection guard by always
        # saving the global default through the YAML config path
        # (defult_config_name), never through commit_update's removed
        # model/model_provider fields.
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

    if args in ("low", "medium", "high", "xhigh"):
        ctx.session.set_state_value("reasoning_effort", args)
        return {"output": f"Reasoning effort set to {args}"}

    return {"output": "Usage: /reasoning show|hide|off|low|medium|high|xhigh"}


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
    """Show conversation history.
    
    Usage:
        /history       — show last 10 messages
        /history N     — show last N messages
        /history all   — show all messages
    """
    if not ctx.session:
        return {"output": "Error: no active session"}
    
    try:
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(_get_db_manager(), ctx.user_id)
        messages = store.load(ctx.session_id)
        
        # Parse limit
        limit = 10  # default
        if ctx.args:
            arg = ctx.args.strip().lower()
            if arg == "all":
                limit = None
            else:
                try:
                    limit = int(arg)
                except ValueError:
                    return {"output": f"Invalid argument: {ctx.args}\nUsage: /history [N|all]"}
        
        if limit is not None and limit > 0:
            messages = messages[-limit:]
        
        if not messages:
            return {"output": "No messages in this session"}
        
        # Format messages for display
        lines = ["", f"  Conversation history ({len(messages)} messages):"]
        lines.append("  " + "─" * 60)
        
        for i, msg in enumerate(messages, 1):
            role = msg.get("role", msg.get("source", "unknown"))
            content = msg.get("content", "")
            
            # Handle content that might be a list or dict
            if isinstance(content, list):
                content = str(content)
            elif isinstance(content, dict):
                content = str(content)
            
            # Truncate long messages
            if len(content) > 200:
                content = content[:197] + "..."
            
            lines.append(f"  [{i}] {role.upper()}: {content}")
            lines.append("")
        
        return {"output": "\n".join(lines)}
        
    except Exception as exc:
        logger.exception("cmd_history failed")
        return {"output": f"Error loading history: {type(exc).__name__}: {exc}"}


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


# ── Memory Compression ────────────────────────────────────────────────────────

def cmd_compress(ctx: SlashContext) -> dict:
    """Manually compress conversation memory via LLM summarization.

    Usage:
        /compress              — compress with default keep_recent=6
        /compress keep_recent=N — keep the last N messages, compress the rest
        /compress status       — show current token usage and compression eligibility
    """
    if not ctx.session or not ctx.session.agent:
        return {"output": "Error: no active session"}

    agent = ctx.session.agent
    context = getattr(agent, "_model_context", None)
    if context is None:
        return {"output": "Error: no model context available"}

    # Handle status subcommand
    args = ctx.args.strip().lower()
    if args == "status":
        token_count = getattr(context, "_token_count", 0)
        token_limit = getattr(context, "_token_limit", None)
        msg_count = len(getattr(context, "_messages", []))
        has_compress = hasattr(context, "manual_compress")
        lines = [
            "Memory compression status:",
            f"  Messages in context: {msg_count}",
            f"  Token count:         {token_count}",
            f"  Token limit:         {token_limit or '(unlimited)'}",
            f"  Compression support: {'✅ yes' if has_compress else '❌ no'}",
        ]
        if token_limit:
            pct = (token_count / token_limit) * 100
            lines.append(f"  Usage:               {pct:.1f}%")
            if pct > 80:
                lines.append("  ⚠️  Approaching limit — consider running /compress")
        return {"output": "\n".join(lines)}

    # Check if context supports manual compression
    if not hasattr(context, "manual_compress"):
        context_type = getattr(agent, "_context_type", "?")
        return {"output": f"Error: context type '{context_type}' does not support compression. Only SQLite context supports this feature."}

    # Parse keep_recent argument
    keep_recent = 6  # default
    if args:
        try:
            if args.startswith("keep_recent="):
                keep_recent = int(args.split("=")[1])
            elif args.isdigit():
                keep_recent = int(args)
            else:
                return {"output": f"Invalid argument: {ctx.args}\nUsage: /compress [keep_recent=N|status]"}
        except ValueError:
            return {"output": f"Invalid keep_recent value: {ctx.args}\nUsage: /compress [keep_recent=N|status]"}

    if keep_recent < 1:
        return {"output": "Error: keep_recent must be at least 1"}

    # ── Spinner: emit rotating status frames while compression runs ──
    # The compression involves an LLM call that can take 10–60 seconds.
    # We run a lightweight background thread that pushes ``status.update``
    # events every 100ms so the TUI status bar shows a live spinner.
    _SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    stop_spinner = threading.Event()

    def _spinner_loop():
        idx = 0
        while not stop_spinner.is_set():
            glyph = _SPINNER_FRAMES[idx % len(_SPINNER_FRAMES)]
            _emit("status.update", ctx.session_id, {
                "kind": "compress",
                "text": f"{glyph} 正在压缩记忆 (保留最近 {keep_recent} 条)…",
            })
            idx += 1
            stop_spinner.wait(0.1)  # 100ms per frame

    spinner_thread = threading.Thread(target=_spinner_loop, daemon=True)
    spinner_thread.start()

    # Run compression on the agent's event loop (it's async)
    from ..adapter.agent_runner import _run_coro
    try:
        result = _run_coro(
            ctx.session._loop,
            context.manual_compress(keep_recent=keep_recent),
            timeout=120.0,
        )
    except TimeoutError:
        stop_spinner.set()
        _emit("status.update", ctx.session_id, {"kind": "compress", "text": ""})
        return {"output": "Error: compression timed out (120s). The model may be slow — try again."}
    except Exception as e:
        stop_spinner.set()
        _emit("status.update", ctx.session_id, {"kind": "compress", "text": ""})
        logger.exception("compress command failed")
        return {"output": f"Compression failed: {type(e).__name__}: {e}"}
    finally:
        stop_spinner.set()
        spinner_thread.join(timeout=1.0)

    # Clear the spinner from the status bar
    _emit("status.update", ctx.session_id, {"kind": "compress", "text": ""})

    # Format result
    compressed_n = result.get("compressed_count", 0)
    if compressed_n == 0:
        return {"output": f"Nothing to compress (only {result.get('total_count', 0)} messages, keep_recent={keep_recent})."}

    token_before = result.get("token_before", 0)
    token_after = result.get("token_after", 0)
    saved = token_before - token_after
    saved_pct = (saved / token_before * 100) if token_before > 0 else 0

    lines = [
        "✅ Memory compressed successfully!",
        f"  Messages:  {result.get('total_count', 0)} → {result.get('kept_count', 0)} (compressed {compressed_n})",
        f"  Tokens:    {token_before} → {token_after} (saved {saved}, {saved_pct:.1f}%)",
    ]
    preview = result.get("summary_preview", "")
    if preview:
        lines.append("")
        lines.append("  Summary preview:")
        lines.append(f"  {preview}{'…' if len(preview) >= 200 else ''}")

    return {"output": "\n".join(lines)}


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
    """Toggle dangerous command permission (session + global default).

    Persistence key normalisation (was the cause of "off then restart still
    any-cmd"):
      - ``run_drsai_agent_factory`` reads ``cli_cfg.get("dangerous_allowed")``
        on every cold start. That is the SOURCE OF TRUTH for the next
        process.
      - This handler USED to write ``cfg["allow_dangerous_commands"]``,
        which the factory ignored. So /dg_global off was a no-op across
        restarts.
      - We now write ``cfg["dangerous_allowed"]`` to match what the
        factory reads, and drop the legacy ``allow_dangerous_commands``
        key if it's lingering in the user's config.
      - The session-state key ``allow_dangerous_commands`` is kept (that
        is what ``session.info()`` surfaces, and what the AgentRunner's
        set_state_value applies to the live closure). That is in-memory
        and does not need to match the on-disk key.
    """
    args = ctx.args.lower()
    cfg = get_config_manager(ctx.user_id)

    if not args or args == "status":
        dg = ctx.session.get_state_value("allow_dangerous_commands", False)
        # Read both for back-compat with older configs; prefer the factory key.
        global_dg = cfg.get("dangerous_allowed", cfg.get("allow_dangerous_commands", False))
        return {"output": f"Dangerous: {'allowed' if dg else 'blocked'} (session)\nGlobal: {'allowed' if global_dg else 'blocked'}"}

    if args == "on":
        ctx.session.set_state_value("allow_dangerous_commands", True)
        cfg["dangerous_allowed"] = True
        cfg.pop("allow_dangerous_commands", None)  # remove legacy/mismatched key if present
        save_global_config(cfg)
        ctx.refresh_info()
        return {"output": "Dangerous commands allowed (session + global, saved)"}
    elif args == "off":
        ctx.session.set_state_value("allow_dangerous_commands", False)
        cfg["dangerous_allowed"] = False
        cfg.pop("allow_dangerous_commands", None)  # remove legacy/mismatched key if present
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

def _get_fresh_sub_agents(ctx: SlashContext) -> dict:
    """Return up-to-date _user_sub_agents, forcing a reload from SUBAGENT_CONFIG.json.

    _user_sub_agents is only populated by _run_startup_checks() which runs inside
    on_messages_stream(). Slash commands bypass that path, so we call
    update_user_subagents() directly here to ensure SUBAGENT_CONFIG.json is
    reflected without needing to send a message first.
    """
    agent = getattr(ctx.session, "agent", None)
    if agent is None:
        return {}
    update_fn = getattr(agent, "update_user_subagents", None)
    if update_fn is not None:
        try:
            update_fn()
        except Exception:
            logger.exception("cmd_agent: update_user_subagents failed")
    return getattr(agent, "_user_sub_agents", {})


def cmd_agent(ctx: SlashContext) -> dict:
    """Set/clear default subagent or list available subagents."""
    args = ctx.args.strip()
    args_lower = args.lower()

    if not args:
        # No args → open interactive agent picker
        return {"output": "", "ui_action": "agent.picker"}

    if args_lower == "list":
        sub_agents = _get_fresh_sub_agents(ctx)
        if sub_agents:
            lines = [f"- {name}: {cfg.get('description', '')}" for name, cfg in sub_agents.items()]
            output = "Available subagents:\n" + "\n".join(lines)
        else:
            output = "Available subagents: (none configured)"
        return {"output": output}

    if args_lower == "clear":
        ctx.session.set_state_value("default_subagent", "")
        ctx.refresh_info()
        return {"output": "Default subagent cleared"}

    # Force reload so newly added agents in SUBAGENT_CONFIG.json are visible
    sub_agents = _get_fresh_sub_agents(ctx)

    # Case-insensitive match to preserve original casing (e.g. RongZai_Agent)
    matched_name = next(
        (name for name in sub_agents if name.lower() == args_lower),
        args,  # fallback: pass as-is, on_messages_stream will validate
    )

    if matched_name not in sub_agents:
        available = ", ".join(sub_agents.keys()) or "none"
        return {"output": f"Subagent '{matched_name}' not found. Available: {available}"}

    ctx.session.set_state_value("default_subagent", matched_name)
    ctx.refresh_info()
    return {"output": f"Default subagent set to: {matched_name}"}


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


def cmd_max_concurrent(ctx: SlashContext) -> dict:
    """Set max parallel subagent count or show current value (global, saved)."""
    args = ctx.args.strip()
    cfg = get_config_manager(ctx.user_id)

    if not args or args.lower() == "status":
        current = (
            getattr(getattr(ctx.session, "agent", None), "_max_agent_concurrent", None)
            if ctx.session else None
        )
        global_val = cfg.get("max_agent_concurrent", 5)
        lines = [f"Max subagent concurrency: {current if current is not None else global_val}"]
        if ctx.session and current is not None:
            lines.append(f"Global default (cli_config.json): {global_val}")
        return {"output": "\n".join(lines)}

    try:
        value = int(args)
    except ValueError:
        return {"output": f"Invalid value: '{args}'. Usage: /max_concurrent <1-256>"}

    if value < 1:
        value = 1
    elif value > 256:
        value = 256

    # Apply to current session agent
    if ctx.session and hasattr(ctx.session, "agent") and ctx.session.agent:
        if hasattr(ctx.session.agent, "_max_agent_concurrent"):
            ctx.session.agent._max_agent_concurrent = value

    # Save globally
    cfg["max_agent_concurrent"] = value
    save_global_config(cfg)
    ctx.refresh_info()

    return {"output": f"Max subagent concurrency set to {value} (global, saved)"}


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
    """List sessions (opens picker).
    
    Usage:
        /list          — list sessions in current workdir only
        /list --all    — list all sessions across all workdirs
    """
    show_all = ctx.args.strip() == "--all"
    
    return {
        "output": f"Opening session list{'…' if not show_all else ' (all workdirs)…'}",
        "ui_action": "session.list",
        "workdir_filter": None if show_all else str(Path.cwd().resolve()),
    }


def cmd_rename(ctx: SlashContext) -> dict:
    """Rename the current session."""
    if not ctx.args:
        return {"output": "Usage: /rename <new_name>"}
    if not ctx.session:
        return {"output": "Error: no active session"}
    try:
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(_get_db_manager(), ctx.user_id)
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
        store = CLISessionStore(_get_db_manager(), ctx.user_id)
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


def cmd_find(ctx: SlashContext) -> dict:
    """Natural language search for sessions (semantic + keyword hybrid).

    Usage:
        /find <natural language query>
        /find --cwd <query>  (restrict to current workdir)
    """
    if not ctx.args:
        return {"output": "Usage: /find <query>  — natural language session search\n       /find --cwd <query>  — search in current workdir only"}
    try:
        from drsai.backend.cli.history import CLISessionStore
        store = CLISessionStore(_get_db_manager(), ctx.user_id)

        # Parse --cwd flag
        workdir = None
        query = ctx.args
        if query.startswith("--cwd "):
            workdir = str(Path.cwd().resolve())
            query = query[6:].strip()
        elif " --cwd" in query:
            query = query.replace(" --cwd", "").strip()
            workdir = str(Path.cwd().resolve())

        results = store.smart_search(query, limit=10, workdir=workdir)
        if not results:
            return {"output": f"No sessions match '{query}'"}

        lines = [f"Found {len(results)} session(s):"]
        for s in results[:10]:
            score = getattr(s, 'relevance_score', 0)
            tags_str = ' '.join(f'#{t}' for t in (getattr(s, 'tags', []) or [])) if getattr(s, 'tags', None) else ''
            pin_str = ' 📌' if getattr(s, 'pinned', False) else ''
            lines.append(f"  [{s.thread_id[:8]}] {s.name} (msgs={s.message_count}, score={score:.2f}){pin_str} {tags_str}")
            if s.preview:
                lines.append(f"    \"{s.preview[:80]}\"")

        # Return ui_action so TUI can open a smart search picker
        return {
            "output": "\n".join(lines),
            "ui_action": "session.smart_search",
            "query": query,
            "results": [
                {
                    "session_id": s.thread_id,
                    "name": s.name,
                    "preview": s.preview,
                    "relevance_score": getattr(s, 'relevance_score', 0),
                }
                for s in results[:10]
            ],
        }
    except Exception as e:
        logger.exception("find failed")
        return {"output": f"Error: {e}"}


def cmd_tag(ctx: SlashContext) -> dict:
    """Manage session tags.

    Usage:
        /tag add <tag1> [tag2] ...
        /tag remove <tag1> [tag2] ...
        /tag list
    """
    if not ctx.session:
        return {"output": "Error: no active session"}
    parts = ctx.args.split(None, 1)
    if not parts:
        return {"output": "Usage: /tag add|remove|list [tags...]"}

    from drsai.backend.cli.history import CLISessionStore
    store = CLISessionStore(_get_db_manager(), ctx.user_id)

    subcmd = parts[0].lower()
    if subcmd == "list":
        info = store.resolve(ctx.session_id)
        if info:
            tags = getattr(info, 'tags', []) or []
            if tags:
                return {"output": f"Tags: {' '.join('#' + t for t in tags)}"}
            return {"output": "No tags set"}
        return {"output": "Session not found"}

    if subcmd in ("add", "remove") and len(parts) < 2:
        return {"output": f"Usage: /tag {subcmd} <tag1> [tag2] ..."}

    tags_str = parts[1] if len(parts) > 1 else ""
    tags = [t.strip().lstrip('#') for t in tags_str.split() if t.strip()]

    if subcmd == "add":
        ok = store.tag_add(ctx.session_id, tags)
        if ok:
            ctx.refresh_info()
            return {"output": f"Added tags: {' '.join('#' + t for t in tags)}", "ui_action": "session.refresh"}
        return {"output": "Failed to add tags"}

    if subcmd == "remove":
        ok = store.tag_remove(ctx.session_id, tags)
        if ok:
            ctx.refresh_info()
            return {"output": f"Removed tags: {' '.join('#' + t for t in tags)}", "ui_action": "session.refresh"}
        return {"output": "Failed to remove tags"}

    return {"output": f"Unknown subcommand: {subcmd}. Use add, remove, or list."}


def cmd_pin(ctx: SlashContext) -> dict:
    """Pin the current session to top of lists."""
    if not ctx.session:
        return {"output": "Error: no active session"}
    from drsai.backend.cli.history import CLISessionStore
    store = CLISessionStore(_get_db_manager(), ctx.user_id)
    ok = store.set_meta_flag(ctx.session_id, "pinned", True)
    if ok:
        ctx.refresh_info()
        return {"output": "📌 Session pinned", "ui_action": "session.refresh"}
    return {"output": "Failed to pin session"}


def cmd_unpin(ctx: SlashContext) -> dict:
    """Unpin the current session."""
    if not ctx.session:
        return {"output": "Error: no active session"}
    from drsai.backend.cli.history import CLISessionStore
    store = CLISessionStore(_get_db_manager(), ctx.user_id)
    ok = store.set_meta_flag(ctx.session_id, "pinned", False)
    if ok:
        ctx.refresh_info()
        return {"output": "Session unpinned", "ui_action": "session.refresh"}
    return {"output": "Failed to unpin session"}


def cmd_archive(ctx: SlashContext) -> dict:
    """Archive or unarchive the current session.

    Usage:
        /archive         — archive (hide from default list)
        /archive off     — unarchive
    """
    if not ctx.session:
        return {"output": "Error: no active session"}
    from drsai.backend.cli.history import CLISessionStore
    store = CLISessionStore(_get_db_manager(), ctx.user_id)
    archived = ctx.args.strip().lower() != "off"
    ok = store.set_meta_flag(ctx.session_id, "archived", archived)
    if ok:
        ctx.refresh_info()
        return {"output": f"Session {'archived' if archived else 'unarchived'}", "ui_action": "session.refresh"}
    return {"output": "Failed to archive session"}


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
        f"  Max concurrent subagents: {info.get('max_agent_concurrent', 5)}",
    ]
    return "\n".join(lines)


def cmd_setup(ctx: SlashContext) -> dict:
    """Show setup status or re-run setup wizard.

    Usage:
        /setup           — show current config status
        /setup wizard    — re-run the setup wizard
        /setup show      — show full config (masked)
    """
    args = (ctx.args or "").strip().lower()

    if args == "wizard":
        return {"output": "", "ui_action": "setup.wizard"}

    if args == "show":
        # Show config with masked keys
        from drsai.backend.cli import config as cli_config
        if cli_config.CLI_CONFIG_PATH.exists():
            cfg = cli_config.load_config()
            lines = ["Configuration:"]
            for k, v in sorted(cfg.items()):
                if "key" in k.lower() or "token" in k.lower():
                    masked = f"{str(v)[:6]}...{str(v)[-4:]}" if v and len(str(v)) > 10 else "***"
                    lines.append(f"  {k}: {masked}")
                else:
                    lines.append(f"  {k}: {v}")
            return {"output": "\n".join(lines)}
        return {"output": "No config file found. Run /setup wizard to configure."}

    # Default: show status
    from .setup import _status
    status = _status(0, {})
    data = status.get("result", status)
    if data.get("setup_required"):
        return {
            "output": "⚠  Setup required. Run /setup wizard to configure your API key and model.",
            "ui_action": "setup.wizard",
        }
    return {"output": "✓ Configured. Use /setup show for details, /setup wizard to reconfigure."}


def cmd_daemons(ctx: SlashContext) -> str:
    """List / manage background daemon processes.

    Usage:
        /daemons              — list all daemons (opens interactive panel)
        /daemons <name>       — show daemon details
        /daemons logs <name>  — tail daemon logs
    """
    from drsai.backend.daemon.pid_manager import list_daemons, read_state, is_running
    from drsai.backend.daemon.pid_manager import _log_file as daemon_log_file

    args = ctx.args.strip() if ctx.args else ""

    # /daemons logs <name>
    if args.startswith("logs "):
        name = args[5:].strip() or "default"
        log_path = daemon_log_file(name)
        if not log_path.exists():
            return "No log file for daemon '{name}'."
        lines = log_path.read_text(errors="replace").splitlines()
        recent = lines[-20:]
        header = f"Logs for daemon '{name}' (last {len(recent)} lines):\n{'-'*40}"
        return header + "\n" + "\n".join(recent)

    # /daemons <name>  → detail view
    if args:
        name = args.split()[0]
        state = read_state(name)
        if not state:
            return f"Daemon '{name}' not found. Use `/daemons` to list all."
        alive = "running" if is_running(name) else "stopped"
        uptime_s = state.get("uptime_seconds", 0)
        h, m = int(uptime_s // 3600), int((uptime_s % 3600) // 60)
        return (
            f"Daemon: {name}\n"
            f"  Status:  {alive}\n"
            f"  PID:     {state.get('pid', '?')}\n"
            f"  WS Port: {state.get('ws_port', '?')}\n"
            f"  Uptime:  {h}h {m}m\n"
            f"  Token:   {state.get('api_token', '?')[:12]}…\n"
            f"  Log:     {state.get('log_file', '?')}\n"
            f"\n"
            f"  Usage:\n"
            f"    /agent daemon:{name}   — set as default subagent\n"
            f"    /daemon-run {name} <task>  — run a one-off task"
        )

    # /daemons (no args) → open interactive panel via ui_action
    return {"output": "", "ui_action": "daemon.panel"}


def cmd_daemon_run(ctx: SlashContext) -> str:
    """Submit a one-off task to a running daemon.

    Usage:
        /daemon-run <name> <task>
        /dr <name> <task>

    Example:
        /daemon-run default Analyze this project structure
    """
    args = ctx.args.strip()
    if not args:
        return "Usage: /daemon-run <name> <task>\nShort: /dr <name> <task>"

    parts = args.split(None, 1)
    if len(parts) < 2:
        return "Usage: /daemon-run <name> <task>\nShort: /dr <name> <task>"

    daemon_name, task = parts

    # Validate daemon exists and is running
    from drsai.backend.daemon.pid_manager import read_state, is_running
    state = read_state(daemon_name)
    if not state:
        return f"Daemon '{daemon_name}' not found. Use `/daemons` to list all."
    if not is_running(daemon_name):
        return f"Daemon '{daemon_name}' is not running."

    # Validate session exists
    if not ctx.session:
        return "Error: no active session. Create or switch to a session first."

    # Dispatch via subagent.invoke (same as LLM Delegate path)
    from drsai.backend.tui_gateway.handlers.daemon import subagent_invoke
    result = subagent_invoke("", {
        "daemon_name": daemon_name,
        "message": task,
        "caller_session_id": ctx.session_id,
    })
    if "error" in result:
        return f"Failed: {result['error']}"
    task_id = (result.get("result") or {}).get("task_id", "?")
    return f"Task submitted to daemon '{daemon_name}' (task_id={task_id}).\nWatch the transcript for streaming output."


def cmd_daemon_model(ctx: SlashContext) -> str:
    """View or change a daemon's model.

    Usage:
        /daemon-model <name>              — view current model
        /daemon-model <name> <model>      — change daemon's model

    Examples:
        /daemon-model mydaemon              → shows current model
        /daemon-model mydaemon claude-haiku → switches to claude-haiku
    """
    from drsai.backend.tui_gateway.handlers.daemon import _daemon_http
    from drsai.backend.daemon.pid_manager import read_state, is_running

    args = (ctx.args or "").strip().split(None, 1)
    if not args or not args[0]:
        return (
            "Usage:\n"
            "  /daemon-model <name>            — view current model\n"
            "  /daemon-model <name> <model>    — change model\n"
            "\n"
            "Use /daemons to list all daemons."
        )

    daemon_name = args[0]

    # Validate daemon exists and is running
    state = read_state(daemon_name)
    if not state:
        return f"Daemon '{daemon_name}' not found. Use `/daemons` to list all."
    if not is_running(daemon_name):
        return f"Daemon '{daemon_name}' is not running."

    if len(args) == 1:
        # View current model
        try:
            info = _daemon_http(daemon_name, "/api/info")
            current = info.get("model", "未知")
        except Exception:
            current = state.get("model") or "(使用全局默认)"
        return f"Daemon '{daemon_name}' 当前模型: {current}"

    # Change model
    new_model = args[1]
    try:
        import json as _json
        import urllib.request
        url = f"http://127.0.0.1:{state['ws_port']}/api/model"
        data = _json.dumps({"model": new_model}).encode()
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = _json.loads(r.read())
        if "error" in resp:
            return f"切换失败: {resp['error']}"
        switched = resp.get("sessions_switched", 0)
        return (
            f"✓ Daemon '{daemon_name}' 模型已切换为 '{new_model}'。\n"
            f"  {switched} 个活跃 session 已同步切换。\n"
            f"  新 session 将默认使用此模型。"
        )
    except Exception as e:
        return f"切换失败: {e}"


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


def cmd_wechat(ctx: SlashContext) -> dict:
    """WeChat integration status and management.

    Usage:
        /wechat              — show status (opens interactive panel)
        /wechat status       — text status
        /wechat sessions     — list wechat user sessions
        /wechat login        — start QR login
        /wechat logout       — logout and delete credentials
    """
    args = (ctx.args or "").strip()
    sub = args.split(None, 1)[0].lower() if args else ""

    if sub == "status":
        # Return text status
        from .wechat import _wechat_status
        result = _wechat_status(0, {})  # rid=0 is unused for direct call
        data = result.get("result", result)
        lines = ["WeChat Status:"]
        lines.append(f"  Configured: {'✓' if data.get('configured') else '✗'}")
        lines.append(f"  Valid:      {'✓' if data.get('credentials_valid') else '✗'}")
        if data.get("login_time"):
            lines.append(f"  Login:      {data['login_time']}")
        if data.get("expires_at"):
            lines.append(f"  Expires:    {data['expires_at']}")
        if data.get("account_id"):
            lines.append(f"  Account:    {data['account_id']}")
        if data.get("active_daemons"):
            for d in data["active_daemons"]:
                lines.append(f"  Daemon:     {d['name']} (port {d['port']})")
        return {"output": "\n".join(lines)}

    if sub == "sessions":
        from .wechat import _wechat_sessions
        result = _wechat_sessions(0, {})
        sessions = result.get("result", result).get("sessions", [])
        if not sessions:
            return {"output": "No WeChat sessions."}
        lines = ["WeChat Sessions:"]
        for s in sessions:
            lines.append(f"  {s.get('wechat_user_id', '?')} → session {s.get('agent_session_id', '?')[:8]}")
        return {"output": "\n".join(lines)}

    if sub == "logout":
        from .wechat import _wechat_logout
        _wechat_logout(0, {})
        return {"output": "✓ WeChat logged out, credentials deleted."}

    if sub == "login":
        return {"output": "Starting WeChat login…", "ui_action": "wechat.login"}

    # Default: open interactive panel
    return {"output": "", "ui_action": "wechat.panel"}


def cmd_schedule(ctx: SlashContext) -> dict:
    """Manage scheduled tasks.

    Usage:
        /schedule                    — list all tasks
        /schedule create <name> interval:N <prompt>
        /schedule create <name> once <prompt>
        /schedule cancel <id>
        /schedule run <id>
    """
    parts = ctx.args.split(None, 1)
    sub = parts[0] if parts else "list"
    rest = parts[1] if len(parts) > 1 else ""

    if sub == "list" or not sub:
        from .scheduler import _scheduled_tasks
        if not _scheduled_tasks:
            return {"output": "No scheduled tasks. Use /schedule create to add one."}
        lines = ["", "  Scheduled tasks:"]
        for tid, info in _scheduled_tasks.items():
            status_icon = {"scheduled": "⏰", "running": "🔄", "completed": "✅", "cancelled": "❌", "error": "⚠"}.get(info["status"], "?")
            lines.append(f"    {status_icon} [{tid}] {info['name']} — {info['schedule']} — {info['status']}")
            if info.get("last_run"):
                lines.append(f"       last run: {info['last_run']}")
        return {"output": "\n".join(lines)}

    if sub == "create":
        # Parse: /schedule create <name> interval:N <prompt>
        # or:    /schedule create <name> once <prompt>
        create_parts = rest.split(None, 2)
        if len(create_parts) < 3:
            return {"output": "Usage: /schedule create <name> <interval:N|once> <prompt>"}
        name, schedule, prompt = create_parts
        session_id = ctx.session_id if ctx.session else ""
        # Call scheduler.create logic directly
        from .scheduler import _scheduled_tasks, _start_scheduler_thread
        import uuid as _uuid
        tid = str(_uuid.uuid4())[:8]
        from datetime import datetime as _dt
        task_info = {
            "id": tid,
            "name": name,
            "prompt": prompt,
            "schedule": schedule,
            "status": "scheduled",
            "created_at": _dt.now().isoformat(),
            "session_id": session_id,
        }
        _scheduled_tasks[tid] = task_info
        _start_scheduler_thread(tid, task_info)
        return {"output": f"✓ Task '{name}' created (id: {tid}, schedule: {schedule})"}

    if sub == "cancel":
        tid = rest.strip()
        if not tid:
            return {"output": "Usage: /schedule cancel <id>"}
        from .scheduler import _scheduled_tasks
        if tid not in _scheduled_tasks:
            return {"output": f"Task '{tid}' not found"}
        _scheduled_tasks[tid]["status"] = "cancelled"
        _scheduled_tasks.pop(tid, None)
        return {"output": f"✓ Task {tid} cancelled"}

    if sub == "run":
        tid = rest.strip()
        if not tid:
            return {"output": "Usage: /schedule run <id>"}
        from .scheduler import _scheduled_tasks, _run_task_once
        if tid not in _scheduled_tasks:
            return {"output": f"Task '{tid}' not found"}
        import threading as _th
        _th.Thread(target=_run_task_once, args=(tid, _scheduled_tasks[tid]), daemon=True).start()
        return {"output": f"✓ Task {tid} started"}

    return {"output": "Usage: /schedule list|create|cancel|run"}


def cmd_notify(ctx: SlashContext) -> dict:
    """Toggle task completion notifications."""
    args = ctx.args.lower().strip()
    current = True
    if ctx.session:
        current = ctx.session.get_state_value("notify_on_complete", True)

    if args in ("on", "off"):
        if ctx.session:
            ctx.session.set_state_value("notify_on_complete", args == "on")
        return {"output": f"Notifications: {args}"}
    if args == "status" or not args:
        return {"output": f"Notifications: {'on' if current else 'off'}"}

    return {"output": "Usage: /notify on|off|status"}


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
    "compress": cmd_compress,
    "cmp": cmd_compress,
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
    "max_concurrent": cmd_max_concurrent,
    "mc": cmd_max_concurrent,
    # ── Session management ────────────────────────────────────────────────
    "new": cmd_new,
    "switch": cmd_switch,
    "list": cmd_list,
    "ls": cmd_list,
    "rename": cmd_rename,
    "search": cmd_search,
    "find": cmd_find,
    "tag": cmd_tag,
    "pin": cmd_pin,
    "unpin": cmd_unpin,
    "archive": cmd_archive,
    "resume": cmd_resume,
    "copy": cmd_copy,
    "status": cmd_status,
    "setup": cmd_setup,
    "env": cmd_setup,
    # ── Daemon management ───────────────────────────────────────────────
    "daemons": cmd_daemons,
    "dm": cmd_daemons,
    "daemon-run": cmd_daemon_run,
    "dr": cmd_daemon_run,
    "daemon-model": cmd_daemon_model,
    "dmodel": cmd_daemon_model,
    # ── Image (fallback — normally intercepted by TUI frontend) ──────────
    "image": cmd_image,
    "img": cmd_image,
    # ── Scheduled tasks & notifications ──────────────────────────────────
    "schedule": cmd_schedule,
    "notify": cmd_notify,
    # ── WeChat ───────────────────────────────────────────────────────────
    "wechat": cmd_wechat,
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
        compact = load_user_config()

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
                "predefined": True,
            })

        compact_active = bool(compact.model or compact.model_provider or compact.providers)
        if compact_active:
            resolved = resolve_model_config(compact, environ=os.environ, require_credentials=False)
            if not any(item["alias"] == resolved.model for item in models):
                models.insert(0, {
                    "alias": resolved.model,
                    "model_name": resolved.model,
                    "provider": resolved.provider.name,
                    "reasoning": list(resolved.capabilities.reasoning.effort_levels),
                    "vision": resolved.capabilities.vision,
                    "known_model": resolved.known_model,
                    "predefined": True,
                })

        return _ok(rid, {
            "models": models,
            "current": compact.model if compact_active else (cfg.get("defult_config_name") or "default"),
        })
    except Exception as exc:
        logger.exception("model.options failed")
        return _err(rid, 5034, f"model.options failed: {exc}")


@method("model.config.get")
def _model_provider_config_get(rid, params: dict) -> dict:
    """Return model configuration with all secrets removed.

    Merges config.toml provider info (if present) with llm_mode_config.yaml
    entry data (token_limit, max_tokens, vision, base_url, etc.) so the
    TUI editor can populate all fields.
    """
    try:
        compact = load_user_config()
        resolved = resolve_model_config(compact, environ=os.environ, require_credentials=False)
        providers = []
        names = set(compact.providers)
        names.update(builtin_provider_names())
        names.add(compact.model_provider or "hepai")
        for name in sorted(names):
            try:
                item = resolve_model_config(
                    compact,
                    environ=os.environ,
                    provider=name,
                    require_credentials=False,
                )
            except ModelProviderConfigError:
                continue
            providers.append(item.provider.public_dict())

        # ── Merge yaml entry data ──
        yaml_entry_data: dict = {}
        try:
            from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
            cfg = load_config()
            llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
            llm_mode_config = load_llm_mode_config(llm_config_path)
            # Look up by model name or alias
            entry = llm_mode_config.get(resolved.model)
            if entry is None:
                for alias, e in llm_mode_config.items():
                    if e.model == resolved.model:
                        entry = e
                        break
            if entry is not None:
                yaml_entry_data = {
                    "token_limit": entry.token_limit,
                    "max_tokens": entry.max_tokens,
                    "vision": entry.vision,
                    "client_type": entry.client_type,
                    "yaml_base_url": entry.base_url,
                    "yaml_api_key_env": entry.api_key_env,
                    "yaml_requires_api_key": entry.requires_api_key,
                    "yaml_use_responses_api": entry.use_responses_api,
                }
        except Exception:
            logger.debug("Failed to load yaml entry for model.config.get", exc_info=True)

        return _ok(rid, {
            **resolved.public_dict(),
            "providers": providers,
            "path": compact.source_path,
            "revision": config_revision(),
            **yaml_entry_data,
        })
    except ModelProviderConfigError as exc:
        return _err(rid, 4001, str(exc))


@method("model.config.save")
def _model_provider_config_save(rid, params: dict) -> dict:
    """Save a model entry to llm_mode_config.yaml (single source of truth).

    All connection info (base_url, api_key, api_key_env, requires_api_key) and
    model metadata (token_limit, max_tokens, vision, client_type) are persisted
    in the YAML catalog.  config.toml is no longer written.
    """
    try:
        provider = str(params.get("provider") or "").strip()
        model = str(params.get("model") or "").strip()
        base_url = str(params.get("base_url") or "").strip()
        if not provider or not model:
            return _err(rid, 4002, "provider and model are required")

        # ── Parse params ──
        wire_api = str(params.get("wire_api") or "openai").strip()
        api_key = str(params.get("api_key") or "").strip()
        api_key_env = str(params.get("api_key_env") or "").strip()
        requires_api_key = bool(params.get("requires_api_key", True))
        token_limit = int(params.get("token_limit") or 200000)
        max_tokens = int(params.get("max_tokens") or 0)
        vision = bool(params.get("vision", False))
        use_responses_raw = params.get("use_responses_api")
        use_responses_api = None if use_responses_raw is None else bool(use_responses_raw)

        # ── Write to llm_mode_config.yaml ──
        from drsai.backend.run_drsai_agent_factory import (
            load_llm_mode_config,
            save_llm_mode_config,
            ModelEntry,
            ReasoningConfig,
        )
        cfg = load_config()
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)

        # Preserve reasoning config from existing entry if present
        existing = llm_mode_config.get(model)
        reasoning = existing.reasoning if existing is not None else ReasoningConfig()

        llm_mode_config[model] = ModelEntry(
            model=model,
            token_limit=token_limit,
            max_tokens=max_tokens,
            client_type=wire_api,
            reasoning=reasoning,
            vision=vision,
            base_url=base_url,
            api_key=api_key,
            api_key_env=api_key_env,
            requires_api_key=requires_api_key,
            use_responses_api=use_responses_api,
        )
        default_alias = cfg.get("defult_config_name") or model
        save_llm_mode_config(llm_mode_config, default_alias)

        # ── Runtime switch ──
        session_id = str(params.get("session_id") or "").strip()
        runtime_applied = True
        if session_id:
            user_id = session_module._resolve_user_id()
            session = session_module._ensure_agent_session(session_id, user_id)
            if session is not None:
                runtime_applied = session.switch_model(model)
                _emit("session.info", session_id, session.info())
        return _ok(rid, {
            "ok": True,
            "model": model,
            "model_provider": provider,
            "runtime_applied": runtime_applied,
            **({"warning": "Configuration was saved, but the current session kept its previous model"} if not runtime_applied else {}),
        })
    except ModelProviderConfigError as exc:
        return _err(rid, 4003, str(exc))
    except Exception as exc:
        logger.exception("model.config.save failed")
        return _err(rid, 5001, f"model config save failed: {exc}")


@method("model.config.delete")
def _model_provider_config_delete(rid, params: dict) -> dict:
    provider = str(params.get("provider") or "").strip()
    if not provider:
        return _err(rid, 4002, "provider is required")
    try:
        compact = load_user_config()
        # TUI bypasses the retired global model-selection guard by not
        # passing model/model_provider.  Only the provider entry is deleted;
        # if the active provider is removed the session keeps its current
        # model client until the user explicitly switches.
        commit_update(ConfigUpdateRequest(
            delete_provider_name=provider,
            delete_provider_credential=bool(params.get("delete_credential", True)),
            model=None,
            model_provider=None,
        ), expected_revision=str(params.get("expected_revision") or "").strip() or None)
        return _ok(rid, {"ok": True, "active": "hepai"})
    except ModelProviderConfigError as exc:
        return _err(rid, 4003, str(exc))


@method("model.config.test")
def _model_provider_config_test(rid, params: dict) -> dict:
    """Test the saved Provider using the same redacted probe as the Gateway."""
    provider = str(params.get("provider") or "").strip()
    model = str(params.get("model") or "").strip() or None
    if not provider:
        return _err(rid, 4002, "provider is required")
    try:
        compact = load_user_config()
        resolved = resolve_model_config(
            compact,
            environ=os.environ,
            provider=provider,
            model=model,
        )
        return _ok(rid, asyncio.run(test_provider_connection(resolved)))
    except ModelProviderConfigError as exc:
        return _err(rid, 4003, str(exc))


@method("model.config.test_draft")
def _model_provider_config_test_draft(rid, params: dict) -> dict:
    """Test editor values without saving TOML or a credential."""
    try:
        draft = ProviderDraft(
            name=str(params.get("provider") or "").strip(),
            model=str(params.get("model") or "").strip(),
            base_url=str(params.get("base_url") or "").strip(),
            api_key=str(params.get("api_key") or "").strip() or None,
            api_key_env=str(params.get("api_key_env") or "").strip() or None,
            wire_api=str(params.get("wire_api") or "openai"),  # type: ignore[arg-type]
            requires_api_key=bool(params.get("requires_api_key", True)),
        )
        result = asyncio.run(probe_provider_draft(draft, mode="basic", environ=os.environ))
        return _ok(rid, result)
    except ModelProviderConfigError as exc:
        return _err(rid, 4003, str(exc))


@method("model.config.presets")
def _model_provider_presets(rid, params: dict) -> dict:
    return _ok(rid, {"presets": list_provider_presets()})


@method("model.config.models")
def _model_provider_models(rid, params: dict) -> dict:
    provider = str(params.get("provider") or "").strip()
    try:
        resolved = resolve_model_config(load_user_config(), environ=os.environ, provider=provider)
        result = asyncio.run(discover_provider_models(resolved, refresh=bool(params.get("refresh"))))
        return _ok(rid, result)
    except ModelProviderConfigError as exc:
        return _err(rid, 4003, str(exc))


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

    Behaviour:
        - ``prefix=""``  → list the contents of ``cwd`` itself.
        - ``prefix="ap"``→ list items in ``cwd`` whose names start with "ap".
        - ``prefix="src/ap"`` → list items in ``cwd/src`` starting with "ap".
    """
    prefix = params.get("prefix", "")
    cwd = params.get("cwd", str(Path.cwd()))

    try:
        # When prefix is empty, list the contents of cwd itself.
        # Without this guard, Path(cwd) / "" == Path(cwd), whose .parent is
        # the PARENT of cwd and whose .name is the last component of cwd —
        # so the general logic below would list cwd's parent filtered by
        # cwd's basename instead of listing cwd's own children.
        if prefix == "":
            target_dir = Path(cwd)
            if not target_dir.exists() or not target_dir.is_dir():
                return _ok(rid, {"items": []})
            items = []
            for child in target_dir.iterdir():
                # Skip hidden files unless the user explicitly typed a dot
                if child.name.startswith("."):
                    continue
                is_dir = child.is_dir()
                items.append({
                    "text": child.name,
                    "display": child.name + ("/" if is_dir else ""),
                    "meta": "dir" if is_dir else "file",
                })
            # Sort: directories first, then files, each alphabetical
            items.sort(key=lambda c: (c["meta"] != "dir", c["display"].lower()))
            return _ok(rid, {"items": items[:50]})  # limit 50

        p = Path(cwd) / prefix
        parent = p.parent
        if not parent.exists():
            return _ok(rid, {"items": []})

        items = []
        for child in parent.iterdir():
            if child.name.startswith(p.name):
                # Skip hidden files unless the filter itself starts with a dot
                if child.name.startswith(".") and not p.name.startswith("."):
                    continue
                is_dir = child.is_dir()
                items.append({
                    "text": str(child.relative_to(cwd)),
                    "display": child.name + ("/" if is_dir else ""),
                    "meta": "dir" if is_dir else "file",
                })
        # Sort: directories first, then files, each alphabetical
        items.sort(key=lambda c: (c["meta"] != "dir", c["display"].lower()))
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
    "reasoning_effort", "deepseek_reasoning_effort", "minimax_format", "zhipu_format",
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
    use_responses_raw = params.get("use_responses_api")
    use_responses_api = None if use_responses_raw is None else bool(use_responses_raw)

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
        use_responses_api=use_responses_api,
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
        "use_responses_api": entry.use_responses_api,
        "reasoning": {
            "supported": entry.reasoning.supported,
            "effort_levels": list(entry.reasoning.effort_levels),
            "param_type": entry.reasoning.param_type,
        },
    })
