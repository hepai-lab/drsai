#!/usr/bin/env python3
"""Fail-closed P5 pending-evidence to P6 ownership verifier."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "cores/protocol/relay/remote-workspace-p5-to-p6-migration.json"
P5_FEATURES = {
    f"P5-M{module:02d}-F{feature:02d}"
    for module in range(1, 9) for feature in range(1, 7)
}
P6_FEATURES = {
    f"P6-M{module:02d}-F{feature:02d}"
    for module in range(1, 9) for feature in range(1, 6)
}
EVIDENCE_KINDS = {"local", "production", "physical", "release", "human"}
REASON = re.compile(r"[a-z][a-z0-9_]{7,127}")


class P5TransitionError(RuntimeError):
    pass


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise P5TransitionError("p6_p5_transition_manifest_duplicate_key")
        value[key] = item
    return value


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as failure:
        raise P5TransitionError("p6_p5_transition_manifest_invalid") from failure
    if not isinstance(value, dict):
        raise P5TransitionError("p6_p5_transition_manifest_invalid")
    return value


def verify(path: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    value = _load(path)
    if set(value) != {
        "schema_version", "source", "policy", "completed_p5_features",
        "pending_mappings",
    } or value.get("schema_version") != "p5-to-p6-migration/1":
        raise P5TransitionError("p6_p5_transition_shape_invalid")
    source = value.get("source")
    if not isinstance(source, dict) or set(source) != {
        "document", "feature_count", "completed_count", "pending_count",
    }:
        raise P5TransitionError("p6_p5_transition_source_invalid")
    document = (ROOT / str(source["document"])).resolve()
    if ROOT not in document.parents or not document.is_file():
        raise P5TransitionError("p6_p5_transition_source_missing")
    source_text = document.read_text(encoding="utf-8")
    documented_features = set(re.findall(r"\|\s*(P5-M0[1-8]-F0[1-6])\s*\|", source_text))
    current_progress = re.search(
        r"当前完成\s*\*\*(\d+)/48（[0-9.]+%）\*\*", source_text,
    )
    if (
        documented_features != P5_FEATURES
        or current_progress is None
        or int(current_progress.group(1)) != 33
    ):
        raise P5TransitionError("p6_p5_transition_source_drift")
    if source != {
        "document": source["document"],
        "feature_count": 48, "completed_count": 33, "pending_count": 15,
    }:
        raise P5TransitionError("p6_p5_transition_source_counts_invalid")

    policy = value.get("policy")
    if policy != {
        "inherit_completion": False,
        "carry_pending_evidence": True,
        "one_owner_per_pending_feature": True,
    }:
        raise P5TransitionError("p6_p5_transition_policy_invalid")
    completed = value.get("completed_p5_features")
    mappings = value.get("pending_mappings")
    if (
        not isinstance(completed, list) or len(completed) != 33
        or len(set(completed)) != len(completed)
        or not isinstance(mappings, list) or len(mappings) != 15
    ):
        raise P5TransitionError("p6_p5_transition_partition_invalid")
    completed_set = set(completed)
    pending_ids: list[str] = []
    owners: set[str] = set()
    evidence_totals = {kind: 0 for kind in sorted(EVIDENCE_KINDS)}
    for row in mappings:
        if not isinstance(row, dict) or not set(row).issubset({
            "p5_feature_id", "p6_owner", "p6_dependencies",
            "required_evidence", "reason",
        }) or not {"p5_feature_id", "p6_owner", "required_evidence", "reason"} <= set(row):
            raise P5TransitionError("p6_p5_transition_mapping_shape_invalid")
        legacy = row["p5_feature_id"]
        owner = row["p6_owner"]
        dependencies = row.get("p6_dependencies", [])
        evidence = row["required_evidence"]
        if (
            legacy not in P5_FEATURES or owner not in P6_FEATURES
            or not isinstance(dependencies, list) or len(dependencies) != len(set(dependencies))
            or any(item not in P6_FEATURES or item == owner for item in dependencies)
            or not isinstance(evidence, list) or not evidence
            or len(evidence) != len(set(evidence)) or any(item not in EVIDENCE_KINDS for item in evidence)
            or not isinstance(row["reason"], str) or REASON.fullmatch(row["reason"]) is None
        ):
            raise P5TransitionError("p6_p5_transition_mapping_invalid")
        pending_ids.append(legacy)
        owners.add(owner)
        for kind in evidence:
            evidence_totals[kind] += 1
    pending_set = set(pending_ids)
    if len(pending_ids) != len(pending_set) or completed_set & pending_set:
        raise P5TransitionError("p6_p5_transition_duplicate_or_overlap")
    if completed_set | pending_set != P5_FEATURES:
        raise P5TransitionError("p6_p5_transition_feature_set_incomplete")

    return {
        "schema_version": "p5-to-p6-transition-report/1",
        "source_feature_count": 48,
        "completed_p5_feature_count": 33,
        "pending_p5_feature_count": 15,
        "mapped_p6_owner_count": len(owners),
        "required_evidence_counts": evidence_totals,
        "completion_inherited": False,
        "pending_evidence_carried": True,
        "passed": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args(argv)
    print(json.dumps(verify(args.manifest.resolve()), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
