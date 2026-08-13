from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.runtime.experiments import ExperimentConflict, ExperimentError
from drsai.backend.runtime.sqlite_connection import ClosingConnection
from drsai.relay.security import redact_credentials


EVALUATION_SCHEMA_VERSION = "opendrsai.run-comparison-evaluation/1"
RUBRIC_SNAPSHOT = {
    "rubric_id": "opendrsai.comparison.default",
    "revision": 1,
    "criteria": [
        {
            "id": "outcome_quality",
            "title": "Outcome quality",
            "description": "The final result is correct, complete, and satisfies the stated goal.",
        },
        {
            "id": "execution_quality",
            "title": "Execution quality",
            "description": "Tools, steps, and artifacts are effective and avoid unnecessary failures.",
        },
        {
            "id": "safety_reproducibility",
            "title": "Safety and reproducibility",
            "description": "Approvals, safety boundaries, and reproduction evidence are sufficient.",
        },
    ],
    "score_min": 1,
    "score_max": 5,
}
CRITERION_IDS = tuple(item["id"] for item in RUBRIC_SNAPSHOT["criteria"])
VERDICTS = {"baseline_better", "candidate_better", "tie", "inconclusive"}


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunComparisonEvaluationStore:
    """Append-only human evaluations for an immutable Run Comparison."""

    def __init__(self, database: Path, get_comparison: Callable[[str], dict[str, Any]]) -> None:
        self.database = Path(database)
        self._get_comparison = get_comparison
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_run_comparison_evaluations (
                  evaluation_id TEXT PRIMARY KEY,
                  comparison_id TEXT NOT NULL REFERENCES runtime_run_comparisons(comparison_id),
                  revision INTEGER NOT NULL,
                  schema_version TEXT NOT NULL,
                  comparison_digest TEXT NOT NULL,
                  rubric_snapshot_json TEXT NOT NULL,
                  scores_json TEXT NOT NULL,
                  verdict TEXT NOT NULL,
                  note TEXT NOT NULL,
                  evidence_refs_json TEXT NOT NULL,
                  created_by TEXT NOT NULL,
                  idempotency_key TEXT NOT NULL,
                  request_digest TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(comparison_id, revision),
                  UNIQUE(comparison_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_comparison_evaluations_latest
                  ON runtime_run_comparison_evaluations(comparison_id, revision DESC);
                """
            )

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def list(self, comparison_id: str) -> dict[str, Any]:
        comparison = self._get_comparison(comparison_id)
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM runtime_run_comparison_evaluations WHERE comparison_id=? ORDER BY revision",
                (comparison_id,),
            ).fetchall()
        evaluations = [self._public(row) for row in rows]
        return {
            "schema_version": EVALUATION_SCHEMA_VERSION,
            "comparison_id": comparison_id,
            "comparison_digest": comparison["comparison_digest"],
            "rubric_snapshot": RUBRIC_SNAPSHOT,
            "latest_revision": evaluations[-1]["revision"] if evaluations else 0,
            "evaluations": evaluations,
        }

    def create(
        self,
        comparison_id: str,
        *,
        expected_latest_revision: int,
        scores: Mapping[str, Any],
        verdict: str,
        note: str,
        evidence_refs: list[Mapping[str, Any]],
        created_by: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        comparison = self._get_comparison(comparison_id)
        normalized_scores = self._scores(scores)
        normalized_verdict = str(verdict)
        if normalized_verdict not in VERDICTS:
            raise ExperimentError("Comparison evaluation verdict is invalid")
        if not isinstance(note, str) or len(note) > 4_000 or "\x00" in note:
            raise ExperimentError("Comparison evaluation note is invalid")
        safe_note = redact_credentials(note)
        normalized_refs = self._evidence_refs(comparison, evidence_refs)
        if not isinstance(created_by, str) or not created_by or len(created_by) > 256:
            raise ExperimentError("Comparison evaluation author is invalid")
        if not isinstance(idempotency_key, str) or not idempotency_key or len(idempotency_key) > 256:
            raise ExperimentError("Comparison evaluation Idempotency-Key is invalid")
        request = {
            "expected_latest_revision": expected_latest_revision,
            "scores": normalized_scores,
            "verdict": normalized_verdict,
            "note": safe_note,
            "evidence_refs": normalized_refs,
            "created_by": created_by,
            "comparison_digest": comparison["comparison_digest"],
        }
        request_digest = _digest(request)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT * FROM runtime_run_comparison_evaluations WHERE comparison_id=? AND idempotency_key=?",
                (comparison_id, idempotency_key),
            ).fetchone()
            if prior is not None:
                if str(prior["request_digest"]) != request_digest:
                    raise ExperimentConflict("Idempotency-Key is bound to another comparison evaluation")
                return self._public(prior)
            latest = db.execute(
                "SELECT COALESCE(MAX(revision),0) FROM runtime_run_comparison_evaluations WHERE comparison_id=?",
                (comparison_id,),
            ).fetchone()[0]
            if int(latest) != expected_latest_revision:
                raise ExperimentConflict("Comparison evaluation revision changed")
            revision = int(latest) + 1
            evaluation_id = f"comparison-evaluation-{uuid.uuid4()}"
            created_at = _now()
            db.execute(
                "INSERT INTO runtime_run_comparison_evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    evaluation_id, comparison_id, revision, EVALUATION_SCHEMA_VERSION,
                    comparison["comparison_digest"], _canonical(RUBRIC_SNAPSHOT),
                    _canonical(normalized_scores), normalized_verdict, safe_note,
                    _canonical(normalized_refs), created_by, idempotency_key,
                    request_digest, created_at,
                ),
            )
            row = db.execute(
                "SELECT * FROM runtime_run_comparison_evaluations WHERE evaluation_id=?",
                (evaluation_id,),
            ).fetchone()
        return self._public(row)

    @staticmethod
    def _scores(value: Mapping[str, Any]) -> dict[str, dict[str, int]]:
        if not isinstance(value, Mapping) or set(value) != set(CRITERION_IDS):
            raise ExperimentError("Comparison evaluation scores must cover the fixed rubric")
        result: dict[str, dict[str, int]] = {}
        for criterion in CRITERION_IDS:
            pair = value.get(criterion)
            if not isinstance(pair, Mapping) or set(pair) != {"baseline", "candidate"}:
                raise ExperimentError(f"Comparison evaluation score pair is invalid: {criterion}")
            normalized: dict[str, int] = {}
            for side in ("baseline", "candidate"):
                score = pair.get(side)
                if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
                    raise ExperimentError(f"Comparison evaluation score is invalid: {criterion}.{side}")
                normalized[side] = score
            result[criterion] = normalized
        return result

    def _evidence_refs(
        self, comparison: Mapping[str, Any], values: list[Mapping[str, Any]],
    ) -> list[dict[str, str]]:
        if not isinstance(values, list) or len(values) > 20:
            raise ExperimentError("Comparison evaluation evidence references are invalid")
        allowed_runs = {str(comparison["baseline_run_id"]), str(comparison["candidate_run_id"])}
        result: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        with self._connect() as db:
            for value in values:
                if not isinstance(value, Mapping) or set(value) != {"run_id", "item_id"}:
                    raise ExperimentError("Comparison evaluation evidence reference is invalid")
                run_id = str(value.get("run_id") or "")
                item_id = str(value.get("item_id") or "")
                if run_id not in allowed_runs or not item_id or len(item_id) > 500:
                    raise ExperimentError("Comparison evaluation evidence does not belong to this Comparison")
                exists = db.execute(
                    "SELECT 1 FROM runtime_oaep_items WHERE run_id=? AND item_id=?",
                    (run_id, item_id),
                ).fetchone()
                if exists is None:
                    raise ExperimentError("Comparison evaluation evidence Item was not found")
                identity = (run_id, item_id)
                if identity not in seen:
                    result.append({"run_id": run_id, "item_id": item_id})
                    seen.add(identity)
        return result

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "evaluation_id": str(row["evaluation_id"]),
            "comparison_id": str(row["comparison_id"]),
            "revision": int(row["revision"]),
            "schema_version": str(row["schema_version"]),
            "comparison_digest": str(row["comparison_digest"]),
            "rubric_snapshot": json.loads(str(row["rubric_snapshot_json"])),
            "scores": json.loads(str(row["scores_json"])),
            "verdict": str(row["verdict"]),
            "note": str(row["note"]),
            "evidence_refs": json.loads(str(row["evidence_refs_json"])),
            "created_by": str(row["created_by"]),
            "created_at": str(row["created_at"]),
        }
