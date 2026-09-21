"""Conservative migration of legacy approval/dangerous mode settings."""

from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.models import canonical_digest
from drsai.backend.runtime.sqlite_connection import ClosingConnection


LEGACY_CONFIG_MIGRATION_VERSION = "permission-config-migration/1"
_TRUSTED_SOURCES = frozenset({"personal", "desktop", "web", "legacy_runtime", "administrator"})
_MANUAL = frozenset({"always", "ask", "on-request", "on_request", "manual", "prompt", "always-ask"})
_CONSERVATIVE_AUTO = frozenset({"auto", "auto-conservative", "auto_review", "auto-reviewed"})
_DANGEROUS = frozenset({
    "never", "dangerous", "dangerous-on", "full-access", "full_access",
    "bypass", "unrestricted", "auto-permissive", "permissive",
})


@dataclass(frozen=True)
class LegacyPermissionMigrationResult:
    migration_id: str
    migration_key: str
    mode_id: str
    reason_code: str
    requires_reselection: bool
    repository_value_ignored: bool
    acknowledged: bool


class LegacyPermissionConfigMigrationService:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_permission_config_migrations(
                    migration_id TEXT PRIMARY KEY,
                    migration_key TEXT NOT NULL UNIQUE,
                    sources_digest TEXT NOT NULL,
                    mode_id TEXT NOT NULL CHECK(mode_id IN ('manual_safe','auto_reviewed')),
                    reason_code TEXT NOT NULL,
                    requires_reselection INTEGER NOT NULL CHECK(requires_reselection IN (0,1)),
                    repository_value_ignored INTEGER NOT NULL CHECK(repository_value_ignored IN (0,1)),
                    migration_version TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    acknowledged_at REAL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_permission_config_migrations_identity_immutable
                BEFORE UPDATE OF migration_id,migration_key,sources_digest,mode_id,reason_code,
                                 requires_reselection,repository_value_ignored,migration_version,created_at
                ON runtime_permission_config_migrations
                BEGIN SELECT RAISE(ABORT, 'permission config migration identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_config_migrations_no_delete
                BEFORE DELETE ON runtime_permission_config_migrations
                BEGIN SELECT RAISE(ABORT, 'permission config migration is durable'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _row(row: sqlite3.Row) -> LegacyPermissionMigrationResult:
        return LegacyPermissionMigrationResult(
            str(row["migration_id"]), str(row["migration_key"]), str(row["mode_id"]),
            str(row["reason_code"]), bool(row["requires_reselection"]),
            bool(row["repository_value_ignored"]), row["acknowledged_at"] is not None,
        )

    @staticmethod
    def _classify(value: object) -> tuple[str, str, bool]:
        if not isinstance(value, str):
            return "manual_safe", "legacy_value_invalid", True
        normalized = value.strip().lower()
        if normalized in _MANUAL:
            return "manual_safe", "legacy_manual_mapped", False
        if normalized in _CONSERVATIVE_AUTO:
            return "auto_reviewed", "legacy_conservative_auto_mapped", False
        if normalized in _DANGEROUS:
            return "manual_safe", "legacy_dangerous_value_requires_reselection", True
        return "manual_safe", "legacy_value_unknown", True

    def migrate(
        self,
        migration_key: str,
        values_by_source: Mapping[str, object],
        *,
        now: float | None = None,
    ) -> LegacyPermissionMigrationResult:
        created_at = float(time.time() if now is None else now)
        if not migration_key:
            raise ValueError("Permission config migration key is required.")
        repository_ignored = any(source not in _TRUSTED_SOURCES for source in values_by_source)
        trusted = [(source, values_by_source[source]) for source in sorted(values_by_source) if source in _TRUSTED_SOURCES]
        classified = [self._classify(value) for _, value in trusted]
        if not classified:
            mode_id, reason_code, reselection = "manual_safe", "legacy_trusted_value_missing", True
        elif len({(mode, requires) for mode, _, requires in classified}) > 1:
            mode_id, reason_code, reselection = "manual_safe", "legacy_values_conflict", True
        elif any(requires for _, _, requires in classified):
            mode_id, reason_code, reselection = "manual_safe", classified[0][1], True
        else:
            mode_id, reason_code, reselection = classified[0]
        if repository_ignored and not trusted:
            reason_code = "legacy_repository_value_ignored"
        # Raw values are authorization inputs and may contain attacker text.
        # Persist only a digest and bounded classifications.
        sources_digest = canonical_digest({
            "sources": sorted(values_by_source),
            "value_digests": {
                source: canonical_digest(value if isinstance(value, (str, bool, int, float, type(None))) else type(value).__name__)
                for source, value in sorted(values_by_source.items())
            },
        })
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT * FROM runtime_permission_config_migrations WHERE migration_key=?", (migration_key,),
            ).fetchone()
            if prior is not None:
                result = self._row(prior)
                db.rollback()
                if str(prior["sources_digest"]) != sources_digest:
                    raise ValueError("Permission config migration key was reused with different legacy inputs.")
                return result
            migration_id = f"permission-config-migration-{uuid.uuid4()}"
            db.execute(
                "INSERT INTO runtime_permission_config_migrations VALUES(?,?,?,?,?,?,?,?,?,NULL)",
                (
                    migration_id, migration_key, sources_digest, mode_id, reason_code,
                    int(reselection), int(repository_ignored), LEGACY_CONFIG_MIGRATION_VERSION, created_at,
                ),
            )
            self.audit.append_in_transaction(db, "permission_config.migrated", migration_id, {
                "mode_id": mode_id, "reason_code": reason_code,
                "requires_reselection": reselection, "repository_value_ignored": repository_ignored,
                "migration_version": LEGACY_CONFIG_MIGRATION_VERSION,
            }, now=created_at)
            db.commit()
        return LegacyPermissionMigrationResult(
            migration_id, migration_key, mode_id, reason_code, reselection,
            repository_ignored, False,
        )

    def acknowledge(self, migration_key: str, *, now: float | None = None) -> LegacyPermissionMigrationResult:
        acknowledged_at = float(time.time() if now is None else now)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_permission_config_migrations SET acknowledged_at=? "
                "WHERE migration_key=? AND acknowledged_at IS NULL",
                (acknowledged_at, migration_key),
            ).rowcount
            row = db.execute(
                "SELECT * FROM runtime_permission_config_migrations WHERE migration_key=?", (migration_key,),
            ).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Permission config migration does not exist.")
            if changed:
                self.audit.append_in_transaction(db, "permission_config.explanation_acknowledged", str(row["migration_id"]), {
                    "migration_version": LEGACY_CONFIG_MIGRATION_VERSION,
                }, now=acknowledged_at)
            db.commit()
        return self._row(row if not changed else self._fetch(migration_key))

    def _fetch(self, migration_key: str) -> sqlite3.Row:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_permission_config_migrations WHERE migration_key=?", (migration_key,),
            ).fetchone()
        if row is None:
            raise KeyError("Permission config migration does not exist.")
        return row
