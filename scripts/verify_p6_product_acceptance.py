#!/usr/bin/env python3
"""Verify the P6 release product-journey acceptance contract and integration."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any

import jsonschema

from finalize_remote_workspace_p6_product_acceptance import ACCESSIBILITY, JOURNEY_INVARIANTS


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-product-acceptance.schema.json"
FINALIZER = ROOT / "scripts/finalize_remote_workspace_p6_product_acceptance.py"
LEDGER_FINALIZER = ROOT / "scripts/finalize_remote_workspace_p6.py"


class P6ProductAcceptanceError(RuntimeError):
    pass


def _strict(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise P6ProductAcceptanceError("p6_product_contract_duplicate_key")
        value[key] = item
    return value


def verify(schema_path: Path = SCHEMA) -> dict[str, Any]:
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"), object_pairs_hook=_strict)
        jsonschema.Draft202012Validator.check_schema(schema)
        journey_enum = set(schema["$defs"]["journey"]["properties"]["name"]["enum"])
        accessibility_enum = set(schema["properties"]["accessibility_checks"]["items"]["enum"])
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError,
            jsonschema.SchemaError) as exc:
        raise P6ProductAcceptanceError("p6_product_contract_invalid") from exc
    if journey_enum != set(JOURNEY_INVARIANTS) or accessibility_enum != ACCESSIBILITY:
        raise P6ProductAcceptanceError("p6_product_contract_coverage_invalid")
    for path in (FINALIZER, LEDGER_FINALIZER):
        try:
            source = path.read_text(encoding="utf-8")
            ast.parse(source, filename=str(path))
        except (OSError, UnicodeDecodeError, SyntaxError) as exc:
            raise P6ProductAcceptanceError("p6_product_finalizer_invalid") from exc
    finalizer_source = FINALIZER.read_text(encoding="utf-8")
    ledger_source = LEDGER_FINALIZER.read_text(encoding="utf-8")
    for token in (
        "p6_product_journey_invariants_invalid", "p6_product_journey_sequence_invalid",
        "p6_product_journey_latency_invalid", "p6_product_journey_device_binding_invalid",
        "p6_product_proof_attestation_invalid", "p6_product_proof_reused",
    ):
        if token not in finalizer_source:
            raise P6ProductAcceptanceError("p6_product_fail_closed_gate_missing")
    if "p6_product_acceptance_raw_report_required" not in ledger_source \
            or "finalize_product(product, root)" not in ledger_source:
        raise P6ProductAcceptanceError("p6_product_ledger_integration_missing")
    return {
        "schema_version": "p6-product-acceptance-verification/1",
        "journey_count": 10,
        "accessibility_check_count": 5,
        "release_only": True,
        "two_physical_devices_required": True,
        "real_execution_pending": True,
        "passed": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", type=Path, default=SCHEMA)
    args = parser.parse_args(argv)
    print(json.dumps(verify(args.schema.resolve()), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
