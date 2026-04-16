"""
DrSai CLI - Connect to a running DrSai agent server and chat interactively.

Features:
- Connect to a remote DrSai Worker via HepAIWorkerAgent
- Continuous multi-turn conversation
- Session switching (create, switch, list)
- Config persistence in ~/.drsai/configs/cli_config.json
"""

import os
import sys
import json
import asyncio
import uuid
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

from drsai.configs.constant import FS_DIR, CONFIG_DIR, VERSION, APPNAME

# ── Config ────────────────────────────────────────────────────────────────────

CLI_CONFIG_PATH = Path(CONFIG_DIR) / "cli_config.json"
CLI_SESSIONS_PATH = Path(CONFIG_DIR) / "cli_sessions.json"

DEFAULT_CONFIG = {
    "url": "http://localhost:42858/apiv2",
    "api_key": "",
    "model_name": "My Dr.Sai",
    "user_id": "anonymous",
    "defult_config_name": None,
}


def load_config() -> dict:
    if CLI_CONFIG_PATH.exists():
        with open(CLI_CONFIG_PATH, "r", encoding="utf-8") as f:
            saved = json.load(f)
        cfg = {**DEFAULT_CONFIG, **saved}
        return cfg
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict):
    CLI_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CLI_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def load_sessions() -> dict:
    """Load saved sessions: {session_id: {"name": ..., "last_used": ...}}"""
    if CLI_SESSIONS_PATH.exists():
        with open(CLI_SESSIONS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_sessions(sessions: dict):
    CLI_SESSIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CLI_SESSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2, ensure_ascii=False)


# ── CLI REPL ──────────────────────────────────────────────────────────────────

def _print_help():
    print(
        "\n"
        "  /new [name]          Create a new session\n"
        "  /switch <id|name>    Switch to another session\n"
        "  /list                List all sessions\n"
        "  /rename <name>       Rename current session\n"
        "  /config              Show current connection config\n"
        "  /help                Show this help\n"
        "  /quit                Save and exit\n"
    )


