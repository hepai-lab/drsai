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
from typing import Optional,Any

import typer
from loguru import logger
from prompt_toolkit.patch_stdout import patch_stdout

from drsai.configs.constant import APPNAME, VERSION
from drsai.backend.cli import config as cli_config
from drsai.backend.cli import status as cli_status
from drsai.backend.cli.banner import configure_cli_logging, print_banner, print_config_info
from drsai.backend.cli.commands import format_help, resolve_command
from drsai.backend.cli.history import CLISessionStore
from drsai.backend.cli.prompt import DrSaiPrompt
from drsai.backend.cli.renderer import DrSaiCLIRenderer
from drsai.backend.cli.theme import ansi, ansi_reset
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
    print(f"\n  {ansi('notify_warn')}⚠ 正在中断当前命令...{ansi_reset()}")

    if agent is not None:
        try:
            await agent.pause()
            await asyncio.sleep(0.1)
            await agent.resume()
            print(f"  {ansi('notify_ok')}✓ 已中断，状态已重置{ansi_reset()}")

            if set_exit_flag:
                print("  按 Enter 继续，或再次 Ctrl+D 退出\n")
                if HAS_TUI:
                    set_interrupt(True)
                return True  # 继续循环
            else:
                print()  # 换行
                return True  # 继续循环

        except Exception as e:
            logger.warning(f"Failed to pause/resume agent: {e}")
            print(f"  {ansi('notify_error')}✗ 中断时出错: {e}{ansi_reset()}\n")
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
        # Instead of hard exit, prompt user to input a key interactively
        cfg = _interactive_setup(api_key_only=True)
        # Re-check after setup
        any_key = any([
            cfg.get("api_key"),
            cfg.get("anthropic_api_key"),
            cfg.get("openai_api_key"),
            os.environ.get("ANTHROPIC_API_KEY"),
            os.environ.get("OPENAI_API_KEY"),
        ])
        if not any_key:
            typer.echo(typer.style(
                "  No API key configured. Set one via environment variables:\n"
                "    HEPAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY\n",
                fg=typer.colors.RED,
            ))
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


