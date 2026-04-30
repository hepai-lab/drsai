"""Configuration management for DrSai CLI.

Handles loading, saving, and display of the CLI connection configuration.
Sensitive values (API keys) are always masked when displayed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from drsai.configs.constant import CONFIG_DIR, APPNAME

# ── Paths ────────────────────────────────────────────────────────────────────

CLI_CONFIG_PATH = Path(CONFIG_DIR) / "cli_config.json"
CLI_SESSIONS_PATH = Path(CONFIG_DIR) / "cli_sessions.json"

# ── Default config ────────────────────────────────────────────────────────────

DEFAULT_CONFIG: dict = {
    # 用户身份
    "user_id": "anonymous",
    # 默认模型名称（对应 defult_config_name）
    "defult_config_name": None,
    # Plan mode: 启用后 AI 会先访谈用户确认计划再执行
    "plan_mode": False,
}

# Config keys that hold sensitive values — always masked when displayed.
_SENSITIVE_KEYS: tuple[str, ...] = ()

# ── Config I/O ───────────────────────────────────────────────────────────────

def load_config() -> dict:
    """Load CLI config from disk, merging with defaults."""
    if CLI_CONFIG_PATH.exists():
        try:
            with open(CLI_CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            cfg = {**DEFAULT_CONFIG, **saved}
            return cfg
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    """Save CLI config to disk (api_key is never written to disk as plaintext,
    callers should use HEPAI_API_KEY env var instead or handle masking)."""
    CLI_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CLI_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def update_config(**kwargs) -> dict:
    """Update specific config keys and save."""
    cfg = load_config()
    for key, value in kwargs.items():
        if key in DEFAULT_CONFIG:
            cfg[key] = value
    save_config(cfg)
    return cfg


# ── Session I/O ──────────────────────────────────────────────────────────────

def load_sessions() -> dict:
    """Load saved sessions: {session_id: {"name": ..., "last_used": ...}}"""
    if CLI_SESSIONS_PATH.exists():
        try:
            with open(CLI_SESSIONS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_sessions(sessions: dict) -> None:
    """Save sessions dict to disk."""
    CLI_SESSIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CLI_SESSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2, ensure_ascii=False)


# ── Display helpers ──────────────────────────────────────────────────────────

def mask_key(key: str) -> str:
    """Mask an API key, showing only first 4 and last 4 chars."""
    if not key:
        return "<not set>"
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def show_config(cfg: Optional[dict] = None, *, as_json: bool = False) -> None:
    """Print the current configuration in a human-readable format.

    Args:
        cfg: config dict to display (loads from disk if None)
        as_json: if True, print raw JSON; otherwise use pretty table format
    """
    if cfg is None:
        cfg = load_config()

    print()
    print(f"  Config file: {CLI_CONFIG_PATH}")
    print()
    print(f"  {'User ID':<18} {cfg.get('user_id', 'anonymous'):<34}  (your identifier)")
    print(f"  {'Model':<18} {str(cfg.get('defult_config_name') or '<not set>'):<34}  (default model)")
    plan_mode = cfg.get('plan_mode', False)
    print(f"  {'Plan Mode':<18} {'on' if plan_mode else 'off':<34}  (AI interviews before acting)")
    print()


def config_as_dict_for_export(cfg: Optional[dict] = None) -> dict:
    """Return a safe-to-print config dict."""
    if cfg is None:
        cfg = load_config()
    return {
        "user_id": cfg.get("user_id", "anonymous"),
        "defult_config_name": cfg.get("defult_config_name"),
        "plan_mode": cfg.get("plan_mode", False),
    }


# ── Workdir Sessions I/O ─────────────────────────────────────────────────────

def get_workdir_sessions() -> dict[str, str]:
    """Get workdir -> session_id mapping."""
    cfg = load_config()
    return cfg.get("workdir_sessions", {})


def set_workdir_session(workdir: str, session_id: str) -> None:
    """Set session for a workdir."""
    cfg = load_config()
    workdir_sessions = cfg.get("workdir_sessions", {})
    workdir_sessions[workdir] = session_id
    cfg["workdir_sessions"] = workdir_sessions
    save_config(cfg)


def remove_workdir_session(workdir: str) -> None:
    """Remove workdir mapping."""
    cfg = load_config()
    workdir_sessions = cfg.get("workdir_sessions", {})
    if workdir in workdir_sessions:
        del workdir_sessions[workdir]
        cfg["workdir_sessions"] = workdir_sessions
        save_config(cfg)
