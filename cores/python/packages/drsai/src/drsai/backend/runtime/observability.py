"""Bounded ORCA-inspired Runtime metrics and cross-resource correlation."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from .security import redact_sensitive


@dataclass(frozen=True)
class ResourceCorrelation:
    correlation_id: str
    operation_id: str
    host_id: str = ""
    runtime_id: str = ""
    workspace_id: str = ""
    worktree_id: str = ""
    terminal_id: str = ""
    session_id: str = ""
    run_id: str = ""

    def as_dict(self) -> dict[str, str]:
        if not self.correlation_id or not self.operation_id:
            raise ValueError("correlation_id and operation_id are required")
        return asdict(self)


METRICS = frozenset({
    "host.connection.success", "host.reconnect.count", "pty.replay.lag",
    "pty.snapshot.bytes", "pty.output.dropped", "worktree.conflict.count",
    "worktree.reconcile.count",
})


class RuntimeObservability:
    """SQLite-backed bounded operational telemetry; never stores command/output bodies."""

    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_metrics(
                metric TEXT NOT NULL, correlation_id TEXT NOT NULL, operation_id TEXT NOT NULL,
                dimensions_json TEXT NOT NULL, value REAL NOT NULL, observed_at REAL NOT NULL
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS runtime_metrics_time ON runtime_metrics(observed_at)")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def record(self, metric: str, value: float, correlation: ResourceCorrelation,
               dimensions: Mapping[str, Any] | None = None) -> None:
        if metric not in METRICS or not isinstance(value, (int, float)):
            raise ValueError("unsupported Runtime metric")
        safe_dimensions = redact_sensitive(dict(dimensions or {}))
        # Resource identities are indexed dimensions; bodies, paths and commands are forbidden.
        forbidden = {"command", "output", "content", "snapshot", "terminal_tail", "stderr"}.intersection(safe_dimensions)
        if forbidden:
            raise ValueError(f"metric dimensions contain forbidden payload fields: {sorted(forbidden)}")
        identity = correlation.as_dict()
        packed = json.dumps({**identity, **safe_dimensions}, sort_keys=True, separators=(",", ":"))
        if len(packed) > 8192:
            raise ValueError("metric dimensions exceed bounded size")
        now = time.time()
        with self._connect() as db:
            db.execute("INSERT INTO runtime_metrics VALUES(?,?,?,?,?,?)", (
                metric, correlation.correlation_id, correlation.operation_id, packed, float(value), now,
            ))
            db.execute("DELETE FROM runtime_metrics WHERE observed_at < ?", (now - 30 * 86400,))

    def list(self, correlation_id: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 1000))
        with self._connect() as db:
            if correlation_id:
                rows = db.execute("SELECT * FROM runtime_metrics WHERE correlation_id=? ORDER BY observed_at DESC LIMIT ?", (correlation_id, limit)).fetchall()
            else:
                rows = db.execute("SELECT * FROM runtime_metrics ORDER BY observed_at DESC LIMIT ?", (limit,)).fetchall()
        return [{**dict(row), "dimensions": json.loads(row["dimensions_json"])} for row in rows]
