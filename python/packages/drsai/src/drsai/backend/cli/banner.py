"""Welcome banner + quiet-logging helpers for drsai-cli.

Keeping these tiny utilities out of :mod:`run_cli` so the REPL file stays
focused on its core loop.
"""

from __future__ import annotations

import logging
import sys
from typing import Optional

from rich.align import Align
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.box import ROUNDED

from drsai.configs.constant import APPNAME, VERSION

__all__ = ["configure_cli_logging", "print_banner", "print_config_info"]


# Loggers that flood the CLI during normal use.
_NOISY_LOGGERS: tuple[str, ...] = (
    "alembic",
    "alembic.runtime.migration",
    "alembic.runtime.plugins",
    "autogen_core",
    "autogen_agentchat",
    "sqlalchemy.engine",
    "httpx",
    "httpcore",
    "openai",
    "anthropic",
    "urllib3",
    "chromadb",
)


def configure_cli_logging(debug: bool = False) -> None:
    """Silence loguru + stdlib loggers so they don't pollute the REPL.

    When ``debug=True`` the caller can still see errors + above; we never
    go fully silent (we want tracebacks on real failures).
    """
    # stdlib logging — set all the chatty loggers to WARNING/ERROR.
    target_level = logging.DEBUG if debug else logging.WARNING
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(
            logging.ERROR if not debug else logging.DEBUG
        )
    logging.getLogger().setLevel(target_level)

    # loguru — drsai internals use `from loguru import logger`. The default
    # sink prints at DEBUG to stderr; swap it for a WARNING-only sink that
    # writes to stderr.
    try:
        from loguru import logger as _loguru_logger
        _loguru_logger.remove()
        if debug:
            _loguru_logger.add(
                sys.stderr,
                level="DEBUG",
                format="<dim>{time:HH:mm:ss}</dim> | "
                       "<level>{level: <7}</level> | {message}",
            )
        else:
            _loguru_logger.add(
                sys.stderr,
                level="WARNING",
                format="<red>{level}</red> {name}: {message}",
            )
    except Exception:
        pass


def print_banner(console: Optional[Console] = None) -> None:
    console = console or Console()
    title = Text()
    title.append("  ╱╲ ", style="bold #FFD700")
    title.append("Dr.Sai", style="bold #FFD700")
    title.append(" CLI ", style="#888888")
    title.append(f"v{VERSION}", style="dim")

    tips = Text()
    tips.append("Type ", style="dim")
    tips.append("/help", style="bold #5FAFFF")
    tips.append("  for commands, ", style="dim")
    tips.append("Esc+Enter", style="bold #5FAFFF")
    tips.append(" for multi-line, ", style="dim")
    tips.append("Ctrl+D", style="bold #5FAFFF")
    tips.append(" to quit.", style="dim")

    body = Text()
    body.append("\n")
    body.append(title)
    body.append("\n\n")
    body.append(tips)
    body.append("\n")

    console.print(
        Panel(
            Align.left(body),
            border_style="#FFD700",
            box=ROUNDED,
            expand=False,
            title=f"[dim]{APPNAME.lower()}[/dim]",
            padding=(0, 2),
        )
    )


def print_config_info(
    user_id: str,
    model_name: str,
    session_id: str = None,
    work_dir: str = None,
    tools: list = None,
    skills_dir: str = None,
    console: Console = None,
) -> None:
    """Print a compact session info panel showing user, model, tools and skills."""
    from pathlib import Path

    console = console or Console()
    tools = tools or []

    # Shorten model name
    model_short = model_name.split("/")[-1] if "/" in model_name else model_name

    # Build content
    content = Text()

    # User info
    content.append("  👤 User\n    ", style="bold #FFD700")
    content.append(f"{user_id}\n\n", style="cyan")

    # Model info
    content.append("  🤖 Model\n    ", style="bold #FFD700")
    content.append(f"{model_short}\n\n", style="cyan")

    # Session ID (if provided)
    if session_id:
        content.append("  📝 Session\n    ", style="bold #FFD700")
        content.append(f"{session_id[:16]}...\n\n", style="yellow")

    # Working Directory
    if work_dir:
        content.append("  📁 Working Directory\n    ", style="bold #FFD700")
        # Smart truncate if too long
        if len(work_dir) > 50:
            parts = Path(work_dir).parts
            if len(parts) > 3:
                work_dir_display = str(Path(*parts[:2], "...", *parts[-2:]))
            else:
                work_dir_display = work_dir[:47] + "..."
        else:
            work_dir_display = work_dir
        content.append(f"{work_dir_display}\n\n", style="dim")

    # Skills count
    skills_count = 0
    if skills_dir:
        skills_path = Path(skills_dir)
        if skills_path.exists():
            for category_folder in skills_path.iterdir():
                if category_folder.is_dir() and (category_folder / "SKILL.md").exists():
                    skills_count += 1

    content.append("  ⚡ Available Skills\n    ", style="bold #FFD700")
    if skills_count > 0:
        content.append(f"{skills_count} skills installed", style="cyan")
    else:
        content.append("No skills installed", style="dim")

    # Tools count
    content.append("\n\n  🔧 Available Tools\n    ", style="bold #FFD700")
    if tools:
        content.append(f"{len(tools)} tools available", style="cyan")
    else:
        content.append("No tools available", style="dim")

    console.print(
        Panel(
            content,
            title="[bold gold1]⚡ Dr.Sai Session Info[/bold gold1]",
            border_style="#FFD700",
            box=ROUNDED,
            expand=False,
            padding=(1, 2),
        )
    )


def _format_token_count(tokens: int) -> str:
    """Format a token count for display (e.g. 128000 → '128K')."""
    if tokens >= 1_000_000:
        val = tokens / 1_000_000
        rounded = round(val)
        return f"{rounded}M" if abs(val - rounded) < 0.05 else f"{val:.1f}M"
    elif tokens >= 1_000:
        val = tokens / 1_000
        rounded = round(val)
        return f"{rounded}K" if abs(val - rounded) < 0.05 else f"{val:.1f}K"
    return str(tokens)




