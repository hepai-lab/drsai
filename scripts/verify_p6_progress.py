#!/usr/bin/env python3
"""Verify the authoritative P6 feature progress ledger and document summary."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

import jsonschema


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-progress.schema.json"
LEDGER = ROOT / "cores/protocol/relay/remote-workspace-p6-progress.json"
REQUIREMENTS = ROOT / "cores/protocol/relay/remote-workspace-p6-feature-evidence.json"
PLAN = ROOT / "docs/remote_workespace/OpenDrSai移动远程工作区P6生产一致性与用户体验开发方案.md"
FEATURE_IDS = {f"P6-M{module:02d}-F{feature:02d}" for module in range(1, 9) for feature in range(1, 6)}
KINDS = {"local", "production", "physical", "release", "human"}
STATES = {"not_started", "code_complete", "local_pass", "physical_pass", "release_pass"}
PENDING_BLOCKERS = {
    "local": "local_evidence_pending",
    "physical": "physical_device_evidence_pending",
    "production": "production_evidence_pending",
    "release": "release_build_evidence_pending",
    "human": "human_acceptance_pending",
}


class P6ProgressError(RuntimeError):
    pass


def _strict(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise P6ProgressError("p6_progress_duplicate_json_key")
        value[key] = item
    return value


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_strict)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise P6ProgressError("p6_progress_json_invalid") from exc
    if not isinstance(value, dict):
        raise P6ProgressError("p6_progress_json_invalid")
    return value


def verify(
    schema_path: Path = SCHEMA,
    ledger_path: Path = LEDGER,
    requirements_path: Path = REQUIREMENTS,
    plan_path: Path = PLAN,
) -> dict[str, Any]:
    schema = _load(schema_path)
    ledger = _load(ledger_path)
    requirements = _load(requirements_path)
    try:
        jsonschema.Draft202012Validator.check_schema(schema)
        jsonschema.Draft202012Validator(schema).validate(ledger)
    except (jsonschema.SchemaError, jsonschema.ValidationError) as exc:
        raise P6ProgressError("p6_progress_schema_validation_failed") from exc

    requirement_rows = requirements.get("features")
    if not isinstance(requirement_rows, list):
        raise P6ProgressError("p6_progress_requirements_invalid")
    required_by_id = {
        row.get("id"): row.get("required_kinds")
        for row in requirement_rows
        if isinstance(row, dict)
    }
    if set(required_by_id) != FEATURE_IDS or len(requirement_rows) != 40:
        raise P6ProgressError("p6_progress_requirements_invalid")

    rows = ledger["features"]
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != 40 or set(by_id) != FEATURE_IDS:
        raise P6ProgressError("p6_progress_feature_set_invalid")

    complete = 0
    blocker_counts: dict[str, int] = {}
    for feature_id in sorted(FEATURE_IDS):
        row = by_id[feature_id]
        required = row["required_kinds"]
        verified = row["verified_kinds"]
        pending = row["pending_kinds"]
        if row["verification_state"] not in STATES:
            raise P6ProgressError("p6_progress_state_invalid")
        if required != required_by_id[feature_id]:
            raise P6ProgressError("p6_progress_requirement_drift")
        if not set(verified).issubset(KINDS) or set(verified) | set(pending) != set(required) \
                or set(verified) & set(pending):
            raise P6ProgressError("p6_progress_evidence_partition_invalid")
        if row["completed"] != (not pending):
            raise P6ProgressError("p6_progress_completion_invalid")
        if pending and not row["blockers"]:
            raise P6ProgressError("p6_progress_blocker_missing")
        if not pending and row["blockers"]:
            raise P6ProgressError("p6_progress_completed_has_blocker")
        expected_blockers = {PENDING_BLOCKERS[kind] for kind in pending}
        actual_blockers = set(row["blockers"])
        if actual_blockers != expected_blockers:
            raise P6ProgressError("p6_progress_blocker_evidence_mismatch")
        if row["verification_state"] in {"local_pass", "physical_pass", "release_pass"} \
                and "local" not in verified:
            raise P6ProgressError("p6_progress_state_evidence_invalid")
        if row["verification_state"] in {"physical_pass", "release_pass"} \
                and "physical" in required and "physical" not in verified:
            raise P6ProgressError("p6_progress_state_evidence_invalid")
        if row["verification_state"] == "release_pass" \
                and "release" in required and "release" not in verified:
            raise P6ProgressError("p6_progress_state_evidence_invalid")
        expected_state = (
            "release_pass" if "release" in verified
            else "physical_pass" if "physical" in verified
            else "local_pass" if "local" in verified
            else "code_complete" if verified
            else "not_started"
        )
        if row["verification_state"] != expected_state:
            raise P6ProgressError("p6_progress_state_summary_invalid")
        complete += int(row["completed"])
        for blocker in row["blockers"]:
            blocker_counts[blocker] = blocker_counts.get(blocker, 0) + 1

    percent = round(complete * 100 / 40, 2)
    if ledger["feature_count"] != 40 or ledger["completed_count"] != complete \
            or ledger["progress_percent"] != percent:
        raise P6ProgressError("p6_progress_summary_invalid")

    try:
        plan = plan_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise P6ProgressError("p6_progress_plan_invalid") from exc
    expected = f"当前完成 **{complete}/40（{percent:.2f}%）**"
    if expected not in plan:
        raise P6ProgressError("p6_progress_plan_summary_drift")
    if "P6 共 **8 个模块、40 个功能点**" not in plan:
        raise P6ProgressError("p6_progress_plan_scope_drift")

    return {
        "schema_version": "p6-progress-verification/1",
        "updated_round": ledger["updated_round"],
        "feature_count": 40,
        "completed_count": complete,
        "progress_percent": percent,
        "pending_count": 40 - complete,
        "blocker_counts": dict(sorted(blocker_counts.items())),
        "ledger_sha256": hashlib.sha256(ledger_path.read_bytes()).hexdigest().upper(),
        "passed": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", type=Path, default=SCHEMA)
    parser.add_argument("--ledger", type=Path, default=LEDGER)
    parser.add_argument("--requirements", type=Path, default=REQUIREMENTS)
    parser.add_argument("--plan", type=Path, default=PLAN)
    args = parser.parse_args(argv)
    print(json.dumps(
        verify(args.schema.resolve(), args.ledger.resolve(), args.requirements.resolve(), args.plan.resolve()),
        sort_keys=True,
        separators=(",", ":"),
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
