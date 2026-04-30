"""
DrSai CLI - Chat with a local DrSaiAssistant agent interactively.

Features:
- Direct local DrSaiAssistant agent (no remote Worker required)
- Continuous multi-turn conversation
- Session switching (create, switch, list, rename)
- Config display with sensitive-value masking
- Status overview (/status, /model)
- Command registry (cli_commands.py) for dispatch and help
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from typing import Optional

import typer
from loguru import logger

from drsai.configs.constant import APPNAME, VERSION
from drsai.backend.cli import config as cli_config
from drsai.backend.cli import status as cli_status
from drsai.backend.cli.banner import configure_cli_logging, print_banner, print_config_info
from drsai.backend.cli.commands import format_help, resolve_command
from drsai.backend.cli.history import CLISessionStore
from drsai.backend.cli.prompt import DrSaiPrompt
from drsai.backend.cli.renderer import DrSaiCLIRenderer
from drsai.backend.cli.stats import SessionStats

# ── Hermes-style TUI Integration ────────────────────────────────────────────
# Import optional TUI modules for enhanced CLI experience
try:
    from drsai.backend.cli.interrupt import (
        set_interrupt,
        is_interrupted,
        clear_interrupt,
        get_current_thread_id,
    )
    from drsai.backend.cli.callbacks import (
        approval_callback,
        is_dangerous_command,
        get_callback_state,
    )
    HAS_TUI = True
except ImportError:
    HAS_TUI = False
    # Stub implementations
    def set_interrupt(*args, **kwargs): pass
    def is_interrupted(): return False
    def clear_interrupt(*args, **kwargs): pass
    def get_current_thread_id(): return 0
    def approval_callback(*args, **kwargs): return "deny"
    def is_dangerous_command(cmd): return False
    def get_callback_state():
        class FakeState:
            _approval_state = None
        return FakeState()


# ── REPL persistent state ─────────────────────────────────────────────────────

_pending_retry: Optional[str] = None   # set by /retry; main loop re-uses this message


# ── Interrupt handling helper ─────────────────────────────────────────────────

async def _handle_interrupt(agent, *, set_exit_flag: bool = False) -> bool:
    """统一的中断处理函数。

    Args:
        agent: DrSaiAgent 实例
        set_exit_flag: 是否设置退出标志（第二次 Ctrl+C 会退出）

    Returns:
        True: 已处理中断，可以继续输入
        False: 需要退出 REPL
    """
    print("\n  \033[33m⚠ 正在中断当前命令...\033[0m")

    if agent is not None:
        try:
            await agent.pause()
            await asyncio.sleep(0.1)
            await agent.resume()
            print("  \033[32m✓ 已中断，状态已重置\033[0m")

            if set_exit_flag:
                print("  按 Enter 继续，或再次 Ctrl+C 退出\n")
                if HAS_TUI:
                    set_interrupt(True)
                return True  # 继续循环
            else:
                print()  # 换行
                return True  # 继续循环

        except Exception as e:
            logger.warning(f"Failed to pause/resume agent: {e}")
            print(f"  \033[31m✗ 中断时出错: {e}\033[0m\n")
            return True  # 继续尝试

    # 无 agent，运行中的任务已取消
    if set_exit_flag:
        print("  按 Enter 继续，或再次 Ctrl+C 退出\n")
        if HAS_TUI:
            set_interrupt(True)
        return True  # 继续循环

    return False  # 退出 REPL


# ─────────────────────────────────────────────────────────────────────────────
# Typer app
# ─────────────────────────────────────────────────────────────────────────────

app = typer.Typer(
    name="drsai",
    help="DrSai CLI - Connect to a running DrSai agent and chat interactively.\n\nUsage: drsai [OPTIONS] [COMMAND]",
    no_args_is_help=False,  # Default to chat REPL when no args given
)


# ── Root entry: `drsai` (no subcommand) drops directly into REPL ───────────
# ── Shared chat entrypoint (used by both the default command and `drsai chat`) ─
def _chat_main(
    url: Optional[str],
    api_key: Optional[str],
    model_name: Optional[str],
    user_id: Optional[str],
    defult_config_name: Optional[str],
    llm_config_file: Optional[str] = None,
    anthropic_api_key: Optional[str] = None,
    anthropic_base_url: Optional[str] = None,
    openai_api_key: Optional[str] = None,
    openai_base_url: Optional[str] = None,
    skills_dir: Optional[str] = None,
    ragflow_url: Optional[str] = None,
    ragflow_token: Optional[str] = None,
    memory_dataset_id: Optional[str] = None,
    plan_mode: bool = False,
):
    # Silence chatty internals before anything else imports loguru/alembic.
    configure_cli_logging(debug=bool(os.environ.get("DRSAI_CLI_DEBUG")))

    overrides = [url, api_key, model_name, user_id, defult_config_name,
                 llm_config_file, anthropic_api_key, anthropic_base_url,
                 openai_api_key, openai_base_url, skills_dir,
                 ragflow_url, ragflow_token, memory_dataset_id]
    if not cli_config.CLI_CONFIG_PATH.exists() and not any(overrides):
        cfg = _interactive_setup()
    else:
        cfg = cli_config.load_config()

    for key, val in [
        ("url", url), ("api_key", api_key), ("model_name", model_name),
        ("user_id", user_id), ("defult_config_name", defult_config_name),
        ("llm_config_file", llm_config_file),
        ("anthropic_api_key", anthropic_api_key),
        ("anthropic_base_url", anthropic_base_url),
        ("openai_api_key", openai_api_key),
        ("openai_base_url", openai_base_url),
        ("skills_dir", skills_dir),
        ("ragflow_url", ragflow_url),
        ("ragflow_token", ragflow_token),
        ("memory_dataset_id", memory_dataset_id),
    ]:
        if val is not None:
            cfg[key] = val

    if not cfg.get("api_key"):
        cfg["api_key"] = os.environ.get("HEPAI_API_KEY", "")

    # Plan mode configuration: CLI flag takes precedence; otherwise use saved config
    if plan_mode:  # Only override if explicitly set to True via CLI flag
        cfg["plan_mode"] = True
    # If not explicitly set, cfg["plan_mode"] already has the value from load_config()

    # HEPAI key is legacy; new factory also accepts ANTHROPIC_API_KEY / OPENAI_API_KEY
    # env vars or anthropic_api_key / openai_api_key config entries.
    any_key = any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])
    if not any_key:
        typer.echo(
            "No API key. Set one of: HEPAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY\n"
            "or use --api-key / --anthropic-api-key / --openai-api-key,\n"
            "or run: drsai config --show"
        )
        raise typer.Exit(1)

    asyncio.run(_run_repl(cfg))


# ── Default command (no subcommand): `drsai` → chat REPL ─────────────────
@app.callback(
    invoke_without_command=True,
    help="Start an interactive chat session (default command when no subcommand is given).",
)
def cli_default(
    ctx: typer.Context,
    url: Optional[str] = typer.Option(None, "--url", "-u",
        help="Agent server URL, e.g. http://localhost:42858/apiv2"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-k",
        help="HepAI API key"),
    model_name: Optional[str] = typer.Option(None, "--model", "-m",
        help="Model/agent name on the server"),
    user_id: Optional[str] = typer.Option(None, "--user",
        help="Your user id (email)"),
    defult_config_name: Optional[str] = typer.Option(None, "--llm-config",
        help="Default LLM model alias"),
    llm_config_file: Optional[str] = typer.Option(None, "--llm-config-file",
        help="Path to YAML/JSON model catalog (alias -> [model_id, token_limit])"),
    anthropic_api_key: Optional[str] = typer.Option(None, "--anthropic-api-key",
        help="Anthropic-format API key (claude/minimax models)"),
    anthropic_base_url: Optional[str] = typer.Option(None, "--anthropic-base-url",
        help="Anthropic-format base URL"),
    openai_api_key: Optional[str] = typer.Option(None, "--openai-api-key",
        help="OpenAI-format API key"),
    openai_base_url: Optional[str] = typer.Option(None, "--openai-base-url",
        help="OpenAI-format base URL"),
    skills_dir: Optional[str] = typer.Option(None, "--skills-dir",
        help="SYSTEM_SKILLS_DIR path"),
    ragflow_url: Optional[str] = typer.Option(None, "--ragflow-url",
        help="RAGFlow server URL"),
    ragflow_token: Optional[str] = typer.Option(None, "--ragflow-token",
        help="RAGFlow API token"),
    memory_dataset_id: Optional[str] = typer.Option(None, "--memory-dataset-id",
        help="Long-term memory dataset id"),
    plan_mode: bool = typer.Option(False, "--plan-mode", "-p",
        help="Enable plan mode: AI will interview you about your plan before acting"),
):
    """Start an interactive chat session (default command when no subcommand is given)."""
    if ctx.invoked_subcommand is not None:
        return
    _chat_main(
        url, api_key, model_name, user_id, defult_config_name,
        llm_config_file, anthropic_api_key, anthropic_base_url,
        openai_api_key, openai_base_url, skills_dir,
        ragflow_url, ragflow_token, memory_dataset_id,
        plan_mode=plan_mode,
    )


@app.command("chat")
def chat(
    url: Optional[str] = typer.Option(None, "--url", "-u",
        help="Agent server URL, e.g. http://localhost:42858/apiv2"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-k",
        help="HepAI API key"),
    model_name: Optional[str] = typer.Option(None, "--model", "-m",
        help="Model/agent name on the server"),
    user_id: Optional[str] = typer.Option(None, "--user",
        help="Your user id (email)"),
    defult_config_name: Optional[str] = typer.Option(None, "--llm-config",
        help="Default LLM model alias"),
    llm_config_file: Optional[str] = typer.Option(None, "--llm-config-file",
        help="Path to YAML/JSON model catalog"),
    anthropic_api_key: Optional[str] = typer.Option(None, "--anthropic-api-key",
        help="Anthropic-format API key"),
    anthropic_base_url: Optional[str] = typer.Option(None, "--anthropic-base-url",
        help="Anthropic-format base URL"),
    openai_api_key: Optional[str] = typer.Option(None, "--openai-api-key",
        help="OpenAI-format API key"),
    openai_base_url: Optional[str] = typer.Option(None, "--openai-base-url",
        help="OpenAI-format base URL"),
    skills_dir: Optional[str] = typer.Option(None, "--skills-dir",
        help="SYSTEM_SKILLS_DIR path"),
    ragflow_url: Optional[str] = typer.Option(None, "--ragflow-url",
        help="RAGFlow server URL"),
    ragflow_token: Optional[str] = typer.Option(None, "--ragflow-token",
        help="RAGFlow API token"),
    memory_dataset_id: Optional[str] = typer.Option(None, "--memory-dataset-id",
        help="Long-term memory dataset id"),
    plan_mode: bool = typer.Option(False, "--plan-mode", "-p",
        help="Enable plan mode: AI will interview you about your plan before acting"),
):
    """Start an interactive chat session (alias: drsai with no subcommand)."""
    _chat_main(
        url, api_key, model_name, user_id, defult_config_name,
        llm_config_file, anthropic_api_key, anthropic_base_url,
        openai_api_key, openai_base_url, skills_dir,
        ragflow_url, ragflow_token, memory_dataset_id,
        plan_mode=plan_mode,
    )


def _interactive_setup() -> dict:
    """First-time setup wizard - minimal config for user identity."""
    typer.echo(typer.style(
        "\n  Welcome to DrSai CLI! Let's configure your profile.\n",
        fg=typer.colors.GREEN, bold=True,
    ))
    typer.echo(f"  Config will be saved to: {cli_config.CLI_CONFIG_PATH}\n")

    cfg = dict(cli_config.DEFAULT_CONFIG)

    # ── User identity ────────────────────────────────────────────────────────
    cfg["user_id"] = typer.prompt(
        "  Your user id",
        default=cfg.get("user_id", "anonymous"),
    ).strip()

    # ── Default model ────────────────────────────────────────────────────────
    typer.echo("")
    cfg["defult_config_name"] = typer.prompt(
        "  Default model name (e.g. minimax-m2.7-highspeed)",
        default=cfg.get("defult_config_name") or "",
    ).strip() or None

    cli_config.save_config(cfg)
    typer.echo(typer.style("\n  Config saved!\n", fg=typer.colors.GREEN))
    return cfg


@app.command()
def config_cmd(
    url: Optional[str] = typer.Option(None, "--url", "-u", help="Agent server URL"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-k", help="HepAI API key"),
    model_name: Optional[str] = typer.Option(None, "--model", "-m", help="Model/agent name"),
    user_id: Optional[str] = typer.Option(None, "--user", help="Your user id (email)"),
    defult_config_name: Optional[str] = typer.Option(None, "--llm-config",
        help="Default LLM model alias"),
    llm_config_file: Optional[str] = typer.Option(None, "--llm-config-file"),
    anthropic_api_key: Optional[str] = typer.Option(None, "--anthropic-api-key"),
    anthropic_base_url: Optional[str] = typer.Option(None, "--anthropic-base-url"),
    openai_api_key: Optional[str] = typer.Option(None, "--openai-api-key"),
    openai_base_url: Optional[str] = typer.Option(None, "--openai-base-url"),
    skills_dir: Optional[str] = typer.Option(None, "--skills-dir"),
    ragflow_url: Optional[str] = typer.Option(None, "--ragflow-url"),
    ragflow_token: Optional[str] = typer.Option(None, "--ragflow-token"),
    memory_dataset_id: Optional[str] = typer.Option(None, "--memory-dataset-id"),
    plan_mode: Optional[bool] = typer.Option(None, "--plan-mode", "-p",
        help="Enable/disable plan mode (AI interviews you before acting)"),
    show: bool = typer.Option(False, "--show", "-s", help="Show current config (masked)"),
    json_fmt: bool = typer.Option(False, "--json", help="Show config as JSON"),
):
    """View or update CLI connection config.

    Sensitive values (API keys) are always masked in output.
    """
    cfg = cli_config.load_config()

    updates = [
        ("url", url), ("api_key", api_key), ("model_name", model_name),
        ("user_id", user_id), ("defult_config_name", defult_config_name),
        ("llm_config_file", llm_config_file),
        ("anthropic_api_key", anthropic_api_key),
        ("anthropic_base_url", anthropic_base_url),
        ("openai_api_key", openai_api_key),
        ("openai_base_url", openai_base_url),
        ("skills_dir", skills_dir),
        ("ragflow_url", ragflow_url),
        ("ragflow_token", ragflow_token),
        ("memory_dataset_id", memory_dataset_id),
        ("plan_mode", plan_mode),
    ]

    if show or not any(v is not None for _, v in updates):
        cli_config.show_config(cfg, as_json=json_fmt)
        return

    for key, val in updates:
        if val is not None:
            cfg[key] = val

    cli_config.save_config(cfg)
    typer.echo(f"Config saved to {cli_config.CLI_CONFIG_PATH}")


@app.command()
def sessions_cmd(
    clear: bool = typer.Option(False, "--clear", help="Clear all saved sessions"),
):
    """List or manage saved CLI sessions."""
    if clear:
        cli_config.save_sessions({})
        typer.echo("All sessions cleared.")
        return
    data = cli_config.load_sessions()
    if not data:
        typer.echo("No saved sessions.")
        return
    typer.echo("Saved sessions:")
    for sid, info in data.items():
        typer.echo(f"  [{sid[:8]}] {info['name']}")


@app.command()
def version_cmd():
    """Print DrSai version."""
    typer.echo(f"{APPNAME} version: {VERSION}")


# ─────────────────────────────────────────────────────────────────────────────
# REPL implementation
# ─────────────────────────────────────────────────────────────────────────────

async def _run_repl(cfg: dict):
    """Main REPL loop. Uses DrSaiCLIAssistant + hermes-style renderer."""
    # pylint: disable=too-many-locals,too-many-statements
    from pathlib import Path
    import time

    from drsai.backend.run_drsai_agent_factory import create_agent
    from drsai.configs.constant import FS_DIR
    from drsai.modules.agents.skills_agent import DrSaiCLIAssistant
    from drsai.modules.managers.database import DatabaseManager
    from drsai.modules.managers.datamodel import Thread
    from drsai.modules.managers.datamodel.db import RunStatus
    from drsai.modules.managers.datamodel.types import Response
    from drsai.utils.utils import compress_state, decompress_state

    user_id = cfg["user_id"]
    defult_config_name = cfg.get("defult_config_name", "hepai/minimax-m2.7-highspeed")

    # ── Local DB setup ──────────────────────────────────────────────────────
    WORKSPACE = Path(FS_DIR) / "workspace"
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    DATASET = WORKSPACE / "drsai"
    DATASET.mkdir(parents=True, exist_ok=True)

    engine_uri = f"sqlite:///{DATASET}/drsai.db"
    db_manager = DatabaseManager(engine_uri=engine_uri, base_dir=str(DATASET))

    # Banner first — before the DB chatter that initialize_database can emit.
    print_banner()

    init_response = db_manager.initialize_database()
    assert init_response.status, init_response.message

    store = CLISessionStore(db_manager, user_id)

    # ── Pick or create a session based on current workdir ───────────────────
    current_workdir = str(Path.cwd().resolve())
    
    # Check if this workdir has an existing session
    workdir_sessions = cli_config.get_workdir_sessions()
    current_session_id = workdir_sessions.get(current_workdir)
    
    if current_session_id:
        # Try to find the session
        existing = store.resolve(current_session_id)
        if existing:
            current_session_id = existing.thread_id
            print(f"  Resuming: \033[33m{existing.name}\033[0m [{current_session_id[:8]}] (workdir: {current_workdir})")
        else:
            # Session was deleted, create new one
            current_session_id = None
    
    if not current_session_id:
        # Create new session with directory name
        session_name = Path.cwd().name
        if not session_name:
            session_name = "default"
        current_session_id = store.create(name=session_name, workdir=current_workdir)
        cli_config.set_workdir_session(current_workdir, current_session_id)
        print(f"  New session: \033[33m{session_name}\033[0m [{current_session_id[:8]}] (workdir: {current_workdir})")

    # ── Agent lifecycle ─────────────────────────────────────────────────────
    agent: Optional[DrSaiCLIAssistant] = None
    current_thread: Optional[Thread] = None  # 当前会话的 Thread 对象

    def _make_agent(chat_id: str) -> DrSaiCLIAssistant:
        return create_agent(
            api_key=cfg.get("api_key") or None,
            thread_id=chat_id,
            user_id=user_id,
            db_manager=db_manager,
            defult_config_name=defult_config_name,
            cli_cfg=cfg,
        )

    async def _load_thread_state(thread_id: str) -> Optional[dict]:
        """从数据库加载 Thread 状态"""
        response: Response = db_manager.get(
            Thread,
            filters={"user_id": user_id, "thread_id": thread_id},
            return_json=False
        )
        if response.status and response.data:
            thread: Thread = response.data[0]
            state = thread.state
            if state:
                if isinstance(state, str):
                    return decompress_state(state)
                return state
        return None

    async def _save_thread_state(thread_id: str, state_dict: dict) -> bool:
        """保存 Thread 状态到数据库"""
        response: Response = db_manager.get(
            Thread,
            filters={"user_id": user_id, "thread_id": thread_id},
            return_json=False
        )
        if response.status and response.data:
            thread: Thread = response.data[0]
            thread.state = compress_state(state_dict)
            thread.updated_at = time.time()
            save_response = db_manager.upsert(thread)
            return save_response.status
        return False

    async def _get_or_create_thread(thread_id: str) -> Thread:
        """获取或创建 Thread 记录"""
        response: Response = db_manager.get(
            Thread,
            filters={"user_id": user_id, "thread_id": thread_id},
            return_json=False
        )
        if response.status and response.data:
            return response.data[0]
        else:
            thread = Thread(
                user_id=user_id,
                thread_id=thread_id,
                status=RunStatus.CREATED,
                messages=[],
            )
            db_manager.upsert(thread)
            return thread

    async def _init_agent(chat_id: str) -> DrSaiCLIAssistant:
        nonlocal current_thread
        a = _make_agent(chat_id)
        if hasattr(a, "lazy_init"):
            await a.lazy_init()

        # 加载历史状态
        state_dict = await _load_thread_state(chat_id)
        if state_dict and hasattr(a, "load_state"):
            await a.load_state(state_dict)

        # 获取或创建 Thread 记录
        current_thread = await _get_or_create_thread(chat_id)

        return a

    async def _close_agent():
        nonlocal agent, current_thread
        if agent is not None:
            try:
                # 保存最终状态
                if hasattr(agent, "save_state"):
                    state_dict = await agent.save_state()
                    await _save_thread_state(current_session_id, state_dict)
                await agent.close()
            except Exception:
                pass
            agent = None
            current_thread = None

    print("  Initializing agent…")
    try:
        agent = await _init_agent(current_session_id)
    except Exception as e:
        print(f"  \033[31mFailed to initialize agent:\033[0m {e}")
        print("  Check your environment / config.")
        return

    # ── Auto-activate plan mode if configured ──────────────────────────────
    PLAN_MODE_PROMPT = """Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead."""

    if cfg.get("plan_mode", False):
        if hasattr(agent, "inject_system_prompt"):
            agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
            print("  \033[1;36m⚡ Plan mode auto-enabled (from config)\033[0m")

    # ── Runtime state (renderer, stats, prompt) ─────────────────────────────
    stats = SessionStats(show_footer=True, ring_bell=False)
    renderer = DrSaiCLIRenderer(show_reasoning=False)
    last_user_msg: str = ""

    def _current_label() -> str:
        info = store.resolve(current_session_id)
        name = info.name if info else current_session_id[:8]
        return f"{name} [{current_session_id[:8]}]"

    def _bottom_toolbar() -> str:
        user_id = cfg.get("user_id", "anonymous")
        model_name = cfg.get("defult_config_name") or "auto"
        if len(model_name) > 40:
            model_name = model_name[:37] + "..."
        
        parts = [f"{user_id} @ {model_name}"]
        
        if stats.turns:
            parts.append(f"turns: {stats.turns}")
        if renderer.show_reasoning:
            parts.append("reasoning: on")
        if cfg.get("plan_mode", False):
            parts.append("plan_mode: on")
        return "  ·  ".join(parts)

    prompt_reader = DrSaiPrompt(
        session_label_fn=_current_label,
        completion_hook=lambda: [s.name for s in store.list(limit=20)],
        bottom_toolbar_fn=_bottom_toolbar,
    )

    # ── Slash command handlers ──────────────────────────────────────────────
    def _cmd_help():
        print(format_help())

    async def _cmd_quit():
        print("Bye!")
        # Fire-and-forget close; os._exit will tear down any threads the
        # assistant left behind without waiting on the GIL.
        try:
            await asyncio.wait_for(_close_agent(), timeout=1.0)
        except Exception:
            pass
        _hard_exit(0)

    def _cmd_config():
        cli_config.show_config(cfg)

    def _cmd_info():
        import os
        from pathlib import Path
        from drsai.configs.constant import CONFIG_DIR
        
        # Skills dir: check env var first, then config, then default location
        skills_path = None
        skills_dir = os.environ.get("SYSTEM_SKILLS_DIR") or cfg.get("skills_dir")
        if skills_dir:
            skills_path = Path(skills_dir) if Path(skills_dir).exists() else None
        if not skills_path:
            # Try default location in workspace
            user_id = cfg.get("user_id", "anonymous")
            default_skills = Path.home() / ".drsai" / "workspace" / "runs" / user_id / "configs" / "skills"
            if default_skills.exists():
                skills_path = default_skills

        # Try to get tools from agent
        tools = []
        if agent:
            if hasattr(agent, '_workbench') and hasattr(agent._workbench, '_tools'):
                # Use workbench tools (includes all tools)
                tools = [{"name": t.name} for t in agent._workbench._tools]
            elif hasattr(agent, '_tools'):
                # Fallback to agent._tools
                tools = [{"name": t.name} for t in agent._tools]
            elif hasattr(agent, 'get_tools'):
                # Fallback to get_tools method
                tools = [{"name": t.name} for t in agent.get_tools()]

        print_config_info(
            user_id=cfg.get("user_id", "anonymous"),
            model_name=cfg.get("defult_config_name") or "auto",
            session_id=current_session_id,
            work_dir=str(Path.cwd()),
            tools=tools,
            skills_dir=str(skills_path) if skills_path else None,
        )

    async def _cmd_status():
        legacy_sessions = {
            info.thread_id: {"name": info.name}
            for info in store.list(limit=50)
        }
        await cli_status.show_status(
            agent=agent,
            cfg=cfg,
            current_session_id=current_session_id,
            sessions=legacy_sessions,
        )
        if stats.turns:
            print(
                f"  Stats   turns={stats.turns} "
                f"tokens={stats.prompt_tokens}→{stats.completion_tokens} "
                f"last={stats.last_turn_seconds:.1f}s"
            )

    async def _cmd_new(args: str):
        nonlocal current_session_id, agent, current_thread
        await _close_agent()  # 保存当前 agent 状态
        name = args.strip() or None
        current_workdir = str(Path.cwd().resolve())
        new_id = store.create(name=name, workdir=current_workdir)
        current_session_id = new_id
        cli_config.set_workdir_session(current_workdir, new_id)
        current_thread = None  # 重置，_init_agent 会创建新的
        try:
            agent = await _init_agent(current_session_id)
            print(f"New session: {_current_label()}")
        except Exception as e:
            print(f"Failed to initialize new session: {e}")

    async def _switch_to(thread_id: str) -> bool:
        nonlocal current_session_id, agent, current_thread
        await _close_agent()  # 保存当前 agent 状态
        current_session_id = thread_id
        # Update workdir mapping if session has a workdir
        current_workdir = str(Path.cwd().resolve())
        info = store.resolve(thread_id)
        if info and info.workdir:
            cli_config.set_workdir_session(info.workdir, thread_id)
        try:
            agent = await _init_agent(current_session_id)
            return True
        except Exception as e:
            print(f"Failed to switch: {e}")
            return False

    async def _cmd_switch(args: str):
        if not args:
            print("Usage: /switch <session_id prefix or name>")
            return
        info = store.resolve(args)
        if info is None:
            print(f"No session found matching: {args}")
            return
        if info.thread_id == current_session_id:
            print("Already in this session.")
            return
        if await _switch_to(info.thread_id):
            print(f"Switched to: {_current_label()}")

    def _cmd_list():
        infos = store.list(limit=50)
        if not infos:
            print("No sessions.")
            return
        current_workdir = str(Path.cwd().resolve())
        for info in infos:
            cur = " \033[93m<-- current\033[0m" if info.thread_id == current_session_id else ""
            workdir_hint = ""
            if info.workdir:
                # Show last part of workdir if it's the current one
                if info.workdir == current_workdir:
                    workdir_hint = " \033[92m[current workdir]\033[0m"
                else:
                    workdir_hint = f" \033[2m({Path(info.workdir).name})\033[0m"
            print(
                f"  [{info.thread_id[:8]}] {info.name:<24} "
                f"msgs={info.message_count:<3} {info.updated_at[:19]}{cur}{workdir_hint}"
            )

    def _cmd_rename(args: str):
        if not args:
            print("Usage: /rename <new name>")
            return
        if store.rename(current_session_id, args.strip()):
            print(f"Renamed to: {args.strip()}")
        else:
            print("Rename failed — session not persisted yet.")

    def _cmd_history():
        msgs = store.load(current_session_id)
        if not msgs:
            print("(no conversation yet)")
            return
        for i, m in enumerate(msgs, 1):
            if not isinstance(m, dict):
                continue
            role = (m.get("source") or m.get("role") or "?").lower()
            content = m.get("content") or ""
            if isinstance(content, list):
                content = " ".join(str(p) for p in content)
            truncated = str(content)[:80].replace("\n", " ")
            if len(str(content)) > 80:
                truncated += "…"
            print(f"  [{i}] {role}: {truncated}")
        print()

    def _cmd_save():
        # Messages are persisted by DrSaiAssistant on each turn; this is a stub.
        print(f"Session: {_current_label()} (auto-saved)")

    def _cmd_retry():
        nonlocal last_user_msg
        if not last_user_msg:
            print("Nothing to retry.")
            return
        global _pending_retry
        _pending_retry = last_user_msg
        print(f"Retrying: {last_user_msg[:60]}…")

    def _cmd_clear():
        print("\033[2J\033[H", end="")
        print(f"Session: {_current_label()}")
        print("Type /help for commands.\n" + "-" * 60)

    async def _cmd_model(args: str):
        nonlocal agent
        args = args.strip()
        if not args:
            current = cfg.get("defult_config_name") or "<default>"
            print(f"Current model alias: {current}")
            return

        # Handle "info" subcommand
        if args.lower().startswith("info "):
            model_name = args[5:].strip()
            _cmd_model_info(model_name)
            return

        if args.lower() == "info":
            print("Usage: /model info <alias>")
            return

        # Validate the model alias exists
        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)
        if args not in llm_mode_config:
            print(f"Unknown model alias: {args}")
            print(f"Available aliases: {', '.join(sorted(llm_mode_config.keys()))}")
            return

        # Switch to the specified model
        cfg["defult_config_name"] = args
        cli_config.save_config(cfg)

        # Create new model client and switch the agent's model
        if agent is not None and hasattr(agent, '_set_model_client'):
            try:
                new_client = agent._set_model_client(args)
                await agent.switch_model(new_client)
                print(f"Model switched to {args}")

                # Update token_limit for stats footer and agent context
                entry = llm_mode_config.get(args)
                if entry and hasattr(entry, "token_limit"):
                    stats.token_limit = entry.token_limit
            except Exception as e:
                print(f"Warning: model client creation failed: {e}")
                print(f"Model alias set to {args} (will take effect on next session)")
        else:
            print(f"Model alias set to {args}")

        # Refresh bottom toolbar to show new model
        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)

    def _cmd_models(args: str):
        """List all available models with reasoning support info."""
        from drsai.backend.run_drsai_agent_factory import (
            load_llm_mode_config,
            DEFAULT_CONFIG_NAME,
            ReasoningConfig,
        )

        # Load the model config (same logic as in create_agent)
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)

        # Parse args for filtering
        show_reasoning_only = "reasoning" in args.lower() or "-r" in args.lower()
        show_all = args.strip() == "" or args.strip() == "all"

        # Get current model
        current_alias = cfg.get("defult_config_name") or DEFAULT_CONFIG_NAME

        print()
        print(f"  Available models ({len(llm_mode_config)} total)")
        print(f"  {'─' * 70}")
        print(f"  {'Alias':<35} {'Reasoning':<15} {'Effort Levels':<25}")
        print(f"  {'─' * 70}")

        for alias in sorted(llm_mode_config.keys()):
            entry = llm_mode_config[alias]
            reasoning = entry.reasoning

            # Filter logic
            if show_reasoning_only and not reasoning.supported:
                continue

            # Format reasoning info
            if reasoning.supported:
                if reasoning.param_type == "is_r1_model":
                    reasoning_str = "✅ R1 model"
                    effort_str = "unlimited"
                else:
                    reasoning_str = f"✅ {reasoning.param_type}"
                    effort_str = ", ".join(reasoning.effort_levels) if reasoning.effort_levels else "all"
            else:
                reasoning_str = "❌ none"
                effort_str = "-"

            # Mark current model
            marker = " →" if alias == current_alias else "  "

            print(f"  {marker} {alias:<33} {reasoning_str:<15} {effort_str:<25}")

        print(f"  {'─' * 70}")
        print()
        print("  Usage:")
        print("    /models              - List all models")
        print("    /models reasoning    - Show only models with reasoning support")
        print("    /model <alias>       - Switch to a model")
        print("    /model info <alias>  - Show detailed info about a model")

    def _cmd_model_info(args: str):
        """Show detailed info about a specific model."""
        from drsai.backend.run_drsai_agent_factory import (
            load_llm_mode_config,
            DEFAULT_CONFIG_NAME,
        )

        # Parse model name
        model_name = args.strip()
        if not model_name:
            print("Usage: /model info <alias>")
            return

        # Load the model config
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)

        # Find the model
        entry = llm_mode_config.get(model_name)

        # Try case-insensitive match
        if entry is None:
            for alias in llm_mode_config.keys():
                if alias.lower() == model_name.lower():
                    entry = llm_mode_config[alias]
                    model_name = alias  # Use correct casing
                    break

        if entry is None:
            print(f"Model '{model_name}' not found in config.")
            similar = [a for a in llm_mode_config.keys() if model_name.lower() in a.lower()]
            if similar:
                print(f"  Similar models: {', '.join(similar[:5])}")
            return

        # Print detailed info
        print()
        print(f"  Model: {model_name}")
        print(f"  {'─' * 50}")
        print(f"  Full model ID:  {entry.model}")
        print(f"  Token limit:    {entry.token_limit:,}")
        print(f"  Client type:    {entry.client_type}")
        print()
        print(f"  Reasoning:")
        print(f"    Supported:     {'Yes' if entry.reasoning.supported else 'No'}")
        if entry.reasoning.supported:
            print(f"    Param type:    {entry.reasoning.param_type}")
            if entry.reasoning.effort_levels:
                print(f"    Effort levels: {', '.join(entry.reasoning.effort_levels)}")
            elif entry.reasoning.param_type == "is_r1_model":
                print(f"    Effort levels: unlimited (R1 models support all)")
            else:
                print(f"    Effort levels: not specified in config")
        print()

    async def _cmd_resume(args: str):
        nonlocal current_session_id
        if not args:
            print("Usage: /resume <session_id prefix or name>")
            return
        info = store.resolve(args)
        if info is None:
            print(f"No session found matching: {args}")
            return
        if info.thread_id == current_session_id:
            print("Already in this session.")
            return
        if await _switch_to(info.thread_id):
            msgs = store.load(current_session_id)
            print(f"Resumed: {_current_label()} ({len(msgs)} messages)")

    def _cmd_search(args: str):
        if not args:
            print("Usage: /search <query>")
            return
        hits = store.search(args.strip(), limit=15)
        if not hits:
            print("No matches.")
            return
        for info in hits:
            print(
                f"  [{info.thread_id[:8]}] {info.name:<24} "
                f"msgs={info.message_count:<3}  {info.preview[:60]}"
            )

    def _cmd_copy(args: str):
        try:
            n = int(args.strip()) if args.strip() else 1
        except ValueError:
            print("Usage: /copy [n]  (n ≥ 1, defaults to 1 = last assistant reply)")
            return
        n = max(n, 1)
        msgs = store.load(current_session_id)
        assistant_msgs = [
            m for m in msgs
            if isinstance(m, dict)
            and (m.get("source") or m.get("role") or "").lower() not in ("user", "system")
        ]
        if n > len(assistant_msgs):
            print(f"Only {len(assistant_msgs)} assistant message(s) available.")
            return
        target = assistant_msgs[-n]
        text = target.get("content") or ""
        if isinstance(text, list):
            text = "\n".join(str(p) for p in text)
        try:
            import pyperclip  # type: ignore
            pyperclip.copy(str(text))
            print(f"Copied {len(str(text))} chars to clipboard.")
        except Exception as e:
            print(f"pyperclip unavailable ({e}); falling back to stdout.")
            print("--- message ---")
            print(text)
            print("--- end ---")

    def _cmd_reasoning(args: str):
        arg = args.strip().lower()
        if not arg or arg in {"toggle", ""}:
            renderer.show_reasoning = not renderer.show_reasoning
            print(f"Reasoning box: {'on' if renderer.show_reasoning else 'off'}")
            return
        if arg in {"show", "on"}:
            renderer.show_reasoning = True
            print("Reasoning box: on")
            return
        if arg in {"hide", "off"}:
            renderer.show_reasoning = False
            print("Reasoning box: off")
            return
        if arg in {"low", "medium", "high", "xhigh"}:
            try:
                if agent is not None:
                    agent.reasoning_effort = arg
                renderer.show_reasoning = arg in {"high", "xhigh"}
                print(f"reasoning_effort={arg}; box={'on' if renderer.show_reasoning else 'off'}")
            except Exception as e:
                print(f"Failed to set reasoning effort: {e}")
            return
        print("Usage: /reasoning show|hide|off|low|medium|high")

    def _cmd_verbose():
        stats.show_footer = not stats.show_footer
        print(f"Stats footer: {'on' if stats.show_footer else 'off'}")

    def _cmd_bell(args: str):
        arg = args.strip().lower()
        if arg in {"on", "true", "1"}:
            stats.ring_bell = True
        elif arg in {"off", "false", "0"}:
            stats.ring_bell = False
        else:
            stats.ring_bell = not stats.ring_bell
        print(f"Bell: {'on' if stats.ring_bell else 'off'}")

    def _cmd_fast(args: str):
        arg = args.strip().lower()
        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
        catalog = load_llm_mode_config(cfg.get("llm_config_file"))
        fast_alias = next(
            (k for k in catalog if "highspeed" in k or "flash" in k or "haiku" in k),
            None,
        )
        if fast_alias is None:
            print("No obviously-fast alias in the catalog; set one via /model.")
            return
        if arg == "off":
            default_alias = next(iter(catalog))
            cfg["defult_config_name"] = default_alias
            cli_config.save_config(cfg)
            print(f"Fast mode off — alias back to {default_alias}; /new to apply.")
            return
        cfg["defult_config_name"] = fast_alias
        cli_config.save_config(cfg)
        print(f"Fast mode on — alias set to {fast_alias}; /new to apply.")

    def _cmd_plan_mode(args: str):
        """动态切换 plan mode：启用后 AI 会先访谈用户确认计划再执行"""
        arg = args.strip().lower()
        if not agent:
            print("Agent not initialized.")
            return
        
        if arg in {"on", "1", "true", "enable"}:
            agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
            cfg["plan_mode"] = True
            cli_config.save_config(cfg)
            print("\033[1;36m⚡ Plan mode enabled\033[0m")
            print("  The AI will interview you about your plan before acting.")
            print("  Setting saved to config (persists across restarts).")
            print()
        elif arg in {"off", "0", "false", "disable"}:
            agent.inject_system_prompt(prefix="")
            cfg["plan_mode"] = False
            cli_config.save_config(cfg)
            print("\033[33m⚠ Plan mode disabled\033[0m")
            print("  Setting saved to config (persists across restarts).")
        elif arg == "status" or arg == "":
            injected_prefix = getattr(agent, '_injected_prefix', "") or ""
            if injected_prefix:
                preview = injected_prefix[:100].replace("\n", " ")
                if len(injected_prefix) > 100:
                    preview += "..."
                print(f"Plan mode: \033[1;32menabled\033[0m")
                print(f"  Prefix: \"{preview}\"")
            else:
                print(f"Plan mode: \033[2mdisabled\033[0m")
        else:
            print("Usage: /plan_mode [on|off|status]")
            print("  on/off   - Enable/disable plan mode (saved to config)")
            print("  status   - Show current status (default)")

        # Refresh toolbar to show plan_mode state
        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)
    
    def _cmd_inject(args: str):
        """注入自定义提示词到 system message。
        
        用法:
            /inject prefix <text>   - 添加前缀提示词
            /inject suffix <text>   - 添加后缀提示词
            /inject clear           - 清除所有注入的提示词
            /inject status          - 显示当前注入状态
        """
        if not agent:
            print("Agent not initialized.")
            return
        
        parts = args.strip().split(maxsplit=1)
        if not parts:
            print("Usage: /inject [prefix|suffix|clear|status] [text]")
            return
        
        action = parts[0].lower()
        text = parts[1] if len(parts) > 1 else ""
        
        if action == "prefix":
            if not text:
                print("Usage: /inject prefix <text>")
                return
            agent.inject_system_prompt(prefix=text)
            print(f"\033[1;36m✓ Prefix injected:\033[0m \"{text[:60]}...\"" if len(text) > 60 else f"\033[1;36m✓ Prefix injected:\033[0m \"{text}\"")
        elif action == "suffix":
            if not text:
                print("Usage: /inject suffix <text>")
                return
            agent.inject_system_prompt(suffix=text)
            print(f"\033[1;36m✓ Suffix injected:\033[0m \"{text[:60]}...\"" if len(text) > 60 else f"\033[1;36m✓ Suffix injected:\033[0m \"{text}\"")
        elif action == "clear":
            agent.inject_system_prompt(prefix="", suffix="")
            print("\033[33m⚠ All injected prompts cleared\033[0m")
        elif action == "status":
            prefix = getattr(agent, '_injected_prefix', "") or "(none)"
            suffix = getattr(agent, '_injected_suffix', "") or "(none)"
            if len(prefix) > 100:
                prefix = prefix[:100] + "..."
            if len(suffix) > 100:
                suffix = suffix[:100] + "..."
            print("Current injected prompts:")
            print(f"  Prefix: \"{prefix}\"")
            print(f"  Suffix: \"{suffix}\"")
        else:
            print("Usage: /inject [prefix|suffix|clear|status] [text]")

    # ── Dispatch table ──────────────────────────────────────────────────────
    # arity: 0 = no args, -1 = rest of line
    _handlers: dict = {
        "help":      (_cmd_help,      0),
        "h":         (_cmd_help,      0),
        "?":         (_cmd_help,      0),
        "quit":      (_cmd_quit,      0),
        "exit":      (_cmd_quit,      0),
        "q":         (_cmd_quit,      0),
        "config":    (_cmd_config,    0),
        "status":    (_cmd_status,    0),
        "info":      (_cmd_info,      0),
        "new":       (_cmd_new,      -1),
        "switch":    (_cmd_switch,   -1),
        "list":      (_cmd_list,      0),
        "ls":        (_cmd_list,      0),
        "rename":    (_cmd_rename,   -1),
        "history":   (_cmd_history,   0),
        "save":      (_cmd_save,      0),
        "retry":     (_cmd_retry,     0),
        "clear":     (_cmd_clear,     0),
        "cls":       (_cmd_clear,     0),
        "model":     (_cmd_model,    -1),
        "m":         (_cmd_model,    -1),
        "models":    (_cmd_models,   -1),
        "listmodels":(_cmd_models,   -1),
        "resume":    (_cmd_resume,   -1),
        "search":    (_cmd_search,   -1),
        "copy":      (_cmd_copy,     -1),
        "reasoning": (_cmd_reasoning, -1),
        "verbose":   (_cmd_verbose,   0),
        "bell":      (_cmd_bell,     -1),
        "fast":      (_cmd_fast,     -1),
        "plan_mode": (_cmd_plan_mode,-1),
        "pm":        (_cmd_plan_mode,-1),  # alias
        "inject":    (_cmd_inject,   -1),
    }

    async def _dispatch(raw: str) -> bool:
        parts = raw.lstrip("/").split(maxsplit=1)
        key = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""
        entry = _handlers.get(key)
        if entry is None:
            resolved = resolve_command(raw)
            if resolved:
                entry = _handlers.get(resolved.name)
        if entry is None:
            print(f"Unknown command: /{key}. Type /help for available commands.")
            return False
        handler, arity = entry
        result = handler() if arity == 0 else handler(args)
        if asyncio.iscoroutine(result):
            await result
        return True

    # ── Chat turn ───────────────────────────────────────────────────────────
    async def _do_chat(user_input: str):
        nonlocal last_user_msg, agent, current_thread
        last_user_msg = user_input
        start_time = time.time()

        if agent is None:
            try:
                agent = await _init_agent(current_session_id)
            except Exception as e:
                print(f"Failed to reconnect: {e}")
                return

        # Update token limit from agent's llm_mode_config
        llm_config = getattr(agent, '_llm_mode_config', {})
        config_name = getattr(agent, '_defult_config_name', '')
        if llm_config and config_name:
            entry = llm_config.get(config_name)
            if entry:
                # entry is a ModelEntry dataclass (V2) or [model, token_limit] tuple (V1)
                if hasattr(entry, "token_limit"):
                    stats.token_limit = entry.token_limit
                elif isinstance(entry, (list, tuple)) and len(entry) >= 2:
                    stats.token_limit = entry[1]

        # 确保 Thread 存在且状态为 ACTIVE
        if current_thread is None:
            current_thread = await _get_or_create_thread(current_session_id)
        current_thread.status = RunStatus.ACTIVE

        stats.start_turn()
        try:
            # ── Hermes-style: Pre-execution dangerous command check ───────────
            if HAS_TUI and is_dangerous_command(user_input):
                try:
                    approval = approval_callback(
                        prompt_func=None,  # Use terminal input fallback
                        command=user_input,
                        description="This command may be destructive. Approve?",
                        timeout=60,
                    )
                    if approval == "deny":
                        print("\n  \033[33m⚠ Command denied by user.\033[0m\n")
                        return
                    elif approval == "once":
                        pass  # Execute once
                    elif approval in ("session", "always"):
                        # Store approval for session
                        _session_approved_commands = getattr(
                            _do_chat, "_approved_cmds", set()
                        )
                        _session_approved_commands.add(user_input)
                        _do_chat._approved_cmds = _session_approved_commands
                except Exception as e:
                    print(f"\n  \033[33m⚠ Approval check failed: {e}\033[0m\n")
                    # Continue anyway on error

            # ── Hermes-style: Interrupt signal check ─────────────────────────
            if HAS_TUI and is_interrupted():
                clear_interrupt()

                print("\n  \033[33m⚠ 正在中断当前命令...\033[0m")

                try:
                    # 1. 暂停 agent（取消当前 LLM/工具调用）
                    await agent.pause()

                    # 2. 等待任务被取消
                    await asyncio.sleep(0.1)

                    # 3. 恢复 agent 状态（以便后续对话可以继续）
                    await agent.resume()

                    print("  \033[32m✓ 已中断，状态已重置\033[0m\n")

                except Exception as e:
                    logger.warning(f"Failed to pause/resume agent: {e}")
                    print(f"\n  \033[33m⚠ 中断时出现错误: {e}\033[0m\n")

                return  # 中断当前命令执行

            # 使用 renderer 渲染消息流
            await renderer.render(agent.run_stream(task=user_input), stats)

        except Exception as e:
            print(f"Error: {e}")
            logger.debug("Chat error", exc_info=e)
        finally:
            # 保存状态和消息到数据库
            try:
                # 1. 保存 agent 状态
                if agent and hasattr(agent, "save_state"):
                    state_dict = await agent.save_state()
                    await _save_thread_state(current_session_id, state_dict)

                # 2. 更新 Thread 状态
                if current_thread:
                    current_thread.status = RunStatus.COMPLETE
                    current_thread.updated_at = time.time()

                    # 3. 持久化到数据库
                    response = db_manager.upsert(current_thread)
                    if not response.status:
                        logger.warning(f"Failed to save thread: {response.message}")

            except Exception as e:
                logger.warning(f"Failed to save conversation state: {e}", exc_info=True)

    # ── Main input loop ─────────────────────────────────────────────────────
    while True:
        global _pending_retry
        
        if _pending_retry is not None:
            user_input = _pending_retry
            _pending_retry = None
            try:
                await _do_chat(user_input)
            except KeyboardInterrupt:
                if await _handle_interrupt(agent, set_exit_flag=True):
                    continue
                break
            continue

        try:
            raw = await prompt_reader.prompt()
        except (EOFError, asyncio.CancelledError):
            print()
            break
        except KeyboardInterrupt:
            # Ctrl+C handling: gracefully interrupt agent or exit
            print()  # newline after ^C

            # Check for Hermes-style external interrupt signal first
            if HAS_TUI and is_interrupted():
                clear_interrupt()

            # 处理中断
            if await _handle_interrupt(agent, set_exit_flag=True):
                continue  # 继续循环
            break  # 无 agent，退出

        user_input = (raw or "").strip()
        if not user_input:
            continue

        if user_input.startswith("/"):
            try:
                await _dispatch(user_input)
            except SystemExit:
                raise
            except Exception as e:
                print(f"Command error: {e}")
            continue

        try:
            await _do_chat(user_input)
        except KeyboardInterrupt:
            if await _handle_interrupt(agent, set_exit_flag=True):
                continue
            break

    print("Bye!")
    try:
        await asyncio.wait_for(_close_agent(), timeout=1.0)
    except Exception:
        pass
    _hard_exit(0)


def _hard_exit(code: int = 0) -> None:
    """Exit without waiting on background executor / thread joins.

    DrSaiAssistant and its async stack leave daemon-like workers in the
    default ThreadPoolExecutor. Python's atexit blocks on ``thread.join``,
    which otherwise forces the user to press Ctrl+C again after "Bye!".
    """
    try:
        sys.stdout.flush()
    except Exception:
        pass
    try:
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(code)


def run():
    # Check if no subcommand was provided → run chat REPL directly
    if len(sys.argv) == 1 or (len(sys.argv) == 2 and sys.argv[1].startswith("-")):
        # `drsai` or `drsai -u http://...` → run chat
        # Re-parse with 'chat' as implicit subcommand
        sys.argv.insert(1, "chat")
    try:
        app()
    except KeyboardInterrupt:
        print("\nInterrupted. Goodbye!")
        _hard_exit(0)
    except SystemExit as e:
        _hard_exit(int(e.code) if isinstance(e.code, int) else 0)
    _hard_exit(0)


if __name__ == "__main__":
    run()
