#!/usr/bin/env python3
"""Fail-closed finalizer for the unique P6 remote-workspace evidence ledger."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

import jsonschema


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-evidence.schema.json"
TRANSITION = ROOT / "cores/protocol/relay/remote-workspace-p5-to-p6-migration.json"
REQUIREMENTS = ROOT / "cores/protocol/relay/remote-workspace-p6-feature-evidence.json"
FEATURE_IDS = {
    f"P6-M{module:02d}-F{feature:02d}"
    for module in range(1, 9) for feature in range(1, 6)
}
BUILD_IDENTITIES = {
    "android": "ai.drsai.remote",
    "windows": "OpenDrSaiDesktop",
    "relay": "opendrsai-runtime-relay",
}
EVIDENCE_KINDS = {"local", "production", "physical", "release", "human"}
DIGEST = re.compile(r"[0-9a-f]{64}")


class P6EvidenceError(RuntimeError):
    pass


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise P6EvidenceError("p6_duplicate_json_key")
        value[key] = item
    return value


def load_json(path: Path, code: str = "p6_evidence_malformed") -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise P6EvidenceError(code) from exc
    if not isinstance(value, dict):
        raise P6EvidenceError(code)
    return value


def _path(root: Path, relative: object) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise P6EvidenceError("p6_artifact_path_invalid")
    candidate = (root / relative).resolve()
    resolved = root.resolve()
    if resolved not in candidate.parents or not candidate.is_file():
        raise P6EvidenceError("p6_artifact_missing")
    return candidate


def _attest(root: Path, row: dict[str, Any], prefix: str = "") -> bytes:
    path = _path(root, row.get("artifact"))
    raw = path.read_bytes()
    if not raw or row.get("bytes") != len(raw) or row.get("sha256") != hashlib.sha256(raw).hexdigest():
        raise P6EvidenceError(f"p6_{prefix}artifact_attestation_invalid")
    return raw


def _report(root: Path, ref: dict[str, Any], expected_type: str | None = None) -> dict[str, Any]:
    raw = _attest(root, ref, "report_")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise P6EvidenceError("p6_report_json_invalid") from exc
    if not isinstance(value, dict) or value.get("schema_version") != "p6-evidence-report/1" \
            or value.get("passed") is not True:
        raise P6EvidenceError("p6_report_shape_invalid")
    if expected_type is not None and value.get("report_type") != expected_type:
        raise P6EvidenceError("p6_report_type_mismatch")
    allowed = {
        "schema_version", "report_type", "evidence_id", "kind", "environment_id",
        "source_revision",
        "feature_ids", "build_sha256s", "physical_device_proof_sha256s",
        "checks", "raw_artifacts", "passed",
    }
    if set(value) != allowed:
        raise P6EvidenceError("p6_report_fields_invalid")
    checks = value.get("checks")
    if not isinstance(checks, list) or not checks or any(
        not isinstance(check, dict) or set(check) != {"id", "passed"}
        or not isinstance(check.get("id"), str) or not check["id"]
        or check.get("passed") is not True for check in checks
    ):
        raise P6EvidenceError("p6_report_checks_invalid")
    raw_refs = value.get("raw_artifacts")
    if not isinstance(raw_refs, list) or not raw_refs:
        raise P6EvidenceError("p6_report_raw_evidence_missing")
    seen: set[str] = set()
    for raw_ref in raw_refs:
        if not isinstance(raw_ref, dict) or set(raw_ref) != {"artifact", "bytes", "sha256"}:
            raise P6EvidenceError("p6_report_raw_evidence_invalid")
        _attest(root, raw_ref, "raw_")
        if raw_ref["sha256"] in seen or raw_ref["sha256"] == ref.get("sha256"):
            raise P6EvidenceError("p6_report_raw_evidence_duplicate")
        seen.add(raw_ref["sha256"])
    return value


def _validate_specialized_report(root: Path, report: dict[str, Any]) -> None:
    """Validate feature-specific authoritative raw reports, not only their digests."""
    if report.get("report_type") != "feature":
        return
    features = set(report.get("feature_ids", []))
    if report.get("kind") == "human" and "P6-M08-F05" in features:
        from finalize_remote_workspace_p6_product_acceptance import finalize as finalize_product

        candidates: list[dict[str, Any]] = []
        for ref in report["raw_artifacts"]:
            try:
                value = load_json(_path(root, ref["artifact"]), "p6_product_report_malformed")
            except P6EvidenceError:
                continue
            if value.get("schema_version") == "p6-product-acceptance/1":
                candidates.append(value)
        if len(candidates) != 1:
            raise P6EvidenceError("p6_product_acceptance_raw_report_required")
        product = candidates[0]
        if product.get("environment_id") != report.get("environment_id") \
                or product.get("source_revision") != report.get("source_revision") \
                or product.get("build_sha256s") != report.get("build_sha256s") \
                or product.get("device_proof_sha256s") != report.get("physical_device_proof_sha256s"):
            raise P6EvidenceError("p6_product_acceptance_binding_invalid")
        if finalize_product(product, root)["status"] != "passed":
            raise P6EvidenceError("p6_product_acceptance_invalid")
    if report.get("kind") == "physical" and "P6-M05-F05" in features:
        from finalize_remote_workspace_stability_p6 import finalize as finalize_stability

        candidates = []
        for ref in report["raw_artifacts"]:
            try:
                value = load_json(_path(root, ref["artifact"]), "p6_stability_report_malformed")
            except P6EvidenceError:
                continue
            if value.get("schema_version") == "p6-stability/1":
                candidates.append(value)
        if len(candidates) != 1:
            raise P6EvidenceError("p6_stability_raw_report_required")
        stability = candidates[0]
        if stability.get("environment_id") != report.get("environment_id") \
                or stability.get("source_revision") != report.get("source_revision") \
                or stability.get("build_sha256s") != report.get("build_sha256s") \
                or stability.get("device_proof_sha256s") != report.get("physical_device_proof_sha256s"):
            raise P6EvidenceError("p6_stability_report_binding_invalid")
        if finalize_stability(stability, root)["status"] != "passed":
            raise P6EvidenceError("p6_stability_report_invalid")


def finalize(value: object, artifact_root: Path) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return {"schema_version": "p6-finalization/1", "status": "failed", "features": 0,
                "errors": ["p6_evidence_malformed"]}
    try:
        schema = load_json(SCHEMA, "p6_schema_invalid")
        jsonschema.Draft202012Validator(schema).validate(value)
    except (P6EvidenceError, jsonschema.SchemaError, jsonschema.ValidationError):
        errors.append("p6_schema_validation_failed")
    try:
        environment = value["environment"]
        environment_id = environment["environment_id"]
        builds = value["builds"]
        by_platform = {row["platform"]: row for row in builds}
        if set(by_platform) != set(BUILD_IDENTITIES) or len(builds) != len(by_platform):
            raise P6EvidenceError("p6_build_set_invalid")
        for platform, identity in BUILD_IDENTITIES.items():
            row = by_platform[platform]
            if row.get("build_id") != platform or row.get("identity") != identity \
                    or row.get("type") != "release" \
                    or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", str(row.get("version", ""))) is None:
                raise P6EvidenceError("p6_release_build_required")
            expected_revision = environment["relay_revision"] if platform == "relay" else value["source_revision"]
            if row.get("revision") != expected_revision:
                raise P6EvidenceError("p6_build_revision_mismatch")
            _attest(artifact_root, row, "build_")
        build_digests = {row["sha256"] for row in builds}
        if len(build_digests) != 3:
            raise P6EvidenceError("p6_distinct_builds_required")

        devices = value["devices"]
        device_proofs = {row["device_proof_sha256"] for row in devices}
        if len(devices) != 2 or len(device_proofs) != 2:
            raise P6EvidenceError("p6_distinct_physical_devices_required")
        claimed_raw_digests: set[str] = set()
        claimed_report_ids: set[str] = set()

        def bind_report(report: dict[str, Any]) -> None:
            if report.get("source_revision") != value["source_revision"]:
                raise P6EvidenceError("p6_report_revision_mismatch")
            report_id = report.get("evidence_id")
            if not isinstance(report_id, str) or report_id in claimed_report_ids:
                raise P6EvidenceError("p6_duplicate_report_identity")
            claimed_report_ids.add(report_id)
            raw_digests = {item["sha256"] for item in report["raw_artifacts"]}
            if claimed_raw_digests & raw_digests:
                raise P6EvidenceError("p6_raw_evidence_reused_across_reports")
            claimed_raw_digests.update(raw_digests)

        for row in devices:
            if row.get("physical") is not True or row.get("emulator") is not False \
                    or row.get("android_build_sha256") != by_platform["android"]["sha256"]:
                raise P6EvidenceError("p6_physical_release_device_required")
            report = _report(artifact_root, row["report"], "physical_device")
            bind_report(report)
            if report.get("environment_id") != environment_id \
                    or report.get("physical_device_proof_sha256s") != [row["device_proof_sha256"]] \
                    or set(report.get("build_sha256s", [])) != build_digests:
                raise P6EvidenceError("p6_device_report_binding_invalid")

        for report_type, ref in value["endpoint_reports"].items():
            report = _report(artifact_root, ref, report_type)
            bind_report(report)
            if report.get("environment_id") != environment_id \
                    or set(report.get("build_sha256s", [])) != build_digests:
                raise P6EvidenceError("p6_endpoint_report_binding_invalid")

        evidence_rows = value["evidence"]
        evidence_by_id = {row["evidence_id"]: row for row in evidence_rows}
        if len(evidence_by_id) != len(evidence_rows):
            raise P6EvidenceError("p6_duplicate_evidence_id")
        evidence_features: dict[str, set[str]] = {}
        used: set[str] = set()
        for evidence_id, row in evidence_by_id.items():
            if row.get("kind") not in EVIDENCE_KINDS or row.get("environment_id") != environment_id \
                    or set(row.get("build_sha256s", [])) != build_digests:
                raise P6EvidenceError("p6_evidence_binding_invalid")
            proofs = set(row.get("physical_device_proof_sha256s", []))
            if not proofs.issubset(device_proofs) or (row["kind"] == "physical" and not proofs):
                raise P6EvidenceError("p6_evidence_device_binding_invalid")
            report = _report(artifact_root, row["report"], "feature")
            bind_report(report)
            _validate_specialized_report(artifact_root, report)
            for key in (
                "evidence_id", "kind", "environment_id", "feature_ids",
                "build_sha256s", "physical_device_proof_sha256s",
            ):
                if report.get(key) != row.get(key):
                    raise P6EvidenceError("p6_evidence_report_binding_invalid")
            evidence_features[evidence_id] = set(row["feature_ids"])

        feature_rows = value["features"]
        features = {row["id"]: row for row in feature_rows}
        if len(features) != 40 or set(features) != FEATURE_IDS:
            raise P6EvidenceError("p6_feature_set_incomplete")
        requirements = load_json(REQUIREMENTS, "p6_feature_requirements_invalid")
        requirement_rows = requirements.get("features")
        required_by_feature = {
            item.get("id"): set(item.get("required_kinds", []))
            for item in requirement_rows if isinstance(item, dict)
        } if isinstance(requirement_rows, list) else {}
        if requirements.get("schema_version") != "p6-feature-evidence-requirements/1" \
                or set(required_by_feature) != FEATURE_IDS \
                or any(not kinds or not kinds.issubset(EVIDENCE_KINDS)
                       for kinds in required_by_feature.values()):
            raise P6EvidenceError("p6_feature_requirements_invalid")
        for feature_id, row in features.items():
            refs = row.get("evidence_ids", [])
            if row.get("status") != "passed" or not refs or any(ref not in evidence_by_id for ref in refs):
                raise P6EvidenceError("p6_feature_not_passed")
            if any(feature_id not in evidence_features[ref] for ref in refs):
                raise P6EvidenceError("p6_feature_evidence_unbound")
            actual_kinds = {evidence_by_id[ref]["kind"] for ref in refs}
            if not required_by_feature[feature_id].issubset(actual_kinds):
                raise P6EvidenceError("p6_feature_required_evidence_missing")
            used.update(refs)
        if used != set(evidence_by_id) or any(
            feature_id not in features for rows in evidence_features.values() for feature_id in rows
        ):
            raise P6EvidenceError("p6_evidence_coverage_invalid")

        transition_ref = value["p5_transition"]
        transition_raw = _attest(artifact_root, transition_ref, "transition_")
        if hashlib.sha256(TRANSITION.read_bytes()).hexdigest() != transition_ref.get("sha256") \
                or transition_raw != TRANSITION.read_bytes():
            raise P6EvidenceError("p6_p5_transition_not_current")
        transition = json.loads(transition_raw.decode("utf-8"), object_pairs_hook=_strict_object)
        if transition.get("schema_version") != "p5-to-p6-migration/1" \
                or transition.get("policy", {}).get("inherit_completion") is not False \
                or value.get("completion_inherited") is not False:
            raise P6EvidenceError("p6_p5_completion_inherited")
    except (KeyError, TypeError, OSError, UnicodeDecodeError, json.JSONDecodeError,
            P6EvidenceError) as exc:
        errors.append(str(exc) or "p6_evidence_invalid")
    return {
        "schema_version": "p6-finalization/1",
        "status": "passed" if not errors else "failed",
        "features": 40 if not errors else 0,
        "errors": sorted(set(errors)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("ledger", type=Path)
    parser.add_argument("--artifact-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        ledger = load_json(args.ledger.resolve())
        result = finalize(ledger, args.artifact_root.resolve())
    except P6EvidenceError as exc:
        result = {"schema_version": "p6-finalization/1", "status": "failed",
                  "features": 0, "errors": [str(exc)]}
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
