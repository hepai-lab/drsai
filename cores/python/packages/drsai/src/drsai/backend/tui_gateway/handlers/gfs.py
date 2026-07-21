"""GFS (高能所文件系统) configuration RPC handlers for the TUI gateway.

Provides RPC methods for managing the GFS personal-mode configuration:
read current status, save credentials, test connectivity, and clear config.

The configuration is persisted in ``~/.drsai/configs/cli_config.json``
under the ``"gfs"`` key (a nested dict).  This is the same config file
used by the CLI/TUI for API keys, user_id, model defaults, etc.

**The single source of truth is ``cli_config.json["gfs"]``.** Neither the
RPC handlers nor ``_build_gfs_tools`` read from ``os.environ`` — the user's
explicit config in ``cli_config.json`` is the only source.

GFS config structure in cli_config.json::

    "gfs": {
        "enabled": true,
        "mode": "personal",        # "personal" | "" (auto-detect)
        "access_key": "...",
        "secret_key": "...",
        "bucket": "20235-xiongdb",
        "email": "xiongdb@ihep.ac.cn",   # optional, logging only
        "s3_endpoint": ""                   # optional, "" = default
    }
"""

from __future__ import annotations

import logging
import os
from typing import Any

from ..server import _err, _ok, method
from drsai.backend.cli import config as cli_config

logger = logging.getLogger(__name__)

# ── Env-var names (kept in sync with cli_config["gfs"]) ───────────────

ENV_ENABLED = "DRSAI_GFS_ENABLED"
ENV_MODE = "DRSAI_GFS_MODE"
ENV_ACCESS_KEY = "GFS_ACCESS_KEY"
ENV_SECRET_KEY = "GFS_SECRET_KEY"
ENV_BUCKET = "GFS_BUCKET"
ENV_EMAIL = "GFS_USER_EMAIL"
ENV_S3_ENDPOINT = "GFS_S3_ENDPOINT"

# Mapping: cli_config["gfs"] key  ↔  os.environ var name
_GFS_CFG_TO_ENV = {
    "enabled":     ENV_ENABLED,
    "mode":        ENV_MODE,
    "access_key":  ENV_ACCESS_KEY,
    "secret_key":  ENV_SECRET_KEY,
    "bucket":      ENV_BUCKET,
    "email":       ENV_EMAIL,
    "s3_endpoint": ENV_S3_ENDPOINT,
}

DEFAULT_S3_ENDPOINT = "https://fgws3-gfs.ihep.ac.cn"


# ── Helpers ─────────────────────────────────────────────────────────────


def _mask(value: str) -> str:
    """Mask a sensitive value, showing only the last 4 characters."""
    if not value:
        return ""
    if len(value) <= 4:
        return "***"
    return f"***{value[-4:]}"


def _as_bool(text: Any, *, default: bool = False) -> bool:
    """Parse a boolean from a string/bool (mirrors run_drsai_agent_factory)."""
    if isinstance(text, bool):
        return text
    if text is None:
        return default
    t = str(text).strip().lower()
    if t in {"1", "true", "yes", "y", "on", "enable", "enabled"}:
        return True
    if t in {"0", "false", "no", "n", "off", "disable", "disabled"}:
        return False
    return default


def _load_gfs_cfg() -> dict[str, Any]:
    """Load the ``gfs`` sub-dict from cli_config.json (the single source of truth).

    Returns an empty dict if no GFS config exists yet.
    Does NOT fall back to ``os.environ`` — the user's explicit config
    in ``cli_config.json`` is the only source.
    """
    cfg = cli_config.load_config()
    gfs = cfg.get("gfs") or {}
    if not isinstance(gfs, dict):
        return {}
    return gfs


def _save_gfs_cfg(gfs: dict[str, Any]) -> None:
    """Persist the ``gfs`` sub-dict into cli_config.json."""
    cfg = cli_config.load_config()
    cfg["gfs"] = gfs
    cli_config.save_config(cfg)


def _clear_env() -> None:
    """Remove all GFS-related env vars from os.environ (defensive cleanup)."""
    for env_name in _GFS_CFG_TO_ENV.values():
        os.environ.pop(env_name, None)


# ── RPC: gfs.status ────────────────────────────────────────────────────


@method("gfs.status")
def _gfs_status(rid, params: dict) -> dict:
    """Return the current GFS configuration (values masked for display).

    Reads from ``cli_config.json`` (source of truth).  Also checks
    ``os.environ`` for the enabled/mode flags which may have been set
    at runtime.

    Response fields:
        enabled: bool
        mode: str — "personal" | "" (auto-detect)
        detected_mode: str — resolved mode after auto-detection
        has_personal_creds: bool
        access_key_masked, secret_key_masked: str
        bucket, email, s3_endpoint: str
        config_path: str — path to cli_config.json
    """
    gfs = _load_gfs_cfg()

    enabled = _as_bool(gfs.get("enabled", False), default=False)
    mode = (gfs.get("mode") or "").strip().lower()
    ak = gfs.get("access_key") or ""
    sk = gfs.get("secret_key") or ""
    bucket = gfs.get("bucket") or ""
    email = gfs.get("email") or ""
    s3_endpoint = gfs.get("s3_endpoint") or ""

    has_personal_creds = bool(ak and sk and bucket)

    # Auto-detect mode: personal if creds exist, otherwise empty
    if not mode:
        detected_mode = "personal" if has_personal_creds else ""
    else:
        detected_mode = mode

    return _ok(rid, {
        "enabled": enabled,
        "mode": mode,
        "detected_mode": detected_mode,
        "has_personal_creds": has_personal_creds,
        "access_key_masked": _mask(ak),
        "secret_key_masked": _mask(sk),
        "bucket": bucket,
        "email": email,
        "s3_endpoint": s3_endpoint or DEFAULT_S3_ENDPOINT,
        "config_path": str(cli_config.CLI_CONFIG_PATH),
        "config_exists": cli_config.CLI_CONFIG_PATH.exists(),
    })


