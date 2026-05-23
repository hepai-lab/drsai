"""
DrSai CLI — thin entry point (Phase 5 rewrite).

The bulky REPL implementation has moved to the new dual-process TUI
(``drsai.backend.tui_gateway`` + ``ui-tui/``). This module is now just a
typer-based launcher that:

- ``drsai`` / ``drsai chat`` → spawns the new Ink-based TUI
- ``drsai gateway``          → starts the legacy SSE gateway (for desktop app)
- ``drsai config``           → view/edit config file
- ``drsai sessions``         → list/manage saved sessions
- ``drsai version``          → print version

The previous ~2,646-line REPL implementation is preserved at
``run_cli_legacy.py`` for reference; it is **no longer wired up**.

To use the legacy REPL, run ``python -m drsai.backend.run_cli_legacy``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer

from drsai.configs.constant import APPNAME, VERSION
from drsai.backend.cli import config as cli_config


app = typer.Typer(
    name="drsai",
    help="DrSai — local agent CLI (Ink TUI + Python gateway)",
    no_args_is_help=False,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _find_ui_tui_dir() -> Optional[Path]:
    """Locate the ui-tui package on disk.

    Resolution order:
    1. $DRSAI_UI_TUI_DIR environment variable
    2. <repo_root>/ui-tui/ (walking up — dev mode)
    3. <site-packages>/drsai/ui_tui/ (installed via PyPI — pre-built bundle)
    4. ~/.drsai/ui-tui/ (manual install location)
    """
    explicit = os.environ.get("DRSAI_UI_TUI_DIR")
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if (p / "package.json").exists() or (p / "dist" / "entry.mjs").exists():
            return p

    # Walk up from <this file>/python/packages/drsai/src/drsai/backend/
    here = Path(__file__).resolve()
    for ancestor in [here, *here.parents]:
        candidate = ancestor / "ui-tui"
        if candidate.is_dir() and (
            (candidate / "package.json").exists()
            or (candidate / "dist" / "entry.mjs").exists()
        ):
            return candidate

    # Installed-package location: drsai/ui_tui/dist/entry.mjs
    pkg_bundled = Path(__file__).resolve().parent.parent / "ui_tui"
    if (pkg_bundled / "dist" / "entry.mjs").exists():
        return pkg_bundled

    fallback = Path.home() / ".drsai" / "ui-tui"
    if (fallback / "package.json").exists() or (fallback / "dist" / "entry.mjs").exists():
        return fallback

    return None


def _resolve_node_runner(ui_dir: Path) -> tuple[str, list[str]]:
    """Return (command, base_args) for launching the Ink UI.

    Prefers the pre-built bundle (dist/entry.mjs) over dev tooling. This means
    PyPI users only need ``node`` installed, not pnpm/npm.

    Resolution order:
    1. node dist/entry.mjs   (pre-built bundle, PyPI distribution)
    2. pnpm dev              (dev mode with sources)
    3. npm run dev           (dev mode fallback)
    """
    bundle = ui_dir / "dist" / "entry.mjs"
    if bundle.exists() and shutil.which("node"):
        return "node", [str(bundle)]
    if (ui_dir / "package.json").exists():
        if shutil.which("pnpm"):
            return "pnpm", ["dev"]
        if shutil.which("npm"):
            return "npm", ["run", "dev"]
    if shutil.which("node") and bundle.exists():
        return "node", [str(bundle)]
    return "", []


# ── Commands ─────────────────────────────────────────────────────────────────


@app.callback(invoke_without_command=True)
def cli_default(ctx: typer.Context) -> None:
    """Default: launch the new TUI when no subcommand is given."""
    if ctx.invoked_subcommand is not None:
        return
    _launch_tui()


@app.command("chat")
def chat(
    attach: Optional[str] = typer.Option(
        None,
        "--attach",
        help="Attach to an existing gateway via WebSocket URL (e.g. ws://127.0.0.1:8765/attach)",
    ),
) -> None:
    """Start an interactive chat session (the new Ink-based TUI)."""
    _launch_tui(attach_url=attach)


def _launch_tui(*, attach_url: Optional[str] = None) -> None:
    """Spawn the Ink TUI subprocess."""
    ui_dir = _find_ui_tui_dir()
    if ui_dir is None:
        typer.echo(
            typer.style(
                "Error: ui-tui directory not found.\n"
                "  Set DRSAI_UI_TUI_DIR=<path> or install the ui-tui package.",
                fg=typer.colors.RED,
            )
        )
        raise typer.Exit(1)

    cmd, base_args = _resolve_node_runner(ui_dir)
    if not cmd:
        typer.echo(
            typer.style(
                "Error: no Node.js runtime found (need pnpm, npm, or node).",
                fg=typer.colors.RED,
            )
        )
        raise typer.Exit(1)

    env = os.environ.copy()
    if attach_url:
        env["DRSAI_TUI_ATTACH_URL"] = attach_url

    try:
        result = subprocess.run([cmd, *base_args], cwd=str(ui_dir), env=env)
        raise typer.Exit(result.returncode)
    except KeyboardInterrupt:
        raise typer.Exit(130)
    except FileNotFoundError as exc:
        typer.echo(typer.style(f"Error launching TUI: {exc}", fg=typer.colors.RED))
        raise typer.Exit(1)


@app.command("gateway")
def gateway(
    port: int = typer.Option(8642, help="API server port"),
    host: str = typer.Option("127.0.0.1", help="API server host"),
) -> None:
    """Start the legacy DrSai SSE gateway (for the Electron desktop app)."""
    typer.echo(
        typer.style(
            "ℹ Note: the legacy SSE gateway (gateway.py) is preserved for desktop compatibility.\n"
            "  For the new JSON-RPC TUI, use `drsai chat` (which auto-spawns its gateway).",
            fg=typer.colors.CYAN,
        )
    )
    os.environ.setdefault("DRSAI_API_PORT", str(port))
    os.environ.setdefault("DRSAI_API_HOST", host)
    from drsai.backend.gateway import main as legacy_gateway_main
    legacy_gateway_main()


@app.command("tui-gateway")
def tui_gateway() -> None:
    """Start the new JSON-RPC TUI gateway as a standalone process (for attach mode)."""
    typer.echo(
        typer.style(
            f"Starting TUI gateway. Set DRSAI_TUI_ENABLE_WS=1 to expose WebSocket.",
            fg=typer.colors.CYAN,
        )
    )
    from drsai.backend.tui_gateway.entry import main as gw_main
    gw_main()


@app.command("config")
def config_cmd(
    url: Optional[str] = typer.Option(None, "--url", "-u"),
    api_key: Optional[str] = typer.Option(None, "--api-key", "-k"),
    user_id: Optional[str] = typer.Option(None, "--user"),
    defult_config_name: Optional[str] = typer.Option(None, "--llm-config"),
    llm_config_file: Optional[str] = typer.Option(None, "--llm-config-file"),
    anthropic_api_key: Optional[str] = typer.Option(None, "--anthropic-api-key"),
    anthropic_base_url: Optional[str] = typer.Option(None, "--anthropic-base-url"),
    openai_api_key: Optional[str] = typer.Option(None, "--openai-api-key"),
    openai_base_url: Optional[str] = typer.Option(None, "--openai-base-url"),
    skills_dir: Optional[str] = typer.Option(None, "--skills-dir"),
    plan_mode: Optional[bool] = typer.Option(None, "--plan-mode", "-p"),
    show: bool = typer.Option(False, "--show", "-s", help="Show current config (masked)"),
    json_fmt: bool = typer.Option(False, "--json", help="Show as JSON"),
) -> None:
    """View or update CLI config (api_key, llm_config_file, etc.)."""
    cfg = cli_config.load_config()
    updates = [
        ("url", url), ("api_key", api_key), ("user_id", user_id),
        ("defult_config_name", defult_config_name),
        ("llm_config_file", llm_config_file),
        ("anthropic_api_key", anthropic_api_key),
        ("anthropic_base_url", anthropic_base_url),
        ("openai_api_key", openai_api_key),
        ("openai_base_url", openai_base_url),
        ("skills_dir", skills_dir),
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


@app.command("sessions")
def sessions_cmd(
    clear: bool = typer.Option(False, "--clear", help="Clear all saved sessions"),
) -> None:
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
        name = info.get("name", "?") if isinstance(info, dict) else "?"
        typer.echo(f"  [{sid[:8]}] {name}")


@app.command("version")
def version_cmd() -> None:
    """Print DrSai version."""
    typer.echo(f"{APPNAME} version: {VERSION}")


# ── Entry point ──────────────────────────────────────────────────────────────


def run() -> None:
    """Main entry point used by the ``drsai`` console script."""
    # `drsai` (no args) or `drsai -u http://...` → implicit `chat` subcommand
    if len(sys.argv) == 1 or (len(sys.argv) >= 2 and sys.argv[1].startswith("-")):
        sys.argv.insert(1, "chat")
    try:
        app()
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)


if __name__ == "__main__":
    run()
