"""User-level OpenDrSai platform configuration.

The configuration lives under ``DRSAI_HOME`` (``~/.drsai`` by default) and
follows the same user-level configuration model as tools such as Codex.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11
    import tomli as tomllib


DEFAULT_PLATFORM = "production"
DEFAULT_PLATFORMS: dict[str, dict[str, str]] = {
    "production": {
        "portal_url": "https://ai.ihep.ac.cn",
        "base_url": "https://aiapi.ihep.ac.cn/apiv2",
    },
    "development": {
        "portal_url": "https://ai-dev.ihep.ac.cn",
        "base_url": "https://ai-dev.ihep.ac.cn/apiv2",
    },
}

DEFAULT_CONFIG_TOML = """\
active_platform = "production"

[platforms.production]
portal_url = "https://ai.ihep.ac.cn"
base_url = "https://aiapi.ihep.ac.cn/apiv2"

[platforms.development]
portal_url = "https://ai-dev.ihep.ac.cn"
base_url = "https://ai-dev.ihep.ac.cn/apiv2"
"""


@dataclass(frozen=True)
class PlatformConfig:
    name: str
    portal_url: str
    base_url: str

    @property
    def oidc_issuer(self) -> str:
        return f"{self.portal_url}/api"


def get_config_path() -> Path:
    configured_home = os.getenv("DRSAI_HOME")
    root = Path(configured_home).expanduser() if configured_home else Path.home() / ".drsai"
    return root / "config.toml"


def load_config(path: Path | None = None) -> dict[str, Any]:
    config_path = path or get_config_path()
    if not config_path.is_file():
        _create_default_config(config_path)
    with config_path.open("rb") as stream:
        data = tomllib.load(stream)
    if not isinstance(data, dict):
        raise ValueError(f"OpenDrSai config must be a TOML table: {config_path}")
    return data


def _create_default_config(config_path: Path) -> None:
    """Create the user config once without replacing an existing file."""
    config_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with config_path.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(DEFAULT_CONFIG_TOML)
    except FileExistsError:
        # Another process may have created it between is_file() and open().
        pass


def get_active_platform(path: Path | None = None) -> PlatformConfig:
    config = load_config(path)
    name = config.get("active_platform", DEFAULT_PLATFORM)
    if not isinstance(name, str) or not name.strip():
        raise ValueError("active_platform must be a non-empty string")
    name = name.strip()

    values = dict(DEFAULT_PLATFORMS.get(name, {}))
    configured_platforms = config.get("platforms", {})
    if configured_platforms is not None and not isinstance(configured_platforms, dict):
        raise ValueError("platforms must be a TOML table")
    configured = configured_platforms.get(name, {}) if configured_platforms else {}
    if not isinstance(configured, dict):
        raise ValueError(f"platforms.{name} must be a TOML table")
    values.update(configured)

    if not values:
        raise ValueError(f"Unknown platform {name!r}; add [platforms.{name}] to config.toml")

    return PlatformConfig(
        name=name,
        portal_url=_normalize_url(values.get("portal_url"), f"platforms.{name}.portal_url"),
        base_url=_normalize_url(values.get("base_url"), f"platforms.{name}.base_url"),
    )


def _normalize_url(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty URL")
    normalized = value.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field} must be an absolute HTTP(S) URL")
    return normalized
