"""Assemble a P5 release ledger from physical, content-free evidence files."""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any

from finalize_remote_workspace_p5 import FEATURE_IDS, _safe_relative_artifact, finalize
from p5_android_apk import inspect_android_apk
from p5_android_apk import release_signer_policy_sha256


def _path(root: Path, relative: object) -> Path:
    if not isinstance(relative, str) or not _safe_relative_artifact(relative):
        raise RuntimeError("p5_manifest_artifact_path_invalid")
    resolved_root = root.resolve()
    resolved = (resolved_root / relative).resolve()
    if resolved_root not in resolved.parents or not resolved.is_file():
        raise RuntimeError("p5_manifest_artifact_missing")
    return resolved


def _raw(root: Path, relative: object) -> bytes:
    raw = _path(root, relative).read_bytes()
    if not raw:
        raise RuntimeError("p5_manifest_artifact_empty")
    return raw


def _json(root: Path, relative: object, label: str) -> dict[str, Any]:
    try:
        value = json.loads(_raw(root, relative))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"p5_manifest_{label}_invalid") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"p5_manifest_{label}_invalid")
    return value


def _attest(root: Path, row: dict[str, Any], artifact_key: str, bytes_key: str,
            digest_key: str) -> None:
    raw = _raw(root, row.get(artifact_key))
    digest = hashlib.sha256(raw).hexdigest()
    for key, expected in ((bytes_key, len(raw)), (digest_key, digest)):
        declared = row.get(key)
        if declared is not None and declared != expected:
            raise RuntimeError(f"p5_manifest_declared_{key}_mismatch")
        row[key] = expected


def assemble(manifest: dict[str, Any], root: Path) -> dict[str, Any]:
    if manifest.get("schema_version") != "p5-manifest/1":
        raise RuntimeError("p5_manifest_schema_invalid")
    ledger = deepcopy(manifest)
    ledger["schema_version"] = "p5/1"
    environment = ledger.get("environment")
    if not isinstance(environment, dict):
        raise RuntimeError("p5_manifest_environment_missing")
    signer_policy_digest = release_signer_policy_sha256()
    if environment.get("android_signer_policy_sha256") not in (None, signer_policy_digest):
        raise RuntimeError("p5_manifest_android_signer_policy_mismatch")
    environment["android_signer_policy_sha256"] = signer_policy_digest

    build = ledger.get("build")
    if not isinstance(build, dict):
        raise RuntimeError("p5_manifest_build_missing")
    _attest(root, build, "artifact", "bytes", "sha256")
    build_identity = inspect_android_apk(
        _path(root, build.get("artifact")), expected_package="ai.drsai.remote"
    )
    for key, actual in (
        ("package_name", build_identity["package_name"]),
        ("version_code", build_identity["version_code"]),
        ("signing_cert_sha256", build_identity["signing_cert_sha256"]),
    ):
        if build.get(key) not in (None, actual):
            raise RuntimeError(f"p5_manifest_build_{key}_mismatch")
        build[key] = actual
    if build.get("version") != build_identity["version_name"]:
        raise RuntimeError("p5_manifest_build_version_mismatch")

    contract_source = ledger.pop("contract_report_artifact", None)
    contract_report = _json(root, contract_source, "contract_report")
    contract_report["artifact"] = contract_source
    _attest(root, contract_report, "artifact", "artifact_bytes", "artifact_sha256")
    openapi_artifact = ledger.pop("openapi_artifact", None)
    contract_report["openapi_artifact"] = openapi_artifact
    _attest(root, contract_report, "openapi_artifact", "openapi_bytes", "openapi_sha256")
    ledger["contract_report"] = contract_report

    devices = ledger.get("devices")
    if not isinstance(devices, list):
        raise RuntimeError("p5_manifest_devices_missing")
    for device in devices:
        if not isinstance(device, dict):
            raise RuntimeError("p5_manifest_device_invalid")
        _attest(root, device, "proof_artifact", "proof_bytes", "proof_sha256")

    stability_artifact = ledger.pop("stability_report_artifact", None)
    stability = _json(root, stability_artifact, "stability_report")
    stability["artifact"] = stability_artifact
    _attest(root, stability, "artifact", "artifact_bytes", "artifact_sha256")
    ledger["stability_report"] = stability

    secret_artifact = ledger.pop("secret_scan_artifact", None)
    secret_scan = _json(root, secret_artifact, "secret_scan")
    secret_scan["artifact"] = secret_artifact
    _attest(root, secret_scan, "artifact", "artifact_bytes", "artifact_sha256")
    ledger["secret_scan"] = secret_scan

    experience_artifact = ledger.pop("experience_report_artifact", None)
    experience = _json(root, experience_artifact, "experience_report")
    experience["artifact"] = experience_artifact
    _attest(root, experience, "artifact", "artifact_bytes", "artifact_sha256")
    ledger["experience_report"] = experience

    legacy_removal = ledger.get("legacy_removal")
    if not isinstance(legacy_removal, dict):
        raise RuntimeError("p5_manifest_legacy_removal_missing")
    for label in ("decision", "rollback", "migration"):
        _attest(root, legacy_removal, f"{label}_artifact", f"{label}_bytes", f"{label}_sha256")
    legacy_removal["decision"] = _json(
        root, legacy_removal.get("decision_artifact"), "legacy_decision"
    )
    legacy_removal["migration"] = _json(
        root, legacy_removal.get("migration_artifact"), "legacy_migration"
    )

    evidence = ledger.get("evidence")
    if not isinstance(evidence, list):
        raise RuntimeError("p5_manifest_evidence_missing")
    feature_digests: dict[str, str] = {}
    for row in evidence:
        if not isinstance(row, dict):
            raise RuntimeError("p5_manifest_evidence_invalid")
        _attest(root, row, "artifact", "bytes", "sha256")
        feature_ids = row.get("feature_ids")
        if not isinstance(feature_ids, list):
            raise RuntimeError("p5_manifest_feature_mapping_invalid")
        for feature_id in feature_ids:
            if feature_id in feature_digests:
                raise RuntimeError("p5_manifest_feature_mapped_twice")
            feature_digests[str(feature_id)] = row["sha256"]
    if set(feature_digests) != FEATURE_IDS:
        raise RuntimeError("p5_manifest_feature_coverage_incomplete")

    features = ledger.get("features")
    if not isinstance(features, list):
        raise RuntimeError("p5_manifest_features_missing")
    for feature in features:
        if not isinstance(feature, dict) or feature.get("id") not in feature_digests:
            raise RuntimeError("p5_manifest_feature_invalid")
        expected = feature_digests[str(feature["id"])]
        if feature.get("evidence_sha256") not in (None, expected):
            raise RuntimeError("p5_manifest_feature_digest_mismatch")
        feature["evidence_sha256"] = expected

    result = finalize(ledger, root)
    if result["status"] != "passed":
        raise RuntimeError(";".join(result["errors"]))
    return ledger


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.manifest.is_file() or not args.manifest.read_bytes():
        raise SystemExit("p5_manifest_missing")
    value = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit("p5_manifest_invalid")
    ledger = assemble(value, args.manifest.parent)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
