"""Status display for DrSai CLI.

Shows agent connection status, available tools, session info,
and configuration summary.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from drsai.modules.agents.drsai_worker_agent import HepAIWorkerAgent


def _mask_key(key: str) -> str:
    if not key:
        return "<not set>"
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def _format_bool(ok: bool, text: str) -> str:
    """Return green OK or red FAIL string."""
    marker = "\033[92m✓\033[0m" if ok else "\033[91m✗\033[0m"
    return f"  {marker} {text}"


async def show_status(
    agent: Optional["HepAIWorkerAgent"],
    cfg: dict,
    current_session_id: Optional[str] = None,
    sessions: Optional[dict] = None,
) -> None:
    """Display a comprehensive status report.

    Args:
        agent: the connected HepAIWorkerAgent instance (may be None)
        cfg: current CLI config dict
        current_session_id: the active session id (for marking current)
        sessions: dict of {session_id: {"name": ...}} (optional, loaded if None)
    """
    from drsai.backend.cli.config import CLI_CONFIG_PATH, load_sessions
    from drsai.configs.constant import APPNAME, VERSION

    print()
    print(f"  \033[1m{APPNAME}\033[0m v{VERSION}  —  CLI Status")
    print()
    print(f"  Config:  {CLI_CONFIG_PATH}")

    # ── Connection ──────────────────────────────────────────────────────────
    print()
    print("  \033[1mConnection\033[0m")

    url = cfg.get("url", "<not set>")
    model_name = cfg.get("model_name", "<not set>")
    user_id = cfg.get("user_id", "anonymous")

    print(f"  {'Server URL':<12} {url}")
    print(f"  {'Model':<12} {model_name}")
    print(f"  {'User ID':<12} {user_id}")

    if cfg.get("defult_config_name"):
        print(f"  {'LLM config':<12} {cfg['defult_config_name']}")

    api_key = cfg.get("api_key") or ""
    print(f"  {'API key':<12} {_mask_key(api_key)}")

    # ── Agent factory config ─────────────────────────────────────────────────
    print()
    print("  \033[1mAgent Factory\033[0m")
    print(f"  {'LLM catalog':<16} {cfg.get('llm_config_file') or '<built-in default>'}")
    print(f"  {'Anthropic key':<16} {_mask_key(cfg.get('anthropic_api_key') or '')}")
    print(f"  {'Anthropic URL':<16} {cfg.get('anthropic_base_url') or '<default>'}")
    print(f"  {'OpenAI key':<16} {_mask_key(cfg.get('openai_api_key') or '')}")
    print(f"  {'OpenAI URL':<16} {cfg.get('openai_base_url') or '<default>'}")
    print(f"  {'Skills dir':<16} {cfg.get('skills_dir') or '<not set>'}")
    print(f"  {'RAGFlow URL':<16} {cfg.get('ragflow_url') or '<default>'}")
    print(f"  {'RAGFlow token':<16} {_mask_key(cfg.get('ragflow_token') or '')}")
    print(f"  {'Memory dataset':<16} {cfg.get('memory_dataset_id') or '<not set>'}")

    # ── Agent health ─────────────────────────────────────────────────────────
    print()
    print("  \033[1mAgent Health\033[0m")

    if agent is not None:
        try:
            tools_count = len(agent._funcs_map) if hasattr(agent, "_funcs_map") else 0
            print(f"  {'Tools':<12} {tools_count} available")
            print(_format_bool(True, "Agent connected"))
        except Exception as e:
            print(_format_bool(False, f"Agent error: {e}"))
    else:
        print(_format_bool(False, "Agent not connected"))

    # ── Session info ─────────────────────────────────────────────────────────
    print()
    print("  \033[1mSessions\033[0m")

    if sessions is None:
        sessions = load_sessions()

    session_count = len(sessions)
    print(f"  Total saved:  {session_count}")

    if current_session_id and sessions:
        for sid, info in sessions.items():
            marker = " \033[93m<-- current\033[0m" if sid == current_session_id else ""
            print(f"    [{sid[:8]}] {info.get('name', 'unnamed')}{marker}")
    elif sessions:
        # Show most recent first (last in dict order)
        items = list(sessions.items())
        for sid, info in items[-3:]:
            marker = " \033[93m<-- current\033[0m" if sid == current_session_id else ""
            print(f"    [{sid[:8]}] {info.get('name', 'unnamed')}{marker}")
        if len(items) > 3:
            print(f"    ... and {len(items) - 3} more (use /list to see all)")
    else:
        print("    No saved sessions")

    # ── Quick tips ───────────────────────────────────────────────────────────
    print()
    print("  \033[3mRun /config to see full config, /help for commands.\033[0m")
    print()


def show_quick_status(
    agent: Optional["HepAIWorkerAgent"],
    cfg: dict,
) -> None:
    """Compact one-line status for display after commands."""
    if agent is not None and hasattr(agent, "_funcs_map"):
        tools = len(agent._funcs_map)
        connected = True
    else:
        tools = 0
        connected = False

    key = cfg.get("api_key") or ""
    key_str = _mask_key(key)

    print(
        f"  [{cfg.get('model_name', '?')}] "
        f"tools={tools} "
        f"key={key_str} "
        f"url={cfg.get('url', '?')}"
    )
