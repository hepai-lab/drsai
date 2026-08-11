from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import jsonschema
import pytest
import finalize_remote_workspace_p5 as finalizer
from finalize_remote_workspace_p5 import (
    FEATURE_IDS, REQUIRED_EVIDENCE, REQUIRED_FAULTS, REQUIRED_PLATFORM_ENDPOINTS, SECRET_SOURCES, finalize,
    platform_contract_sha256,
)

DIGEST = "a" * 64


def _evidence_rows() -> tuple[list[dict], dict[str, str]]:
    categories = sorted(REQUIRED_EVIDENCE)
    assignments = {category: [] for category in categories}
    feature_digest: dict[str, str] = {}
    for index, feature_id in enumerate(sorted(FEATURE_IDS)):
        assignments[categories[index % len(categories)]].append(feature_id)
    rows = []
    for category in categories:
        digest = hashlib.sha256(category.encode()).hexdigest()
        rows.append({"category": category, "artifact": f"artifacts/{category}.json", "bytes": 1,
                     "sha256": digest, "environment_id": "ai-dev-1",
                     "feature_ids": assignments[category]})
        feature_digest.update({feature_id: digest for feature_id in assignments[category]})
    return rows, feature_digest


def valid() -> dict:
    evidence, feature_digest = _evidence_rows()
    return {
        "schema_version": "p5/1",
        "environment": {"environment_id": "ai-dev-1", "relay_url": "https://ai-dev.example",
                        "runtime_version": "2.0.0", "schema_hash": DIGEST,
                        "platform_contract_sha256": platform_contract_sha256()},
        "build": {"type": "release", "version": "2.0.0", "artifact": "build/app.apk",
                  "bytes": 1, "sha256": DIGEST},
        "contract_report": {
            "schema_version": "p5-contract-evidence/1", "environment_id": "ai-dev-1",
            "relay_url": "https://ai-dev.example", "platform_contract_sha256": platform_contract_sha256(),
            "artifact": "reports/contract.json", "artifact_bytes": 1, "artifact_sha256": "6" * 64,
            "openapi_artifact": "contract/openapi.json", "openapi_sha256": DIGEST, "openapi_bytes": 1,
            "verified_endpoints": sorted(REQUIRED_PLATFORM_ENDPOINTS), "passed": True,
        },
        "legacy_removal": {
            "schema_version": "p5-legacy-removal/1", "environment_id": "ai-dev-1", "passed": True,
            "decision_artifact": "legacy/deletion-decision.json", "decision_bytes": 1,
            "decision_sha256": "f" * 64,
            "rollback_artifact": "legacy/rollback.zip", "rollback_bytes": 1,
            "rollback_sha256": "1" * 64,
            "migration_artifact": "legacy/migration.json", "migration_bytes": 1,
            "migration_sha256": "2" * 64,
            "decision": {
                "schema_version": "p5-protocol-deletion-decision/1", "status": "eligible",
                "data_start": "2026-07-01", "data_end": "2026-07-01",
                "observation_days": 1, "release_cycles": 0, "oaep_ratio": 1.0,
                "legacy_ratio": 0.0, "migration_ratio": 1.0,
                "fallback_error_ratio": 0.0, "gap_days": 0,
                "requirements": {"observation_days": 0, "release_cycles": 0,
                                 "oaep_ratio": 0.999, "legacy_ratio": 0.001,
                                 "migration_ratio": 1.0, "fallback_error_ratio": 0.001},
                "eligible": True,
            },
            "migration": {
                "schema_version": "p5-legacy-migration/1", "database_migration_verified": True,
                "migration_transcript_before_sha256": DIGEST,
                "migration_transcript_after_sha256": DIGEST,
                "rollback_artifact_sha256": "1" * 64,
            },
        },
        "devices": [
            {"physical": True, "emulator": False, "proof_artifact": "devices/device-a.json",
             "proof_bytes": 1, "proof_sha256": "b" * 64},
            {"physical": True, "emulator": False, "proof_artifact": "devices/device-b.json",
             "proof_bytes": 1, "proof_sha256": "c" * 64},
        ],
        "experience_report": {
            "schema_version": "p5-experience/1", "environment_id": "ai-dev-1", "passed": True,
            "artifact": "reports/experience.json", "artifact_bytes": 1,
            "artifact_sha256": "4" * 64,
            "device_proof_sha256s": ["b" * 64, "c" * 64],
            "checks": [
                "talkback_navigation", "touch_target_48dp", "dynamic_text_200_percent", "contrast",
                "connection_state_action", "approval_risk_announcement", "notification_deep_link",
                "offline_stale_semantics",
            ],
            "manual_scenarios": [
                {"name": name, "status": "passed"} for name in (
                    "pair_by_qr", "browse_catalog", "open_session", "send_message",
                    "approval_decision", "cancel_and_retry", "revoke_device", "recover_after_restart",
                )
            ],
            "accessibility_violations": 0, "raw_sensitive_content_exported": False,
        },
        "features": [{"id": item, "status": "passed", "evidence_sha256": feature_digest[item]}
                     for item in sorted(FEATURE_IDS)],
        "evidence": evidence,
        "stability_report": {
            "schema_version": "p5-stability/1", "environment_id": "ai-dev-1", "passed": True,
            "artifact": "reports/stability.json", "artifact_bytes": 1, "artifact_sha256": "d" * 64,
            "required_duration_seconds": 3600, "observed_duration_seconds": 3600,
            "probe_error_count": 0, "duplicate_sequence_count": 0, "missing_sequence_count": 0,
            "reexecuted_side_effect_count": 0, "relay_latency_p95_ms": 100,
            "windows_memory_slope_bytes_per_second": 10, "windows_handle_slope_per_second": 0,
            "transcript_hashes": {"android": DIGEST, "desktop": DIGEST, "runtime": DIGEST},
            "faults": [{"name": name, "status": "passed", "sequence_preserved": True,
                        "transcript_preserved": True, "duplicate_sequence_count": 0,
                        "missing_sequence_count": 0, "reexecuted_side_effect_count": 0}
                       for name in sorted(REQUIRED_FAULTS)],
        },
        "secret_scan": {
            "schema_version": "p5-secret/1", "profile": "mobile-remote-workspace-p5",
            "environment_id": "ai-dev-1",
            "artifact": "reports/secret-scan.json", "artifact_bytes": 1, "artifact_sha256": "e" * 64,
            "canary_run_id": "canary-one", "passed": True, "matches": 0,
            "raw_artifacts_crossed_trust_boundary": False,
            "sources": [
                {"name": name, "boundary": name.split("_", 1)[0], "status": "clean",
                 "bytes_scanned": 1, "files_scanned": 1}
                for name in sorted(SECRET_SOURCES)
            ],
            "boundary_reports": [
                {"boundary": "android", "report_sha256": DIGEST, "source_count": 4,
                 "artifact_sha256": DIGEST},
                {"boundary": "windows", "report_sha256": DIGEST, "source_count": 4},
                {"boundary": "relay", "report_sha256": DIGEST, "source_count": 3},
            ],
        },
    }