# ── RPC: gfs.save ──────────────────────────────────────────────────────


@method("gfs.save")
def _gfs_save(rid, params: dict) -> dict:
    """Save GFS personal-mode configuration to cli_config.json.

    Params (all optional — only provided fields are updated):
        enabled: bool — set DRSAI_GFS_ENABLED
        mode: str — "personal" | "" (auto). Defaults to "personal".
        access_key: str — GFS_ACCESS_KEY
        secret_key: str — GFS_SECRET_KEY
        bucket: str — GFS_BUCKET
        email: str — GFS_USER_EMAIL (optional)
        s3_endpoint: str — GFS_S3_ENDPOINT (optional)

    To clear a field, pass an empty string "".
    """
    gfs = _load_gfs_cfg()

    # Update fields that were provided in params
    def _update(key: str, value: Any) -> None:
        if value is None:
            return
        if isinstance(value, str) and value == "":
            gfs.pop(key, None)  # remove on empty string
        else:
            gfs[key] = value

    # enabled (normalize to bool)
    if params.get("enabled") is not None:
        gfs["enabled"] = _as_bool(params["enabled"])

    # mode (personal only; admin mode not supported in TUI)
    if params.get("mode") is not None:
        mode_val = str(params["mode"]).strip().lower()
        if mode_val in ("personal", ""):
            if mode_val:
                gfs["mode"] = mode_val
            else:
                gfs.pop("mode", None)
        # Silently ignore "admin" or other values

    # Credentials
    _update("access_key", params.get("access_key"))
    _update("secret_key", params.get("secret_key"))
    _update("bucket", params.get("bucket"))
    _update("email", params.get("email"))
    _update("s3_endpoint", params.get("s3_endpoint"))

    # Persist to cli_config.json
    _save_gfs_cfg(gfs)

    logger.info(
        "GFS config saved to %s (enabled=%s, mode=%s, bucket=%s)",
        cli_config.CLI_CONFIG_PATH,
        gfs.get("enabled"),
        gfs.get("mode"),
        gfs.get("bucket"),
    )

    return _ok(rid, {
        "ok": True,
        "config_path": str(cli_config.CLI_CONFIG_PATH),
        "message": (
            "GFS configuration saved. "
            "Restart the session (Ctrl+C then /new or /switch) for the new "
            "GFS tools to take effect on the agent."
        ),
    })


# ── RPC: gfs.test ──────────────────────────────────────────────────────


@method("gfs.test")
def _gfs_test(rid, params: dict) -> dict:
    """Test the current GFS personal-mode credentials by doing a healthcheck.

    Directly constructs ``GfsUserClient`` from ``cli_config.json`` values
    (no ``os.environ`` involved) and runs a ``list_objects_v2`` healthcheck.

    This is a potentially slow operation (network call), so it is registered
    in ``_LONG_HANDLERS`` to run on the worker pool.
    """
    gfs = _load_gfs_cfg()
    enabled = _as_bool(gfs.get("enabled", False), default=False)
    if not enabled:
        return _ok(rid, {
            "ok": False,
            "error": "GFS is not enabled. Toggle it on first.",
        })

    ak = gfs.get("access_key") or ""
    sk = gfs.get("secret_key") or ""
    bucket = gfs.get("bucket") or ""
    if not (ak and sk and bucket):
        return _ok(rid, {
            "ok": False,
            "error": (
                "Personal credentials incomplete. "
                "Need access_key, secret_key, and bucket."
            ),
        })

    email = gfs.get("email") or ""
    s3_endpoint = gfs.get("s3_endpoint") or DEFAULT_S3_ENDPOINT

    try:
        from drsai.modules.managers.gfs.admin_client import GfsCredential
        from drsai.modules.managers.gfs.user_client import GfsUserClient

        cred = GfsCredential(
            access_key=ak,
            secret_key=sk,
            bucket=bucket,
            s3_endpoint=s3_endpoint,
            email=email,
            owner_id="",
            expiration=-1,
            status="active",
            resources=[],
        )
        client = GfsUserClient(cred)
        if not client.healthcheck():
            return _ok(rid, {
                "ok": False,
                "error": (
                    f"S3 healthcheck failed for personal credential "
                    f"(bucket={bucket}, ak={ak[:8]}...). "
                    "请确认 AK/SK 与 bucket 匹配，且当前网络能访问 GFS S3 endpoint。"
                ),
            })
        return _ok(rid, {
            "ok": True,
            "bucket": client.bucket,
            "email": client.email,
            "s3_endpoint": client.credential.s3_endpoint,
            "message": f"✓ GFS connection OK — bucket: {client.bucket}",
        })
    except Exception as exc:
        logger.warning("GFS test failed: %s", exc)
        return _ok(rid, {
            "ok": False,
            "error": str(exc),
        })


# ── RPC: gfs.clear ─────────────────────────────────────────────────────


@method("gfs.clear")
def _gfs_clear(rid, params: dict) -> dict:
    """Remove all GFS configuration from cli_config.json and os.environ."""
    # Remove the "gfs" key from cli_config.json
    cfg = cli_config.load_config()
    if "gfs" in cfg:
        del cfg["gfs"]
        cli_config.save_config(cfg)

    # Clear os.environ
    _clear_env()

    logger.info("GFS config cleared from cli_config.json")
    return _ok(rid, {
        "ok": True,
        "message": "GFS configuration cleared. Restart the session for changes to take effect.",
    })
