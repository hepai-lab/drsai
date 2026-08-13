#!/usr/bin/env python3
"""Assemble an artifact-attested P6 evidence ledger from endpoint-local reports."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from finalize_remote_workspace_p6 import (
    FEATURE_IDS, P6EvidenceError, _path, _report, finalize, load_json,
)


def _ref(root: Path, relative: object) -> dict[str, Any]:
    path = _path(root, relative)
    raw = path.read_bytes()
    if not raw:
        raise P6EvidenceError("p6_manifest_artifact_empty")
    return {"artifact": str(relative), "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest()}


def assemble(manifest: dict[str, Any], artifact_root: Path) -> dict[str, Any]:
    if set(manifest) != {
        "schema_version", "source_revision", "environment", "builds", "device_reports",
        "endpoint_reports", "evidence_reports", "feature_evidence", "p5_transition_artifact",
    } or manifest.get("schema_version") != "p6-evidence-manifest/1":
        raise P6EvidenceError("p6_manifest_shape_invalid")
    root = artifact_root.resolve()
    builds: list[dict[str, Any]] = []
    for row in manifest.get("builds", []):
        if not isinstance(row, dict) or set(row) != {
            "build_id", "platform", "type", "version", "revision", "identity", "artifact",
        }:
            raise P6EvidenceError("p6_manifest_build_invalid")
        builds.append({**row, **_ref(root, row["artifact"])})

    device_rows: list[dict[str, Any]] = []
    for relative in manifest.get("device_reports", []):
        ref = _ref(root, relative)
        report = _report(root, ref, "physical_device")
        proofs = report.get("physical_device_proof_sha256s")
        if not isinstance(proofs, list) or len(proofs) != 1:
            raise P6EvidenceError("p6_manifest_device_proof_invalid")
        android = next((row for row in builds if row.get("platform") == "android"), None)
        if android is None:
            raise P6EvidenceError("p6_manifest_android_build_missing")
        device_rows.append({
            "physical": True, "emulator": False,
            "device_proof_sha256": proofs[0],
            "android_build_sha256": android["sha256"],
            "report": ref,
        })

    endpoint_manifest = manifest.get("endpoint_reports")
    if not isinstance(endpoint_manifest, dict) or set(endpoint_manifest) != {"windows", "relay"}:
        raise P6EvidenceError("p6_manifest_endpoint_reports_invalid")
    endpoint_reports = {name: _ref(root, relative) for name, relative in endpoint_manifest.items()}

    evidence_rows: list[dict[str, Any]] = []
    for relative in manifest.get("evidence_reports", []):
        ref = _ref(root, relative)
        report = _report(root, ref, "feature")
        evidence_rows.append({
            "evidence_id": report.get("evidence_id"),
            "kind": report.get("kind"),
            "environment_id": report.get("environment_id"),
            "feature_ids": report.get("feature_ids"),
            "build_sha256s": report.get("build_sha256s"),
            "physical_device_proof_sha256s": report.get("physical_device_proof_sha256s"),
            "report": ref,
        })
    evidence_ids = {row.get("evidence_id") for row in evidence_rows}
    mappings = manifest.get("feature_evidence")
    if not isinstance(mappings, dict) or set(mappings) != FEATURE_IDS:
        raise P6EvidenceError("p6_manifest_feature_mapping_invalid")
    features = []
    for feature_id in sorted(FEATURE_IDS):
        refs = mappings[feature_id]
        if not isinstance(refs, list) or not refs or len(refs) != len(set(refs)) \
                or any(ref not in evidence_ids for ref in refs):
            raise P6EvidenceError("p6_manifest_feature_mapping_invalid")
        features.append({"id": feature_id, "status": "passed", "evidence_ids": refs})

    ledger = {
        "schema_version": "p6-evidence-ledger/1",
        "source_revision": manifest["source_revision"],
        "environment": manifest["environment"],
        "builds": builds,
        "devices": device_rows,
        "endpoint_reports": endpoint_reports,
        "features": features,
        "evidence": evidence_rows,
        "p5_transition": _ref(root, manifest["p5_transition_artifact"]),
        "completion_inherited": False,
        "passed": True,
    }
    result = finalize(ledger, root)
    if result["status"] != "passed":
        raise P6EvidenceError("p6_manifest_finalization_failed:" + ",".join(result["errors"]))
    return ledger


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--artifact-root", type=Path, required=True)
    args = parser.parse_args(argv)
    manifest = load_json(args.manifest.resolve(), "p6_manifest_malformed")
    ledger = assemble(manifest, args.artifact_root.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"features": 40, "passed": True}, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