def test_complete_release_evidence_passes() -> None:
    value = valid()
    schema = json.loads((Path(__file__).parents[1] / "cores/protocol/relay/remote-workspace-p5-evidence.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema).validate(value)
    assert finalize(value) == {"status": "passed", "features": 48, "errors": []}


def test_missing_mixed_debug_and_emulator_evidence_fail_closed() -> None:
    fixtures = []
    missing = valid(); missing["features"].pop(); fixtures.append((missing, "p5_feature_set_incomplete"))
    mixed = valid(); mixed["evidence"][0]["environment_id"] = "other"; fixtures.append((mixed, "p5_mixed_environment_evidence"))
    debug = valid(); debug["build"]["type"] = "debug"; fixtures.append((debug, "p5_release_build_required"))
    emulator = valid(); emulator["devices"][0]["emulator"] = True; fixtures.append((emulator, "p5_physical_device_required"))
    duplicate = valid(); duplicate["devices"][1]["proof_sha256"] = duplicate["devices"][0]["proof_sha256"]
    fixtures.append((duplicate, "p5_distinct_devices_required"))
    secret_missing = valid(); secret_missing["secret_scan"]["sources"].pop()
    fixtures.append((secret_missing, "p5_secret_source_set_incomplete"))
    secret_mixed = valid(); secret_mixed["secret_scan"]["environment_id"] = "other"
    fixtures.append((secret_mixed, "p5_secret_scan_mixed_environment"))
    short = valid(); short["stability_report"]["observed_duration_seconds"] = 3599
    fixtures.append((short, "p5_stability_duration_incomplete"))
    mismatch = valid(); mismatch["stability_report"]["transcript_hashes"]["desktop"] = "d" * 64
    fixtures.append((mismatch, "p5_stability_transcript_mismatch"))
    replay = valid(); replay["stability_report"]["faults"][0]["reexecuted_side_effect_count"] = 1
    fixtures.append((replay, "p5_stability_fault_failed"))
    drift = valid(); drift["environment"]["platform_contract_sha256"] = "d" * 64
    fixtures.append((drift, "p5_platform_contract_drift"))
    apk_mismatch = valid(); apk_mismatch["secret_scan"]["boundary_reports"][0]["artifact_sha256"] = "e" * 64
    fixtures.append((apk_mismatch, "p5_android_secret_scan_build_mismatch"))
    duplicate_feature = valid(); duplicate_feature["features"].append(deepcopy(duplicate_feature["features"][0]))
    fixtures.append((duplicate_feature, "p5_feature_rows_invalid"))
    contract_mixed = valid(); contract_mixed["contract_report"]["environment_id"] = "other"
    fixtures.append((contract_mixed, "p5_contract_mixed_environment"))
    for fixture, expected in fixtures:
        result = finalize(fixture)
        assert result["status"] == "failed"
        assert expected in result["errors"]


def test_feature_evidence_must_be_explicitly_bound() -> None:
    unbound = valid()
    unbound["features"][0]["evidence_sha256"] = "f" * 64
    assert "p5_feature_evidence_unbound" in finalize(unbound)["errors"]

    incomplete = valid()
    feature_id = incomplete["evidence"][0]["feature_ids"].pop()
    assert feature_id in FEATURE_IDS
    assert "p5_evidence_feature_coverage_incomplete" in finalize(incomplete)["errors"]

    reused = valid()
    reused["evidence"][1]["sha256"] = reused["evidence"][0]["sha256"]
    assert "p5_evidence_digest_reused" in finalize(reused)["errors"]


def test_cli_mode_verifies_physical_artifacts(tmp_path: Path) -> None:
    value = valid()

    def attest(row: dict, artifact_key: str, bytes_key: str, digest_key: str, raw: bytes) -> str:
        path = tmp_path / row[artifact_key]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        row[bytes_key] = len(raw)
        row[digest_key] = digest
        return digest

    build_digest = attest(value["build"], "artifact", "bytes", "sha256", b"release-apk")
    value["secret_scan"]["boundary_reports"][0]["artifact_sha256"] = build_digest
    attest(value["contract_report"], "openapi_artifact", "openapi_bytes", "openapi_sha256", b"openapi")
    contract_body = {key: item for key, item in value["contract_report"].items()
                     if key not in {"artifact", "artifact_bytes", "artifact_sha256", "openapi_artifact"}}
    attest(value["contract_report"], "artifact", "artifact_bytes", "artifact_sha256",
           json.dumps(contract_body, sort_keys=True).encode())
    for index, device in enumerate(value["devices"]):
        attest(device, "proof_artifact", "proof_bytes", "proof_sha256", f"device-proof-{index}".encode())
    value["experience_report"]["device_proof_sha256s"] = [
        device["proof_sha256"] for device in value["devices"]
    ]
    stability_body = {key: item for key, item in value["stability_report"].items()
                      if key not in {"artifact", "artifact_bytes", "artifact_sha256"}}
    attest(value["stability_report"], "artifact", "artifact_bytes", "artifact_sha256",
           json.dumps(stability_body, sort_keys=True).encode())
    secret_body = {key: item for key, item in value["secret_scan"].items()
                   if key not in {"artifact", "artifact_bytes", "artifact_sha256"}}
    attest(value["secret_scan"], "artifact", "artifact_bytes", "artifact_sha256",
           json.dumps(secret_body, sort_keys=True).encode())
    experience_body = {key: item for key, item in value["experience_report"].items()
                       if key not in {"artifact", "artifact_bytes", "artifact_sha256"}}
    attest(value["experience_report"], "artifact", "artifact_bytes", "artifact_sha256",
           json.dumps(experience_body, sort_keys=True).encode())
    rollback_digest = attest(
        value["legacy_removal"], "rollback_artifact", "rollback_bytes", "rollback_sha256",
        b"legacy-rollback",
    )
    value["legacy_removal"]["migration"]["rollback_artifact_sha256"] = rollback_digest
    decision_raw = json.dumps(value["legacy_removal"]["decision"], sort_keys=True).encode()
    attest(value["legacy_removal"], "decision_artifact", "decision_bytes", "decision_sha256",
           decision_raw)
    migration_raw = json.dumps(value["legacy_removal"]["migration"], sort_keys=True).encode()
    attest(value["legacy_removal"], "migration_artifact", "migration_bytes", "migration_sha256",
           migration_raw)

    for row in value["evidence"]:
        path = tmp_path / row["artifact"]
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = (row["category"] + "-physical-evidence").encode()
        path.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        old_digest = row["sha256"]
        row["bytes"] = len(raw)
        row["sha256"] = digest
        for feature in value["features"]:
            if feature["evidence_sha256"] == old_digest:
                feature["evidence_sha256"] = digest

    assert finalize(value, tmp_path) == {"status": "passed", "features": 48, "errors": []}

    physical_targets = [
        (value["build"]["artifact"], "p5_build"),
        (value["contract_report"]["openapi_artifact"], "p5_contract_openapi"),
        (value["contract_report"]["artifact"], "p5_contract_report"),
        (value["devices"][0]["proof_artifact"], "p5_device_proof"),
        (value["stability_report"]["artifact"], "p5_stability"),
        (value["secret_scan"]["artifact"], "p5_secret_scan"),
        (value["experience_report"]["artifact"], "p5_experience"),
        (value["legacy_removal"]["decision_artifact"], "p5_legacy_decision"),
        (value["legacy_removal"]["rollback_artifact"], "p5_legacy_rollback"),
        (value["legacy_removal"]["migration_artifact"], "p5_legacy_migration"),
    ]
    for relative, prefix in physical_targets:
        target = tmp_path / relative
        original = target.read_bytes()
        target.write_bytes(original + b"tampered")
        result = finalize(value, tmp_path)
        assert f"{prefix}_artifact_size_mismatch" in result["errors"]
        assert f"{prefix}_artifact_digest_mismatch" in result["errors"]
        target.write_bytes(original)

    first = tmp_path / value["evidence"][0]["artifact"]
    first.write_bytes(first.read_bytes() + b"tampered")
    result = finalize(value, tmp_path)
    assert "p5_evidence_artifact_size_mismatch" in result["errors"]
    assert "p5_evidence_artifact_digest_mismatch" in result["errors"]


def test_artifact_path_traversal_fails_closed() -> None:
    value = valid()
    value["evidence"][0]["artifact"] = "../outside.json"
    assert "p5_evidence_artifact_path_invalid" in finalize(value)["errors"]

    value = valid()
    value["evidence"][0]["artifact"] = "artifacts\\..\\outside.json"
    assert "p5_evidence_artifact_path_invalid" in finalize(value)["errors"]
    schema = json.loads((Path(__file__).parents[1] / "cores/protocol/relay/remote-workspace-p5-evidence.schema.json").read_text(encoding="utf-8"))
    errors = list(jsonschema.Draft202012Validator(schema).iter_errors(value))
    assert errors


def test_malformed_evidence_types_fail_closed_without_exception() -> None:
    value = valid()
    value["evidence"][0]["category"] = {"invalid": True}
    value["evidence"][0]["bytes"] = "1"
    value["evidence"][0]["artifact"] = []
    value["evidence"][0]["feature_ids"] = [{"invalid": True}]
    result = finalize(value)
    assert result["status"] == "failed"
    assert "p5_evidence_feature_mapping_invalid" in result["errors"]
    assert "p5_evidence_artifact_path_invalid" in result["errors"]


def test_runtime_schema_rejects_unknown_fields_and_missing_schema(monkeypatch, tmp_path: Path) -> None:
    value = valid()
    value["unexpected"] = True
    assert "p5_schema_validation_failed" in finalize(value)["errors"]

    monkeypatch.setattr(finalizer, "EVIDENCE_SCHEMA", tmp_path / "missing-schema.json")
    result = finalizer.finalize(valid())
    assert "p5_schema_unavailable_or_invalid" in result["errors"]


def test_legacy_removal_requires_real_eligible_decision_and_matching_migration() -> None:
    missing_migration = valid()
    missing_migration["legacy_removal"]["decision"].update({
        "status": "threshold_failed", "eligible": False, "migration_ratio": None,
    })
    assert "p5_legacy_deletion_not_eligible" in finalize(missing_migration)["errors"]

    mismatch = valid()
    mismatch["legacy_removal"]["migration"]["migration_transcript_after_sha256"] = "3" * 64
    assert "p5_legacy_migration_evidence_invalid" in finalize(mismatch)["errors"]

    boundary = valid()
    boundary["legacy_removal"]["decision"]["legacy_ratio"] = 0.001
    assert "p5_legacy_deletion_not_eligible" in finalize(boundary)["errors"]


def test_experience_report_requires_all_checks_scenarios_and_same_physical_devices() -> None:
    missing_check = valid()
    missing_check["experience_report"]["checks"].pop()
    assert "p5_experience_checks_incomplete" in finalize(missing_check)["errors"]

    failed_scenario = valid()
    failed_scenario["experience_report"]["manual_scenarios"][0]["status"] = "failed"
    assert "p5_experience_scenarios_incomplete" in finalize(failed_scenario)["errors"]

    substituted_device = valid()
    substituted_device["experience_report"]["device_proof_sha256s"][0] = "5" * 64
    assert "p5_experience_device_proofs_mismatch" in finalize(substituted_device)["errors"]


def test_structured_reports_cannot_drift_from_attested_physical_json(tmp_path: Path) -> None:
    value = valid()

    def materialize_report(row: dict, excluded: set[str]) -> None:
        path = tmp_path / row["artifact"]
        path.parent.mkdir(parents=True, exist_ok=True)
        body = {key: item for key, item in row.items() if key not in excluded}
        raw = json.dumps(body, sort_keys=True).encode()
        path.write_bytes(raw)
        row["artifact_bytes"] = len(raw)
        row["artifact_sha256"] = hashlib.sha256(raw).hexdigest()

    materialize_report(
        value["contract_report"],
        {"artifact", "artifact_bytes", "artifact_sha256", "openapi_artifact"},
    )
    materialize_report(value["stability_report"], {"artifact", "artifact_bytes", "artifact_sha256"})
    materialize_report(value["secret_scan"], {"artifact", "artifact_bytes", "artifact_sha256"})

    value["contract_report"]["passed"] = False
    value["stability_report"]["relay_latency_p95_ms"] = 101
    value["secret_scan"]["canary_run_id"] = "different-canary"
    errors = finalize(value, tmp_path)["errors"]
    assert "p5_contract_report_artifact_content_mismatch" in errors
    assert "p5_stability_artifact_content_mismatch" in errors
    assert "p5_secret_scan_artifact_content_mismatch" in errors


@pytest.mark.parametrize(
    ("section", "field", "bad_value"),
    [
        ("contract_report", "verified_endpoints", [["unhashable"]]),
        ("stability_report", "observed_duration_seconds", {"invalid": True}),
        ("stability_report", "relay_latency_p95_ms", "not-a-number"),
        ("secret_scan", "boundary_reports", [{"boundary": {"invalid": True}}]),
    ],
)
def test_arbitrary_malformed_input_never_crashes(section: str, field: str, bad_value: object) -> None:
    value = valid()
    value[section][field] = bad_value
    result = finalize(value)
    assert result["status"] == "failed"
    assert result["errors"]
