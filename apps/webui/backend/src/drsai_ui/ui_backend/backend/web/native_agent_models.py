"""Public native-agent projections that must never contain execution secrets."""
from __future__ import annotations

from typing import Any


def public_agent(
    agent: dict[str, Any],
    *,
    is_default: bool = False,
    recent: dict[str, Any] | None = None,
    catalog_group: str = "official",
) -> dict[str, Any]:
    config = agent.get("config") if isinstance(agent.get("config"), dict) else {}
    available = agent.get("available") is not False and agent.get("status") not in {
        "offline",
        "disabled",
        "unreachable",
    }
    return {
        "id": str(agent.get("id") or ""),
        "name": str(agent.get("name") or config.get("name") or "Unknown agent"),
        "description": str(agent.get("description") or config.get("description") or ""),
        "owner": str(agent.get("owner") or agent.get("author") or "OpenDrSai"),
        "mode": str(agent.get("mode") or config.get("mode") or "remote"),
        "status": "online" if available else "offline",
        "available": available,
        "featured": bool(agent.get("featured")),
        "is_default": is_default or bool(agent.get("is_default")),
        "model": _public_string(agent.get("model") or config.get("model")),
        "models": _public_models(
            agent.get("models")
            or agent.get("allowed_models")
            or agent.get("available_models")
            or config.get("models")
            or config.get("allowed_models")
            or config.get("available_models")
        ),
        "logo": _public_string(agent.get("logo") or agent.get("avatar")),
        "examples": _public_examples(agent.get("examples") or config.get("examples")),
        "capabilities": _public_capabilities(agent.get("capabilities")),
        "last_used_at": _public_string((recent or {}).get("last_used_at")),
        "catalog_group": "mine" if catalog_group == "mine" else "official",
    }


def _public_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _public_models(value: Any) -> list[str] | None:
    if not isinstance(value, list):
        return None
    result: list[str] = []
    for item in value:
        candidate = item
        if isinstance(item, dict):
            candidate = item.get("id") or item.get("alias") or item.get("model")
        model = _public_string(candidate)
        if model and model not in result:
            result.append(model)
    return result or None


def _public_examples(value: Any) -> list[Any] | str | None:
    if isinstance(value, str):
        return value[:4000]
    if not isinstance(value, list):
        return None
    result: list[Any] = []
    for item in value[:20]:
        if isinstance(item, str) and item.strip():
            result.append(item.strip()[:1000])
        elif isinstance(item, dict):
            localized = {
                key: text.strip()[:1000]
                for key in ("en", "zh")
                if isinstance((text := item.get(key)), str) and text.strip()
            }
            if localized:
                result.append(localized)
    return result or None


def _public_capabilities(value: Any) -> list[str] | None:
    if isinstance(value, list):
        result = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        return result or None
    if isinstance(value, dict):
        result = [str(key) for key, enabled in value.items() if enabled is True]
        return result or None
    return None
