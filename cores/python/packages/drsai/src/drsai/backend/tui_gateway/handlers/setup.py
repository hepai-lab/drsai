"""Setup-flow RPC handlers — first-run config (user_id, API key, model).

Driven by the UI's setup screen when ``gateway.ready.setup.setup_required``
is true. The UI collects user_id / provider / API key / model alias and
calls ``setup.save`` to persist.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from ..server import _err, _ok, _resolve_user_id, method
from drsai.backend.cli import config as cli_config

logger = logging.getLogger(__name__)


_PROVIDER_KEYS = {
    "hepai":    ("api_key",           "HEPAI_API_KEY"),
    "anthropic": ("anthropic_api_key", "ANTHROPIC_API_KEY"),
    "openai":   ("openai_api_key",    "OPENAI_API_KEY"),
}

_PROVIDER_BASE_URL_KEYS = {
    "hepai":    ("openai_base_url",     "OPENAI_BASE_URL"),
    "anthropic": ("anthropic_base_url",  "ANTHROPIC_BASE_URL"),
    "openai":   ("openai_base_url",     "OPENAI_BASE_URL"),
}


@method("setup.status")
def _status(rid, params: dict) -> dict:
    """Return the same setup snapshot the gateway emits at startup.

    Useful for the UI to refresh after the user submits credentials or
    completes the OIDC / skills setup flow.

    Delegates to :func:`entry.setup_status` so the RPC always returns
    identical fields as the ``gateway.ready`` event (auth_mode,
    auth_authenticated, skills_selected).
    """
    # Lazy import to avoid circular entry ↔ handlers dependency
    from ..entry import setup_status
    return _ok(rid, setup_status())


@method("setup.config")
def _config(rid, params: dict) -> dict:
    """Return the current CLI config with sensitive values masked.

    Used by the TUI SetupScreen overlay to display current configuration
    before the user modifies it via the wizard.
    """
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)
    masked: dict = {}
    for k, v in cfg.items():
        if k in cli_config._SENSITIVE_KEYS:
            # Check both config file and env var for the effective value
            env_map = {
                "api_key": "HEPAI_API_KEY",
                "anthropic_api_key": "ANTHROPIC_API_KEY",
                "openai_api_key": "OPENAI_API_KEY",
            }
            env_val = os.environ.get(env_map.get(k, ""), "")
            effective = v or env_val
            if effective:
                source = "env" if env_val and not v else "config"
                masked[k] = {"value": cli_config.mask_key(effective), "source": source}
            else:
                masked[k] = {"value": "<not set>", "source": "none"}
        else:
            masked[k] = v
    return _ok(rid, {
        "config": masked,
        "config_path": str(cli_config.CLI_CONFIG_PATH),
    })


@method("setup.save")
def _save(rid, params: dict) -> dict:
    """Persist first-run setup choices to ``~/.drsai/cli_config.json``.

    Params:
        provider:           one of "hepai" | "anthropic" | "openai" | "skip"
        api_key:            secret string (only when provider != skip)
        base_url:           optional override (only when provider != skip)
        user_id:            optional, defaults to the current cfg or "anonymous"
        defult_config_name: optional default model alias
    """
    provider = (params.get("provider") or "").strip().lower()
    api_key = (params.get("api_key") or "").strip()
    base_url = (params.get("base_url") or "").strip()
    user_id = (params.get("user_id") or "").strip()
    default_model = (params.get("defult_config_name") or "").strip()
    auth_mode = (params.get("auth_mode") or "").strip().lower()

    if provider not in _PROVIDER_KEYS and provider != "skip":
        return _err(rid, 4002, f"unknown provider: {provider!r}")

    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)

    if user_id:
        cfg["user_id"] = user_id
    if default_model:
        cfg["defult_config_name"] = default_model
    if auth_mode in ("none", "oidc", "apikey"):
        cfg["auth_mode"] = auth_mode

    if provider in _PROVIDER_KEYS:
        if not api_key:
            return _err(rid, 4002, "api_key is required for non-skip providers")
        cfg_key, env_key = _PROVIDER_KEYS[provider]
        cfg[cfg_key] = api_key
        os.environ[env_key] = api_key
        if base_url:
            bu_cfg, bu_env = _PROVIDER_BASE_URL_KEYS[provider]
            cfg[bu_cfg] = base_url
            os.environ[bu_env] = base_url

    try:
        cli_config.save_config(cfg)
    except Exception as exc:
        logger.exception("save_config failed")
        return _err(rid, 5000, f"save_config failed: {exc}")

    has_api_key = any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("HEPAI_API_KEY"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])
    # setup_required: False if user has API key OR chose OIDC (will auth later)
    setup_required = not has_api_key and cfg.get("auth_mode") != "oidc"
    return _ok(rid, {
        "ok": True,
        "config_path": str(cli_config.CLI_CONFIG_PATH),
        "has_api_key": has_api_key,
        "auth_mode": cfg.get("auth_mode", "none"),
        "setup_required": setup_required,
    })


# ── Built-in skills installation (first-run) ────────────────────────────

def _resolve_builtin_skills_dir():
    """Find the built-in skills directory (skills/skills/ in repo root)."""
    from drsai.modules.components.skills.discovery import resolve_builtin_skills_dir
    return resolve_builtin_skills_dir()


def _read_builtin_skill(skill_dir):
    """Read one built-in skill and return a summary dict."""
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return None
    try:
        content = skill_file.read_text(encoding="utf-8")
    except OSError:
        return None

    # Parse frontmatter
    import re
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
    if not m:
        return None
    frontmatter_str, body = m.groups()
    try:
        import yaml
        metadata = yaml.safe_load(frontmatter_str) or {}
    except Exception:
        metadata = {}
        for line in frontmatter_str.strip().splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                metadata[k.strip()] = v.strip().strip("\"'")

    if not isinstance(metadata, dict) or "name" not in metadata:
        return None

    return {
        "name": str(metadata.get("name", skill_dir.name)),
        "description": str(metadata.get("description", "")).strip(),
        "dir": str(skill_dir),
        "installed": False,  # will be set below
    }


@method("setup.skills.list")
def _setup_skills_list(rid, params: dict) -> dict:
    """List built-in skills available for installation and their install status.

    Returns:
        skills: list of {name, description, dir, installed}
        skills_selected: bool — whether user already completed selection
        enabled_skills: list of skill names the user chose
    """
    user_id = _resolve_user_id()

    # Get user skills dir to check what's already installed
    from drsai.configs.constant import WORKSPACE_RUNS_DIR
    user_skills_dir = Path(WORKSPACE_RUNS_DIR) / user_id / "configs" / "skills"

    builtin_dir = _resolve_builtin_skills_dir()
    if not builtin_dir:
        return _ok(rid, {
            "skills": [],
            "skills_selected": False,
            "enabled_skills": [],
            "error": "built-in skills directory not found",
        })

    # Load config for enabled_skills
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else {}
    enabled_skills = cfg.get("enabled_skills") or []
    skills_selected = bool(cfg.get("skills_selected", False))

    skills_list = []
    for skill_dir in sorted(builtin_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        info = _read_builtin_skill(skill_dir)
        if info is None:
            continue
        # Check if already installed in user dir
        installed_path = user_skills_dir / skill_dir.name
        info["installed"] = installed_path.exists()
        info["enabled"] = skill_dir.name in enabled_skills if enabled_skills else info["installed"]
        skills_list.append(info)

    return _ok(rid, {
        "skills": skills_list,
        "skills_selected": skills_selected,
        "enabled_skills": enabled_skills,
    })


@method("setup.skills.install")
def _setup_skills_install(rid, params: dict) -> dict:
    """Install (or uninstall) selected built-in skills to the user's skills dir.

    Params:
        skills: list of skill names to install (e.g. ["pptx", "image-process"])
            If empty, installs nothing (user chose to skip).
        uninstall_others: bool (default True) — remove skills not in the list

    Returns:
        installed: list of skill names successfully installed
        failed: list of {name, error}
        skills_selected: True (marks selection as complete)
    """
    import shutil as _shutil

    user_id = _resolve_user_id()
    from drsai.configs.constant import WORKSPACE_RUNS_DIR
    user_skills_dir = Path(WORKSPACE_RUNS_DIR) / user_id / "configs" / "skills"
    user_skills_dir.mkdir(parents=True, exist_ok=True)

    builtin_dir = _resolve_builtin_skills_dir()
    if not builtin_dir:
        return _err(rid, 5001, "built-in skills directory not found")

    selected = params.get("skills") or []
    if not isinstance(selected, list):
        return _err(rid, 4002, "skills must be a list of skill names")
    uninstall_others = params.get("uninstall_others", True)

    installed: list[str] = []
    failed: list[dict] = []

    # Install selected skills
    for skill_name in selected:
        src = builtin_dir / skill_name
        if not src.is_dir():
            failed.append({"name": skill_name, "error": "not found in built-in skills"})
            continue
        dst = user_skills_dir / skill_name
        try:
            if dst.exists():
                _shutil.rmtree(dst)
            _shutil.copytree(src, dst)
            installed.append(skill_name)
        except Exception as exc:
            failed.append({"name": skill_name, "error": str(exc)})

    # Optionally uninstall skills not in the selection
    if uninstall_others:
        for existing in user_skills_dir.iterdir():
            if not existing.is_dir():
                continue
            if existing.name not in selected:
                try:
                    _shutil.rmtree(existing)
                except Exception as exc:
                    logger.warning("Failed to remove skill %s: %s", existing.name, exc)

    # Persist selection in cli_config
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)
    cfg["enabled_skills"] = selected
    cfg["skills_selected"] = True
    try:
        cli_config.save_config(cfg)
    except Exception as exc:
        logger.exception("save_config for skills failed")
        return _err(rid, 5000, f"save_config failed: {exc}")

    return _ok(rid, {
        "installed": installed,
        "failed": failed,
        "skills_selected": True,
    })
