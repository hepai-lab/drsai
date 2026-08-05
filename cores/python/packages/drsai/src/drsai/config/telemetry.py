"""In-process counters containing classifications only, never user values."""

from __future__ import annotations

from collections import Counter
from threading import RLock

_LOCK = RLock()
_COUNTERS: Counter[str] = Counter()


def increment_metric(category: str) -> None:
    if not category.replace("_", "").isalnum() or len(category) > 80:
        category = "invalid_metric_category"
    with _LOCK:
        _COUNTERS[category] += 1


def telemetry_snapshot() -> dict[str, int]:
    with _LOCK:
        return dict(sorted(_COUNTERS.items()))


def clear_telemetry() -> None:
    with _LOCK:
        _COUNTERS.clear()
