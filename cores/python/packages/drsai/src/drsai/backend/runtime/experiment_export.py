"""Redacted, offline-verifiable export packages for Runtime experiments."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.runtime.sqlite_connection import ClosingConnection


EXPERIMENT_PACKAGE_SCHEMA_VERSION = "opendrsai.run-experiment-package/1"


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")


def _sha(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value)).hexdigest()


def _identity_digest(value: Any) -> str:
    return _sha(str(value or ""))


def build_experiment_package(engine: Any, experiment_id: str) -> dict[str, Any]:
    """Build a curated package without prompt bodies, credentials or absolute paths."""
    draft = engine.experiments.get(experiment_id)
    base_run_id = str(draft["base_run_id"])
    executed_run_id = str(draft["executed_run_id"]) if draft.get("executed_run_id") else None
    plan = _latest_plan(engine, experiment_id)
    comparison = _latest_comparison(engine, base_run_id, executed_run_id)
    adoption = _latest_adoption(engine, comparison)
    payload: dict[str, Any] = {
        "schema_version": EXPERIMENT_PACKAGE_SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "privacy_notice": (
            "Redacted experiment evidence. Prompt/input bodies, credential references, "
            "absolute paths and raw Tool payloads are excluded."
        ),
        "experiment": {
            key: draft.get(key) for key in (
                "experiment_id", "workspace_id", "session_id", "base_run_id",
                "forked_from_item_id", "forked_from_checkpoint_id", "draft_version",
                "title", "status", "safe_summary", "overrides_digest", "replay_mode",
                "created_at", "updated_at", "executed_run_id", "pinned",
                "resources_cleaned_at",
            )
        },
        "base_manifest": engine.get_run_manifest(base_run_id, safe=True),
        "candidate_manifest": (
            engine.get_run_manifest(executed_run_id, safe=True) if executed_run_id else None
        ),
        "replay_plan": _safe_plan(plan),
        "comparison": _safe_comparison(comparison),
        "adoption": _safe_adoption(adoption),
        "proof_scope": [
            "experiment_lineage", "safe_override_summary", "run_manifests",
            "replay_policy_summary", "comparison_summary", "adoption_receipt_summary",
        ],
        "excluded": [
            "prompt_bodies", "input_bodies", "credential_references", "raw_tool_payloads",
            "absolute_paths", "model_chain_of_thought",
        ],
    }
    payload["integrity"] = {
        "algorithm": "sha256", "digest_scope": "package_without_integrity",
        "digest": _sha(payload),
    }
    return payload


def verify_experiment_package(package: Mapping[str, Any]) -> bool:
    integrity = package.get("integrity") if isinstance(package.get("integrity"), Mapping) else {}
    expected = integrity.get("digest")
    payload = dict(package)
    payload.pop("integrity", None)
    return (
        package.get("schema_version") == EXPERIMENT_PACKAGE_SCHEMA_VERSION
        and integrity.get("algorithm") == "sha256"
        and integrity.get("digest_scope") == "package_without_integrity"
        and isinstance(expected, str)
        and expected == _sha(payload)
    )


def _connect(engine: Any) -> sqlite3.Connection:
    db = sqlite3.connect(Path(engine.database), timeout=30, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    return db


def _latest_plan(engine: Any, experiment_id: str) -> dict[str, Any] | None:
    with _connect(engine) as db:
        row = db.execute(
            "SELECT replay_plan_id FROM runtime_replay_plans WHERE experiment_id=? "
            "ORDER BY created_at DESC,replay_plan_id DESC LIMIT 1", (experiment_id,),
        ).fetchone()
    return engine.replay_plans.get(str(row["replay_plan_id"])) if row else None


def _latest_comparison(
    engine: Any, base_run_id: str, executed_run_id: str | None,
) -> dict[str, Any] | None:
    if not executed_run_id:
        return None
    with _connect(engine) as db:
        row = db.execute(
            "SELECT comparison_id FROM runtime_run_comparisons "
            "WHERE baseline_run_id=? AND candidate_run_id=? "
            "ORDER BY created_at DESC,comparison_id DESC LIMIT 1",
            (base_run_id, executed_run_id),
        ).fetchone()
    return engine.run_comparisons.get(str(row["comparison_id"])) if row else None


def _latest_adoption(engine: Any, comparison: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not comparison:
        return None
    with _connect(engine) as db:
        row = db.execute(
            "SELECT adoption_id FROM runtime_run_adoptions WHERE comparison_id=? "
            "ORDER BY updated_at DESC,adoption_id DESC LIMIT 1",
            (comparison["comparison_id"],),
        ).fetchone()
    return engine.adoptions.get(str(row["adoption_id"])) if row else None


def _safe_plan(plan: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not plan:
        return None
    steps = plan.get("steps") if isinstance(plan.get("steps"), list) else []
    return {
        key: plan.get(key) for key in (
            "replay_plan_id", "schema_version", "experiment_id", "draft_version",
            "base_manifest_digest", "plan_digest", "policy_version", "replay_mode",
            "approval_requirement", "created_at", "expires_at", "stale", "stale_reasons",
            "executable", "estimated_impact",
        )
    } | {
        "step_summary": [{
            "kind": step.get("kind"), "decision": step.get("decision"),
            "classification": step.get("classification"),
            "comparison_required": bool(step.get("comparison_required", False)),
            "reason_code": step.get("reason_code"),
        } for step in steps if isinstance(step, Mapping)],
        "blocker_codes": [item.get("code") for item in plan.get("blockers", []) if isinstance(item, Mapping)],
        "risk_codes": [item.get("code") for item in plan.get("risks", []) if isinstance(item, Mapping)],
    }


def _safe_comparison(comparison: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not comparison:
        return None
    outcome = comparison.get("outcome") if isinstance(comparison.get("outcome"), Mapping) else {}
    return {
        key: comparison.get(key) for key in (
            "comparison_id", "schema_version", "baseline_run_id", "candidate_run_id",
            "source_digest", "comparison_digest", "created_at", "incomplete",
        )
    } | {
        "outcome": {key: outcome.get(key) for key in ("baseline_status", "candidate_status", "status_changed")},
        "usage": comparison.get("usage"),
        "attribution": comparison.get("attribution"),
        "step_count": len(comparison.get("steps", [])),
        "files": _safe_fact_list(comparison.get("files")),
        "artifacts": _safe_fact_list(comparison.get("artifacts")),
    }


def _safe_fact_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [{
        "identity_digest": _identity_digest(item.get("identity")),
        "change": item.get("change"),
        "baseline_digest": (item.get("baseline") or {}).get("digest") if isinstance(item.get("baseline"), Mapping) else None,
        "candidate_digest": (item.get("candidate") or {}).get("digest") if isinstance(item.get("candidate"), Mapping) else None,
    } for item in value if isinstance(item, Mapping)]


def _safe_adoption(adoption: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not adoption:
        return None
    receipt = adoption.get("receipt") if isinstance(adoption.get("receipt"), Mapping) else {}
    return {
        key: adoption.get(key) for key in (
            "adoption_id", "schema_version", "comparison_id", "preview_digest", "status",
            "created_at", "updated_at",
        )
    } | {
        "selected_count": len(adoption.get("selected_paths", [])),
        "receipt": {
            key: receipt.get(key) for key in (
                "audit_event", "selected_count", "cleanup_requested", "worktree_status",
            ) if key in receipt
        },
    }
