"""Persisted provider-neutral web-search selection policy."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import tempfile
from typing import Literal


WebSearchProviderMode = Literal["auto", "managed", "byok", "none"]
_MODES = frozenset({"auto", "managed", "byok", "none"})


@dataclass(frozen=True)
class WebSearchProviderSelection:
    mode: WebSearchProviderMode
    provider: Literal["hai_managed_tavily", "tavily"] | None
    error: str | None = None

    @property
    def available(self) -> bool:
        return self.provider is not None

    def public_dict(self) -> dict[str, object]:
        return {"mode": self.mode, "provider": self.provider, "available": self.available, "error": self.error}


def resolve_web_search_provider(
    mode: str, *, platform_authenticated: bool, byok_available: bool,
) -> WebSearchProviderSelection:
    normalized = normalize_provider_mode(mode)
    if normalized == "none":
        return WebSearchProviderSelection(normalized, None, "policy_denied")
    if normalized == "managed":
        return WebSearchProviderSelection(normalized, "hai_managed_tavily" if platform_authenticated else None, None if platform_authenticated else "login_required")
    if normalized == "byok":
        return WebSearchProviderSelection(normalized, "tavily" if byok_available else None, None if byok_available else "credential_missing")
    if platform_authenticated:
        return WebSearchProviderSelection(normalized, "hai_managed_tavily")
    if byok_available:
        return WebSearchProviderSelection(normalized, "tavily")
    return WebSearchProviderSelection(normalized, None, "configuration_required")


def normalize_provider_mode(value: object) -> WebSearchProviderMode:
    mode = str(value or "auto").strip().lower()
    if mode not in _MODES:
        raise ValueError("web_search_provider_mode_invalid")
    return mode  # type: ignore[return-value]


def policy_path(config_dir: str | Path) -> Path:
    return Path(config_dir) / "perceptors" / "web_search_policy.json"


def read_provider_mode(config_dir: str | Path) -> WebSearchProviderMode:
    path = policy_path(config_dir)
    if not path.is_file():
        return "auto"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return "auto"
    try:
        return normalize_provider_mode(value.get("mode") if isinstance(value, dict) else None)
    except ValueError:
        return "auto"


def write_provider_mode(config_dir: str | Path, mode: object) -> WebSearchProviderMode:
    normalized = normalize_provider_mode(mode)
    path = policy_path(config_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"version": 1, "mode": normalized}, ensure_ascii=False, separators=(",", ":")) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=".web-search-policy-", suffix=".tmp", delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    temporary.replace(path)
    return normalized
