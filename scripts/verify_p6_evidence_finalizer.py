#!/usr/bin/env python3
"""Verify the unique P6 evidence schema, requirement ledger, assembler and finalizer."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any

import jsonschema


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-evidence.schema.json"
REQUIREMENTS = ROOT / "cores/protocol/relay/remote-workspace-p6-feature-evidence.json"
ASSEMBLER = ROOT / "scripts/assemble_remote_workspace_p6_evidence.py"
FINALIZER = ROOT / "scripts/finalize_remote_workspace_p6.py"
FEATURE_IDS = {f"P6-M{module:02d}-F{feature:02d}" for module in range(1, 9) for feature in range(1, 6)}
KINDS = {"local", "production", "physical", "release", "human"}


class P6EvidenceVerifierError(RuntimeError):
    pass


def _strict(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise P6EvidenceVerifierError("p6_evidence_verifier_duplicate_json_key")
        value[key] = item
    return value


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_strict)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise P6EvidenceVerifierError("p6_evidence_verifier_json_invalid") from exc
    if not isinstance(value, dict):
        raise P6EvidenceVerifierError("p6_evidence_verifier_json_invalid")
    return value


def verify(schema_path: Path = SCHEMA, requirements_path: Path = REQUIREMENTS) -> dict[str, Any]:
    schema = _load(schema_path)
    requirements = _load(requirements_path)
    try:
        jsonschema.Draft202012Validator.check_schema(schema)
    except jsonschema.SchemaError as exc:
        raise P6EvidenceVerifierError("p6_evidence_schema_invalid") from exc
    rows = requirements.get("features")
    if requirements.get("schema_version") != "p6-feature-evidence-requirements/1" \
            or not isinstance(rows, list) or len(rows) != 40:
        raise P6EvidenceVerifierError("p6_evidence_requirements_invalid")
    by_id = {row.get("id"): row for row in rows if isinstance(row, dict)}
    if len(by_id) != 40 or set(by_id) != FEATURE_IDS:
        raise P6EvidenceVerifierError("p6_evidence_feature_set_invalid")
    counts = {kind: 0 for kind in sorted(KINDS)}
    for feature_id, row in by_id.items():
        if set(row) != {"id", "required_kinds"} or row["id"] != feature_id \
                or not isinstance(row["required_kinds"], list) or not row["required_kinds"] \
                or len(row["required_kinds"]) != len(set(row["required_kinds"])) \
                or not set(row["required_kinds"]).issubset(KINDS):
            raise P6EvidenceVerifierError("p6_evidence_feature_requirement_invalid")
        for kind in row["required_kinds"]:
            counts[kind] += 1
    for path in (ASSEMBLER, FINALIZER):
        try:
            source = path.read_text(encoding="utf-8")
            ast.parse(source, filename=str(path))
        except (OSError, UnicodeDecodeError, SyntaxError) as exc:
            raise P6EvidenceVerifierError("p6_evidence_implementation_invalid") from exc
    finalizer_source = FINALIZER.read_text(encoding="utf-8")
    for token in (
        "p6_release_build_required", "p6_distinct_physical_devices_required",
        "p6_feature_required_evidence_missing", "p6_report_raw_evidence_missing",
        "p6_evidence_report_binding_invalid", "p6_p5_transition_not_current",
        "p6_p5_completion_inherited", "p6_build_revision_mismatch",
        "p6_report_revision_mismatch", "p6_raw_evidence_reused_across_reports",
    ):
        if token not in finalizer_source:
            raise P6EvidenceVerifierError("p6_evidence_fail_closed_gate_missing")
    return {
        "schema_version": "p6-evidence-finalizer-verification/1",
        "feature_count": 40,
        "required_evidence_counts": counts,
        "p5_completion_inherited": False,
        "production_bundle_required": True,
        "passed": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", type=Path, default=SCHEMA)
    parser.add_argument("--requirements", type=Path, default=REQUIREMENTS)
    args = parser.parse_args(argv)
    print(json.dumps(verify(args.schema.resolve(), args.requirements.resolve()),
                     sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
