"""Content-free OAEP/legacy request telemetry used for retirement decisions."""
from __future__ import annotations

import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from drsai.sqlite_connection import ClosingConnection


_PROTOCOLS = {"oaep", "legacy"}
_REASONS = {"selected", "operator_rollback", "oaep_unavailable", "schema_mismatch", "version_incompatible", "other"}
_MAX_VERSIONS = 128
_MAX_RELEASE_CYCLES = 32
_RETENTION_DAYS = 30


class ProtocolUsageTelemetry:
    """Bounded aggregate counters with no principal or resource dimensions."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS protocol_usage (
                protocol TEXT NOT NULL, runtime_version TEXT NOT NULL,
                fallback_reason TEXT NOT NULL, request_count INTEGER NOT NULL,
                PRIMARY KEY (protocol, runtime_version, fallback_reason)
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS protocol_usage_daily (
                observed_date TEXT NOT NULL, protocol TEXT NOT NULL, runtime_version TEXT NOT NULL,
                fallback_reason TEXT NOT NULL, request_count INTEGER NOT NULL,
                PRIMARY KEY (observed_date, protocol, runtime_version, fallback_reason)
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS protocol_migration_daily (
                observed_date TEXT NOT NULL, runtime_version TEXT NOT NULL,
                migrated_count INTEGER NOT NULL, total_count INTEGER NOT NULL,
                PRIMARY KEY (observed_date, runtime_version)
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS protocol_observation_day (
                observed_date TEXT PRIMARY KEY
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS protocol_release_cycle (
                release_id TEXT PRIMARY KEY, first_observed_date TEXT NOT NULL,
                last_observed_date TEXT NOT NULL
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS protocol_known_version (
                runtime_version TEXT PRIMARY KEY
            )""")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=5, factory=ClosingConnection)

    @staticmethod
    def _version(value: object) -> str:
        text = str(value or "unknown").strip()
        if not text or len(text) > 32 or any(ch not in "0123456789.-+abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" for ch in text):
            return "unknown"
        return text

    @staticmethod
    def _date(value: date | datetime | None = None) -> str:
        if value is None:
            return datetime.now(timezone.utc).date().isoformat()
        if isinstance(value, datetime):
            if value.tzinfo is None:
                raise ValueError("protocol_usage_datetime_timezone_required")
            return value.astimezone(timezone.utc).date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        raise ValueError("protocol_usage_date_invalid")

    @staticmethod
    def _bounded_version(db: sqlite3.Connection, value: str) -> str:
        if db.execute("SELECT 1 FROM protocol_known_version WHERE runtime_version=?", (value,)).fetchone():
            return value
        count = int(db.execute("SELECT COUNT(*) FROM protocol_known_version").fetchone()[0])
        if count >= _MAX_VERSIONS - 1:
            value = "other"
        db.execute("INSERT OR IGNORE INTO protocol_known_version(runtime_version) VALUES (?)", (value,))
        return value

    @staticmethod
    def _trim_daily(db: sqlite3.Connection) -> None:
        latest = db.execute("""SELECT MAX(observed_date) FROM (
            SELECT observed_date FROM protocol_usage_daily
            UNION ALL SELECT observed_date FROM protocol_migration_daily
            UNION ALL SELECT observed_date FROM protocol_observation_day
        )""").fetchone()[0]
        if latest is None:
            return
        cutoff = (date.fromisoformat(str(latest)) - timedelta(days=_RETENTION_DAYS - 1)).isoformat()
        db.execute("DELETE FROM protocol_usage_daily WHERE observed_date < ?", (cutoff,))
        db.execute("DELETE FROM protocol_migration_daily WHERE observed_date < ?", (cutoff,))
        db.execute("DELETE FROM protocol_observation_day WHERE observed_date < ?", (cutoff,))

    @staticmethod
    def _observe(db: sqlite3.Connection, observed_date: str) -> None:
        db.execute(
            "INSERT OR IGNORE INTO protocol_observation_day(observed_date) VALUES (?)",
            (observed_date,),
        )

    def record_observation_day(self, *, observed_at: date | datetime | None = None) -> None:
        """Persist an explicit UTC observation day even when no protocol request occurs."""
        observed_date = self._date(observed_at)
        with self._lock, self._connect() as db:
            self._observe(db, observed_date)
            self._trim_daily(db)

    def record(self, protocol: str, runtime_version: object, fallback_reason: str = "selected",
               *, observed_at: date | datetime | None = None) -> None:
        if protocol not in _PROTOCOLS:
            raise ValueError("protocol_usage_protocol_invalid")
        reason = fallback_reason if fallback_reason in _REASONS else "other"
        version = self._version(runtime_version)
        observed_date = self._date(observed_at)
        with self._lock, self._connect() as db:
            self._observe(db, observed_date)
            version = self._bounded_version(db, version)
            db.execute("""INSERT INTO protocol_usage(protocol, runtime_version, fallback_reason, request_count)
                VALUES (?, ?, ?, 1) ON CONFLICT(protocol, runtime_version, fallback_reason)
                DO UPDATE SET request_count = MIN(request_count + 1, 1000000000)""",
                       (protocol, version, reason))
            db.execute("""INSERT INTO protocol_usage_daily(
                    observed_date, protocol, runtime_version, fallback_reason, request_count)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(observed_date, protocol, runtime_version, fallback_reason)
                DO UPDATE SET request_count = MIN(request_count + 1, 1000000000)""",
                       (observed_date, protocol, version, reason))
            db.execute("""INSERT INTO protocol_migration_daily(
                    observed_date, runtime_version, migrated_count, total_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(observed_date, runtime_version) DO UPDATE SET
                    migrated_count = MIN(migrated_count + excluded.migrated_count, 1000000000),
                    total_count = MIN(total_count + 1, 1000000000)""",
                       (observed_date, version, 1 if protocol == "oaep" else 0))
            self._trim_daily(db)

    def record_migration(self, runtime_version: object, *, migrated: bool,
                         observed_at: date | datetime | None = None) -> None:
        version = self._version(runtime_version)
        observed_date = self._date(observed_at)
        with self._lock, self._connect() as db:
            self._observe(db, observed_date)
            version = self._bounded_version(db, version)
            db.execute("""INSERT INTO protocol_migration_daily(
                    observed_date, runtime_version, migrated_count, total_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(observed_date, runtime_version) DO UPDATE SET
                    migrated_count = MIN(migrated_count + excluded.migrated_count, 1000000000),
                    total_count = MIN(total_count + 1, 1000000000)""",
                       (observed_date, version, 1 if migrated else 0))
            self._trim_daily(db)

    def record_release_cycle(self, release_id: object,
                             *, observed_at: date | datetime | None = None) -> None:
        normalized = self._version(release_id)
        if normalized == "unknown":
            raise ValueError("protocol_release_cycle_invalid")
        observed_date = self._date(observed_at)
        with self._lock, self._connect() as db:
            self._observe(db, observed_date)
            exists = db.execute("SELECT 1 FROM protocol_release_cycle WHERE release_id=?", (normalized,)).fetchone()
            count = int(db.execute("SELECT COUNT(*) FROM protocol_release_cycle").fetchone()[0])
            if not exists and count >= _MAX_RELEASE_CYCLES:
                raise ValueError("protocol_release_cycle_capacity_exceeded")
            db.execute("""INSERT INTO protocol_release_cycle(
                    release_id, first_observed_date, last_observed_date)
                VALUES (?, ?, ?)
                ON CONFLICT(release_id) DO UPDATE SET
                    first_observed_date = MIN(first_observed_date, excluded.first_observed_date),
                    last_observed_date = MAX(last_observed_date, excluded.last_observed_date)""",
                       (normalized, observed_date, observed_date))

    def report(self) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            rows = db.execute("""SELECT protocol, runtime_version, fallback_reason, request_count
                FROM protocol_usage ORDER BY protocol, runtime_version, fallback_reason""").fetchall()
        total = sum(int(row[3]) for row in rows)
        oaep = sum(int(row[3]) for row in rows if row[0] == "oaep")
        legacy = total - oaep
        return {
            "schema_version": "p5-protocol-usage/1",
            "dimensions": ["protocol", "runtime_version", "fallback_reason"],
            "total_requests": total,
            "oaep_request_ratio": oaep / total if total else 0.0,
            "legacy_request_ratio": legacy / total if total else 0.0,
            "rows": [
                {"protocol": row[0], "runtime_version": row[1], "fallback_reason": row[2], "request_count": row[3]}
                for row in rows
            ],
            "retirement_decision": {
                "eligible": False,
                "reason": "requires_threshold_and_migration_evidence",
            },
        }

    def deletion_decision(
        self,
        *,
        supported_runtime_count: int = 0,
        supported_runtime_requires_legacy: bool | None = None,
    ) -> dict[str, Any]:
        if supported_runtime_count < 0:
            raise ValueError("supported_runtime_count_invalid")
        if supported_runtime_count == 0:
            supported_runtime_requires_legacy = None
        elif not isinstance(supported_runtime_requires_legacy, bool):
            raise ValueError("supported_runtime_compatibility_invalid")
        with self._lock, self._connect() as db:
            usage = db.execute("""SELECT observed_date, protocol, fallback_reason, request_count
                FROM protocol_usage_daily ORDER BY observed_date""").fetchall()
            migration = db.execute("""SELECT observed_date, migrated_count, total_count
                FROM protocol_migration_daily""").fetchall()
            observation = db.execute(
                "SELECT observed_date FROM protocol_observation_day ORDER BY observed_date"
            ).fetchall()
            release_rows = db.execute(
                "SELECT first_observed_date, last_observed_date FROM protocol_release_cycle"
            ).fetchall()
        dates = sorted({
            date.fromisoformat(str(row[0]))
            for row in [*usage, *migration, *observation]
        })
        release_cycles = sum(
            1 for row in release_rows
            if dates and dates[0] <= date.fromisoformat(str(row[1])) <= dates[-1]
        )
        total = sum(int(row[3]) for row in usage)
        oaep = sum(int(row[3]) for row in usage if row[1] == "oaep")
        legacy = total - oaep
        fallback = sum(int(row[3]) for row in usage if row[2] != "selected")
        migrated = sum(int(row[1]) for row in migration)
        migration_total = sum(int(row[2]) for row in migration)
        observation_days = len(dates)
        gap_days = ((dates[-1] - dates[0]).days + 1 - observation_days) if dates else 0
        oaep_ratio = oaep / total if total else 0.0
        legacy_ratio = legacy / total if total else 0.0
        fallback_ratio = fallback / total if total else 0.0
        migration_ratio = migrated / migration_total if migration_total else None
        has_protocol_or_migration_data = total > 0 or migration_total > 0
        if not has_protocol_or_migration_data:
            status = "no_data"
        elif supported_runtime_count == 0:
            status = "runtime_compatibility_unknown"
        elif supported_runtime_requires_legacy:
            status = "supported_runtime_requires_legacy"
        elif (oaep_ratio >= 0.999 and legacy_ratio < 0.001 and migration_ratio == 1.0
              and fallback_ratio <= 0.001):
            status = "eligible"
        else:
            status = "threshold_failed"
        if status == "no_data":
            dates = []
            observation_days = 0
            release_cycles = 0
            gap_days = 0
        return {
            "schema_version": "p5-protocol-deletion-decision/1",
            "status": status,
            "data_start": dates[0].isoformat() if dates else None,
            "data_end": dates[-1].isoformat() if dates else None,
            "observation_days": observation_days,
            "release_cycles": release_cycles,
            "oaep_ratio": oaep_ratio,
            "legacy_ratio": legacy_ratio,
            "migration_ratio": migration_ratio,
            "fallback_error_ratio": fallback_ratio,
            "gap_days": gap_days,
            "supported_runtime_count": supported_runtime_count,
            "supported_runtime_requires_legacy": supported_runtime_requires_legacy,
            "requirements": {
                "observation_days": 0, "release_cycles": 0, "oaep_ratio": 0.999,
                "legacy_ratio": 0.001, "migration_ratio": 1.0,
                "fallback_error_ratio": 0.001,
                "supported_runtime_requires_legacy": False,
            },
            "eligible": status == "eligible",
        }
