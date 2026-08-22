from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.runtime.experiments import ExperimentConflict, ExperimentNotFound
from drsai.backend.runtime.sqlite_connection import ClosingConnection


ADOPTION_SCHEMA_VERSION = "opendrsai.run-adoption/1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RuntimeAdoptionStore:
    """Durable receipt for preview/apply/discard decisions; never stores file content."""

    def __init__(self, database: Path) -> None:
        self.database = Path(database)
        self._lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_run_adoptions (
                  adoption_id TEXT PRIMARY KEY,
                  schema_version TEXT NOT NULL,
                  comparison_id TEXT NOT NULL REFERENCES runtime_run_comparisons(comparison_id),
                  source_workspace_id TEXT NOT NULL,
                  worktree_id TEXT NOT NULL,
                  preview_digest TEXT NOT NULL,
                  preview_json TEXT NOT NULL,
                  status TEXT NOT NULL CHECK(status IN ('previewed','applied','discarded')),
                  selected_paths_json TEXT,
                  receipt_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  UNIQUE(comparison_id,preview_digest)
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_run_adoptions_status
                  ON runtime_run_adoptions(status,updated_at,adoption_id);
            """)
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(runtime_run_adoptions)").fetchall()}
            for name, declaration in (
                ("operation_kind", "TEXT"),
                ("operation_payload_json", "TEXT"),
                ("operation_status", "TEXT"),
                ("operation_started_at", "TEXT"),
            ):
                if name not in columns:
                    db.execute(f"ALTER TABLE runtime_run_adoptions ADD COLUMN {name} {declaration}")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def record_preview(
        self, comparison_id: str, source_workspace_id: str, worktree_id: str,
        preview: Mapping[str, Any],
    ) -> dict[str, Any]:
        digest = str(preview.get("preview_digest") or "")
        if not digest.startswith("sha256:"):
            raise ExperimentConflict("Adoption preview is missing its integrity digest")
        safe_preview = {
            key: value for key, value in dict(preview).items()
            if key not in {"content", "patch", "secret", "credentials"}
        }
        now = _now()
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_run_adoptions WHERE comparison_id=? AND preview_digest=?",
                (comparison_id, digest),
            ).fetchone()
            if row is None:
                adoption_id = f"adoption-{uuid.uuid4()}"
                db.execute(
                    "INSERT INTO runtime_run_adoptions("
                    "adoption_id,schema_version,comparison_id,source_workspace_id,worktree_id,"
                    "preview_digest,preview_json,status,selected_paths_json,receipt_json,created_at,updated_at"
                    ") VALUES(?,?,?,?,?,?,?,?,NULL,NULL,?,?)",
                    (adoption_id, ADOPTION_SCHEMA_VERSION, comparison_id, source_workspace_id,
                     worktree_id, digest, json.dumps(safe_preview, ensure_ascii=False, sort_keys=True),
                     "previewed", now, now),
                )
                row = db.execute("SELECT * FROM runtime_run_adoptions WHERE adoption_id=?", (adoption_id,)).fetchone()
        return self._public(row)

    def get(self, adoption_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_run_adoptions WHERE adoption_id=?", (adoption_id,)).fetchone()
        if row is None:
            raise ExperimentNotFound("Adoption record not found")
        return self._public(row)

    def mark_applied(self, adoption_id: str, selected_paths: list[str], receipt: Mapping[str, Any]) -> dict[str, Any]:
        if not selected_paths:
            raise ExperimentConflict("At least one reviewed path must be selected")
        return self._finish(adoption_id, "applied", selected_paths, receipt)

    def begin_apply(self, adoption_id: str, selected_paths: list[str]) -> dict[str, Any]:
        if not selected_paths:
            raise ExperimentConflict("At least one reviewed path must be selected")
        return self._begin(adoption_id, "apply", {"selected_paths": sorted(set(selected_paths))})

    def begin_discard(self, adoption_id: str, *, cleanup: bool) -> dict[str, Any]:
        return self._begin(adoption_id, "discard", {"cleanup": bool(cleanup)})

    def _begin(self, adoption_id: str, kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        now = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_run_adoptions WHERE adoption_id=?", (adoption_id,)).fetchone()
            if row is None:
                db.rollback()
                raise ExperimentNotFound("Adoption record not found")
            if str(row["status"]) != "previewed":
                db.rollback()
                return self._public(row)
            existing_kind = str(row["operation_kind"] or "")
            existing_payload = str(row["operation_payload_json"] or "")
            if existing_kind and (existing_kind != kind or existing_payload != encoded):
                db.rollback()
                raise ExperimentConflict("Adoption operation is already bound to another decision")
            if not existing_kind:
                db.execute(
                    "UPDATE runtime_run_adoptions SET operation_kind=?,operation_payload_json=?,"
                    "operation_status='prepared',operation_started_at=?,updated_at=? WHERE adoption_id=?",
                    (kind, encoded, now, now, adoption_id),
                )
            db.commit()
        return self.get(adoption_id)

    def mark_discarded(self, adoption_id: str, receipt: Mapping[str, Any]) -> dict[str, Any]:
        return self._finish(adoption_id, "discarded", [], receipt)

    def _finish(
        self, adoption_id: str, status: str, selected_paths: list[str], receipt: Mapping[str, Any],
    ) -> dict[str, Any]:
        now = _now()
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM runtime_run_adoptions WHERE adoption_id=?", (adoption_id,)).fetchone()
            if row is None:
                raise ExperimentNotFound("Adoption record not found")
            if str(row["status"]) != "previewed":
                if str(row["status"]) == status:
                    return self._public(row)
                raise ExperimentConflict("Adoption decision is immutable")
            db.execute(
                "UPDATE runtime_run_adoptions SET status=?,selected_paths_json=?,receipt_json=?,"
                "operation_status='completed',updated_at=? WHERE adoption_id=?",
                (status, json.dumps(sorted(set(selected_paths)), ensure_ascii=False),
                 json.dumps(dict(receipt), ensure_ascii=False, sort_keys=True), now, adoption_id),
            )
            row = db.execute("SELECT * FROM runtime_run_adoptions WHERE adoption_id=?", (adoption_id,)).fetchone()
        return self._public(row)

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "adoption_id": str(row["adoption_id"]),
            "schema_version": str(row["schema_version"]),
            "comparison_id": str(row["comparison_id"]),
            "source_workspace_id": str(row["source_workspace_id"]),
            "worktree_id": str(row["worktree_id"]),
            "preview_digest": str(row["preview_digest"]),
            "preview": json.loads(str(row["preview_json"])),
            "status": str(row["status"]),
            "selected_paths": json.loads(str(row["selected_paths_json"])) if row["selected_paths_json"] else [],
            "receipt": json.loads(str(row["receipt_json"])) if row["receipt_json"] else None,
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
            "operation": (
                {
                    "kind": str(row["operation_kind"]),
                    "payload": json.loads(str(row["operation_payload_json"])),
                    "status": str(row["operation_status"]),
                    "started_at": str(row["operation_started_at"]),
                }
                if "operation_kind" in row.keys() and row["operation_kind"] else None
            ),
        }
