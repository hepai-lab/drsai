"""Setup-flow RPC handlers — first-run config (user_id, API key, model).

Driven by the UI's setup screen when ``gateway.ready.setup.setup_required``
is true. The UI collects user_id / provider / API key / model alias and
calls ``setup.save`` to persist.
"""

from __future__ import annotations

import logging
import os

from ..server import _err, _ok, method
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

    Useful for the UI to refresh after the user submits credentials.
    """
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else {}
    has_api_key = any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("HEPAI_API_KEY"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])
    return _ok(rid, {
        "config_exists": cli_config.CLI_CONFIG_PATH.exists(),
        "has_api_key": has_api_key,
        "setup_required": (not cli_config.CLI_CONFIG_PATH.exists()) or (not has_api_key),
    })


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

    if provider not in _PROVIDER_KEYS and provider != "skip":
        return _err(rid, 4002, f"unknown provider: {provider!r}")

    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)

    if user_id:
        cfg["user_id"] = user_id
    if default_model:
        cfg["defult_config_name"] = default_model

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
    return _ok(rid, {
        "ok": True,
        "config_path": str(cli_config.CLI_CONFIG_PATH),
        "has_api_key": has_api_key,
        "setup_required": not has_api_key,
    })