def _interactive_setup(*, api_key_only: bool = False) -> dict:
    """First-time setup wizard — configure user identity and/or API keys.

    Args:
        api_key_only: If True, only prompt for API keys (skip user_id/model).
                      Used when the app starts without any key and needs one
                      before it can proceed.

    Returns:
        Updated config dict.
    """
    if api_key_only:
        typer.echo(typer.style(
            "\n  \u26a0 No API key found \u2014 let\u2019s set one up first.\n",
            fg=typer.colors.YELLOW, bold=True,
        ))
    else:
        typer.echo(typer.style(
            "\n  Welcome to DrSai CLI! Let\u2019s configure your profile.\n",
            fg=typer.colors.GREEN, bold=True,
        ))
    typer.echo(f"  Config will be saved to: {cli_config.CLI_CONFIG_PATH}\n")

    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)

    # ── User identity (skip if api_key_only) ──────────────────────────────────────────────────────────────────────────────────────────
    if not api_key_only:
        cfg["user_id"] = typer.prompt(
            "  Your user id",
            default=cfg.get("user_id", "anonymous"),
        ).strip()

        # ── Default model ──────────────────────────────────────────────────────────────────────────────────────
        typer.echo("")
        cfg["defult_config_name"] = typer.prompt(
            "  Default model name (e.g. hepai/minimax-m2.7-highspeed)",
            default=cfg.get("defult_config_name") or "",
        ).strip() or None

    # ── API Key setup ──────────────────────────────────────────────────────────────────────────────────────
    # Check if any key is already configured (config + env vars)
    existing_keys = any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("HEPAI_API_KEY"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])

    if not existing_keys or api_key_only:
        typer.echo("")
        typer.echo(typer.style("  \u2500\u2500 API Key Configuration \u2500\u2500", fg=typer.colors.CYAN, bold=True))
        typer.echo("  Choose an API provider:")
        typer.echo("    1. HepAI     (\u63a8\u8350 \u2014 \u56fd\u5185\u9ad8\u901f\u6a21\u578b, https://hepai.ai)")
        typer.echo("    2. Anthropic (Claude \u7cfb\u5217)")
        typer.echo("    3. OpenAI    (GPT \u7cfb\u5217)")
        typer.echo("    4. \u8df3\u8fc7 \u2014 \u6211\u4f1a\u901a\u8fc7\u73af\u5883\u53d8\u91cf\u8bbe\u5b9a")
        typer.echo("")

        choice = typer.prompt("  \u9009\u62e9 (1-4)", default="1").strip()

        import getpass

        if choice == "1":
            # ── HepAI ──────────────────────────────────────────────────────────────────────────────────────
            typer.echo(typer.style("\n  HepAI API Key", fg=typer.colors.CYAN))
            key = getpass.getpass("  Enter your HepAI API Key (input hidden): ").strip()
            if key:
                cfg["api_key"] = key
                os.environ["HEPAI_API_KEY"] = key
                typer.echo(typer.style(f"  \u2705 HepAI Key saved: {cli_config.mask_key(key)}", fg=typer.colors.GREEN))
            else:
                typer.echo(typer.style("  \u26a0 Empty key \u2014 skipped", fg=typer.colors.YELLOW))

            base_url = typer.prompt(
                "  HepAI Base URL (optional, press Enter for default)",
                default="",
            ).strip()
            if base_url:
                cfg["openai_base_url"] = base_url
                os.environ["OPENAI_BASE_URL"] = base_url

        elif choice == "2":
            # ── Anthropic ──────────────────────────────────────────────────────────────────────────────────────
            typer.echo(typer.style("\n  Anthropic API Key", fg=typer.colors.CYAN))
            key = getpass.getpass("  Enter your Anthropic API Key (input hidden): ").strip()
            if key:
                cfg["anthropic_api_key"] = key
                os.environ["ANTHROPIC_API_KEY"] = key
                typer.echo(typer.style(f"  \u2705 Anthropic Key saved: {cli_config.mask_key(key)}", fg=typer.colors.GREEN))
            else:
                typer.echo(typer.style("  \u26a0 Empty key \u2014 skipped", fg=typer.colors.YELLOW))

            base_url = typer.prompt(
                "  Anthropic Base URL (optional, default: https://api.anthropic.com)",
                default="",
            ).strip()
            if base_url:
                cfg["anthropic_base_url"] = base_url
                os.environ["ANTHROPIC_BASE_URL"] = base_url

        elif choice == "3":
            # ── OpenAI ──────────────────────────────────────────────────────────────────────────────────────
            typer.echo(typer.style("\n  OpenAI API Key", fg=typer.colors.CYAN))
            key = getpass.getpass("  Enter your OpenAI API Key (input hidden): ").strip()
            if key:
                cfg["openai_api_key"] = key
                os.environ["OPENAI_API_KEY"] = key
                typer.echo(typer.style(f"  \u2705 OpenAI Key saved: {cli_config.mask_key(key)}", fg=typer.colors.GREEN))
            else:
                typer.echo(typer.style("  \u26a0 Empty key \u2014 skipped", fg=typer.colors.YELLOW))

            base_url = typer.prompt(
                "  OpenAI Base URL (optional, default: https://api.openai.com/v1)",
                default="",
            ).strip()
            if base_url:
                cfg["openai_base_url"] = base_url
                os.environ["OPENAI_BASE_URL"] = base_url

        elif choice == "4":
            typer.echo(typer.style("  \u2139 Skipped \u2014 set env vars before running:", fg=typer.colors.YELLOW))
            typer.echo("    HEPAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY")

        else:
            typer.echo(typer.style(f"  \u26a0 Unknown choice: {choice}", fg=typer.colors.YELLOW))

    # ── Save config ──────────────────────────────────────────────────────────────────────────────────────
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
            print(f"  Resuming: {ansi('notify_info')}{existing.name}{ansi_reset()} [{current_session_id[:8]}] (workdir: {current_workdir})")
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
        print(f"  New session: {ansi('notify_info')}{session_name}{ansi_reset()} [{current_session_id[:8]}] (workdir: {current_workdir})")

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
        print(f"  {ansi('notify_error')}Failed to initialize agent:{ansi_reset()} {e}")
        print("  Check your environment / config.")
        return

    # ── Load project-level instructions (DRSAI.md / CLAUDE.md) ────────────
    from drsai.backend.cli.drsaimd_loader import load_project_instructions

    # 只在全新 session 或没有从 load_state 恢复项目指令时才加载
    existing_project_instr = getattr(agent, '_project_instructions', '') or ''
    if not existing_project_instr:
        project_instructions, loaded_paths, md_warnings = load_project_instructions(str(Path.cwd()))
        if project_instructions:
            # 注入项目指令到 system prompt 的 project_instructions 层
            prefix = getattr(agent, '_injected_prefix', '') or ''
            suffix = getattr(agent, '_injected_suffix', '') or ''
            agent.inject_system_prompt(
                prefix=prefix,
                suffix=suffix,
                project_instructions=project_instructions,
            )
            # 显示加载信息
            for p in loaded_paths:
                short_path = Path(p).name if Path(p).parent == Path.cwd() else str(Path(p).relative_to(Path.cwd())) if Path.cwd() in Path(p).parents else p
                print(f"  {ansi('notify_ok')}✓ Project instructions loaded: {short_path}{ansi_reset()}")
            # 显示超限警告
            for w in md_warnings:
                print(f"  {ansi('warn')}{w}{ansi_reset()}")
            # 保存状态以持久化项目指令
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)
    else:
        # 从 session state 恢复的项目指令
        logger.info(f"Project instructions restored from session state ({len(existing_project_instr)} chars)")

    # ── ✅ 定时任务 + 通知推送（远程 worker 模式）───────────────────────────
    # 当配置了 worker URL 时，定时任务委托给后台 worker 进程，
    # CLI 后台轮询 /notifications 接口，有通知时打印到终端。
    _notification_poller_task: Optional[asyncio.Task] = None
    _remote_task_manager: Optional[Any] = None

    worker_url = cfg.get("url")  # 如 "http://localhost:42858/apiv2"
    if worker_url:
        from drsai.modules.agents.skills_agent.managers import RemoteScheduledTaskManager

        # 构造远程 task_manager 代理
        remote_api_key = cfg.get("api_key") or os.environ.get("HEPAI_API_KEY", "")
        _remote_task_manager = RemoteScheduledTaskManager(
            worker_url=worker_url,
            api_key=remote_api_key,
        )

        # 注入到 agent（让 ScheduledTaskManager tool 可以使用远程 API）
        if hasattr(agent, "set_task_manager"):
            agent.set_task_manager(_remote_task_manager)
            print(f"  {ansi('notify_ok')}✓ 定时任务已连接到 worker: {worker_url}{ansi_reset()}")

        # ✅ 后台轮询通知
        async def _notification_poller():
            """每 30 秒轮询 worker 的 /notifications 接口，有通知时打印到终端"""
            poll_interval = 30
            while True:
                try:
                    await asyncio.sleep(poll_interval)
                    notifications = await _remote_task_manager.get_pending_notifications(user_id)
                    if notifications:
                        for n in notifications:
                            status_icon = {"success": "✅", "error": "❌", "timeout_partial": "⏱️"}.get(n.status, "❓")
                            status_text = {
                                "success": "成功",
                                "error": "失败",
                                "timeout_partial": "超时(部分结果已保存)",
                            }.get(n.status, n.status)
                            color = ansi('notify_ok') if n.status == "success" else ansi('notify_error')
                            print(f"\n  {color}{status_icon} 定时任务通知: {n.task_name} — {status_text} ({n.timestamp}){ansi_reset()}")
                            if n.summary:
                                print(f"    {ansi('system_info')}{n.summary}{ansi_reset()}")
                        # 通知已由 worker 端 get_pending_notifications 清除
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.debug(f"Notification poller error: {e}")

        _notification_poller_task = asyncio.create_task(_notification_poller(), name="notification_poller")
        print(f"  {ansi('notify_ok')}✓ 通知轮询已启动 (每30秒){ansi_reset()}")
    else:
        # 无 worker URL：本地模式，暂不支持定时任务推送
        print(f"  {ansi('system_info')}ℹ 定时任务推送需要 worker 后端 (配置 --url){ansi_reset()}")

    # ── Auto-activate plan mode if configured ──────────────────────────────
    PLAN_MODE_PROMPT = """Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead."""

    if cfg.get("plan_mode", False):
        if hasattr(agent, "inject_system_prompt"):
            # Only inject from global config if agent doesn't already have
            # a prefix from a restored session state (load_state)
            existing_prefix = getattr(agent, '_injected_prefix', "") or ""
            if not existing_prefix:
                agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
                print(f"  {ansi('notify_ok')}⚡ Plan mode auto-enabled (from config){ansi_reset()}")
            else:
                print(f"  {ansi('notify_ok')}⚡ Plan mode restored (from session state){ansi_reset()}")

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
        # Read model from agent (session-local), fallback to global default
        model_name = getattr(agent, '_defult_config_name', None) or cfg.get("defult_config_name") or "auto"
        if len(model_name) > 40:
            model_name = model_name[:37] + "..."
        
        parts = [f"{user_id} @ {model_name}"]
        
        if stats.turns:
            parts.append(f"turns: {stats.turns}")
        if renderer.show_reasoning:
            parts.append("reasoning: on")
        # Read plan_mode from agent (injected_prefix = PLAN_MODE_PROMPT)
        injected_prefix = getattr(agent, '_injected_prefix', "") or ""
        if injected_prefix:
            parts.append("plan-mode: on")
        # Read workspace restriction from agent
        ws_enabled = getattr(agent, '_only_in_workspace', None)
        if ws_enabled is True:
            parts.append("🔒 workdir-only")
        elif ws_enabled is False:
            parts.append("⚠️ any-path")
        # Read dangerous command permission from agent
        dangerous_allowed = getattr(agent, '_get_dangerous_allowed', None)
        if dangerous_allowed is not None:
            da = dangerous_allowed()
            if da:
                parts.append("⚠️ all-cmd")
            else:
                parts.append("🛡 safe-cmd")
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
        # ✅ 停止通知轮询器
        if _notification_poller_task:
            _notification_poller_task.cancel()
            try:
                await _notification_poller_task
            except asyncio.CancelledError:
                pass
        # ✅ 关闭远程 task_manager
        if _remote_task_manager:
            try:
                await _remote_task_manager.close()
            except Exception:
                pass
        # Fire-and-forget close; os._exit will tear down any threads the
        # assistant left behind without waiting on the GIL.
        try:
            await asyncio.wait_for(_close_agent(), timeout=1.0)
        except Exception:
            pass
        _hard_exit(0)

    def _cmd_config():
        cli_config.show_config(cfg)

    async def _cmd_setup():
        """Re-open the setup wizard to change API key / configuration.

        This allows the user to reconfigure at any time via /setup
        command, similar to the tray app's /setup command and "配置" menu.
        """
        nonlocal cfg, agent
        print()
        print(typer.style("  Opening setup wizard...", fg=typer.colors.CYAN))
        new_cfg = _interactive_setup()

        # If we had a previous agent, close it first
        if agent is not None:
            try:
                await _close_agent()
            except Exception:
                pass

        # Update cfg with new values and re-initialize
        cfg = new_cfg
        agent = await _init_agent(current_session_id)

        print(typer.style("  ✅ Setup complete! Agent re-initialized.", fg=typer.colors.GREEN))
        print()

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
            model_name=getattr(agent, '_defult_config_name', None) or cfg.get("defult_config_name") or "auto",
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
            cur = f" {ansi('notify_info')}<-- current{ansi_reset()}" if info.thread_id == current_session_id else ""
            workdir_hint = ""
            if info.workdir:
                # Show last part of workdir if it's the current one
                if info.workdir == current_workdir:
                    workdir_hint = f" {ansi('notify_ok')}[current workdir]{ansi_reset()}"
                else:
                    workdir_hint = f" {ansi('system_info')}({Path(info.workdir).name}){ansi_reset()}"
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
            # Show current model with source info (session-local vs global default)
            current = getattr(agent, '_defult_config_name', None) or cfg.get("defult_config_name") or "<default>"
            global_default = cfg.get("defult_config_name") or "<default>"
            if current != global_default:
                print(f"Current model: {current} (session-local)")
                print(f"Global default: {global_default}")
            else:
                print(f"Current model: {current} (default)")
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

        # Switch to the specified model (session-local only)
        # NOTE: cfg dict is NOT modified — toolbar reads from agent directly

        # Create new model client and switch the agent's model
        if agent is not None and hasattr(agent, '_set_model_client'):
            try:
                new_client = agent._set_model_client(args)
                await agent.switch_model(new_client)
                agent._defult_config_name = args
                print(f"Model switched to {args} (session-local)")

                # Update token_limit for stats footer and agent context
                entry = llm_mode_config.get(args)
                if entry and hasattr(entry, "token_limit"):
                    stats.token_limit = entry.token_limit

                # Immediately persist session-local state
                state_dict = await agent.save_state()
                await _save_thread_state(current_session_id, state_dict)
            except Exception as e:
                print(f"Warning: model client creation failed: {e}")
                print(f"Model alias set to {args} (will take effect on next session)")
        else:
            print(f"Model alias set to {args}")

        # Refresh bottom toolbar to show new model
        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)

    async def _cmd_model_global(args: str):
        """Switch model for current session AND save as global default.

        Usage:
            /model_global <alias>  - Switch model (session + global default)
            /model_global          - Show global default model
        """
        if not args:
            global_default = cfg.get("defult_config_name") or "<default>"
            print(f"Global default model: {global_default}")
            return

        # Validate the model alias exists
        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        llm_mode_config = load_llm_mode_config(llm_config_path)
        if args not in llm_mode_config:
            print(f"Unknown model alias: {args}")
            print(f"Available aliases: {', '.join(sorted(llm_mode_config.keys()))}")
            return

        # Save as global default
        cfg["defult_config_name"] = args
        cli_config.save_config(cfg)

        # Also switch the current session's model
        if agent is not None and hasattr(agent, '_set_model_client'):
            try:
                new_client = agent._set_model_client(args)
                await agent.switch_model(new_client)
                agent._defult_config_name = args
                print(f"Model switched to {args} (session + global default)")

                entry = llm_mode_config.get(args)
                if entry and hasattr(entry, "token_limit"):
                    stats.token_limit = entry.token_limit

                # Immediately persist session-local state
                state_dict = await agent.save_state()
                await _save_thread_state(current_session_id, state_dict)
            except Exception as e:
                print(f"Warning: model client creation failed: {e}")
                print(f"Global default set to {args} (will take effect on next session)")
        else:
            print(f"Global default set to {args}")

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
        current_alias = getattr(agent, '_defult_config_name', None) or cfg.get("defult_config_name") or DEFAULT_CONFIG_NAME

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

    async def _cmd_reasoning(args: str):
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
                    # Immediately persist session-local state
                    state_dict = await agent.save_state()
                    await _save_thread_state(current_session_id, state_dict)
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

    async def _cmd_fast(args: str):
        arg = args.strip().lower()
        from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
        llm_config_path = os.environ.get("LLM_CONFIG_FILE") or cfg.get("llm_config_file")
        catalog = load_llm_mode_config(llm_config_path)
        fast_alias = next(
            (k for k in catalog if "highspeed" in k or "flash" in k or "haiku" in k),
            None,
        )
        if fast_alias is None:
            print("No obviously-fast alias in the catalog; set one via /model.")
            return
        if arg == "off":
            # Switch back to the first (default) alias in catalog
            default_alias = next(iter(catalog))
            if agent is not None and hasattr(agent, '_set_model_client'):
                try:
                    new_client = agent._set_model_client(default_alias)
                    await agent.switch_model(new_client)
                    agent._defult_config_name = default_alias
                    print(f"Fast mode off — switched back to {default_alias} (session-local)")
                    
                    entry = catalog.get(default_alias)
                    if entry and hasattr(entry, "token_limit"):
                        stats.token_limit = entry.token_limit

                    # Immediately persist session-local state
                    state_dict = await agent.save_state()
                    await _save_thread_state(current_session_id, state_dict)
                except Exception as e:
                    print(f"Warning: model switch failed: {e}")
            else:
                print(f"Fast mode off — alias back to {default_alias}")
            return

        # Switch to fast model (session-local only)
        if agent is not None and hasattr(agent, '_set_model_client'):
            try:
                new_client = agent._set_model_client(fast_alias)
                await agent.switch_model(new_client)
                agent._defult_config_name = fast_alias
                print(f"Fast mode on — switched to {fast_alias} (session-local)")

                entry = catalog.get(fast_alias)
                if entry and hasattr(entry, "token_limit"):
                    stats.token_limit = entry.token_limit

                # Immediately persist session-local state
                state_dict = await agent.save_state()
                await _save_thread_state(current_session_id, state_dict)
            except Exception as e:
                print(f"Warning: model switch failed: {e}")
        else:
            print(f"Fast mode on — alias set to {fast_alias}")

        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)

    async def _cmd_plan_mode(args: str):
        """动态切换 plan mode (session-local)：启用后 AI 会先访谈用户确认计划再执行"""
        arg = args.strip().lower()
        if not agent:
            print("Agent not initialized.")
            return
        
        if arg in {"on", "1", "true", "enable"}:
            agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
            # cfg["plan_mode"] is NOT modified — toolbar reads from agent
            print(f"{ansi('notify_ok')}⚡ Plan mode enabled (session-local){ansi_reset()}")
            print("  The AI will interview you about your plan before acting.")
            print()

            # Immediately persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)
        elif arg in {"off", "0", "false", "disable"}:
            agent.inject_system_prompt(prefix="")
            print(f"{ansi('notify_warn')}⚠ Plan mode disabled (session-local){ansi_reset()}")

            # Immediately persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)
        elif arg == "status" or arg == "":
            injected_prefix = getattr(agent, '_injected_prefix', "") or ""
            global_plan = cfg.get("plan_mode", False)
            if injected_prefix:
                preview = injected_prefix[:100].replace("\n", " ")
                if len(injected_prefix) > 100:
                    preview += "..."
                print(f"Plan mode: {ansi('notify_ok')}enabled (session-local){ansi_reset()}")
                print(f"  Prefix: \"{preview}\"")
                print(f"  Global default: {'on' if global_plan else 'off'}")
            else:
                print(f"Plan mode: {ansi('system_info')}disabled{ansi_reset()}")
                if global_plan:
                    print(f"  Global default: on")
        else:
            print("Usage: /plan_mode [on|off|status]")
            print("  on/off   - Enable/disable plan mode (session-local)")
            print("  status   - Show current status (default)")
            print("  /pm_global [on|off] - Set global default")

        # Refresh toolbar to show plan_mode state
        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)
    
    async def _cmd_pm_global(args: str):
        """切换 plan mode (session + global default)"""
        arg = args.strip().lower()
        if not agent:
            print("Agent not initialized.")
            return
        
        if arg in {"on", "1", "true", "enable"}:
            agent.inject_system_prompt(prefix=PLAN_MODE_PROMPT)
            cfg["plan_mode"] = True
            cli_config.save_config(cfg)
            print(f"{ansi('notify_ok')}⚡ Plan mode enabled (session + global default){ansi_reset()}")
            print("  The AI will interview you about your plan before acting.")
            print("  Setting saved to global config (new sessions will use this).")
            print()

            # Immediately persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)
        elif arg in {"off", "0", "false", "disable"}:
            agent.inject_system_prompt(prefix="")
            cfg["plan_mode"] = False
            cli_config.save_config(cfg)
            print(f"{ansi('notify_warn')}⚠ Plan mode disabled (session + global default){ansi_reset()}")
            print("  Setting saved to global config (new sessions will use this).")

            # Immediately persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)
        elif arg == "status" or arg == "":
            global_plan = cfg.get("plan_mode", False)
            print(f"Global default plan_mode: {'on' if global_plan else 'off'}")
        else:
            print("Usage: /pm_global [on|off|status]")
            print("  on/off   - Enable/disable (session + global default)")
            print("  status   - Show global default (default)")

        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)

    async def _cmd_workspace(args: str):
        """Toggle workspace restriction (only_in_workspace) on/off or show status.

        When enabled, all file operations and shell commands are restricted to
        the user's project directory (cwd) + internal storage directory.
        When disabled, the agent can access any path on the filesystem.
        """
        arg = args.strip().lower()
        if not agent:
            print("Agent not initialized.")
            return

        # Find toggle helpers in _workspace_toggle_funcs
        toggle_funcs = getattr(agent, '_workspace_toggle_funcs', [])
        set_fn = next((f for f in toggle_funcs if f.__name__ == "set_workspace_restriction"), None)
        get_fn = next((f for f in toggle_funcs if f.__name__ == "get_workspace_status"), None)

        if not set_fn or not get_fn:
            print("Workspace toggle functions not available (agent may be using an older version).")
            return

        if arg in {"on", "1", "true", "enable"}:
            result = set_fn(True)
            agent._only_in_workspace = True  # sync agent-level flag
            status = get_fn()
            print(f"{ansi('notify_ok')}🔒 Workspace restriction enabled{ansi_reset()}")
            print(f"  Work dir:  {status['work_dir']}")
            allowed = status['allowed_dirs']
            if len(allowed) > 3:
                shown = allowed[:3]
                print(f"  Allowed:   {', '.join(str(d) for d in shown)}, ... ({len(allowed)} dirs total)")
            else:
                print(f"  Allowed:   {', '.join(str(d) for d in allowed)}")
            print("  All file/shell operations are restricted to these directories.")
            print()

            # Persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)

        elif arg in {"off", "0", "false", "disable"}:
            result = set_fn(False)
            agent._only_in_workspace = False  # sync agent-level flag
            print(f"{ansi('notify_warn')}⚠ Workspace restriction disabled{ansi_reset()}")
            print("  The agent can now access any path on the filesystem.")
            print()

            # Persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)

        elif arg == "status" or arg == "":
            status = get_fn()
            enabled = status['only_in_workspace']
            icon = "🔒" if enabled else "🔓"
            style = ansi('notify_ok') if enabled else ansi('notify_warn')
            reset = ansi_reset()
            print(f"{icon} Workspace restriction: {style}{'enabled' if enabled else 'disabled'}{reset}")
            print(f"  Work dir:  {status['work_dir']}")
            allowed = status['allowed_dirs']
            if len(allowed) > 3:
                shown = allowed[:3]
                print(f"  Allowed:   {', '.join(str(d) for d in shown)}, ... ({len(allowed)} dirs total)")
            else:
                print(f"  Allowed:   {', '.join(str(d) for d in allowed)}")
            print()
            print("Usage: /workspace [on|off|status]")
            print("  on/off   - Enable/disable restriction (session-local)")
            print("  status   - Show current status (default)")

        else:
            print("Usage: /workspace [on|off|status]")
            print("  on/off   - Enable/disable restriction (session-local)")
            print("  status   - Show current status")

        # Refresh toolbar to show workspace state
        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)

    async def _cmd_dangerous(args: str):
        """Toggle dangerous command execution permission on/off or show status.

        When disabled (default), both _DANGEROUS_PATTERNS (system-level commands
        like sudo, rm -rf) and _SCRIPT_EXEC_PATTERNS (python/bash/sh script
        execution) are blocked in run_bash/run_bash_background/run_powershell.
        When enabled (/dangerous on), all dangerous and script execution commands
        are allowed without restriction.
        """
        arg = args.strip().lower()
        if not agent:
            print("Agent not initialized.")
            return

        # Find toggle helpers in _dangerous_toggle_funcs
        toggle_funcs = getattr(agent, '_dangerous_toggle_funcs', [])
        set_fn = next((f for f in toggle_funcs if f.__name__ == "set_dangerous_allowed"), None)
        get_fn = next((f for f in toggle_funcs if f.__name__ == "get_dangerous_status"), None)

        if not set_fn or not get_fn:
            print("Dangerous toggle functions not available (agent may be using an older version).")
            return

        if arg in {"on", "1", "true", "enable"}:
            result = set_fn(True)
            print(f"{ansi('notify_warn')}⚠️ Dangerous command execution allowed{ansi_reset()}")
            print("  sudo, rm -rf, python, bash, sh and similar commands will NOT be blocked.")
            print("  Use /dangerous off to re-enable protection.")
            print()

            # Persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)

        elif arg in {"off", "0", "false", "disable"}:
            result = set_fn(False)
            print(f"{ansi('notify_ok')}🛡 Dangerous command protection enabled{ansi_reset()}")
            print("  sudo, rm -rf, shutdown, python, bash, sh etc. are BLOCKED.")
            print("  Use /dangerous on to temporarily allow.")
            print()

            # Persist session-local state
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)

        elif arg == "status" or arg == "":
            status = get_fn()
            allowed = status['dangerous_allowed']
            icon = "⚠️" if allowed else "🛡"
            style = ansi('notify_warn') if allowed else ansi('notify_ok')
            reset = ansi_reset()
            state_str = 'ALLOWED (all commands pass)' if allowed else 'BLOCKED (dangerous + script exec filtered)'
            print(f"{icon} Dangerous command protection: {style}{state_str}{reset}")
            print()
            print("Usage: /dangerous [on|off|status]")
            print("  on    - Allow all dangerous and script execution commands")
            print("  off   - Block dangerous and script execution commands (default)")
            print("  status - Show current status (default)")

        else:
            print("Usage: /dangerous [on|off|status]")
            print("  on    - Allow all dangerous and script execution commands")
            print("  off   - Block dangerous and script execution commands (default)")

        # Refresh toolbar to show dangerous state
        if hasattr(prompt_reader, 'update_bottom_toolbar_fn'):
            prompt_reader.update_bottom_toolbar_fn(_bottom_toolbar)

    async def _cmd_inject(args: str):
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
        needs_persist = False
        
        if action == "prefix":
            if not text:
                print("Usage: /inject prefix <text>")
                return
            agent.inject_system_prompt(prefix=text)
            needs_persist = True
            print(f"{ansi('notify_ok')}✓ Prefix injected:{ansi_reset()} \"{text[:60]}...\"" if len(text) > 60 else f"{ansi('notify_ok')}✓ Prefix injected:{ansi_reset()} \"{text}\"")
        elif action == "suffix":
            if not text:
                print("Usage: /inject suffix <text>")
                return
            agent.inject_system_prompt(suffix=text)
            needs_persist = True
            print(f"{ansi('notify_ok')}✓ Suffix injected:{ansi_reset()} \"{text[:60]}...\"" if len(text) > 60 else f"{ansi('notify_ok')}✓ Suffix injected:{ansi_reset()} \"{text}\"")
        elif action == "clear":
            agent.inject_system_prompt(prefix="", suffix="")
            needs_persist = True
            print(f"{ansi('notify_warn')}⚠ All injected prompts cleared{ansi_reset()}")
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

        # Immediately persist session-local state when prompts changed
        if needs_persist:
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)

    # ── Project instructions commands ──────────────────────────────────────

    def _cmd_init():
        """在当前项目目录生成初始 DRSAI.md 文件。

        类似 Claude Code 的 /init 命令。分析项目结构，自动生成
        包含构建命令、编码标准、架构说明的初始项目指令文件。
        """
        from drsai.backend.cli.drsaimd_loader import init_project_instructions
        filepath, is_new = init_project_instructions(str(Path.cwd()))
        if is_new:
            print(f"  {ansi('notify_ok')}✓ Created project instructions at: {filepath}{ansi_reset()}")
            print("  Edit this file to add project-specific instructions.")
            print("  Use /memory reload to apply changes to the current session.")
            print()
            print("  Tip: Add DRSAI.local.md for personal preferences (auto-ignored by git).")
        else:
            print(f"  {ansi('notify_warn')}⚠ Project instructions already exists at: {filepath}{ansi_reset()}")
            print("  Edit it manually. Use /memory reload after editing.")

    async def _cmd_memory(args: str):
        """查看和管理项目级指令。

        类似 Claude Code 的 /memory 命令。可以查看当前加载的项目指令文件、
        重新加载（在编辑 DRSAI.md 后使用），或显示注入状态。

        用法:
            /memory           - 显示当前加载的项目指令文件
            /memory reload    - 从磁盘重新加载项目指令
            /memory status    - 显示所有 system prompt 层的注入状态
        """
        from drsai.backend.cli.drsaimd_loader import (
            load_project_instructions,
            get_memory_status,
        )

        arg = args.strip().lower()

        if arg == "reload":
            # 重新加载项目指令（用户编辑了 DRSAI.md 后使用）
            if not agent:
                print("Agent not initialized.")
                return

            project_instructions, loaded_paths, md_warnings = load_project_instructions(str(Path.cwd()))
            # 获取当前 prefix/suffix，保持不变
            prefix = getattr(agent, '_injected_prefix', '') or ''
            suffix = getattr(agent, '_injected_suffix', '') or ''
            agent.inject_system_prompt(
                prefix=prefix,
                suffix=suffix,
                project_instructions=project_instructions,  # 明式更新项目指令
            )

            if loaded_paths:
                print(f"  {ansi('notify_ok')}✓ Project instructions reloaded:{ansi_reset()}")
                for p in loaded_paths:
                    short = Path(p).name if Path(p).parent == Path.cwd() else str(Path(p).relative_to(Path.cwd())) if Path.cwd() in Path(p).parents else p
                    lines = Path(p).read_text(encoding="utf-8").split("\n")
                    print(f"    {short} ({len(lines)} lines)")
            # 显示超限警告
            for w in md_warnings:
                print(f"  {ansi('warn')}{w}{ansi_reset()}")
            else:
                print(f"  {ansi('system_info')}ℹ No project instruction files found.{ansi_reset()}")
                print("  Use /init to create one in the current project directory.")

            # 持久化状态
            state_dict = await agent.save_state()
            await _save_thread_state(current_session_id, state_dict)
            return

        if arg == "status":
            # 显示所有 system prompt 层的注入状态
            if not agent:
                print("Agent not initialized.")
                return

            prefix = getattr(agent, '_injected_prefix', '') or ""
            suffix = getattr(agent, '_injected_suffix', '') or ""
            project_instr = getattr(agent, '_project_instructions', '') or ""

            print()
            print("  System prompt layers:")
            print(f"  {'─' * 60}")
            print(f"  ① Prefix (session):          {len(prefix)} chars")
            if prefix:
                preview = prefix[:80].replace("\n", " ")
                if len(prefix) > 80: preview += "..."
                print(f"     Preview: \"{preview}\"")
            print(f"  ② Developer msg (hardcoded): {len(agent._developer_system_message)} chars")
            user_sys = agent._user_profile_manager.get_agent_system_prompt()
            print(f"  ③ AGENTS.md (global):         {len(user_sys)} chars")
            print(f"  ④ Project instructions:       {len(project_instr)} chars")
            if project_instr:
                # 显示来源文件
                mem_status = get_memory_status(str(Path.cwd()))
                for f in mem_status.get("project_files", []):
                    print(f"     Source: {f['path']} ({f['lines']} lines, {f['scope']})")
            print(f"  ⑤ Session_ID:                 fixed")
            print(f"  ⑥ Suffix (session):           {len(suffix)} chars")
            if suffix:
                preview = suffix[:80].replace("\n", " ")
                if len(suffix) > 80: preview += "..."
                print(f"     Preview: \"{preview}\"")
            print(f"  {'─' * 60}")
            print()
            return

        # Default: show (显示当前加载的项目指令文件列表)
        mem_status = get_memory_status(str(Path.cwd()))
        org = mem_status.get("org_file")
        project_files = mem_status.get("project_files", [])
        total_lines = mem_status.get("total_lines", 0)
        total_size_kb = mem_status.get("total_size_kb", 0.0)

        if not project_files and not org:
            print()
            print("  No project instruction files found in current directory tree.")
            print()
            print("  Use /init to create one, or place DRSAI.md / CLAUDE.md in your project.")
            print("  Project instructions are loaded from:")
            print("    - .drsai/DRSAI.md  or  .drsai/CLAUDE.md")
            print("    - DRSAI.md         or  CLAUDE.md        (in project root)")
            print("    - DRSAI.local.md   or  CLAUDE.local.md  (personal, gitignored)")
            print()
            return

        print()
        print("  Project instruction files (loaded at session start):")
        print(f"  {'─' * 60}")
        if org:
            print(f"  🏢 Organization: {org['path']} ({org['lines']} lines)")
        for f in project_files:
            icon = "🔒" if "local" in f["scope"] else "📁"
            print(f"  {icon} {f['path']:<50} {f['lines']} lines  {f['size_kb']}KB  ({f['scope']})")
        print(f"  {'─' * 60}")
        print(f"  Total: {total_lines} lines, {total_size_kb}KB")
        print()
        print("  Commands:")
        print("    /memory reload  - Reload after editing DRSAI.md")
        print("    /memory status  - Show all system prompt layers")
        print("    /init           - Create DRSAI.md for this project")
        print()

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
        "setup":     (_cmd_setup,     0),
        "env":       (_cmd_setup,     0),
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
        "model_global": (_cmd_model_global, -1),
        "mg":        (_cmd_model_global, -1),  # alias
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
        "pm_global": (_cmd_pm_global, -1),
        "pmg":       (_cmd_pm_global, -1),  # alias
        "inject":    (_cmd_inject,   -1),
        "init":      (_cmd_init,      0),
        "memory":    (_cmd_memory,   -1),
        "workspace": (_cmd_workspace, -1),
        "ws":        (_cmd_workspace, -1),  # alias
        "dangerous": (_cmd_dangerous, -1),
        "dg":        (_cmd_dangerous, -1),  # alias
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
            # ── Hermes-style: Interrupt signal check ─────────────────────────
            if HAS_TUI and is_interrupted():
                clear_interrupt()

                print(f"\n  {ansi('notify_warn')}⚠ 正在中断当前命令...{ansi_reset()}")

                try:
                    # 1. 暂停 agent（取消当前 LLM/工具调用）
                    await agent.pause()

                    # 2. 等待任务被取消
                    await asyncio.sleep(0.1)

                    # 3. 恢复 agent 状态（以便后续对话可以继续）
                    await agent.resume()

                    print(f"  {ansi('notify_ok')}✓ 已中断，状态已重置{ansi_reset()}\n")

                except Exception as e:
                    logger.warning(f"Failed to pause/resume agent: {e}")
                    print(f"\n  {ansi('notify_warn')}⚠ 中断时出现错误: {e}{ansi_reset()}\n")

                return  # 中断当前命令执行

            # 使用 renderer 渲染消息流
            # 用户输入前加分隔线，与 AI 回复视觉分隔
            renderer.print_turn_separator()
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

    # ── Activate patch_stdout for the entire REPL session ──────────────────
    # When active, sys.stdout is replaced with a prompt_toolkit proxy that:
    #  1. During prompt_async(): positions output ABOVE the input line,
    #     keeping the user's editing area isolated from streaming output,
    #     notification prints, and slash-command feedback.
    #  2. Outside prompt_async(): passes output through to real stdout.
    # This replaces the per-call patch_stdout that was previously in
    # DrSaiPrompt.prompt(), which only covered the brief interval when
    # prompt_async() was running and left streaming output un-isolated.
    _patch_stdout_cm = None
    if sys.stdin.isatty():
        try:
            _patch_stdout_cm = patch_stdout(raw=True)
            _patch_stdout_cm.__enter__()
            # Route the renderer's Rich Console through the same proxy so that
            # Rich panels/markdown also respect the input-area boundary.
            renderer.reconfigure_output()
        except Exception as e:
            logger.warning(f"Failed to activate patch_stdout: {e}; "
                           "output isolation may be limited")
            _patch_stdout_cm = None

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

    # Restore original stdout before hard exit (cosmetic — _hard_exit
    # calls os._exit so the process terminates regardless).
    if _patch_stdout_cm is not None:
        try:
            _patch_stdout_cm.__exit__(None, None, None)
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