async def _run_repl(cfg: dict):
    """Core async REPL loop."""
    from drsai.modules.agents.drsai_worker_agent import HepAIWorkerAgent
    from autogen_agentchat.ui import Console
    from autogen_agentchat.base import TaskResult
    from drsai.modules.managers.messages import (
        BaseChatMessage,
        AgentLogEvent,
        ModelClientStreamingChunkEvent,
    )

    url = cfg["url"]
    api_key = cfg["api_key"]
    model_name = cfg["model_name"]
    user_id = cfg["user_id"]
    defult_config_name = cfg.get("defult_config_name")

    # Load persisted sessions
    sessions = load_sessions()  # {id: {"name": str}}

    # Pick or create initial session
    current_session_id: str
    if sessions:
        # Resume the most recent session
        current_session_id = list(sessions.keys())[-1]
        print(f"Resuming session: {sessions[current_session_id]['name']} [{current_session_id[:8]}]")
    else:
        current_session_id = str(uuid.uuid4())
        sessions[current_session_id] = {"name": "default"}
        save_sessions(sessions)

    agent: Optional[HepAIWorkerAgent] = None

    def _create_agent(chat_id: str) -> HepAIWorkerAgent:
        return HepAIWorkerAgent(
            name="Assistant",
            model_remote_configs={
                "url": url,
                "api_key": api_key,
                "name": model_name,
                "defult_config_name": defult_config_name,
            },
            chat_id=chat_id,
            run_info={"email": user_id, "name": user_id},
        )

    async def _init_agent(chat_id: str) -> HepAIWorkerAgent:
        a = _create_agent(chat_id)
        await a.lazy_init()
        return a

    async def _close_agent():
        nonlocal agent
        if agent is not None:
            try:
                await agent.close()
            except Exception:
                pass
            agent = None

    # Connect
    print(f"Connecting to {url} ({model_name})...")
    try:
        agent = await _init_agent(current_session_id)
    except Exception as e:
        print(f"Failed to connect: {e}")
        print("Please check your config with: drsai-chat config")
        return

    if not agent._funcs_map:
        print(f"Cannot connect to model '{model_name}' at {url}")
        print("Make sure the agent server is running and the model name is correct.")
        return

    session_name = sessions[current_session_id]["name"]
    print(f"\nConnected! Session: {session_name} [{current_session_id[:8]}]")
    print("Type /help for commands.\n" + "-" * 60)

    loop = asyncio.get_event_loop()

    while True:
        # Non-blocking input
        try:
            user_input = await loop.run_in_executor(
                None,
                lambda: input(f"[{sessions[current_session_id]['name']}] You> "),
            )
        except (EOFError, KeyboardInterrupt):
            print()
            break
        user_input = user_input.strip()
        if not user_input:
            continue

        # ── Commands ──────────────────────────────────────────
        if user_input.startswith("/"):
            parts = user_input.split(maxsplit=1)
            cmd = parts[0].lower()

            if cmd == "/quit":
                break

            elif cmd == "/help":
                _print_help()
                continue

            elif cmd == "/config":
                print(json.dumps(cfg, indent=2, ensure_ascii=False))
                continue

            elif cmd == "/new":
                await _close_agent()
                new_id = str(uuid.uuid4())
                name = parts[1] if len(parts) > 1 else f"session-{len(sessions) + 1}"
                sessions[new_id] = {"name": name}
                save_sessions(sessions)
                current_session_id = new_id
                try:
                    agent = await _init_agent(current_session_id)
                    print(f"New session: {name} [{new_id[:8]}]")
                except Exception as e:
                    print(f"Failed to initialize new session: {e}")
                continue

            elif cmd == "/switch":
                if len(parts) < 2:
                    print("Usage: /switch <session_id prefix or name>")
                    continue
                target = parts[1].strip()
                # Match by id prefix or name
                matched = [
                    sid for sid, info in sessions.items()
                    if sid.startswith(target) or info["name"] == target
                ]
                if not matched:
                    print(f"No session found matching: {target}")
                    continue
                if len(matched) > 1:
                    print("Multiple matches:")
                    for sid in matched:
                        print(f"  [{sid[:8]}] {sessions[sid]['name']}")
                    continue
                target_id = matched[0]
                if target_id == current_session_id:
                    print("Already in this session.")
                    continue
                await _close_agent()
                current_session_id = target_id
                try:
                    agent = await _init_agent(current_session_id)
                    print(f"Switched to: {sessions[current_session_id]['name']} [{current_session_id[:8]}]")
                except Exception as e:
                    print(f"Failed to switch: {e}")
                continue

            elif cmd == "/list":
                if not sessions:
                    print("No sessions.")
                else:
                    print("Sessions:")
                    for sid, info in sessions.items():
                        marker = " <-- current" if sid == current_session_id else ""
                        print(f"  [{sid[:8]}] {info['name']}{marker}")
                continue

            elif cmd == "/rename":
                if len(parts) < 2:
                    print("Usage: /rename <new name>")
                    continue
                new_name = parts[1].strip()
                sessions[current_session_id]["name"] = new_name
                save_sessions(sessions)
                print(f"Renamed to: {new_name}")
                continue

            else:
                print(f"Unknown command: {cmd}. Type /help for help.")
                continue

        # ── Chat ──────────────────────────────────────────────
        if agent is None:
            try:
                agent = await _init_agent(current_session_id)
            except Exception as e:
                print(f"Failed to reconnect: {e}")
                continue

        try:
            await Console(agent.run_stream(task=user_input))
        except asyncio.CancelledError:
            print("\n[Cancelled]")
        except Exception as e:
            print(f"Error: {e}")
            logger.debug(f"Chat error: {e}", exc_info=True)

    # ── Cleanup ───────────────────────────────────────────────
    await _close_agent()
    save_sessions(sessions)
    print("Bye!")


# ── Typer App ─────────────────────────────────────────────────────────────────

app = typer.Typer(
    name="drsai-chat",
    help="DrSai CLI - Connect to a running DrSai agent and chat interactively.",
)


