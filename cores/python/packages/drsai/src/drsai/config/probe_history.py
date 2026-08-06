"""Process-local, redacted history of the latest provider probe."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import RLock
from typing import Mapping

_LOCK = RLock()
_LATEST: dict[str, dict[str, object]] = {}


def record_probe_result(provider: str, model: str, mode: str, result: Mapping[str, object]) -> None:
    value = {
        "provider": provider,
        "model": model,
        "mode": mode,
        "ok": bool(result.get("ok")),
        "tested_at": datetime.now(timezone.utc).isoformat(),
        **({"error": result["error"]} if isinstance(result.get("error"), str) else {}),
        **({"status_code": result["status_code"]} if isinstance(result.get("status_code"), int) else {}),
        **({"duration_ms": result["duration_ms"]} if isinstance(result.get("duration_ms"), int) else {}),
    }
    with _LOCK:
        _LATEST[provider] = value


def latest_probe_result(provider: str) -> dict[str, object] | None:
    with _LOCK:
        value = _LATEST.get(provider)
        return dict(value) if value else None


def clear_probe_history() -> None:
    with _LOCK:
        _LATEST.clear()
