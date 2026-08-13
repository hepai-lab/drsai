#!/usr/bin/env python3
"""Verify the P6 two-device, five-boundary, one-hour stability gate."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any

import jsonschema

from finalize_remote_workspace_stability_p6 import BOUNDARIES, FAULTS


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-stability.schema.json"
FINALIZER = ROOT / "scripts/finalize_remote_workspace_stability_p6.py"
ASSEMBLER = ROOT / "scripts/assemble_remote_workspace_stability_p6.py"
LEDGER_FINALIZER = ROOT / "scripts/finalize_remote_workspace_p6.py"


class P6StabilityVerifierError(RuntimeError):
    pass


def _strict(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise P6StabilityVerifierError("p6_stability_contract_duplicate_key")
        value[key] = item
    return value


def verify(schema_path: Path = SCHEMA) -> dict[str, Any]:
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"), object_pairs_hook=_strict)
        jsonschema.Draft202012Validator.check_schema(schema)
        boundary_enum = set(schema["$defs"]["boundary"]["properties"]["name"]["enum"])
        fault_enum = set(schema["$defs"]["fault"]["properties"]["name"]["enum"])
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError,
            jsonschema.SchemaError) as exc:
        raise P6StabilityVerifierError("p6_stability_contract_invalid") from exc
    if boundary_enum != BOUNDARIES or fault_enum != FAULTS:
        raise P6StabilityVerifierError("p6_stability_contract_coverage_invalid")
    for path in (ASSEMBLER, FINALIZER, LEDGER_FINALIZER):
        source = path.read_text(encoding="utf-8")
        ast.parse(source, filename=str(path))
    finalizer_source = FINALIZER.read_text(encoding="utf-8")
    ledger_source = LEDGER_FINALIZER.read_text(encoding="utf-8")
    for token in (
        "p6_stability_device_binding_invalid", "p6_stability_transcript_or_sequence_mismatch",
        "p6_stability_fault_coverage_invalid", "p6_stability_proof_attestation_invalid",
        "p6_stability_proof_reused",
    ):
        if token not in finalizer_source:
            raise P6StabilityVerifierError("p6_stability_fail_closed_gate_missing")
    if "p6_stability_raw_report_required" not in ledger_source \
            or "finalize_stability(stability, root)" not in ledger_source:
        raise P6StabilityVerifierError("p6_stability_ledger_integration_missing")
    assembler_source = ASSEMBLER.read_text(encoding="utf-8")
    if '"p6-stability-boundary/1"' not in assembler_source \
            or '"p6-stability-fault/1"' not in assembler_source \
            or "_path(root, raw_path)" not in assembler_source:
        raise P6StabilityVerifierError("p6_stability_assembler_missing")
    return {"schema_version": "p6-two-device-stability-verification/1",
            "required_duration_seconds": 3600, "boundary_count": 5, "fault_count": 5,
            "physical_device_count": 2, "release_only": True,
            "real_execution_pending": True, "passed": True}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", type=Path, default=SCHEMA)
    args = parser.parse_args(argv)
    print(json.dumps(verify(args.schema.resolve()), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