def _interactive_setup() -> dict:
    """First-time interactive setup wizard. Returns the config dict."""
    typer.echo(typer.style(
        "\n  Welcome to DrSai CLI! Let's configure your connection.\n",
        fg=typer.colors.GREEN, bold=True,
    ))
    typer.echo(f"  Config will be saved to: {CLI_CONFIG_PATH}\n")

    cfg = dict(DEFAULT_CONFIG)

    cfg["url"] = typer.prompt(
        "  Agent server URL",
        default=cfg["url"],
    ).strip()

    env_key = os.environ.get("HEPAI_API_KEY", "")
    if env_key:
        typer.echo(f"  Found HEPAI_API_KEY in environment: {env_key[:8]}...{env_key[-4:]}")
        use_env = typer.confirm("  Use this API key?", default=True)
        if use_env:
            cfg["api_key"] = env_key
    if not cfg["api_key"]:
        cfg["api_key"] = typer.prompt("  HepAI API key").strip()

    cfg["model_name"] = typer.prompt(
        "  Model/agent name on the server",
        default=cfg["model_name"],
    ).strip()

    cfg["user_id"] = typer.prompt(
        "  Your user id (email)",
        default=cfg["user_id"],
    ).strip()

    llm = typer.prompt(
        "  Default LLM config name (leave empty to skip)",
        default="",
    ).strip()
    cfg["defult_config_name"] = llm or None

    save_config(cfg)
    typer.echo(typer.style("\n  Config saved!\n", fg=typer.colors.GREEN))
    return cfg


@app.command()
def chat(
    url: Optional[str] = typer.Option(None, "--url", "-u", help="Agent server URL, e.g. http://localhost:42858/apiv2"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-k", help="HepAI API key"),
    model_name: Optional[str] = typer.Option(None, "--model", "-m", help="Model/agent name on the server"),
    user_id: Optional[str] = typer.Option(None, "--user", help="Your user id (email)"),
    defult_config_name: Optional[str] = typer.Option(None, "--llm-config", help="Default LLM config name"),
):
    """Start an interactive chat session with a running DrSai agent."""
    # First-time setup: no config file exists and no CLI args provided
    if not CLI_CONFIG_PATH.exists() and not any([url, api_key, model_name, user_id]):
        cfg = _interactive_setup()
    else:
        cfg = load_config()

    # CLI args override saved config
    if url:
        cfg["url"] = url
    if api_key:
        cfg["api_key"] = api_key
    if model_name:
        cfg["model_name"] = model_name
    if user_id:
        cfg["user_id"] = user_id
    if defult_config_name:
        cfg["defult_config_name"] = defult_config_name

    if not cfg["api_key"]:
        # Try env
        cfg["api_key"] = os.environ.get("HEPAI_API_KEY", "")
    if not cfg["api_key"]:
        typer.echo("No API key provided. Use --api-key, set HEPAI_API_KEY, or run: drsai-chat config")
        raise typer.Exit(1)

    asyncio.run(_run_repl(cfg))


@app.command()
def config(
    url: Optional[str] = typer.Option(None, "--url", "-u", help="Agent server URL"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-k", help="HepAI API key"),
    model_name: Optional[str] = typer.Option(None, "--model", "-m", help="Model/agent name"),
    user_id: Optional[str] = typer.Option(None, "--user", help="Your user id (email)"),
    defult_config_name: Optional[str] = typer.Option(None, "--llm-config", help="Default LLM config name"),
    show: bool = typer.Option(False, "--show", "-s", help="Show current config"),
):
    """View or update CLI connection config (saved to ~/.drsai/configs/cli_config.json)."""
    cfg = load_config()

    if show or (url is None and api_key is None and model_name is None and user_id is None and defult_config_name is None):
        typer.echo(f"Config file: {CLI_CONFIG_PATH}")
        display = dict(cfg)
        if display.get("api_key"):
            key = display["api_key"]
            display["api_key"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
        typer.echo(json.dumps(display, indent=2, ensure_ascii=False))
        return

    if url:
        cfg["url"] = url
    if api_key:
        cfg["api_key"] = api_key
    if model_name:
        cfg["model_name"] = model_name
    if user_id:
        cfg["user_id"] = user_id
    if defult_config_name:
        cfg["defult_config_name"] = defult_config_name

    save_config(cfg)
    typer.echo(f"Config saved to {CLI_CONFIG_PATH}")


@app.command()
def sessions(
    clear: bool = typer.Option(False, "--clear", help="Clear all saved sessions"),
):
    """List or manage saved CLI sessions."""
    if clear:
        save_sessions({})
        typer.echo("All sessions cleared.")
        return

    data = load_sessions()
    if not data:
        typer.echo("No saved sessions.")
        return
    typer.echo("Saved sessions:")
    for sid, info in data.items():
        typer.echo(f"  [{sid[:8]}] {info['name']}")


@app.command()
def version():
    """Print DrSai version."""
    typer.echo(f"{APPNAME} version: {VERSION}")


def run():
    app()


if __name__ == "__main__":
    app()
