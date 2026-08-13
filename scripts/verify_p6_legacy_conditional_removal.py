#!/usr/bin/env python3
"""Verify that Legacy removal is conditional, immediate, and fail closed."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any

import jsonschema


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "cores/protocol/relay/p5-platform-adapter.contract.json"
INVENTORY = ROOT / "cores/protocol/relay/remote-workspace-legacy-inventory.json"
COMPATIBILITY = ROOT / "cores/python/packages/drsai/src/drsai/oaep/compatibility.py"
USAGE = ROOT / "cores/python/packages/drsai/src/drsai/oaep/usage.py"
REGISTRY = ROOT / "cores/python/packages/drsai/src/drsai/relay/registry.py"
API = ROOT / "cores/python/packages/drsai/src/drsai/relay/api.py"
FINALIZER = ROOT / "scripts/finalize_remote_workspace_p5.py"
CHECKER = ROOT / "scripts/check-oaep-legacy-removal.py"


class LegacyConditionalRemovalError(RuntimeError):
    pass


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise LegacyConditionalRemovalError("p6_legacy_removal_duplicate_json_key")
        result[key] = value
    return result


def _json(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LegacyConditionalRemovalError(code) from exc
    if not isinstance(value, dict):
        raise LegacyConditionalRemovalError(code)
    return value


def _python(path: Path) -> str:
    try:
        source = path.read_text(encoding="utf-8")
        ast.parse(source, filename=str(path))
        return source
    except (OSError, UnicodeDecodeError, SyntaxError) as exc:
        raise LegacyConditionalRemovalError("p6_legacy_removal_python_invalid") from exc


def verify(
    *, contract_path: Path = CONTRACT, inventory_path: Path = INVENTORY,
) -> dict[str, Any]:
    contract = _json(contract_path, "p6_legacy_removal_contract_invalid")
    inventory = _json(inventory_path, "p6_legacy_removal_inventory_invalid")
    try:
        schema = contract["$defs"]["protocol_deletion_decision"]
        jsonschema.Draft202012Validator.check_schema(schema)
    except (KeyError, TypeError, jsonschema.SchemaError) as exc:
        raise LegacyConditionalRemovalError("p6_legacy_removal_contract_invalid") from exc
    validator = jsonschema.Draft202012Validator(schema)
    requirements = {
        "observation_days": 0,
        "release_cycles": 0,
        "oaep_ratio": 0.999,
        "legacy_ratio": 0.001,
        "migration_ratio": 1.0,
        "fallback_error_ratio": 0.001,
        "supported_runtime_requires_legacy": False,
    }
    eligible = {
        "schema_version": "p5-protocol-deletion-decision/1",
        "status": "eligible",
        "data_start": "2026-08-12",
        "data_end": "2026-08-12",
        "observation_days": 1,
        "release_cycles": 0,
        "oaep_ratio": 0.999,
        "legacy_ratio": 0.0009,
        "migration_ratio": 1.0,
        "fallback_error_ratio": 0.001,
        "gap_days": 0,
        "supported_runtime_count": 1,
        "supported_runtime_requires_legacy": False,
        "requirements": requirements,
        "eligible": True,
    }
    if list(validator.iter_errors(eligible)):
        raise LegacyConditionalRemovalError("p6_legacy_removal_eligible_contract_invalid")
    blocked_variants = (
        {**eligible, "supported_runtime_requires_legacy": True},
        {**eligible, "supported_runtime_count": 0,
         "supported_runtime_requires_legacy": None},
        {**eligible, "legacy_ratio": 0.001},
        {**eligible, "migration_ratio": 0.999},
        {**eligible, "fallback_error_ratio": 0.0011},
    )
    if any(not list(validator.iter_errors(value)) for value in blocked_variants):
        raise LegacyConditionalRemovalError("p6_legacy_removal_contract_not_fail_closed")

    policy = inventory.get("policy")
    if not isinstance(policy, dict) or set(policy.get("delete_only_when", [])) != {
        "oaep_client_ratio>=0.999", "migration_ratio=1",
        "legacy_request_ratio<0.001", "fallback_error_rate<=0.001",
        "supported_runtime_requires_legacy=false", "rollback_artifact_verified=true",
        "transcript_hash_preserved=true", "database_migration_verified=true",
    }:
        raise LegacyConditionalRemovalError("p6_legacy_removal_inventory_policy_invalid")
    if policy.get("long_observation_window_required") is not False:
        raise LegacyConditionalRemovalError("p6_legacy_removal_wait_window_reintroduced")

    sources = {
        "compatibility": _python(COMPATIBILITY),
        "usage": _python(USAGE),
        "registry": _python(REGISTRY),
        "api": _python(API),
        "finalizer": _python(FINALIZER),
        "checker": _python(CHECKER),
    }
    required_fragments = {
        "compatibility": ("supported_runtimes_are_oaep_capable", "supported_runtime_requires_legacy"),
        "usage": ("runtime_compatibility_unknown", "supported_runtime_requires_legacy"),
        "registry": ("supported_runtime_capability_summary", "not runtime.revoked", "issubset"),
        "api": ("supported_runtime_capability_summary(OAEP_REQUIRED)", "supported_runtime_count >= 1"),
        "finalizer": ("supported_runtime_requires_legacy", "supported_runtime_count"),
        "checker": ("validate_rollback_artifact", "migration_transcript_before_sha256"),
    }
    for name, fragments in required_fragments.items():
        if any(fragment not in sources[name] for fragment in fragments):
            raise LegacyConditionalRemovalError(f"p6_legacy_removal_{name}_gate_missing")

    return {
        "schema_version": "p6-legacy-conditional-removal-report/1",
        "checks": {
            "instant_thresholds_without_wait_window": True,
            "supported_runtime_registry_gate": True,
            "unknown_runtime_compatibility_fails_closed": True,
            "migration_and_rollback_bound": True,
            "finalizer_rechecks_decision": True,
            "contract_negative_matrix": len(blocked_variants),
        },
        "legacy_deleted": False,
        "production_evidence_required": True,
        "passed": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", type=Path, default=CONTRACT)
    parser.add_argument("--inventory", type=Path, default=INVENTORY)
    args = parser.parse_args(argv)
    print(json.dumps(verify(contract_path=args.contract.resolve(), inventory_path=args.inventory.resolve()),
                     sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
