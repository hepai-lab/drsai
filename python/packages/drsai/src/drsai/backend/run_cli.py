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

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer

from drsai.configs.constant import APPNAME, VERSION
from drsai.backend.cli import config as cli_config

logger = logging.getLogger(__name__)


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

    Resolution order:
    1. ``$DRSAI_NODE``        — explicit user override
    2. system ``node``        — fastest path when present
    3. ``pnpm dev`` / ``npm run dev``  — dev mode with sources, no bundle needed
    4. portable ``node``      — auto-download + cache under ~/.drsai/cache/node
                                (Playwright/Puppeteer-style; ~25 MB one-time)

    Steps 1, 2, 4 require the prebuilt bundle ``dist/entry.mjs`` to exist
    (it ships inside the wheel for PyPI installs). Step 3 is for in-repo dev.
    """
    bundle = ui_dir / "dist" / "entry.mjs"

    # 1. Honour an explicit DRSAI_NODE env var first — useful for nvm/fnm/scoop
    # installs in non-standard locations or for offline air-gapped environments.
    explicit_node = os.environ.get("DRSAI_NODE", "").strip()
    if explicit_node and Path(explicit_node).exists() and bundle.exists():
        return explicit_node, [str(bundle)]

    # 2. System node on PATH (covers most dev machines + CI)
    if bundle.exists():
        node = _which_any("node")
        if node:
            return node, [str(bundle)]

    # 3. Dev mode: launch via pnpm/npm so source changes hot-reload
    if (ui_dir / "package.json").exists():
        pnpm = _which_any("pnpm")
        if pnpm:
            return pnpm, ["dev"]
        npm = _which_any("npm")
        if npm:
            return npm, ["run", "dev"]

    # 4. Auto-download a portable Node runtime if the bundle is present.
    # This is the "pip install drsai && drsai" path — no Node required on host.
    if bundle.exists():
        try:
            from ._node_bootstrap import ensure_portable_node
            node = ensure_portable_node()
            return node, [str(bundle)]
        except Exception as exc:
            logger.warning("Portable Node bootstrap failed: %s", exc)

    return "", []


def _which_any(name: str) -> Optional[str]:
    """``shutil.which`` plus a few Windows-specific fallbacks.

    Windows installers sometimes register node under ``ProgramFiles\\nodejs``
    without touching the user PATH; if a fresh PowerShell session is open
    before the installer's PATH refresh propagates, ``shutil.which`` misses it.
    Check the well-known install locations as a fallback before giving up.
    """
    found = shutil.which(name)
    if found:
        return found

    if sys.platform != "win32":
        return None

    # Common Windows install locations
    candidates = []
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    for base in [
        Path(program_files) / "nodejs",
        Path(program_files_x86) / "nodejs",
        Path(local_appdata) / "Programs" / "nodejs" if local_appdata else None,
        # Scoop default
        Path(local_appdata) / "scoop" / "shims" if local_appdata else None,
    ]:
        if base is None:
            continue
        for ext in (".exe", ".cmd", ".bat", ""):
            p = base / f"{name}{ext}"
            if p.is_file():
                candidates.append(str(p))
                break

    return candidates[0] if candidates else None


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


def _has_any_api_key(cfg: dict) -> bool:
    """Return True if any usable API key is reachable via config or env."""
    return any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("HEPAI_API_KEY"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])


def _setup_wizard(*, first_run: bool) -> dict:
    """Interactive first-time setup — prompts for user_id + API key.

    Called automatically before launching the TUI when:
      - cli_config.json doesn't exist yet (first install), OR
      - no usable API key is reachable (config + env are both empty).

    Returns the (possibly updated) config dict, already saved to disk.
    """
    import getpass
    from drsai.backend.cli.config import mask_key

    cfg = cli_config.load_config()

    if first_run:
        typer.echo(typer.style(
            "\n  Welcome to DrSai! Let's configure your profile.\n",
            fg=typer.colors.GREEN, bold=True,
        ))
    else:
        typer.echo(typer.style(
            "\n  ⚠ No API key configured — set one up to continue.\n",
            fg=typer.colors.YELLOW, bold=True,
        ))
    typer.echo(f"  Config will be saved to: {cli_config.CLI_CONFIG_PATH}\n")

    # ── User identity (only on first run) ───────────────────────────────────
    if first_run:
        cfg["user_id"] = typer.prompt(
            "  Your user id",
            default=cfg.get("user_id") or "anonymous",
        ).strip() or "anonymous"

        default_model = typer.prompt(
            "  Default model alias (e.g. hepai/deepseek-v4-pro, claude-sonnet-4-6) — Enter to skip",
            default=cfg.get("defult_config_name") or "",
            show_default=False,
        ).strip()
        cfg["defult_config_name"] = default_model or None

    # ── API key ─────────────────────────────────────────────────────────────
    typer.echo("")
    typer.echo(typer.style("  ── API Key ──", fg=typer.colors.CYAN, bold=True))
    typer.echo("    1. HepAI     (推荐 — 国内高速, https://hepai.ai)")
    typer.echo("    2. Anthropic (Claude 系列)")
    typer.echo("    3. OpenAI    (GPT 系列)")
    typer.echo("    4. 跳过 — 我会通过环境变量设置")
    typer.echo("")
    choice = typer.prompt("  选择 (1-4)", default="1").strip()

    def _ask_key(label: str, cfg_key: str, env_key: str, base_url_label: Optional[str] = None,
                 base_url_cfg_key: Optional[str] = None, base_url_env_key: Optional[str] = None) -> None:
        typer.echo(typer.style(f"\n  {label}", fg=typer.colors.CYAN))
        try:
            key = getpass.getpass("  API Key (输入隐藏): ").strip()
        except (KeyboardInterrupt, EOFError):
            typer.echo("\n  Cancelled.")
            return
        if key:
            cfg[cfg_key] = key
            os.environ[env_key] = key
            typer.echo(typer.style(
                f"  ✓ {label} Key saved: {mask_key(key)}", fg=typer.colors.GREEN,
            ))
        else:
            typer.echo(typer.style("  ⚠ Empty key — skipped", fg=typer.colors.YELLOW))
        if base_url_label and base_url_cfg_key:
            try:
                bu = typer.prompt(
                    f"  {base_url_label} (可选, Enter 跳过)",
                    default=cfg.get(base_url_cfg_key) or "",
                    show_default=False,
                ).strip()
            except (KeyboardInterrupt, EOFError):
                bu = ""
            if bu:
                cfg[base_url_cfg_key] = bu
                if base_url_env_key:
                    os.environ[base_url_env_key] = bu

    if choice == "1":
        _ask_key("HepAI", "api_key", "HEPAI_API_KEY",
                 base_url_label="HepAI Base URL", base_url_cfg_key="openai_base_url",
                 base_url_env_key="OPENAI_BASE_URL")
    elif choice == "2":
        _ask_key("Anthropic", "anthropic_api_key", "ANTHROPIC_API_KEY",
                 base_url_label="Anthropic Base URL", base_url_cfg_key="anthropic_base_url",
                 base_url_env_key="ANTHROPIC_BASE_URL")
    elif choice == "3":
        _ask_key("OpenAI", "openai_api_key", "OPENAI_API_KEY",
                 base_url_label="OpenAI Base URL", base_url_cfg_key="openai_base_url",
                 base_url_env_key="OPENAI_BASE_URL")
    else:
        typer.echo(
            "\n  Skipped. Set one of HEPAI_API_KEY / ANTHROPIC_API_KEY / "
            "OPENAI_API_KEY environment variables before next launch."
        )

    cli_config.save_config(cfg)
    typer.echo(typer.style(f"\n  ✓ Saved to {cli_config.CLI_CONFIG_PATH}\n", fg=typer.colors.GREEN))
    return cfg


def _launch_tui(*, attach_url: Optional[str] = None) -> None:
    """Spawn the Ink TUI subprocess.

    Before launching, run the setup wizard on first install or whenever no
    API key is reachable. Skipped silently when attaching to a remote gateway
    (the remote already has its own config).
    """
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

    # ── First-run / missing-API-key wizard ──────────────────────────────
    # Skip when --attach is given (remote gateway has its own config) or when
    # running headless (no TTY → can't prompt interactively).
    if not attach_url and sys.stdin.isatty() and sys.stdout.isatty():
        first_run = not cli_config.CLI_CONFIG_PATH.exists()
        cfg = cli_config.load_config() if not first_run else dict(cli_config.DEFAULT_CONFIG)
        if first_run or not _has_any_api_key(cfg):
            try:
                _setup_wizard(first_run=first_run)
            except (KeyboardInterrupt, EOFError):
                typer.echo("\n  Setup cancelled. You can re-run any time with: drsai config\n")
                raise typer.Exit(130)

    cmd, base_args = _resolve_node_runner(ui_dir)
    if not cmd:
        bundle = ui_dir / "dist" / "entry.mjs"
        has_bundle = bundle.exists()
        has_src = (ui_dir / "package.json").exists()
        no_download = (os.environ.get("DRSAI_NODE_NO_DOWNLOAD") or "").strip() in {
            "1", "true", "yes", "on",
        }

        msg = [
            "Error: cannot launch TUI.",
            "",
            "The DrSai TUI is a React/Ink app and needs Node.js (≥ 20) to run.",
            "",
            f"Checked for: $DRSAI_NODE, node on PATH, pnpm, npm "
            f"(bundle: {has_bundle}, source: {has_src})",
        ]
        if has_bundle and not no_download:
            msg += [
                "",
                "An auto-download of portable Node.js was also attempted but failed.",
                "Most likely cause: network unreachable / proxy / mirror blocked.",
                "",
                "Options:",
                "  • Install Node.js system-wide:  https://nodejs.org/",
                "  • Or set a closer mirror:",
                "      DRSAI_NODE_MIRROR=https://npmmirror.com/mirrors/node  drsai",
                "  • Or point at an existing node:",
                "      DRSAI_NODE=/full/path/to/node  drsai",
            ]
        elif has_bundle and no_download:
            msg += [
                "",
                "DRSAI_NODE_NO_DOWNLOAD=1 is set, so auto-download is disabled.",
                "",
                "Options:",
                "  • Install Node.js system-wide:  https://nodejs.org/",
                "  • Or point at an existing node:  DRSAI_NODE=/full/path/to/node",
                "  • Or unset DRSAI_NODE_NO_DOWNLOAD to allow auto-download (~25 MB).",
            ]
        else:
            msg += [
                "",
                "The ui-tui bundle is missing — your install looks incomplete.",
                "Rebuild it from source:  cd ui-tui && pnpm install && pnpm build",
            ]
        typer.echo(typer.style("\n".join(msg), fg=typer.colors.RED))
        raise typer.Exit(1)

    env = os.environ.copy()
    if attach_url:
        env["DRSAI_TUI_ATTACH_URL"] = attach_url

    try:
        # On Windows, pnpm/npm are .cmd/.ps1 shims — Python's CreateProcess
        # can't execute them without shell=True. We pass an absolute path from
        # _which_any when possible, but fall back to shell=True for safety.
        use_shell = sys.platform == "win32" and not cmd.lower().endswith((".exe",))
        if use_shell:
            # Quote args containing spaces (e.g. bundle path may contain spaces)
            cmd_line = " ".join(f'"{a}"' if " " in a else a for a in [cmd, *base_args])
            result = subprocess.run(cmd_line, cwd=str(ui_dir), env=env, shell=True)
        else:
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
