from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any
from drsai.backend.runtime.sqlite_connection import ClosingConnection


class RuntimeOperationMetrics:
    """Persistent, content-free latency and failure aggregates."""

    def __init__(self, database: Path) -> None:
        self.database = Path(database)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_operation_metrics (
              operation TEXT PRIMARY KEY,
              total INTEGER NOT NULL,
              failures INTEGER NOT NULL,
              latency_ms_total REAL NOT NULL,
              latency_ms_max REAL NOT NULL,
              latency_lt_100 INTEGER NOT NULL DEFAULT 0,
              latency_lt_1000 INTEGER NOT NULL DEFAULT 0,
              latency_gte_1000 INTEGER NOT NULL DEFAULT 0,
              last_error_code TEXT,
              updated_at REAL NOT NULL
            )""")
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(runtime_operation_metrics)").fetchall()}
            for column in ("latency_lt_100", "latency_lt_1000", "latency_gte_1000"):
                if column not in columns:
                    db.execute(f"ALTER TABLE runtime_operation_metrics ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        return db

    def record(self, operation: str, latency_ms: float, *, error_code: str | None = None) -> None:
        if not operation or len(operation) > 100:
            return
        safe_error = (error_code or "")[:100] or None
        with self._connect() as db:
            db.execute("""INSERT INTO runtime_operation_metrics
              (operation,total,failures,latency_ms_total,latency_ms_max,latency_lt_100,latency_lt_1000,latency_gte_1000,last_error_code,updated_at)
              VALUES(?,1,?,?,?,?,?,?,?,?)
              ON CONFLICT(operation) DO UPDATE SET
                total=total+1,
                failures=failures+excluded.failures,
                latency_ms_total=latency_ms_total+excluded.latency_ms_total,
                latency_ms_max=MAX(latency_ms_max,excluded.latency_ms_max),
                latency_lt_100=latency_lt_100+excluded.latency_lt_100,
                latency_lt_1000=latency_lt_1000+excluded.latency_lt_1000,
                latency_gte_1000=latency_gte_1000+excluded.latency_gte_1000,
                last_error_code=COALESCE(excluded.last_error_code,last_error_code),
                updated_at=excluded.updated_at""",
              (operation, 1 if safe_error else 0, max(0.0, latency_ms), max(0.0, latency_ms),
               1 if latency_ms < 100 else 0, 1 if 100 <= latency_ms < 1000 else 0,
               1 if latency_ms >= 1000 else 0, safe_error, time.time()),
            )

    def list(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM runtime_operation_metrics ORDER BY operation").fetchall()
        return [{
            "operation": str(row["operation"]), "total": int(row["total"]),
            "failures": int(row["failures"]),
            "latency_ms_average": float(row["latency_ms_total"]) / max(1, int(row["total"])),
            "latency_ms_max": float(row["latency_ms_max"]),
            "latency_histogram": {
                "lt_100_ms": int(row["latency_lt_100"]),
                "100_to_999_ms": int(row["latency_lt_1000"]),
                "gte_1000_ms": int(row["latency_gte_1000"]),
            },
            "last_error_code": row["last_error_code"], "updated_at": float(row["updated_at"]),
        } for row in rows]
