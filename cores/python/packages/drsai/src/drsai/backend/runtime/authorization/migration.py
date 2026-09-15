"""Restartable, fail-closed migration from the legacy Approval control plane."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.models import canonical_digest
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .approval_service import ApprovalService


MIGRATION_VERSION = "legacy-approval/1"
_LEGACY_TERMINAL = {
    "approved": "approved",
    "denied": "denied",
    "cancelled": "cancelled",
    "expired": "expired",
    "timeout": "expired",
    "disconnected": "cancelled",
}


class LegacyApprovalMigrationError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class LegacyApprovalMigrationReport:
    migrated: int
    already_migrated: int
    deferred: int
    deferred_reasons: dict[str, int]


@dataclass(frozen=True)
class LegacyApprovalRetirementStatus:
    ready: bool
    blockers: tuple[str, ...]
    legacy_rows: int
    unmigrated_rows: int
    pending_rows: int
    uses_since_cutoff: int


def _epoch(value: object, *, fallback: float) -> float:
    if value is None:
        return fallback
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, OverflowError):
        return fallback


class LegacyApprovalMigrationService:
    """Migrates one legacy row per transaction and never invents authorization."""

    def __init__(self, database: Path):
        self.database = Path(database)
        self.approvals = ApprovalService(self.database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_legacy_approval_migrations(
                    legacy_approval_id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL UNIQUE REFERENCES runtime_approval_requests(request_id),
                    source_identity_digest TEXT NOT NULL,
                    migration_version TEXT NOT NULL,
                    legacy_status TEXT NOT NULL,
                    migrated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_legacy_approval_revisions(
                    revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    legacy_approval_id TEXT NOT NULL REFERENCES runtime_legacy_approval_migrations(legacy_approval_id),
                    source_digest TEXT NOT NULL UNIQUE,
                    legacy_status TEXT NOT NULL,
                    observed_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_legacy_approval_migrations_no_update
                BEFORE UPDATE ON runtime_legacy_approval_migrations
                BEGIN SELECT RAISE(ABORT, 'legacy approval migration is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_legacy_approval_migrations_no_delete
                BEFORE DELETE ON runtime_legacy_approval_migrations
                BEGIN SELECT RAISE(ABORT, 'legacy approval migration is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_legacy_approval_revisions_no_update
                BEFORE UPDATE ON runtime_legacy_approval_revisions
                BEGIN SELECT RAISE(ABORT, 'legacy approval revision is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_legacy_approval_revisions_no_delete
                BEFORE DELETE ON runtime_legacy_approval_revisions
                BEGIN SELECT RAISE(ABORT, 'legacy approval revision is append-only'); END;
            """)
            self._create_compat_view(db)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @staticmethod
    def _legacy_exists(db: sqlite3.Connection) -> bool:
        return db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_approvals'",
        ).fetchone() is not None

    def _create_compat_view(self, db: sqlite3.Connection) -> None:
        if not self._legacy_exists(db):
            return
        db.executescript("""
            DROP VIEW IF EXISTS runtime_approval_compat_v1;
            CREATE VIEW runtime_approval_compat_v1 AS
            SELECT l.approval_id AS approval_id,l.run_id AS run_id,l.status AS status,
                   l.deadline_at AS deadline_at,l.created_at AS created_at,l.resolved_at AS resolved_at,
                   'legacy' AS source,
                   CASE WHEN m.request_id IS NULL THEN 'deferred' ELSE 'migrated' END AS migration_status,
                   m.request_id AS new_request_id
              FROM runtime_approvals l
              LEFT JOIN runtime_legacy_approval_migrations m ON m.legacy_approval_id=l.approval_id
            UNION ALL
            SELECT r.request_id,r.run_id,r.status,r.deadline_at,r.created_at,r.resolved_at,
                   'native','native',r.request_id
              FROM runtime_approval_requests r
             WHERE NOT EXISTS (
                   SELECT 1 FROM runtime_legacy_approval_migrations m WHERE m.request_id=r.request_id
             );
        """)

    @staticmethod
    def _source_digest(row: sqlite3.Row) -> str:
        return canonical_digest({
            "approval_id": row["approval_id"], "run_id": row["run_id"], "status": row["status"],
            "request_json": row["request_json"], "decision_json": row["decision_json"],
            "deadline_at": row["deadline_at"], "created_at": row["created_at"],
            "resolved_at": row["resolved_at"],
        })

    @staticmethod
    def _identity_digest(row: sqlite3.Row) -> str:
        return canonical_digest({
            "approval_id": row["approval_id"], "run_id": row["run_id"],
            "request_json": row["request_json"], "deadline_at": row["deadline_at"],
            "created_at": row["created_at"],
        })

    def migrate(self, *, limit: int | None = None, now: float | None = None) -> LegacyApprovalMigrationReport:
        migrated_at = float(time.time() if now is None else now)
        with self._connect() as db:
            if not self._legacy_exists(db):
                return LegacyApprovalMigrationReport(0, 0, 0, {})
            rows = db.execute("SELECT * FROM runtime_approvals ORDER BY created_at,approval_id").fetchall()
        migrated = already = deferred = 0
        reasons: dict[str, int] = {}
        for row in rows:
            if limit is not None and migrated >= limit:
                break
            outcome = self._migrate_one(row, migrated_at)
            if outcome == "migrated":
                migrated += 1
            elif outcome == "already_migrated":
                already += 1
            else:
                deferred += 1
                reasons[outcome] = reasons.get(outcome, 0) + 1
        return LegacyApprovalMigrationReport(migrated, already, deferred, reasons)

    def _migrate_one(self, source: sqlite3.Row, migrated_at: float) -> str:
        approval_id = str(source["approval_id"])
        source_digest = self._source_digest(source)
        identity_digest = self._identity_digest(source)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT * FROM runtime_approvals WHERE approval_id=?", (approval_id,)).fetchone()
            if current is None:
                db.rollback()
                return "legacy_source_missing"
            if self._source_digest(current) != source_digest:
                db.rollback()
                return "legacy_source_changed"
            prior = db.execute(
                "SELECT * FROM runtime_legacy_approval_migrations WHERE legacy_approval_id=?", (approval_id,),
            ).fetchone()
            if prior is not None:
                if str(prior["source_identity_digest"]) != identity_digest:
                    db.rollback()
                    raise LegacyApprovalMigrationError(
                        "legacy_identity_changed_after_migration",
                        "A migrated legacy Approval changed immutable request identity.",
                    )
                latest = db.execute(
                    "SELECT * FROM runtime_legacy_approval_revisions WHERE legacy_approval_id=? "
                    "ORDER BY revision_id DESC LIMIT 1", (approval_id,),
                ).fetchone()
                if latest is not None and str(latest["source_digest"]) == source_digest:
                    db.rollback()
                    return "already_migrated"
                request = db.execute(
                    "SELECT * FROM runtime_approval_requests WHERE request_id=?", (str(prior["request_id"]),),
                ).fetchone()
                target_status = _LEGACY_TERMINAL.get(str(current["status"]))
                if request is None or str(request["status"]) != "pending" or target_status is None:
                    db.rollback()
                    raise LegacyApprovalMigrationError(
                        "legacy_state_transition_invalid",
                        "Legacy Approval changed outside the permitted pending-to-terminal transition.",
                    )
                resolved_at = _epoch(current["resolved_at"], fallback=migrated_at)
                db.execute(
                    "UPDATE runtime_approval_requests SET status=?,resolved_at=? "
                    "WHERE request_id=? AND status='pending'",
                    (target_status, resolved_at, str(prior["request_id"])),
                )
                db.execute(
                    "INSERT INTO runtime_legacy_approval_revisions("
                    "legacy_approval_id,source_digest,legacy_status,observed_at) VALUES(?,?,?,?)",
                    (approval_id, source_digest, str(current["status"]), migrated_at),
                )
                self.audit.append_in_transaction(db, "approval.legacy_synced", str(prior["request_id"]), {
                    "legacy_status": str(current["status"]), "imported_status": target_status,
                    "migration_version": MIGRATION_VERSION,
                }, now=migrated_at)
                db.commit()
                return "migrated"
            proposal = db.execute(
                "SELECT proposal_id FROM runtime_action_proposals WHERE proposal_id=? AND run_id=?",
                (approval_id, str(current["run_id"])),
            ).fetchone()
            if proposal is None:
                db.rollback()
                return "proposal_missing"
            legacy_status = str(current["status"])
            status = "pending" if legacy_status == "pending" else _LEGACY_TERMINAL.get(legacy_status)
            if status is None:
                db.rollback()
                return "legacy_status_unknown"
            created_at = _epoch(current["created_at"], fallback=migrated_at)
            deadline_at = _epoch(current["deadline_at"], fallback=migrated_at) if current["deadline_at"] else None
            resolved_at = _epoch(current["resolved_at"], fallback=migrated_at) if current["resolved_at"] else None
            if status == "pending":
                profile = db.execute(
                    "SELECT profile_digest FROM runtime_run_security_profiles WHERE run_id=? "
                    "ORDER BY binding_id DESC LIMIT 1", (str(current["run_id"]),),
                ).fetchone()
                if profile is None:
                    db.rollback()
                    return "active_profile_missing"
                profile_digest = str(profile["profile_digest"])
                if deadline_at is not None and deadline_at <= migrated_at:
                    status, resolved_at = "expired", migrated_at
            else:
                # The legacy row did not bind the historical profile.  Preserve
                # that uncertainty explicitly; without a Decision no Grant can
                # ever be issued from this imported terminal fact.
                profile_digest = "legacy:historical-profile-unknown"
            request_id = "approval-request-legacy-" + canonical_digest(approval_id).split(":", 1)[1][:32]
            db.execute(
                "INSERT INTO runtime_approval_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    request_id, approval_id, str(current["run_id"]), profile_digest, MIGRATION_VERSION,
                    "human", "legacy_import", status, f"legacy:{approval_id}", created_at,
                    deadline_at, resolved_at,
                ),
            )
            db.execute(
                "INSERT INTO runtime_legacy_approval_migrations VALUES(?,?,?,?,?,?)",
                (approval_id, request_id, identity_digest, MIGRATION_VERSION, legacy_status, migrated_at),
            )
            db.execute(
                "INSERT INTO runtime_legacy_approval_revisions("
                "legacy_approval_id,source_digest,legacy_status,observed_at) VALUES(?,?,?,?)",
                (approval_id, source_digest, legacy_status, migrated_at),
            )
            self.audit.append_in_transaction(db, "approval.legacy_migrated", request_id, {
                "legacy_status": legacy_status,
                "imported_status": status,
                "historical_profile_known": legacy_status == "pending",
                "migration_version": MIGRATION_VERSION,
            }, now=migrated_at)
            db.commit()
        return "migrated"

    def compatibility_rows(self) -> list[dict[str, object]]:
        with self._connect() as db:
            if not self._legacy_exists(db):
                return []
            self._create_compat_view(db)
            rows = db.execute(
                "SELECT * FROM runtime_approval_compat_v1 ORDER BY created_at,approval_id",
            ).fetchall()
        return [dict(row) for row in rows]

    def retirement_status(self, *, quiet_since: float) -> LegacyApprovalRetirementStatus:
        """Prove whether the legacy path can be removed; uncertainty blocks removal."""

        with self._connect() as db:
            if not self._legacy_exists(db):
                return LegacyApprovalRetirementStatus(True, (), 0, 0, 0, 0)
            legacy_rows = int(db.execute("SELECT COUNT(*) FROM runtime_approvals").fetchone()[0])
            unmigrated = int(db.execute(
                "SELECT COUNT(*) FROM runtime_approvals l WHERE NOT EXISTS ("
                "SELECT 1 FROM runtime_legacy_approval_migrations m WHERE m.legacy_approval_id=l.approval_id)",
            ).fetchone()[0])
            pending = int(db.execute(
                "SELECT COUNT(*) FROM runtime_approvals WHERE status='pending'",
            ).fetchone()[0])
            uses = int(db.execute(
                "SELECT COUNT(*) FROM runtime_security_events "
                "WHERE event_type IN ('approval.legacy_requested','approval.legacy_resolved') AND created_at>=?",
                (float(quiet_since),),
            ).fetchone()[0])
        blockers = tuple(
            name for name, active in (
                ("unmigrated_rows", unmigrated > 0),
                ("pending_rows", pending > 0),
                ("legacy_path_used_since_cutoff", uses > 0),
            ) if active
        )
        return LegacyApprovalRetirementStatus(not blockers, blockers, legacy_rows, unmigrated, pending, uses)
