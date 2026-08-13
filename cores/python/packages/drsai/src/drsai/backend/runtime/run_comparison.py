from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from drsai.backend.runtime.experiments import ExperimentError, ExperimentNotFound, RuntimeExperimentStore


COMPARISON_SCHEMA_VERSION = "opendrsai.run-comparison/2"
TERMINAL = {"completed", "failed", "cancelled"}


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


class RunComparisonStore:
    def __init__(
        self, database: Path, get_run: Callable[[str], dict[str, Any]],
        get_manifest: Callable[[str], dict[str, Any]], inspect_run: Callable[..., dict[str, Any]],
        experiments: RuntimeExperimentStore,
    ) -> None:
        self.database = Path(database)
        self._get_run = get_run
        self._get_manifest = get_manifest
        self._inspect_run = inspect_run
        self._experiments = experiments
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_run_comparisons (
                  comparison_id TEXT PRIMARY KEY,
                  baseline_run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  candidate_run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  schema_version TEXT NOT NULL,
                  source_digest TEXT NOT NULL,
                  comparison_json TEXT NOT NULL,
                  comparison_digest TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(baseline_run_id,candidate_run_id,source_digest)
                );
            """)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def create(self, baseline_run_id: str, candidate_run_id: str) -> dict[str, Any]:
        baseline = self._get_run(baseline_run_id)
        candidate = self._get_run(candidate_run_id)
        if baseline_run_id == candidate_run_id:
            raise ExperimentError("Comparison requires two different Runs")
        relation = self._experiments.relations(candidate_run_id)
        related_experiment = relation.get("parent") or {}
        if baseline["workspace_id"] != candidate["workspace_id"] and not (
            related_experiment.get("source_run_id") == baseline_run_id
            and related_experiment.get("relation_type") == "experiment_replay"
        ):
            raise ExperimentError("Unrelated Runs from different Workspaces cannot be compared")
        if baseline["status"] not in TERMINAL or candidate["status"] not in TERMINAL:
            raise ExperimentError("Only terminal Runs can produce an immutable comparison")
        baseline_manifest = self._get_manifest(baseline_run_id)
        candidate_manifest = self._get_manifest(candidate_run_id)
        candidate_snapshot = self._candidate_snapshot(candidate_run_id)
        source_digest = _digest({
            "baseline": baseline_manifest["manifest_digest"],
            "candidate": candidate_manifest["manifest_digest"],
            "candidate_snapshot": candidate_snapshot,
            "schema": COMPARISON_SCHEMA_VERSION,
        })
        with self._connect() as db:
            cached = db.execute(
                "SELECT * FROM runtime_run_comparisons WHERE baseline_run_id=? AND candidate_run_id=? AND source_digest=?",
                (baseline_run_id, candidate_run_id, source_digest),
            ).fetchone()
        if cached is not None:
            try:
                payload = json.loads(str(cached["comparison_json"]))
                if _digest(payload) == str(cached["comparison_digest"]):
                    return self._public(cached, payload, cached=True)
            except (TypeError, json.JSONDecodeError):
                pass
            with self._connect() as db:
                db.execute("DELETE FROM runtime_run_comparisons WHERE comparison_id=?", (cached["comparison_id"],))
        payload = self._build(
            baseline, candidate, baseline_manifest["manifest"], candidate_manifest["manifest"], candidate_snapshot,
        )
        comparison_digest = _digest(payload)
        comparison_id = f"comparison-{uuid.uuid4()}"
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute(
                "INSERT INTO runtime_run_comparisons VALUES(?,?,?,?,?,?,?,?)",
                (comparison_id, baseline_run_id, candidate_run_id, COMPARISON_SCHEMA_VERSION,
                 source_digest, _canonical(payload), comparison_digest, created_at),
            )
            row = db.execute("SELECT * FROM runtime_run_comparisons WHERE comparison_id=?", (comparison_id,)).fetchone()
        return self._public(row, payload, cached=False)

    def get(self, comparison_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_run_comparisons WHERE comparison_id=?", (comparison_id,)).fetchone()
        if row is None:
            raise ExperimentNotFound("Run Comparison not found")
        try:
            payload = json.loads(str(row["comparison_json"]))
        except (TypeError, json.JSONDecodeError) as exc:
            raise ExperimentError("Run Comparison cache is damaged; regenerate it from the source Runs") from exc
        if _digest(payload) != str(row["comparison_digest"]):
            raise ExperimentError("Run Comparison cache integrity check failed")
        return self._public(row, payload, cached=True)

    def _build(
        self, baseline: Mapping[str, Any], candidate: Mapping[str, Any],
        baseline_manifest: Mapping[str, Any], candidate_manifest: Mapping[str, Any],
        candidate_snapshot: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        left = self._inspect_run(str(baseline["run_id"]), limit=500)
        right = self._inspect_run(str(candidate["run_id"]), limit=500)
        steps = self._align(left["timeline"], right["timeline"])
        baseline_file_items, baseline_files_incomplete = self._collect_type(str(baseline["run_id"]), "file_change")
        candidate_file_items, candidate_files_incomplete = self._collect_type(str(candidate["run_id"]), "file_change")
        baseline_artifact_items, baseline_artifacts_incomplete = self._collect_type(str(baseline["run_id"]), "artifact")
        candidate_artifact_items, candidate_artifacts_incomplete = self._collect_type(str(candidate["run_id"]), "artifact")
        baseline_tool_items, baseline_tools_incomplete = self._collect_type(str(baseline["run_id"]), "tool_call")
        candidate_tool_items, candidate_tools_incomplete = self._collect_type(str(candidate["run_id"]), "tool_call")
        baseline_files = self._facts(baseline_file_items, "file_change")
        candidate_files = self._facts(candidate_file_items, "file_change")
        baseline_artifacts = self._facts(baseline_artifact_items, "artifact")
        candidate_artifacts = self._facts(candidate_artifact_items, "artifact")
        baseline_usage = self._usage(baseline_manifest)
        candidate_usage = self._usage(candidate_manifest)
        attribution: list[dict[str, Any]] = []
        relation = self._experiments.relations(str(candidate["run_id"]))
        if relation["parent"] and relation["parent"].get("experiment_id"):
            experiment = next((item for item in relation["experiments"] if item["executed_run_id"] == candidate["run_id"]), None)
            if experiment and experiment["safe_summary"].get("change_count", 0):
                attribution.append({"kind": "known_configuration", "evidence": experiment["safe_summary"]})
        if baseline_manifest.get("external_dependencies") != candidate_manifest.get("external_dependencies"):
            attribution.append({"kind": "external_dependency_change", "confidence": "observed"})
        if not attribution:
            attribution.append({"kind": "unattributed", "confidence": "unknown", "message": "The evidence does not prove a causal explanation."})
        return {
            "outcome": {
                "baseline_status": baseline["status"], "candidate_status": candidate["status"],
                "status_changed": baseline["status"] != candidate["status"],
                "baseline_result": self._result(baseline_manifest),
                "candidate_result": self._result(candidate_manifest),
            },
            "steps": steps,
            "files": self._diff_facts(baseline_files, candidate_files),
            "artifacts": self._diff_facts(baseline_artifacts, candidate_artifacts),
            "usage": {"baseline": baseline_usage, "candidate": candidate_usage},
            "metrics": self._metrics(
                left,
                right,
                baseline_tool_errors=sum(item.get("status") == "failed" for item in baseline_tool_items),
                candidate_tool_errors=sum(item.get("status") == "failed" for item in candidate_tool_items),
            ),
            "candidate_snapshot": dict(candidate_snapshot) if candidate_snapshot else None,
            "attribution": attribution,
            "incomplete": bool(
                left["page"]["has_more"] or right["page"]["has_more"]
                or baseline_files_incomplete or candidate_files_incomplete
                or baseline_artifacts_incomplete or candidate_artifacts_incomplete
                or baseline_tools_incomplete or candidate_tools_incomplete
            ),
        }

    @staticmethod
    def _metrics(
        left: Mapping[str, Any],
        right: Mapping[str, Any],
        *,
        baseline_tool_errors: int,
        candidate_tool_errors: int,
    ) -> dict[str, Any]:
        def side(value: Mapping[str, Any], *, tool_errors: int) -> dict[str, int | str | None]:
            summary = value.get("summary") if isinstance(value.get("summary"), Mapping) else {}
            counts = summary.get("counts_by_item_type") if isinstance(summary.get("counts_by_item_type"), Mapping) else {}
            usage = summary.get("usage") if isinstance(summary.get("usage"), Mapping) else {}
            run = value.get("run") if isinstance(value.get("run"), Mapping) else {}
            return {
                "status": str(run.get("status") or "unknown"),
                "duration_ms": int(summary["duration_ms"]) if isinstance(summary.get("duration_ms"), (int, float)) else None,
                "input_tokens": int(usage.get("input_tokens") or 0),
                "output_tokens": int(usage.get("output_tokens") or 0),
                "total_tokens": int(usage.get("total_tokens") or 0),
                "tool_calls": int(counts.get("tool_call") or 0),
                "tool_errors": tool_errors,
                "approvals": int(counts.get("interaction") or 0),
                "artifacts": int(counts.get("artifact") or 0),
                "warnings": int(summary.get("warning_count") or 0),
            }

        baseline = side(left, tool_errors=baseline_tool_errors)
        candidate = side(right, tool_errors=candidate_tool_errors)
        numeric = (
            "duration_ms", "input_tokens", "output_tokens", "total_tokens", "tool_calls",
            "tool_errors", "approvals", "artifacts", "warnings",
        )
        delta = {
            key: (
                int(candidate[key]) - int(baseline[key])
                if baseline[key] is not None and candidate[key] is not None else None
            )
            for key in numeric
        }
        return {"baseline": baseline, "candidate": candidate, "delta": delta}

    def _candidate_snapshot(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT data_json FROM runtime_events WHERE run_id=? AND event_type=? ORDER BY sequence DESC LIMIT 1",
                (run_id, "run.experiment.candidate_snapshot"),
            ).fetchone()
        if row is None:
            return None
        try:
            value = json.loads(str(row["data_json"]))
        except (TypeError, json.JSONDecodeError) as exc:
            raise ExperimentError("Candidate snapshot evidence is damaged") from exc
        if not isinstance(value, dict) or not str(value.get("candidate_head") or ""):
            raise ExperimentError("Candidate snapshot evidence is incomplete")
        return value

    def _collect_type(self, run_id: str, item_type: str, *, cap: int = 2_000) -> tuple[list[dict[str, Any]], bool]:
        items: list[dict[str, Any]] = []
        cursor: str | None = None
        while len(items) < cap:
            page = self._inspect_run(run_id, limit=min(500, cap - len(items)), timeline_cursor=cursor, item_type=item_type)
            items.extend(page["timeline"])
            cursor = page["page"].get("next_cursor")
            if not page["page"].get("has_more") or not cursor:
                return items, False
        return items, bool(cursor)

    @staticmethod
    def _provenance(item: Mapping[str, Any]) -> str | None:
        content = item.get("content") if isinstance(item.get("content"), Mapping) else {}
        provenance = content.get("provenance") if isinstance(content.get("provenance"), Mapping) else {}
        value = provenance.get("source_event_id") or content.get("source_event_id")
        return str(value) if value else None

    def _align(self, left: list[dict[str, Any]], right: list[dict[str, Any]]) -> list[dict[str, Any]]:
        right_by_provenance = {key: item for item in right if (key := self._provenance(item))}
        right_by_id = {str(item["id"]): item for item in right}
        used: set[str] = set()
        rows = []
        for item in left:
            provenance = self._provenance(item)
            match = right_by_provenance.get(provenance) if provenance else right_by_id.get(str(item["id"]))
            if match:
                used.add(str(match["id"]))
            rows.append({
                "baseline_item_id": item["id"], "candidate_item_id": match["id"] if match else None,
                "alignment": "provenance" if match and provenance else "same_id" if match else "unmatched_baseline",
                "baseline_type": item["type"], "candidate_type": match["type"] if match else None,
            })
        rows.extend({
            "baseline_item_id": None, "candidate_item_id": item["id"], "alignment": "unmatched_candidate",
            "baseline_type": None, "candidate_type": item["type"],
        } for item in right if str(item["id"]) not in used)
        return rows

    @staticmethod
    def _facts(items: list[dict[str, Any]], item_type: str) -> dict[str, dict[str, Any]]:
        result = {}
        for item in items:
            if item.get("type") != item_type:
                continue
            content = item.get("content") if isinstance(item.get("content"), Mapping) else {}
            if item_type == "file_change" and isinstance(content.get("changes"), list):
                for index, change in enumerate(content["changes"]):
                    if not isinstance(change, Mapping):
                        continue
                    key = str(change.get("path") or change.get("new_path") or change.get("old_path") or f"{item['id']}:{index}")
                    result[key] = {"identity": key, "digest": change.get("sha256") or change.get("digest"), "change": change.get("operation") or change.get("change"), "binary": change.get("binary")}
                continue
            key = str(content.get("path") or content.get("artifact_id") or content.get("name") or item["id"])
            result[key] = {"identity": key, "digest": content.get("sha256") or content.get("digest"), "change": content.get("change") or content.get("status"), "binary": content.get("binary")}
        return result

    @staticmethod
    def _diff_facts(left: Mapping[str, dict[str, Any]], right: Mapping[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return [{
            "identity": key, "baseline": left.get(key), "candidate": right.get(key),
            "change": "added" if key not in left else "deleted" if key not in right else "unchanged" if left[key].get("digest") == right[key].get("digest") else "modified",
        } for key in sorted(set(left) | set(right))]

    @staticmethod
    def _usage(manifest: Mapping[str, Any]) -> dict[str, Any]:
        outcome = manifest.get("outcome") if isinstance(manifest.get("outcome"), Mapping) else {}
        usage = outcome.get("usage") if isinstance(outcome.get("usage"), Mapping) else None
        return {"known": usage is not None, "value": dict(usage) if usage is not None else None}

    @staticmethod
    def _result(manifest: Mapping[str, Any]) -> dict[str, Any] | None:
        outcome = manifest.get("outcome") if isinstance(manifest.get("outcome"), Mapping) else {}
        result = outcome.get("result")
        return dict(result) if isinstance(result, Mapping) else None

    @staticmethod
    def _public(row: sqlite3.Row, payload: dict[str, Any], *, cached: bool) -> dict[str, Any]:
        return {
            "comparison_id": str(row["comparison_id"]),
            "schema_version": str(row["schema_version"]),
            "baseline_run_id": str(row["baseline_run_id"]),
            "candidate_run_id": str(row["candidate_run_id"]),
            "source_digest": str(row["source_digest"]),
            "comparison_digest": str(row["comparison_digest"]),
            "created_at": str(row["created_at"]),
            "cached": cached,
            **payload,
        }
