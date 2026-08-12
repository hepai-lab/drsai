"""Bounded ORCA-inspired Runtime metrics and cross-resource correlation."""

from __future__ import annotations

import json
import hashlib
import math
import re
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
USER_SLO_DEFINITIONS: dict[str, dict[str, Any]] = {
    "first_screen": {
        "threshold_ms": 2_000.0,
        "stages": ("cache_load", "authority_refresh", "first_render"),
    },
    "event_to_render": {
        "threshold_ms": 1_000.0,
        "stages": CONVERSATION_LATENCY_STAGES,
    },
    "operation_confirmation": {
        "threshold_ms": 2_000.0,
        "stages": ("request_dispatch", "runtime_commit", "confirmation_render"),
    },
    "reconnect": {
        "threshold_ms": 30_000.0,
        "stages": ("disconnect_detect", "transport_restore", "replay_catchup"),
    },
}
_OPAQUE_SAMPLE_ID = re.compile(r"[A-Za-z0-9._:-]{8,500}")
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
        self._initialize()

    def _initialize(self) -> None:
        # Separate worker processes may cold-start against the same empty
        # telemetry database.  WAL negotiation and DDL are individually safe,
        # but Windows can transiently return SQLITE_BUSY between the two open
        # calls. Retry only that bounded startup race; all other failures remain
        # fail-closed and visible.
        for attempt in range(8):
            try:
                with self._connect() as db:
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
                    db.execute("""CREATE TABLE IF NOT EXISTS user_slo_stages(
                        journey TEXT NOT NULL, sample_hash TEXT NOT NULL,
                        stage TEXT NOT NULL, duration_ms REAL NOT NULL,
                        observed_at REAL NOT NULL,
                        PRIMARY KEY(journey, sample_hash, stage)
                    )""")
                    db.execute(
                        "CREATE INDEX IF NOT EXISTS user_slo_time ON user_slo_stages(observed_at)"
                    )
                return
            except sqlite3.OperationalError as failure:
                if "locked" not in str(failure).lower() or attempt == 7:
                    raise
                time.sleep(0.025 * (attempt + 1))

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def record(self, metric: str, value: float, correlation: ResourceCorrelation,
               dimensions: Mapping[str, Any] | None = None) -> None:
        if metric not in METRICS or not isinstance(value, (int, float)):
            raise ValueError("unsupported Runtime metric")
        safe_dimensions = redact_sensitive(dict(dimensions or {}), "", "audit")
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
        safe_dimensions = redact_sensitive(dict(dimensions or {}), "", "audit")
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
                "SELECT correlation_id,operation_id,stage,duration_ms,dimensions_json "
                "FROM conversation_latency_stages WHERE observed_at>=? "
                "ORDER BY correlation_id,operation_id,stage",
                (time.time() - CONVERSATION_LATENCY_RETENTION_SECONDS,),
            ).fetchall()
        grouped: dict[tuple[str, str], dict[str, float]] = {}
        relay_workers: dict[tuple[str, str], str] = {}
        for row in rows:
            key = (str(row["correlation_id"]), str(row["operation_id"]))
            stage = str(row["stage"])
            grouped.setdefault(key, {})[stage] = float(row["duration_ms"])
            if stage == "relay_fanout":
                dimensions = json.loads(str(row["dimensions_json"]))
                worker = dimensions.get("relay_worker") if isinstance(dimensions, dict) else None
                if isinstance(worker, str) and worker:
                    relay_workers[key] = worker
        complete = [
            values for values in grouped.values()
            if all(stage in values for stage in CONVERSATION_LATENCY_STAGES)
        ]
        stage_rows: dict[str, dict[str, float | int]] = {}
        for stage in CONVERSATION_LATENCY_STAGES:
            values = sorted(sample[stage] for sample in complete)
            p50 = values[max(0, math.ceil(len(values) * 0.50) - 1)] if values else 0.0
            p95 = values[max(0, math.ceil(len(values) * 0.95) - 1)] if values else 0.0
            stage_rows[stage] = {
                "sample_count": len(values),
                "p50_ms": round(p50, 3),
                "p95_ms": round(p95, 3),
                "max_ms": round(values[-1], 3) if values else 0.0,
            }
        bottleneck = max(
            CONVERSATION_LATENCY_STAGES,
            key=lambda candidate: float(stage_rows[candidate]["p95_ms"]),
        ) if complete else None
        ready = len(complete) >= minimum_complete_samples
        complete_keys = {
            key for key, values in grouped.items()
            if all(stage in values for stage in CONVERSATION_LATENCY_STAGES)
        }
        worker_count = len({relay_workers[key] for key in complete_keys if key in relay_workers})
        return {
            "ready": ready,
            "minimum_complete_samples": minimum_complete_samples,
            "complete_sample_count": len(complete),
            "incomplete_sample_count": len(grouped) - len(complete),
            "required_relay_workers": 2,
            "relay_worker_count": worker_count,
            "multi_worker_ready": ready and worker_count >= 2,
            "stages": stage_rows,
            "p95_bottleneck": bottleneck,
        }

    def record_user_slo_stage(
        self,
        journey: str,
        stage: str,
        duration_ms: float,
        *,
        sample_id: str,
    ) -> bool:
        """Record one content-free user-journey stage.

        The caller's opaque sample identifier is irreversibly hashed before it
        reaches SQLite. No user, device, Runtime, Workspace, Session, Run or
        conversation payload is accepted by this API.
        """
        definition = USER_SLO_DEFINITIONS.get(journey)
        if definition is None:
            raise ValueError("unsupported user SLO journey")
        if stage not in definition["stages"]:
            raise ValueError("unsupported user SLO stage")
        if not isinstance(sample_id, str) or not _OPAQUE_SAMPLE_ID.fullmatch(sample_id):
            raise ValueError("user SLO sample id is invalid")
        if not isinstance(duration_ms, (int, float)) or not math.isfinite(duration_ms):
            raise ValueError("duration_ms must be finite")
        if duration_ms < 0 or duration_ms > 300_000:
            raise ValueError("duration_ms is outside the bounded range")
        sample_hash = hashlib.sha256(sample_id.encode("utf-8")).hexdigest()
        now = time.time()
        with self._connect() as db:
            cursor = db.execute(
                "INSERT OR IGNORE INTO user_slo_stages VALUES(?,?,?,?,?)",
                (journey, sample_hash, stage, float(duration_ms), now),
            )
            db.execute(
                "DELETE FROM user_slo_stages WHERE observed_at < ?",
                (now - CONVERSATION_LATENCY_RETENTION_SECONDS,),
            )
            if cursor.lastrowid and cursor.lastrowid % self.conversation_latency_trim_interval == 0:
                db.execute(
                    "DELETE FROM user_slo_stages WHERE rowid IN ("
                    "SELECT rowid FROM user_slo_stages "
                    "ORDER BY observed_at DESC,rowid DESC LIMIT -1 OFFSET ?)",
                    (self.conversation_latency_capacity,),
                )
        return cursor.rowcount == 1

    @staticmethod
    def _slo_journey_report(
        definition: Mapping[str, Any],
        samples: Mapping[str, Mapping[str, float]],
        minimum_complete_samples: int,
    ) -> dict[str, Any]:
        stages = tuple(str(stage) for stage in definition["stages"])
        complete = [
            values for values in samples.values()
            if all(stage in values for stage in stages)
        ]
        stage_reports: dict[str, dict[str, float | int]] = {}
        for stage in stages:
            values = sorted(float(sample[stage]) for sample in complete)
            p50 = values[max(0, math.ceil(len(values) * 0.50) - 1)] if values else 0.0
            p95 = values[max(0, math.ceil(len(values) * 0.95) - 1)] if values else 0.0
            stage_reports[stage] = {
                "sample_count": len(values),
                "p50_ms": round(p50, 3),
                "p95_ms": round(p95, 3),
            }
        totals = sorted(sum(float(sample[stage]) for stage in stages) for sample in complete)
        total_p50 = totals[max(0, math.ceil(len(totals) * 0.50) - 1)] if totals else 0.0
        total_p95 = totals[max(0, math.ceil(len(totals) * 0.95) - 1)] if totals else 0.0
        ready = len(complete) >= minimum_complete_samples
        threshold = float(definition["threshold_ms"])
        status = "insufficient_samples" if not ready else (
            "within_slo" if total_p95 <= threshold else "over_slo"
        )
        bottleneck = max(
            stages, key=lambda candidate: float(stage_reports[candidate]["p95_ms"])
        ) if complete else None
        return {
            "ready": ready,
            "status": status,
            "threshold_ms": threshold,
            "complete_sample_count": len(complete),
            "incomplete_sample_count": len(samples) - len(complete),
            "total_p50_ms": round(total_p50, 3),
            "total_p95_ms": round(total_p95, 3),
            "p95_bottleneck": bottleneck,
            "stages": stage_reports,
        }

    def user_slo_report(self, *, minimum_complete_samples: int = 20) -> dict[str, Any]:
        """Aggregate four user-visible journeys without identity dimensions."""
        if minimum_complete_samples < 1 or minimum_complete_samples > 100_000:
            raise ValueError("minimum_complete_samples is outside the bounded range")
        with self._connect() as db:
            rows = db.execute(
                "SELECT journey,sample_hash,stage,duration_ms FROM user_slo_stages "
                "WHERE observed_at>=? ORDER BY journey,sample_hash,stage",
                (time.time() - CONVERSATION_LATENCY_RETENTION_SECONDS,),
            ).fetchall()
            conversation_rows = db.execute(
                "SELECT correlation_id,operation_id,stage,duration_ms "
                "FROM conversation_latency_stages WHERE observed_at>=? "
                "ORDER BY correlation_id,operation_id,stage",
                (time.time() - CONVERSATION_LATENCY_RETENTION_SECONDS,),
            ).fetchall()
        grouped: dict[str, dict[str, dict[str, float]]] = {
            journey: {} for journey in USER_SLO_DEFINITIONS
        }
        for row in rows:
            grouped[str(row["journey"])].setdefault(str(row["sample_hash"]), {})[
                str(row["stage"])
            ] = float(row["duration_ms"])
        # Event-to-render reuses the authoritative five-stage conversation
        # observations instead of accepting a second, contradictory data path.
        for row in conversation_rows:
            sample = f'{row["correlation_id"]}:{row["operation_id"]}'
            grouped["event_to_render"].setdefault(sample, {})[str(row["stage"])] = float(
                row["duration_ms"]
            )
        journeys = {
            journey: self._slo_journey_report(
                definition, grouped[journey], minimum_complete_samples
            )
            for journey, definition in USER_SLO_DEFINITIONS.items()
        }
        breaches = sorted(
            journey for journey, report in journeys.items() if report["status"] == "over_slo"
        )
        return {
            "schema_version": "user-slo/1",
            "privacy": "aggregate_only",
            "minimum_complete_samples": minimum_complete_samples,
            "ready": all(report["ready"] for report in journeys.values()),
            "breaches": breaches,
            "journeys": journeys,
        }

    def list(self, correlation_id: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 1000))
        with self._connect() as db:
            if correlation_id:
                rows = db.execute("SELECT * FROM runtime_metrics WHERE correlation_id=? ORDER BY observed_at DESC LIMIT ?", (correlation_id, limit)).fetchall()
            else:
                rows = db.execute("SELECT * FROM runtime_metrics ORDER BY observed_at DESC LIMIT ?", (limit,)).fetchall()
        return [{**dict(row), "dimensions": json.loads(row["dimensions_json"])} for row in rows]
