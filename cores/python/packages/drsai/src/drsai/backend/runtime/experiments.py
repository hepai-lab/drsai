from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.runtime.experiment_overrides import (
    OverrideValidationError,
    UnsupportedOverrideError,
    normalize_overrides,
    overrides_digest,
    safe_override_summary,
)
from drsai.backend.runtime.sqlite_connection import ClosingConnection


EXPERIMENT_SCHEMA_VERSION = "opendrsai.run-experiment/1"
REPLAY_MODES = {
    "rerun_from_start", "resume_from_checkpoint", "reuse_recorded_results",
    "reexecute_safe_steps",
}
LEGACY_REPLAY_MODE_ALIASES = {
    "fresh": "rerun_from_start",
    "resume_checkpoint": "resume_from_checkpoint",
    "reuse_pure": "reuse_recorded_results",
    "review_each_step": "reexecute_safe_steps",
}
FORKABLE_ITEM_TYPES = {
    "message", "reasoning", "plan", "command_execution", "file_change",
    "tool_call", "artifact", "interaction", "subtask", "notice",
}


class ExperimentError(ValueError):
    code = "invalid_experiment"


class ExperimentNotFound(ExperimentError):
    code = "experiment_not_found"


class ExperimentConflict(ExperimentError):
    code = "experiment_version_conflict"


class ExperimentImmutable(ExperimentError):
    code = "experiment_already_executed"


class InvalidExperimentOverrides(ExperimentError):
    code = "invalid_experiment_overrides"


class UnsupportedExperimentOverrides(InvalidExperimentOverrides):
    code = "unsupported_override"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def normalize_replay_mode(value: Any) -> str:
    mode = LEGACY_REPLAY_MODE_ALIASES.get(str(value), str(value))
    if mode not in REPLAY_MODES:
        raise ExperimentError("Replay mode is invalid")
    return mode


