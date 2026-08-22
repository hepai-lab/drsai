"""Bounded, content-free diagnostics for Codex protocol drift and health."""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping


_SECRET = re.compile(r"(?:token|secret|password|cookie|authorization|api.?key|credential)", re.I)


@dataclass(slots=True)
class _DiagnosticAggregate:
    classification: str
    count: int
    first_seen: float
    last_seen: float
    last_digest: str


class CodexDiagnosticSink:
    """Aggregate diagnostics without retaining native payload content."""

    def __init__(self, *, max_methods: int = 128, clock: Callable[[], float] = time.time):
        self.max_methods = max(8, max_methods)
        self.clock = clock
        self.total = 0
        self._methods: dict[str, _DiagnosticAggregate] = {}

    def record(self, classification: str, method: str, payload: Mapping[str, Any] | None = None) -> None:
        self.total += 1
        identity = str(method or "unknown")[:160]
        # Reserve one bucket for overflow so the aggregate map itself remains
        # within the configured cardinality bound.
        if identity not in self._methods and len(self._methods) >= self.max_methods - 1:
            identity = "__overflow__"
        now = float(self.clock())
        digest = self._digest(self._safe(payload or {}))
        current = self._methods.get(identity)
        if current is None:
            self._methods[identity] = _DiagnosticAggregate(classification[:40], 1, now, now, digest)
        else:
            current.count += 1
            current.last_seen = now
            current.last_digest = digest

    def snapshot(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "unique_methods": len(self._methods),
            "max_methods": self.max_methods,
            "methods": {
                method: {
                    "classification": aggregate.classification,
                    "count": aggregate.count,
                    "first_seen": aggregate.first_seen,
                    "last_seen": aggregate.last_seen,
                    "last_digest": aggregate.last_digest,
                }
                for method, aggregate in sorted(self._methods.items())
            },
            "content_retained": False,
        }

    @classmethod
    def _safe(cls, value: Any, key: str = "") -> Any:
        if _SECRET.search(key):
            return "[REDACTED]"
        if isinstance(value, Mapping):
            return {str(child)[:120]: cls._safe(item, str(child)) for child, item in list(value.items())[:100]}
        if isinstance(value, list):
            return [cls._safe(item) for item in value[:100]]
        if isinstance(value, str):
            return {"type": "string", "length": len(value), "prefix_class": "empty" if not value else "text"}
        return value if isinstance(value, (int, float, bool, type(None))) else type(value).__name__

    @staticmethod
    def _digest(value: Any) -> str:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()[:16]
