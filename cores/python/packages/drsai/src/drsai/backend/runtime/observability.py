"""Bounded ORCA-inspired Runtime metrics and cross-resource correlation."""

from __future__ import annotations

import json
import math
import sqlite3
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from .security import redact_sensitive
from .sqlite_connection import ClosingConnection


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

CONVERSATION_LATENCY_STAGES = (
    "journal_append",
    "runtime_wss_send",
    "relay_fanout",
    "client_receive",
    "client_render",
)
CONVERSATION_LATENCY_RETENTION_SECONDS = 30 * 86400
DEFAULT_CONVERSATION_LATENCY_CAPACITY = 100_000
DEFAULT_CONVERSATION_LATENCY_TRIM_INTERVAL = 256

_FORBIDDEN_DIMENSIONS = frozenset({
    "command", "output", "content", "snapshot", "terminal_tail", "stderr",
    "message", "body", "arguments", "prompt", "completion", "token",
})
_FORBIDDEN_RUNTIME_METRIC_DIMENSIONS = frozenset({
    "command", "output", "content", "snapshot", "terminal_tail", "stderr",
})


class RuntimeObservability:
    """SQLite-backed bounded operational telemetry; never stores command/output bodies."""

    def __init__(
        self,
        database: Path,
        *,
        conversation_latency_capacity: int = DEFAULT_CONVERSATION_LATENCY_CAPACITY,
        conversation_latency_trim_interval: int = DEFAULT_CONVERSATION_LATENCY_TRIM_INTERVAL,
    ):
        if not 5 <= conversation_latency_capacity <= 1_000_000:
            raise ValueError("conversation latency capacity is outside the bounded range")
        if not 1 <= conversation_latency_trim_interval <= 10_000:
            raise ValueError("conversation latency trim interval is outside the bounded range")
        self.database = Path(database)
        self.conversation_latency_capacity = conversation_latency_capacity
        self.conversation_latency_trim_interval = conversation_latency_trim_interval
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            # Runtime and Relay workers use independent connections. WAL keeps
            # short telemetry writes concurrent without weakening SQLite's
            # transactional visibility or requiring synchronized clocks.
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=NORMAL")
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_metrics(
                metric TEXT NOT NULL, correlation_id TEXT NOT NULL, operation_id TEXT NOT NULL,
                dimensions_json TEXT NOT NULL, value REAL NOT NULL, observed_at REAL NOT NULL
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS runtime_metrics_time ON runtime_metrics(observed_at)")
            db.execute("""CREATE TABLE IF NOT EXISTS conversation_latency_stages(
                correlation_id TEXT NOT NULL, operation_id TEXT NOT NULL,
                stage TEXT NOT NULL, duration_ms REAL NOT NULL,
                dimensions_json TEXT NOT NULL, observed_at REAL NOT NULL,
                PRIMARY KEY(correlation_id, operation_id, stage)
            )""")
            db.execute(
                "CREATE INDEX IF NOT EXISTS conversation_latency_time "
                "ON conversation_latency_stages(observed_at)"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def record(self, metric: str, value: float, correlation: ResourceCorrelation,
               dimensions: Mapping[str, Any] | None = None) -> None:
        if metric not in METRICS or not isinstance(value, (int, float)):
            raise ValueError("unsupported Runtime metric")
        safe_dimensions = redact_sensitive(dict(dimensions or {}))
        # Resource identities are indexed dimensions; bodies, paths and commands are forbidden.
        forbidden = _FORBIDDEN_RUNTIME_METRIC_DIMENSIONS.intersection(safe_dimensions)
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

    def record_conversation_latency(
        self,
        stage: str,
        duration_ms: float,
        correlation: ResourceCorrelation,
        dimensions: Mapping[str, Any] | None = None,
    ) -> bool:
        """Record one content-free local stage duration for a conversation event.

        Durations are measured locally by each component, so the resulting
        report does not rely on synchronized Runtime/Relay/client clocks. The
        primary key makes retries idempotent and preserves the first accepted
        measurement for a correlation/stage pair.
        """
        packed = self._validated_latency_payload(stage, duration_ms, correlation, dimensions)
        now = time.time()
        with self._connect() as db:
            cursor = db.execute(
                "INSERT OR IGNORE INTO conversation_latency_stages VALUES(?,?,?,?,?,?)",
                (
                    correlation.correlation_id,
                    correlation.operation_id,
                    stage,
                    float(duration_ms),
                    packed,
                    now,
                ),
            )
            self._trim_conversation_latency(db, now, cursor.lastrowid)
        return cursor.rowcount == 1

    def record_conversation_latency_in_transaction(
        self,
        db: sqlite3.Connection,
        stage: str,
        duration_ms: float,
        correlation: ResourceCorrelation,
        dimensions: Mapping[str, Any] | None = None,
    ) -> bool:
        """Record inside the authoritative Journal transaction without a second writer."""
        packed = self._validated_latency_payload(stage, duration_ms, correlation, dimensions)
        now = time.time()
        cursor = db.execute(
            "INSERT OR IGNORE INTO conversation_latency_stages VALUES(?,?,?,?,?,?)",
            (
                correlation.correlation_id,
                correlation.operation_id,
                stage,
                float(duration_ms),
                packed,
                now,
            ),
        )
        self._trim_conversation_latency(db, now, cursor.lastrowid)
        return cursor.rowcount == 1

    def _trim_conversation_latency(
        self, db: sqlite3.Connection, now: float, inserted_rowid: int | None
    ) -> None:
        db.execute(
            "DELETE FROM conversation_latency_stages WHERE observed_at < ?",
            (now - CONVERSATION_LATENCY_RETENTION_SECONDS,),
        )
        # Amortize the indexed OFFSET scan. The physical hard bound is
        # capacity + interval - 1, without an O(n^2) scan under Event load.
        if not inserted_rowid or inserted_rowid % self.conversation_latency_trim_interval:
            return
        db.execute(
            "DELETE FROM conversation_latency_stages WHERE rowid IN ("
            "SELECT rowid FROM conversation_latency_stages "
            "ORDER BY observed_at DESC,rowid DESC LIMIT -1 OFFSET ?)",
            (self.conversation_latency_capacity,),
        )

    @staticmethod
    def _validated_latency_payload(
        stage: str,
        duration_ms: float,
        correlation: ResourceCorrelation,
        dimensions: Mapping[str, Any] | None,
    ) -> str:
        if stage not in CONVERSATION_LATENCY_STAGES:
            raise ValueError("unsupported conversation latency stage")
        if not isinstance(duration_ms, (int, float)) or not math.isfinite(duration_ms):
            raise ValueError("duration_ms must be finite")
        if duration_ms < 0 or duration_ms > 300_000:
            raise ValueError("duration_ms is outside the bounded range")
        safe_dimensions = redact_sensitive(dict(dimensions or {}))
        forbidden = _FORBIDDEN_DIMENSIONS.intersection(safe_dimensions)
        if forbidden:
            raise ValueError(
                f"latency dimensions contain forbidden payload fields: {sorted(forbidden)}"
            )
        identity = correlation.as_dict()
        packed = json.dumps(
            {**identity, **safe_dimensions}, sort_keys=True, separators=(",", ":")
        )
        if len(packed) > 8192:
            raise ValueError("latency dimensions exceed bounded size")
        return packed

    def conversation_latency_observations(self, correlation_id: str) -> list[dict[str, Any]]:
        """Return only bounded stage durations for WSS telemetry forwarding."""
        if not correlation_id or len(correlation_id) > 500:
            raise ValueError("correlation_id is invalid")
        with self._connect() as db:
            rows = db.execute(
                "SELECT operation_id,stage,duration_ms FROM conversation_latency_stages "
                "WHERE correlation_id=? AND observed_at>=? ORDER BY stage",
                (correlation_id, time.time() - CONVERSATION_LATENCY_RETENTION_SECONDS),
            ).fetchall()
        return [
            {
                "correlation_id": correlation_id,
                "operation_id": str(row["operation_id"]),
                "stage": str(row["stage"]),
                "duration_ms": float(row["duration_ms"]),
            }
            for row in rows
        ]

    def record_oaep_stage(
        self,
        stage: str,
        duration_ms: float,
        *,
        event_id: str,
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        run_id: str = "",
    ) -> bool:
        """Small transport-facing adapter that cannot accept payload dimensions."""
        return self.record_conversation_latency(
            stage,
            duration_ms,
            ResourceCorrelation(
                event_id,
                event_id,
                runtime_id=runtime_id,
                workspace_id=workspace_id,
                session_id=session_id,
                run_id=run_id,
            ),
            {"protocol": "oaep/1"},
        )

    def conversation_latency_report(self, *, minimum_complete_samples: int = 20) -> dict[str, Any]:
        """Return a content-free P95 report and identify the slowest stage."""
        if minimum_complete_samples < 1 or minimum_complete_samples > 100_000:
            raise ValueError("minimum_complete_samples is outside the bounded range")
        with self._connect() as db:
            rows = db.execute(
                "SELECT correlation_id,operation_id,stage,duration_ms "
                "FROM conversation_latency_stages WHERE observed_at>=? "
                "ORDER BY correlation_id,operation_id,stage",
                (time.time() - CONVERSATION_LATENCY_RETENTION_SECONDS,),
            ).fetchall()
        grouped: dict[tuple[str, str], dict[str, float]] = {}
        for row in rows:
            grouped.setdefault(
                (str(row["correlation_id"]), str(row["operation_id"])), {}
            )[str(row["stage"])] = float(row["duration_ms"])
        complete = [
            values for values in grouped.values()
            if all(stage in values for stage in CONVERSATION_LATENCY_STAGES)
        ]
        stage_rows: dict[str, dict[str, float | int]] = {}
        for stage in CONVERSATION_LATENCY_STAGES:
            values = sorted(sample[stage] for sample in complete)
            p95 = values[max(0, math.ceil(len(values) * 0.95) - 1)] if values else 0.0
            stage_rows[stage] = {
                "sample_count": len(values),
                "p95_ms": round(p95, 3),
                "max_ms": round(values[-1], 3) if values else 0.0,
            }
        bottleneck = max(
            CONVERSATION_LATENCY_STAGES,
            key=lambda candidate: float(stage_rows[candidate]["p95_ms"]),
        ) if complete else None
        return {
            "ready": len(complete) >= minimum_complete_samples,
            "minimum_complete_samples": minimum_complete_samples,
            "complete_sample_count": len(complete),
            "incomplete_sample_count": len(grouped) - len(complete),
            "stages": stage_rows,
            "p95_bottleneck": bottleneck,
        }

    def list(self, correlation_id: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 1000))
        with self._connect() as db:
            if correlation_id:
                rows = db.execute("SELECT * FROM runtime_metrics WHERE correlation_id=? ORDER BY observed_at DESC LIMIT ?", (correlation_id, limit)).fetchall()
            else:
                rows = db.execute("SELECT * FROM runtime_metrics ORDER BY observed_at DESC LIMIT ?", (limit,)).fetchall()
        return [{**dict(row), "dimensions": json.loads(row["dimensions_json"])} for row in rows]
