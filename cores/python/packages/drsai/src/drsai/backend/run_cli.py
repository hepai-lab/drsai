"""
OpenDrSai CLI — thin entry point (Phase 5 rewrite).

The bulky REPL implementation has moved to the new dual-process TUI
(``drsai.backend.tui_gateway`` + ``apps/ui-tui/``). This module is now just a
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
import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer

from drsai.configs.constant import VERSION
from drsai.backend.cli import config as cli_config
from drsai.config import (
    ConfigError as ModelProviderConfigError,
    ConfigUpdateRequest,
    ProviderDraft,
    commit_update,
    cleanup_orphaned_credentials,
    load_user_config,
    migrate_legacy_model_config,
    resolve_model_config,
    builtin_provider_names,
    config_revision,
    diagnose_model_config,
    discover_provider_models,
    get_provider_preset,
    last_known_good_path,
    restore_last_known_good,
    preview_update,
    probe_provider_draft,
    test_provider_connection,
)
from drsai.config.loader import default_config_path

logger = logging.getLogger(__name__)


app = typer.Typer(
    name="drsai",
    help="OpenDrSai — local agent CLI (Ink TUI + Python gateway)",
    no_args_is_help=False,
)
config_app = typer.Typer(help="Manage ~/.drsai/config.toml", invoke_without_command=True)
provider_app = typer.Typer(help="Manage model providers")
app.add_typer(config_app, name="config")
app.add_typer(provider_app, name="provider")


# ── Helpers ──────────────────────────────────────────────────────────────────


def _find_ui_tui_dir() -> Optional[Path]:
    """Locate the ui-tui package on disk.

    Resolution order:
    1. $DRSAI_UI_TUI_DIR environment variable
    2. <repo_root>/apps/ui-tui/ (walking up — dev mode)
    3. <site-packages>/drsai/ui_tui/ (installed via PyPI — pre-built bundle)
    4. ~/.drsai/ui-tui/ (manual install location)
    """
    explicit = os.environ.get("DRSAI_UI_TUI_DIR")
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if (p / "package.json").exists() or (p / "dist" / "entry.mjs").exists():
            return p

    # Walk up from <this file>/cores/python/packages/drsai/src/drsai/backend/
    here = Path(__file__).resolve()
    for ancestor in [here, *here.parents]:
        # Check both legacy (repo-root/ui-tui) and new (repo-root/apps/ui-tui) locations
        for candidate in (ancestor / "ui-tui", ancestor / "apps" / "ui-tui"):
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
def cli_default(
    ctx: typer.Context,
    version: bool = typer.Option(
        None,
        "--version",
        "-V",
        help="Print OpenDrSai version and exit.",
        is_eager=True,
    ),
) -> None:
    """Default: launch the new TUI when no subcommand is given."""
    if version:
        typer.echo(f"version: {VERSION}")
        raise typer.Exit()
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
            "\n  Welcome to OpenDrSai! Let's configure your profile.\n",
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
    typer.echo("    1. HepAI     (Recommended — high-speed, https://ai.ihep.ac.cn)")
    typer.echo("    2. Anthropic (Claude style)")
    typer.echo("    3. OpenAI    (GPT style)")
    typer.echo("    4. Skip — I will set it through environment variables-`HEPAI_API_KEY`")
    typer.echo("")
    choice = typer.prompt("  Please select (1-4)", default="1").strip()

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
                "Error: ui-tui directory not found (expected at apps/ui-tui/).\n"
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
            "The OpenDrSai TUI is a React/Ink app and needs Node.js (≥ 20) to run.",
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
                "Rebuild it from source:  cd apps/ui-tui && pnpm install && pnpm build",
            ]
        typer.echo(typer.style("\n".join(msg), fg=typer.colors.RED))
        raise typer.Exit(1)

    env = os.environ.copy()
    if attach_url:
        env["DRSAI_TUI_ATTACH_URL"] = attach_url

    # Capture the directory the *user* invoked ``drsai`` from. We have to
    # ``cwd=ui_dir`` for the Node subprocess (so it can find package.json /
    # node_modules / dist), but the gateway needs to treat the user's cwd as
    # the workspace — sessions are bound to that, not to apps/ui-tui/.
    user_cwd = os.environ.get("DRSAI_USER_CWD") or str(Path.cwd().resolve())
    env["DRSAI_USER_CWD"] = user_cwd

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
    port: int = typer.Option(18642, help="API server port"),
    host: str = typer.Option("127.0.0.1", help="API server host"),
) -> None:
    """Start the legacy OpenDrSai SSE gateway (for the Electron desktop app)."""
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


@config_app.callback()
def config_cmd(
    ctx: typer.Context,
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
    model: Optional[str] = typer.Option(None, "--model", help="Default model ID in config.toml"),
    model_provider: Optional[str] = typer.Option(None, "--model-provider", help="Default Provider in config.toml"),
    provider: Optional[str] = typer.Option(None, "--provider", help="Create or update this Provider"),
    base_url: Optional[str] = typer.Option(None, "--base-url", help="Provider API base URL"),
    api_key_env: Optional[str] = typer.Option(None, "--api-key-env", help="Provider API-key environment variable"),
    wire_api: str = typer.Option("openai", "--wire-api", help="openai or anthropic"),
    no_api_key: bool = typer.Option(False, "--no-api-key", help="Provider does not require an API key"),
    migrate: bool = typer.Option(False, "--migrate", help="Migrate legacy model configuration to config.toml"),
    check: bool = typer.Option(False, "--check", help="Validate and resolve config.toml"),
    path_only: bool = typer.Option(False, "--path", help="Print the config.toml path"),
    force: bool = typer.Option(False, "--force", help="Explicitly bypass optimistic revision checking"),
) -> None:
    """View, validate or update OpenDrSai configuration."""
    if ctx.invoked_subcommand is not None:
        return
    if path_only:
        typer.echo(str(default_config_path()))
        return
    if migrate:
        try:
            result = migrate_legacy_model_config()
        except ModelProviderConfigError as exc:
            raise typer.BadParameter(str(exc)) from exc
        typer.echo(
            f"Migrated model={result.model} provider={result.provider}"
            if result.migrated
            else f"No migration performed: {result.reason}"
        )
        return
    if provider:
        if not base_url:
            raise typer.BadParameter("--base-url is required with --provider")
        if model is not None or model_provider is not None:
            raise typer.BadParameter(
                "Global model selection has been removed; configure the selected Agent model policy instead"
            )
        values: dict[str, object] = {
            "base_url": base_url,
            "wire_api": wire_api,
            "requires_api_key": not no_api_key,
        }
        try:
            if api_key_env is not None:
                values["api_key_env"] = api_key_env
            request = ConfigUpdateRequest(
                provider_name=provider,
                provider_values=values,
                provider_secret=api_key,
            )
            preview = preview_update(request, environ=os.environ)
            commit_update(request, expected_revision=None if force else preview.base_revision)
        except ModelProviderConfigError as exc:
            raise typer.BadParameter(str(exc)) from exc
        typer.echo(f"Provider '{provider}' saved to {default_config_path()}")
        return
    if model is not None or model_provider is not None:
        raise typer.BadParameter(
            "Global model selection has been removed; configure the selected Agent model policy instead"
        )
    if check:
        try:
            compact = load_user_config()
            resolved = resolve_model_config(compact, environ=os.environ, require_credentials=False)
        except ModelProviderConfigError as exc:
            typer.echo(typer.style(f"Invalid config: {exc}", fg=typer.colors.RED))
            raise typer.Exit(1)
        typer.echo(
            f"OK: model={resolved.model} provider={resolved.provider.name} "
            f"wire_api={resolved.provider.wire_api}"
        )
        return
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
        try:
            compact = load_user_config()
            resolved = resolve_model_config(compact, environ=os.environ, require_credentials=False)
            typer.echo("\nconfig.toml model:")
            typer.echo(json.dumps(resolved.public_dict(), ensure_ascii=False, indent=2))
        except ModelProviderConfigError as exc:
            typer.echo(f"\nconfig.toml model: invalid ({exc})")
        return
    for key, val in updates:
        if val is not None:
            cfg[key] = val
    cli_config.save_config(cfg)
    typer.echo(f"Config saved to {cli_config.CLI_CONFIG_PATH}")


@config_app.command("path")
def config_path_cmd() -> None:
    """Print the active user TOML path."""
    typer.echo(str(default_config_path()))


@config_app.command("show")
def config_show_cmd() -> None:
    """Show the resolved model configuration with credentials redacted."""
    try:
        resolved = resolve_model_config(load_user_config(), environ=os.environ, require_credentials=False)
    except ModelProviderConfigError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(resolved.public_dict(), ensure_ascii=False, indent=2))


@config_app.command("check")
def config_check_cmd() -> None:
    """Validate and resolve the active user TOML."""
    try:
        resolved = resolve_model_config(load_user_config(), environ=os.environ, require_credentials=False)
    except ModelProviderConfigError as exc:
        typer.echo(typer.style(f"Invalid config: {exc}", fg=typer.colors.RED))
        raise typer.Exit(1)
    typer.echo(f"OK: model={resolved.model} provider={resolved.provider.name} wire_api={resolved.provider.wire_api}")


@config_app.command("status")
def config_status_cmd(json_fmt: bool = typer.Option(False, "--json")) -> None:
    """Show the effective model, revision, path, and recovery availability."""
    target = default_config_path()
    try:
        resolved = resolve_model_config(load_user_config(), environ=os.environ, require_credentials=False)
    except ModelProviderConfigError as exc:
        raise typer.BadParameter(str(exc)) from exc
    result = {
        "path": str(target),
        "revision": config_revision(target),
        "last_known_good_available": last_known_good_path(target).is_file(),
        "effective": resolved.public_dict(),
    }
    if json_fmt:
        typer.echo(json.dumps(result, ensure_ascii=False))
    else:
        typer.echo(f"model={resolved.model} provider={resolved.provider.name}")
        typer.echo(f"path={target}")
        typer.echo(f"revision={result['revision']}")
        typer.echo(f"last-known-good={'available' if result['last_known_good_available'] else 'unavailable'}")


@config_app.command("doctor")
def config_doctor_cmd(
    json_fmt: bool = typer.Option(False, "--json"),
    online: bool = typer.Option(False, "--online", help="Also test protocol and selected model; may incur cost"),
) -> None:
    """Run offline configuration and credential diagnostics."""
    result = diagnose_model_config(online=online)
    if json_fmt:
        typer.echo(json.dumps(result, ensure_ascii=False))
    else:
        for check in result["checks"]:
            typer.echo(f"[{str(check['status']).upper()}] {check['id']}: {check['message']}")
    if not result["ok"]:
        raise typer.Exit(1)


@config_app.command("restore")
def config_restore_cmd() -> None:
    """Restore the last configuration that committed successfully."""
    try:
        result = restore_last_known_good(expected_revision=config_revision())
    except ModelProviderConfigError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(f"Restored model={result.resolved.model} provider={result.resolved.provider.name}")


@config_app.command("credential-cleanup")
def config_credential_cleanup_cmd(
    apply: bool = typer.Option(False, "--apply", help="Delete confirmed orphaned local credentials"),
) -> None:
    """Scan local credential files; deletion requires an explicit --apply."""
    result = cleanup_orphaned_credentials(dry_run=not apply)
    typer.echo(json.dumps({key: value for key, value in result.items() if key != "orphan_references"}, ensure_ascii=False))


@config_app.command("migrate")
def config_migrate_cmd() -> None:
    """Idempotently migrate legacy model settings to config.toml."""
    result = migrate_legacy_model_config()
    typer.echo(
        f"Migrated model={result.model} provider={result.provider}"
        if result.migrated
        else f"No migration performed: {result.reason}"
    )


@config_app.command("set-model")
def config_set_model_cmd(model: str, force: bool = typer.Option(False, "--force")) -> None:
    """Reject the retired global model selection command."""
    raise typer.BadParameter(
        "Global model selection has been removed; configure the selected Agent model policy instead"
    )


@config_app.command("set-provider")
def config_set_provider_cmd(provider: str, force: bool = typer.Option(False, "--force")) -> None:
    """Reject the retired global Provider selection command."""
    raise typer.BadParameter(
        "Global model selection has been removed; configure the selected Agent model policy instead"
    )


@provider_app.command("list")
def provider_list_cmd() -> None:
    """List configured Providers without exposing credentials."""
    config = load_user_config()
    rows = []
    for name in sorted({*builtin_provider_names(), *config.providers}):
        try:
            resolved = resolve_model_config(
                config, environ=os.environ, provider=name, require_credentials=False
            )
        except ModelProviderConfigError:
            continue
        rows.append(resolved.provider.public_dict())
    typer.echo(json.dumps(rows, ensure_ascii=False, indent=2))


def _save_provider_from_cli(
    name: str,
    base_url: str,
    api_key: Optional[str],
    api_key_env: Optional[str],
    wire_api: str,
    no_api_key: bool,
    force: bool,
) -> None:
    values: dict[str, object] = {
        "base_url": base_url,
        "wire_api": wire_api,
        "requires_api_key": not no_api_key,
    }
    try:
        if api_key_env is not None:
            values["api_key_env"] = api_key_env
        revision = config_revision()
        commit_update(ConfigUpdateRequest(
            provider_name=name,
            provider_values=values,
            provider_secret=api_key,
        ), expected_revision=None if force else revision)
    except ModelProviderConfigError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(f"Provider '{name}' saved")


@provider_app.command("add")
@provider_app.command("edit")
def provider_save_cmd(
    name: str,
    base_url: str = typer.Option(..., "--base-url"),
    api_key: Optional[str] = typer.Option(None, "--api-key", help="Prefer --api-key-env to avoid shell history"),
    api_key_env: Optional[str] = typer.Option(None, "--api-key-env"),
    wire_api: str = typer.Option("openai", "--wire-api"),
    no_api_key: bool = typer.Option(False, "--no-api-key"),
    force: bool = typer.Option(False, "--force", help="Explicitly bypass optimistic revision checking"),
) -> None:
    """Add or edit a Provider."""
    _save_provider_from_cli(name, base_url, api_key, api_key_env, wire_api, no_api_key, force)


@provider_app.command("test")
def provider_test_cmd(
    name: str,
    model: Optional[str] = typer.Option(None, "--model"),
    mode: str = typer.Option("model", "--mode", help="basic or model"),
) -> None:
    """Run a bounded authenticated connectivity probe."""
    resolved = resolve_model_config(load_user_config(), environ=os.environ, provider=name, model=model)
    if mode not in {"basic", "model"}:
        raise typer.BadParameter("--mode must be basic or model")
    result = asyncio.run(test_provider_connection(resolved, mode=mode))  # type: ignore[arg-type]
    typer.echo(json.dumps(result, ensure_ascii=False))
    if not result.get("ok"):
        raise typer.Exit(1)


@provider_app.command("models")
def provider_models_cmd(
    name: str,
    refresh: bool = typer.Option(False, "--refresh"),
) -> None:
    """Discover model IDs exposed by a configured Provider."""
    resolved = resolve_model_config(load_user_config(), environ=os.environ, provider=name)
    result = asyncio.run(discover_provider_models(resolved, refresh=refresh))
    typer.echo(json.dumps(result, ensure_ascii=False))
    if not result.get("ok"):
        raise typer.Exit(1)


@provider_app.command("setup")
def provider_setup_cmd() -> None:
    """Interactively test, preview, and save a model service."""
    preset_ids = ["hepai", "openai", "anthropic", "deepseek", "ollama", "custom-openai", "custom-anthropic"]
    typer.echo("Model service presets:")
    for index, preset_id in enumerate(preset_ids, 1):
        preset_item = get_provider_preset(preset_id)
        typer.echo(f"  {index}. {preset_item.label if preset_item else preset_id}")
    choice = typer.prompt("Preset", default="1").strip()
    try:
        preset_id = preset_ids[int(choice) - 1] if choice.isdigit() else choice
    except IndexError as exc:
        raise typer.BadParameter("Unknown preset") from exc
    preset = get_provider_preset(preset_id)
    if preset is None:
        raise typer.BadParameter("Unknown preset")

    default_name = "custom" if preset.id.startswith("custom-") else preset.id
    provider = typer.prompt("Provider name", default=default_name).strip()
    if not provider or not provider.replace("-", "").replace("_", "").isalnum():
        raise typer.BadParameter("Provider name may contain letters, numbers, '_' and '-'")
    base_url = preset.base_url
    if preset.base_url_editable:
        base_url = typer.prompt("Base URL", default=base_url).strip()

    api_key: str | None = None
    api_key_env: str | None = None
    if preset.requires_api_key:
        source = typer.prompt("Key source (secure/env)", default="secure").strip().lower()
        if source == "secure":
            api_key = typer.prompt("API Key", hide_input=True).strip()
            if not api_key:
                raise typer.BadParameter("API Key is required")
        elif source == "env":
            api_key_env = typer.prompt(
                "Environment variable", default=preset.api_key_env or "API_KEY"
            ).strip()
        else:
            raise typer.BadParameter("Key source must be secure or env")

    model = typer.prompt(
        "Model ID", default="deepseek-v4-pro" if preset.id == "hepai" else ""
    ).strip()
    if not model:
        raise typer.BadParameter("Model ID is required")
    draft = ProviderDraft(
        name=provider,
        base_url=base_url,
        model=model,
        wire_api=preset.wire_api,  # type: ignore[arg-type]
        requires_api_key=preset.requires_api_key,
        api_key=api_key,
        api_key_env=api_key_env,
    )
    if typer.confirm("Test this draft before saving?", default=True):
        test_result = asyncio.run(probe_provider_draft(draft, mode="basic", environ=os.environ))
        if test_result.get("ok"):
            typer.echo("Draft connection test passed (nothing saved yet).")
        else:
            guidance = test_result.get("guidance")
            if isinstance(guidance, dict):
                typer.echo(f"Draft test failed: {guidance.get('title', test_result.get('error', 'unknown'))}")
                for action in guidance.get("actions", []):
                    typer.echo(f"  - {action}")
            else:
                typer.echo(f"Draft test failed: {test_result.get('error', 'unknown')}")
            if not typer.confirm("Save anyway?", default=False):
                raise typer.Abort()

    values: dict[str, object] = {
        "base_url": base_url,
        "wire_api": preset.wire_api,
        "requires_api_key": preset.requires_api_key,
    }
    if api_key_env:
        values["api_key_env"] = api_key_env
    request = ConfigUpdateRequest(
        provider_name=provider,
        provider_values=values,
        provider_secret=api_key,
    )
    preview = preview_update(request, environ=os.environ)
    typer.echo(
        f"Preview: Provider={provider} probe_model={model} base_url={base_url}"
    )
    if not typer.confirm("Save this Provider configuration?", default=True):
        raise typer.Abort()
    commit_update(request, expected_revision=preview.base_revision)
    typer.echo(f"Saved Provider={provider}; select models in the Agent model policy")


@provider_app.command("remove")
def provider_remove_cmd(
    name: str,
    force: bool = typer.Option(False, "--force"),
    keep_credential: bool = typer.Option(False, "--keep-credential", help="Remove the Provider but retain its secure credential for manual recovery"),
) -> None:
    """Remove a custom Provider."""
    revision = config_revision()
    commit_update(ConfigUpdateRequest(
        delete_provider_name=name,
        delete_provider_credential=not keep_credential,
    ), expected_revision=None if force else revision)
    typer.echo(f"Provider '{name}' removed")


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
    """Print OpenDrSai version."""
    typer.echo(f"version: {VERSION}")


# ── Daemon 子命令组 ───────────────────────────────────────────────────────────

daemon_app = typer.Typer(
    name="daemon",
    help="管理后台常驻的 OpenDrSai Agent 服务（daemon）",
    no_args_is_help=True,
)
app.add_typer(daemon_app, name="daemon")


@daemon_app.command("start")
def daemon_start(
    name: str = typer.Option("default", "--name", "-n", help="Daemon 名称"),
    port: Optional[int] = typer.Option(None, "--port", "-p", help="WebSocket 端口（默认自动选择）"),
    wechat_port: Optional[int] = typer.Option(None, "--wechat-port", help="微信接入端口"),
    wechat: bool = typer.Option(False, "--wechat/--no-wechat", help="是否启用微信接入"),
    restart: bool = typer.Option(False, "--restart", help="如已运行则先停止再启动"),
    model: Optional[str] = typer.Option(None, "--model", "-m", help="指定 daemon 使用的模型别名（如 claude-sonnet-4-5, gpt-4o）"),
) -> None:
    """启动后台常驻的 OpenDrSai Agent Daemon。"""
    from drsai.backend.daemon.pid_manager import start_daemon, stop_daemon, is_running

    if restart and is_running(name):
        typer.echo(f"  停止现有 daemon '{name}'...")
        stop_daemon(name)

    typer.echo(f"\n  启动 Daemon '{name}'...")
    try:
        state = start_daemon(
            name=name,
            ws_port=port,
            wechat_port=wechat_port,
            wechat_enabled=wechat,
            model=model,
        )
    except RuntimeError as e:
        typer.echo(typer.style(f"\n  ✗ 启动失败: {e}", fg=typer.colors.RED))
        raise typer.Exit(1)
    except TimeoutError as e:
        typer.echo(typer.style(f"\n  ✗ 超时: {e}", fg=typer.colors.RED))
        raise typer.Exit(1)

    typer.echo(typer.style(f"\n  ✓ OpenDrSai Daemon '{name}' 启动成功\n", fg=typer.colors.GREEN, bold=True))
    typer.echo(f"  PID        : {state['pid']}")
    typer.echo(f"  模型       : {state.get('model') or '(使用全局默认)'}")
    typer.echo(f"  WebSocket  : ws://127.0.0.1:{state['ws_port']}/ws")
    typer.echo(f"  管理 API   : http://127.0.0.1:{state['ws_port']}/api")
    if state.get("wechat_enabled"):
        typer.echo(f"  微信接入   : ilink Bot 长轮询 (端口 {state['wechat_port']})")
    typer.echo(f"  API Token  : {state['api_token']}")
    typer.echo(f"  日志文件   : {state['log_file']}")
    typer.echo(f"\n  Attach URL : ws://127.0.0.1:{state['ws_port']}/ws?token={state['api_token']}")
    typer.echo(f"\n  在 TUI 中使用 /daemons 命令查看和管理此 daemon。\n")


@daemon_app.command("stop")
def daemon_stop(
    name: Optional[str] = typer.Option(None, "--name", "-n", help="Daemon 名称"),
    all_: bool = typer.Option(False, "--all", help="停止所有 daemon"),
) -> None:
    """停止后台 daemon。"""
    from drsai.backend.daemon.pid_manager import stop_daemon, list_daemons, remove_pid, remove_state

    targets: list[str] = []
    dead_daemons: list[str] = []
    if all_:
        for d in list_daemons():
            if d.get("alive"):
                targets.append(d["name"])
            else:
                dead_daemons.append(d["name"])
    elif name:
        targets = [name]
    else:
        typer.echo("请指定 --name 或 --all")
        raise typer.Exit(1)

    for n in targets:
        if stop_daemon(n):
            typer.echo(typer.style(f"  ✓ Daemon '{n}' 已停止", fg=typer.colors.GREEN))
        else:
            typer.echo(f"  Daemon '{n}' 未在运行")

    # 清理已死 daemon 的残留 state 文件
    if dead_daemons:
        for n in dead_daemons:
            remove_pid(n)
            remove_state(n)
            typer.echo(typer.style(f"  ✓ Daemon '{n}' 残留状态已清理", fg=typer.colors.YELLOW))


@daemon_app.command("status")
def daemon_status(
    name: Optional[str] = typer.Option(None, "--name", "-n", help="查看指定 daemon（默认列出全部）"),
) -> None:
    """查看 daemon 运行状态。"""
    import datetime
    from drsai.backend.daemon.pid_manager import list_daemons, read_state, is_running

    if name:
        # 单个 daemon 详情
        state = read_state(name)
        if not state:
            typer.echo(f"  Daemon '{name}' 未找到")
            raise typer.Exit(1)
        alive = is_running(name)
        status_str = typer.style("运行中", fg=typer.colors.GREEN) if alive else typer.style("已停止", fg=typer.colors.RED)
        typer.echo(f"\n  Daemon: {name}")
        typer.echo(f"  状态  : {status_str}")
        typer.echo(f"  PID   : {state.get('pid', '─')}")
        typer.echo(f"  WS 端口: ws://127.0.0.1:{state.get('ws_port', '─')}/ws")
        if alive:
            uptime = datetime.timedelta(seconds=int(datetime.datetime.now().timestamp() - state.get("started_at", 0)))
            typer.echo(f"  运行时间: {uptime}")
        typer.echo(f"  微信  : {'已启用' if state.get('wechat_enabled') else '未启用'}")
        typer.echo(f"  日志  : {state.get('log_file', '─')}\n")
        return

    daemons = list_daemons()
    if not daemons:
        typer.echo("  当前没有已配置的 daemon。使用 `drsai daemon start` 启动一个。")
        return

    typer.echo(f"\n  {'名称':<20} {'状态':<8} {'PID':<8} {'WS端口':<8} {'运行时间':<14} {'微信'}")
    typer.echo("  " + "─" * 70)
    for d in daemons:
        alive = d.get("alive", False)
        status_str = typer.style("运行中", fg=typer.colors.GREEN) if alive else typer.style("已停止", fg=typer.colors.RED)
        uptime = str(datetime.timedelta(seconds=int(d.get("uptime_seconds", 0)))) if alive else "─"
        wechat = "✓" if d.get("wechat_enabled") else "─"
        pid = str(d.get("pid", "─")) if alive else "─"
        typer.echo(f"  {d['name']:<20} {status_str:<8} {pid:<8} {d.get('ws_port', '─')!s:<8} {uptime:<14} {wechat}")
    typer.echo()


@daemon_app.command("list")
def daemon_list(
    json_output: bool = typer.Option(False, "--json", help="JSON 格式输出"),
) -> None:
    """列出所有已配置的 daemon（脚本友好格式）。"""
    import json as _json
    from drsai.backend.daemon.pid_manager import list_daemons

    daemons = list_daemons()
    if json_output:
        print(_json.dumps(daemons, ensure_ascii=False, indent=2))
    else:
        if not daemons:
            typer.echo("(无 daemon)")
            return
        for d in daemons:
            alive = "up" if d.get("alive") else "down"
            print(f"{d['name']}  {alive}  ws:{d.get('ws_port', '?')}")


@daemon_app.command("logs")
def daemon_logs(
    name: str = typer.Option("default", "--name", "-n", help="Daemon 名称"),
    tail: int = typer.Option(50, "--tail", help="显示末尾行数"),
    follow: bool = typer.Option(False, "--follow", "-f", help="持续跟踪输出"),
) -> None:
    """查看 daemon 日志。"""
    from drsai.backend.daemon.pid_manager import _log_file

    log_path = _log_file(name)
    if not log_path.exists():
        typer.echo(f"  日志文件不存在: {log_path}")
        raise typer.Exit(1)

    # Windows does not ship `tail`; use pure-Python fallback so the command
    # works on both platforms without requiring Git-BASH / WSL.
    if sys.platform == "win32" or not shutil.which("tail"):
        _tail_fallback(log_path, tail, follow)
    else:
        import subprocess as sp
        cmd = ["tail", f"-n{tail}"]
        if follow:
            cmd.append("-f")
        cmd.append(str(log_path))
        sp.run(cmd)


def _tail_fallback(path: Path, n: int, follow: bool) -> None:
    """Pure-Python ``tail -n N [-f]`` for Windows (or systems without tail)."""
    import time
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            # Read all lines, keep only last n
            lines = fh.readlines()
            for line in lines[-n:]:
                print(line, end="")
            if not follow:
                return
            # -f mode: seek to end and poll for new lines
            fh.seek(0, 2)  # EOF
            while True:
                line = fh.readline()
                if line:
                    print(line, end="")
                else:
                    time.sleep(0.5)
    except KeyboardInterrupt:
        pass


@daemon_app.command("send")
def daemon_send(
    message: str = typer.Argument(..., help="要发送的消息"),
    name: str = typer.Option("default", "--name", "-n", help="Daemon 名称"),
    session: str = typer.Option("auto", "--session", "-s", help="会话 ID"),
) -> None:
    """向指定 daemon 发送一条消息（调试用）。"""
    import json as _json
    from drsai.backend.daemon.pid_manager import read_state

    state = read_state(name)
    if not state:
        typer.echo(f"  Daemon '{name}' 未找到或未运行")
        raise typer.Exit(1)

    try:
        import websocket  # websocket-client
    except ImportError:
        typer.echo("  缺少依赖: websocket-client。请运行 `pip install websocket-client`")
        raise typer.Exit(1)

    url = f"ws://127.0.0.1:{state['ws_port']}/ws?token={state['api_token']}"
    try:
        ws = websocket.create_connection(url, timeout=10)
    except Exception as e:
        typer.echo(f"  连接 daemon 失败: {e}")
        raise typer.Exit(1)

    ws.recv()  # gateway.ready

    ws.send(_json.dumps({
        "jsonrpc": "2.0", "id": "r1",
        "method": "session.create",
        "params": {"name": f"cli-send-{name}"}
    }))
    resp = _json.loads(ws.recv())
    sid = (resp.get("result") or {}).get("session_id", session)

    ws.send(_json.dumps({
        "jsonrpc": "2.0", "id": "r2",
        "method": "prompt.submit",
        "params": {"session_id": sid, "text": message}
    }))

    typer.echo(f"\n  [Daemon: {name}] [Session: {sid}]\n")

    while True:
        try:
            frame = _json.loads(ws.recv())
        except Exception:
            break
        params = frame.get("params") or {}
        ev_type = params.get("type", "")
        payload = params.get("payload") or {}
        if ev_type == "message.delta":
            print(payload.get("text", ""), end="", flush=True)
        elif ev_type == "message.complete":
            print()
            break
        elif ev_type == "error":
            typer.echo(f"\n  ✗ {payload.get('message', '')}")
            break

    ws.close()


# ── Entry point ──────────────────────────────────────────────────────────────


def run() -> None:
    """Main entry point used by the ``drsai`` console script."""
    # `drsai` (no args) → implicit `chat` subcommand
    # `drsai --version` / `drsai -V` → handled by callback (don't insert chat)
    if len(sys.argv) == 1:
        sys.argv.insert(1, "chat")
    elif (
        len(sys.argv) >= 2
        and sys.argv[1].startswith("-")
        and sys.argv[1] not in ("--version", "-V")
    ):
        sys.argv.insert(1, "chat")
    try:
        app()
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)


if __name__ == "__main__":
    run()
