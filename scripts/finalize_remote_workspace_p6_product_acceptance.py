#!/usr/bin/env python3
"""Validate P6 manual product journeys without trusting checkbox summaries."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
from typing import Any

import jsonschema

from finalize_remote_workspace_p6 import P6EvidenceError, _path, load_json


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-product-acceptance.schema.json"
JOURNEY_INVARIANTS = {
    "pair_by_qr": {"single_use_grant", "permission_scope_visible", "host_visible"},
    "browse_host_workspace_catalog": {"host_workspace_catalog_consistent", "no_path_exposed"},
    "browse_session_catalog": {"session_catalog_consistent", "archive_projection_consistent"},
    "bidirectional_message": {"windows_to_android_realtime", "android_to_windows_realtime", "source_message_exactly_once"},
    "model_stream_and_tool_activity": {"model_delta_realtime", "tool_state_realtime", "terminal_state_visible"},
    "approval_decision": {"risk_visible", "decision_exactly_once", "both_ends_consistent"},
    "cancel_and_retry": {"cancel_exactly_once", "retry_same_key_safe", "terminal_state_visible"},
    "offline_network_recovery": {"offline_state_actionable", "cursor_resume_no_gap", "no_busy_loop"},
    "runtime_relay_restart_recovery": {"runtime_reconnect", "relay_reconnect", "transcript_preserved"},
    "targeted_device_revoke": {"target_denied_immediately", "other_device_unaffected", "existing_stream_closed"},
}
ACCESSIBILITY = {"talkback_order", "dynamic_text_200_percent", "touch_target_48dp", "keyboard_focus", "actionable_error_state"}
SEQUENCED = {
    "browse_session_catalog", "bidirectional_message", "model_stream_and_tool_activity",
    "approval_decision", "cancel_and_retry", "offline_network_recovery",
    "runtime_relay_restart_recovery", "targeted_device_revoke",
}


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise P6EvidenceError("p6_product_timestamp_invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise P6EvidenceError("p6_product_timestamp_invalid") from exc
    if parsed.tzinfo is None:
        raise P6EvidenceError("p6_product_timestamp_timezone_required")
    return parsed


def _attest(root: Path, ref: dict[str, Any]) -> str:
    path = _path(root, ref.get("artifact"))
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if not raw or ref.get("bytes") != len(raw) or ref.get("sha256") != digest:
        raise P6EvidenceError("p6_product_proof_attestation_invalid")
    return digest


def finalize(value: object, artifact_root: Path) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return {"schema_version": "p6-product-finalization/1", "status": "failed",
                "journeys": 0, "errors": ["p6_product_report_malformed"]}
    try:
        schema = load_json(SCHEMA, "p6_product_schema_invalid")
        try:
            jsonschema.Draft202012Validator(
                schema, format_checker=jsonschema.FormatChecker()
            ).validate(value)
        except (jsonschema.SchemaError, jsonschema.ValidationError) as exc:
            raise P6EvidenceError("p6_product_schema_validation_failed") from exc
        journeys = value["journeys"]
        indexed = {row["name"]: row for row in journeys}
        if len(indexed) != 10 or set(indexed) != set(JOURNEY_INVARIANTS):
            raise P6EvidenceError("p6_product_journey_set_invalid")
        root_proofs = set(value["device_proof_sha256s"])
        observed_proofs: set[str] = set()
        proof_digests: set[str] = set()
        for name, row in indexed.items():
            if set(row["invariants"]) != JOURNEY_INVARIANTS[name]:
                raise P6EvidenceError("p6_product_journey_invariants_invalid")
            started, completed = _timestamp(row["started_at"]), _timestamp(row["completed_at"])
            elapsed = int((completed - started).total_seconds() * 1000)
            if completed < started or abs(elapsed - row["elapsed_ms"]) > 1 \
                    or row["elapsed_ms"] > row["threshold_ms"]:
                raise P6EvidenceError("p6_product_journey_latency_invalid")
            sequence_start, sequence_end = row["sequence_start"], row["sequence_end"]
            if name in SEQUENCED:
                if not isinstance(sequence_start, int) or isinstance(sequence_start, bool) \
                        or not isinstance(sequence_end, int) or isinstance(sequence_end, bool) \
                        or sequence_end <= sequence_start:
                    raise P6EvidenceError("p6_product_journey_sequence_invalid")
            elif sequence_start is not None or sequence_end is not None:
                raise P6EvidenceError("p6_product_journey_sequence_invalid")
            proofs = set(row["device_proof_sha256s"])
            if not proofs.issubset(root_proofs) or (name == "targeted_device_revoke" and proofs != root_proofs):
                raise P6EvidenceError("p6_product_journey_device_binding_invalid")
            observed_proofs.update(proofs)
            for ref in row["proof_artifacts"]:
                digest = _attest(artifact_root, ref)
                if digest in proof_digests:
                    raise P6EvidenceError("p6_product_proof_reused")
                proof_digests.add(digest)
        if observed_proofs != root_proofs:
            raise P6EvidenceError("p6_product_two_device_coverage_invalid")
        if set(value["accessibility_checks"]) != ACCESSIBILITY:
            raise P6EvidenceError("p6_product_accessibility_incomplete")
    except (KeyError, TypeError, P6EvidenceError) as exc:
        errors.append(str(exc) or "p6_product_report_invalid")
    return {"schema_version": "p6-product-finalization/1",
            "status": "passed" if not errors else "failed",
            "journeys": 10 if not errors else 0, "errors": sorted(set(errors))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--artifact-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = finalize(load_json(args.report.resolve(), "p6_product_report_malformed"),
                          args.artifact_root.resolve())
    except P6EvidenceError as exc:
        result = {"schema_version": "p6-product-finalization/1", "status": "failed",
                  "journeys": 0, "errors": [str(exc)]}
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