class RuntimeExperimentStore:
    """Versioned experiment drafts that never mutate their source Run."""

    def __init__(
        self,
        database: Path,
        encrypt: Callable[[dict[str, Any]], str],
        decrypt: Callable[[str], dict[str, Any]],
    ) -> None:
        self.database = Path(database)
        self._encrypt = encrypt
        self._decrypt = decrypt
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_run_experiments (
                  experiment_id TEXT PRIMARY KEY,
                  schema_version TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  base_run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  forked_from_item_id TEXT,
                  forked_from_checkpoint_id TEXT,
                  draft_version INTEGER NOT NULL,
                  title TEXT NOT NULL,
                  status TEXT NOT NULL CHECK(status IN ('draft','executed')),
                  overrides_json_encrypted TEXT NOT NULL,
                  safe_summary_json TEXT NOT NULL,
                  overrides_digest TEXT NOT NULL,
                  replay_mode TEXT NOT NULL,
                  created_by TEXT NOT NULL,
                  create_idempotency_key TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  executed_run_id TEXT UNIQUE REFERENCES runtime_runs(run_id)
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_run_experiments_base
                  ON runtime_run_experiments(base_run_id,created_at,experiment_id);
                CREATE INDEX IF NOT EXISTS idx_runtime_run_experiments_workspace
                  ON runtime_run_experiments(workspace_id,updated_at,experiment_id);
                CREATE TABLE IF NOT EXISTS runtime_run_experiment_versions (
                  experiment_id TEXT NOT NULL REFERENCES runtime_run_experiments(experiment_id) ON DELETE CASCADE,
                  draft_version INTEGER NOT NULL,
                  title TEXT NOT NULL,
                  overrides_json_encrypted TEXT NOT NULL,
                  safe_summary_json TEXT NOT NULL,
                  overrides_digest TEXT NOT NULL,
                  replay_mode TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(experiment_id,draft_version)
                );
                CREATE TABLE IF NOT EXISTS runtime_run_experiment_operations (
                  experiment_id TEXT NOT NULL REFERENCES runtime_run_experiments(experiment_id) ON DELETE CASCADE,
                  idempotency_key TEXT NOT NULL,
                  request_digest TEXT NOT NULL,
                  result_version INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(experiment_id,idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS runtime_run_relations (
                  source_run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  target_run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  relation_type TEXT NOT NULL,
                  source_item_id TEXT,
                  experiment_id TEXT NOT NULL UNIQUE REFERENCES runtime_run_experiments(experiment_id),
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(source_run_id,target_run_id,relation_type)
                );
                """
            )
            columns = {str(row["name"]) for row in db.execute("PRAGMA table_info(runtime_run_experiments)").fetchall()}
            if "pinned" not in columns:
                db.execute("ALTER TABLE runtime_run_experiments ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
            if "resources_cleaned_at" not in columns:
                db.execute("ALTER TABLE runtime_run_experiments ADD COLUMN resources_cleaned_at TEXT")

    def create(
        self,
        base_run_id: str,
        *,
        created_by: str,
        idempotency_key: str,
        title: str = "Experiment",
        forked_from_item_id: str | None = None,
        replay_mode: str = "rerun_from_start",
    ) -> tuple[dict[str, Any], bool]:
        if not created_by or not idempotency_key or len(idempotency_key) > 200:
            raise ExperimentError("created_by and a valid Idempotency-Key are required")
        if not title.strip() or len(title) > 500:
            raise ExperimentError("Experiment title is invalid")
        replay_mode = normalize_replay_mode(replay_mode)
        now = _now()
        experiment_id = f"experiment-{uuid.uuid4()}"
        empty_overrides: dict[str, Any] = {}
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM runtime_run_experiments WHERE create_idempotency_key=?",
                (idempotency_key,),
            ).fetchone()
            if existing is not None:
                if (
                    str(existing["base_run_id"]) != base_run_id
                    or str(existing["created_by"]) != created_by
                    or (existing["forked_from_item_id"] or None) != forked_from_item_id
                ):
                    raise ExperimentConflict("Idempotency-Key is bound to another experiment")
                return self._experiment(existing), False
            run = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (base_run_id,)).fetchone()
            if run is None:
                raise ExperimentNotFound("Base Run not found")
            if forked_from_item_id:
                item = db.execute(
                    "SELECT item_type FROM runtime_oaep_items WHERE run_id=? AND item_id=?",
                    (base_run_id, forked_from_item_id),
                ).fetchone()
                if item is None:
                    raise ExperimentError("Fork Item does not belong to the base Run")
                if str(item["item_type"]) not in FORKABLE_ITEM_TYPES:
                    raise ExperimentError("Fork Item type is not supported")
            encrypted = self._encrypt(empty_overrides)
            summary = {"changed_fields": [], "change_count": 0}
            values = (
                experiment_id, EXPERIMENT_SCHEMA_VERSION, run["workspace_id"], run["session_id"],
                base_run_id, forked_from_item_id, None, 1, title.strip(), "draft", encrypted,
                _canonical(summary), _digest(empty_overrides), replay_mode, created_by,
                idempotency_key, now, now, None,
                0, None,
            )
            db.execute(
                "INSERT INTO runtime_run_experiments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                values,
            )
            db.execute(
                "INSERT INTO runtime_run_experiment_versions VALUES(?,?,?,?,?,?,?,?)",
                (experiment_id, 1, title.strip(), encrypted, _canonical(summary),
                 _digest(empty_overrides), replay_mode, now),
            )
            db.commit()
        return self.get(experiment_id), True

    def get(self, experiment_id: str, *, version: int | None = None) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_run_experiments WHERE experiment_id=?", (experiment_id,)
            ).fetchone()
            if row is None:
                raise ExperimentNotFound("Experiment not found")
            result = self._experiment(row)
            if version is not None and version != result["draft_version"]:
                snapshot = db.execute(
                    "SELECT * FROM runtime_run_experiment_versions WHERE experiment_id=? AND draft_version=?",
                    (experiment_id, version),
                ).fetchone()
                if snapshot is None:
                    raise ExperimentNotFound("Experiment version not found")
                result.update(self._version(snapshot))
            return result

    def update(
        self,
        experiment_id: str,
        *,
        expected_version: int,
        idempotency_key: str,
        patch: Mapping[str, Any],
    ) -> dict[str, Any]:
        allowed = {"title", "overrides", "replay_mode"}
        unknown = set(patch) - allowed
        if unknown:
            raise ExperimentError(f"Unknown experiment fields: {', '.join(sorted(unknown))}")
        normalized_patch = dict(patch)
        if "replay_mode" in normalized_patch:
            normalized_patch["replay_mode"] = normalize_replay_mode(normalized_patch["replay_mode"])
        request_digest = _digest({"expected_version": expected_version, "patch": normalized_patch})
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM runtime_run_experiments WHERE experiment_id=?", (experiment_id,)
            ).fetchone()
            if row is None:
                raise ExperimentNotFound("Experiment not found")
            prior = db.execute(
                "SELECT * FROM runtime_run_experiment_operations WHERE experiment_id=? AND idempotency_key=?",
                (experiment_id, idempotency_key),
            ).fetchone()
            if prior is not None:
                if str(prior["request_digest"]) != request_digest:
                    raise ExperimentConflict("Idempotency-Key was reused with another update")
                return self.get(experiment_id, version=int(prior["result_version"]))
            if str(row["status"]) != "draft" or row["executed_run_id"] is not None:
                raise ExperimentImmutable("Executed experiments are immutable")
            if int(row["draft_version"]) != expected_version:
                raise ExperimentConflict("Experiment was updated in another window")
            title = str(patch.get("title", row["title"])).strip()
            if not title or len(title) > 500:
                raise ExperimentError("Experiment title is invalid")
            replay_mode = normalize_replay_mode(normalized_patch.get("replay_mode", row["replay_mode"]))
            overrides = patch.get("overrides")
            if overrides is None:
                overrides = self._decrypt(str(row["overrides_json_encrypted"]))
            if not isinstance(overrides, dict):
                raise ExperimentError("Experiment overrides must be an object")
            try:
                overrides = normalize_overrides(overrides)
            except UnsupportedOverrideError as exc:
                raise UnsupportedExperimentOverrides(str(exc)) from exc
            except OverrideValidationError as exc:
                raise InvalidExperimentOverrides(str(exc)) from exc
            version = expected_version + 1
            now = _now()
            summary = safe_override_summary(overrides)
            encrypted = self._encrypt(overrides)
            override_digest = overrides_digest(overrides)
            db.execute(
                "UPDATE runtime_run_experiments SET draft_version=?,title=?,overrides_json_encrypted=?,"
                "safe_summary_json=?,overrides_digest=?,replay_mode=?,updated_at=? WHERE experiment_id=?",
                (version, title, encrypted, _canonical(summary), override_digest, replay_mode, now, experiment_id),
            )
            db.execute(
                "INSERT INTO runtime_run_experiment_versions VALUES(?,?,?,?,?,?,?,?)",
                (experiment_id, version, title, encrypted, _canonical(summary), override_digest, replay_mode, now),
            )
            db.execute(
                "INSERT INTO runtime_run_experiment_operations VALUES(?,?,?,?,?)",
                (experiment_id, idempotency_key, request_digest, version, now),
            )
            db.commit()
        return self.get(experiment_id)

    def delete(self, experiment_id: str) -> None:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT status,executed_run_id FROM runtime_run_experiments WHERE experiment_id=?",
                (experiment_id,),
            ).fetchone()
            if row is None:
                raise ExperimentNotFound("Experiment not found")
            if str(row["status"]) != "draft" or row["executed_run_id"] is not None:
                raise ExperimentImmutable("Executed experiments cannot be deleted")
            db.execute("DELETE FROM runtime_replay_plans WHERE experiment_id=?", (experiment_id,))
            db.execute("DELETE FROM runtime_run_experiments WHERE experiment_id=?", (experiment_id,))
            db.commit()

    def mark_executed(self, experiment_id: str, executed_run_id: str) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM runtime_run_experiments WHERE experiment_id=?", (experiment_id,)
            ).fetchone()
            target = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (executed_run_id,)).fetchone()
            if row is None:
                raise ExperimentNotFound("Experiment not found")
            if target is None or (
                str(target["workspace_id"]) != str(row["workspace_id"])
                and target["worktree_id"] is None
            ):
                raise ExperimentError("Replay Run must exist in the experiment Workspace")
            if row["executed_run_id"] and str(row["executed_run_id"]) != executed_run_id:
                raise ExperimentImmutable("Experiment is already bound to another Replay Run")
            now = _now()
            db.execute(
                "UPDATE runtime_run_experiments SET status='executed',executed_run_id=?,updated_at=? WHERE experiment_id=?",
                (executed_run_id, now, experiment_id),
            )
            db.execute(
                "INSERT OR IGNORE INTO runtime_run_relations VALUES(?,?,?,?,?,?)",
                (row["base_run_id"], executed_run_id, "experiment_replay", row["forked_from_item_id"], experiment_id, now),
            )
            db.commit()
        return self.get(experiment_id)

    def set_pinned(self, experiment_id: str, pinned: bool) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            result = db.execute(
                "UPDATE runtime_run_experiments SET pinned=?,updated_at=? WHERE experiment_id=?",
                (int(pinned), _now(), experiment_id),
            )
            if result.rowcount != 1:
                raise ExperimentNotFound("Experiment not found")
        return self.get(experiment_id)

    def cleanup_candidates(self, *, older_than: str, limit: int = 100) -> list[dict[str, Any]]:
        """Select only terminal, unpinned experiments without a pending adoption."""
        with self._connect() as db:
            rows = db.execute(
                """SELECT e.* FROM runtime_run_experiments e
                   JOIN runtime_runs r ON r.run_id=e.executed_run_id
                   WHERE e.status='executed' AND e.pinned=0 AND e.resources_cleaned_at IS NULL
                     AND e.updated_at<? AND r.status IN ('completed','failed','cancelled')
                     AND NOT EXISTS (
                       SELECT 1 FROM runtime_run_comparisons c
                       JOIN runtime_run_adoptions a ON a.comparison_id=c.comparison_id
                       WHERE c.candidate_run_id=e.executed_run_id AND a.status='previewed'
                     )
                   ORDER BY e.updated_at,e.experiment_id LIMIT ?""",
                (older_than, max(1, min(limit, 500))),
            ).fetchall()
        return [self._experiment(row) for row in rows]

    def mark_resources_cleaned(self, experiment_id: str) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            result = db.execute(
                "UPDATE runtime_run_experiments SET resources_cleaned_at=?,updated_at=? "
                "WHERE experiment_id=? AND pinned=0 AND resources_cleaned_at IS NULL",
                (_now(), _now(), experiment_id),
            )
            if result.rowcount != 1:
                raise ExperimentConflict("Experiment resources are pinned or already cleaned")
        return self.get(experiment_id)

    def relations(self, run_id: str) -> dict[str, Any]:
        with self._connect() as db:
            run = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if run is None:
                raise ExperimentNotFound("Run not found")
            parent = None
            if run["parent_run_id"]:
                parent = {"run_id": str(run["parent_run_id"]), "relation_type": "subagent"}
            replay_parent = db.execute(
                "SELECT source_run_id,relation_type,source_item_id,experiment_id FROM runtime_run_relations WHERE target_run_id=?",
                (run_id,),
            ).fetchone()
            if replay_parent is not None:
                parent = dict(replay_parent)
            children = [dict(row) for row in db.execute(
                "SELECT run_id,'subagent' AS relation_type,NULL AS source_item_id,NULL AS experiment_id "
                "FROM runtime_runs WHERE parent_run_id=? UNION ALL "
                "SELECT target_run_id AS run_id,relation_type,source_item_id,experiment_id "
                "FROM runtime_run_relations WHERE source_run_id=? ORDER BY run_id",
                (run_id, run_id),
            ).fetchall()]
            experiments = [self._experiment(row) for row in db.execute(
                "SELECT * FROM runtime_run_experiments WHERE base_run_id=? OR executed_run_id=? ORDER BY created_at,experiment_id",
                (run_id, run_id),
            ).fetchall()]
        return {"run_id": run_id, "parent": parent, "children": children, "experiments": experiments}

    def _experiment(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "schema_version": str(row["schema_version"]),
            "experiment_id": str(row["experiment_id"]),
            "workspace_id": str(row["workspace_id"]),
            "session_id": str(row["session_id"]),
            "base_run_id": str(row["base_run_id"]),
            "forked_from_item_id": row["forked_from_item_id"],
            "forked_from_checkpoint_id": row["forked_from_checkpoint_id"],
            "draft_version": int(row["draft_version"]),
            "title": str(row["title"]),
            "status": str(row["status"]),
            "overrides": self._decrypt(str(row["overrides_json_encrypted"])),
            "safe_summary": json.loads(str(row["safe_summary_json"])),
            "overrides_digest": str(row["overrides_digest"]),
            "replay_mode": normalize_replay_mode(row["replay_mode"]),
            "created_by": str(row["created_by"]),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
            "executed_run_id": row["executed_run_id"],
            "pinned": bool(row["pinned"]) if "pinned" in row.keys() else False,
            "resources_cleaned_at": row["resources_cleaned_at"] if "resources_cleaned_at" in row.keys() else None,
        }

    def _version(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "draft_version": int(row["draft_version"]),
            "title": str(row["title"]),
            "overrides": self._decrypt(str(row["overrides_json_encrypted"])),
            "safe_summary": json.loads(str(row["safe_summary_json"])),
            "overrides_digest": str(row["overrides_digest"]),
            "replay_mode": normalize_replay_mode(row["replay_mode"]),
            "updated_at": str(row["created_at"]),
        }
