from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import jsonschema
import pytest
from p5_secret_canary import expected_canary_set_sha256
from p5_legacy_rollback import build_rollback_artifact
import finalize_remote_workspace_p5 as finalizer
from finalize_remote_workspace_p5 import (
    FEATURE_IDS, LONG_SESSION_FEATURE_SET, REQUIRED_EVIDENCE, REQUIRED_FAULTS,
    REQUIRED_PLATFORM_ENDPOINTS, SECRET_SOURCES, finalize,
    platform_contract_sha256,
)

DIGEST = "a" * 64


@pytest.fixture(autouse=True)
def fake_apk_inspection(monkeypatch: pytest.MonkeyPatch) -> None:
    def inspect(_path: Path, *, expected_package: str,
                expected_target_package: str | None = None) -> dict:
        return {
            "package_name": expected_package,
            "version_code": 20000,
            "version_name": "2.0.0",
            "signing_cert_sha256": "3" * 64,
            "signer_dn": "CN=OpenDrSai Test Release",
            "target_package": expected_target_package,
        }
    monkeypatch.setattr(finalizer, "inspect_android_apk", inspect)
    monkeypatch.setattr(finalizer, "release_signer_is_trusted", lambda _cert, _dn: True)


def _evidence_rows() -> tuple[list[dict], dict[str, str]]:
    categories = sorted(REQUIRED_EVIDENCE)
    assignments = {category: [] for category in categories}
    feature_digest: dict[str, str] = {}
    remaining = sorted(FEATURE_IDS - LONG_SESSION_FEATURE_SET)
    for index, feature_id in enumerate(remaining):
        assignments[categories[index % len(categories)]].append(feature_id)
    rows = []
    for category in categories:
        digest = hashlib.sha256(category.encode()).hexdigest()
        rows.append({"category": category, "artifact": f"artifacts/{category}.json", "bytes": 1,
                     "sha256": digest, "environment_id": "ai-dev-1",
                     "feature_ids": assignments[category]})
        feature_digest.update({feature_id: digest for feature_id in assignments[category]})
    digest = hashlib.sha256(b"android-long-session").hexdigest()
    rows.append({"category": "android", "artifact": "artifacts/android-long-session.json",
                 "bytes": 1, "sha256": digest, "environment_id": "ai-dev-1",
                 "feature_ids": sorted(LONG_SESSION_FEATURE_SET)})
    feature_digest.update({feature_id: digest for feature_id in LONG_SESSION_FEATURE_SET})
    return rows, feature_digest


def valid_long_session_report(
    build_sha256: str = DIGEST, *, test_apk_sha256: str = "8" * 64,
    test_apk_bytes: int = 8,
) -> dict:
    return {
        "schema_version": "p5-long-session-acceptance/1",
        "feature_ids": sorted(LONG_SESSION_FEATURE_SET),
        "generated_at": "2026-08-10T12:00:00+00:00",
        "passed": True,
        "environment": {
            "kind": "physical_device", "device_id_sha256": "9" * 64,
            "manufacturer": "Vendor", "model": "Physical tablet", "api": 36,
            "abi": "arm64-v8a",
        },
        "artifacts": {
            "app_build_type": "release", "app_apk_sha256": build_sha256,
            "test_apk_artifact": "artifacts/p5-long-session-test.apk",
            "test_apk_bytes": test_apk_bytes, "test_apk_sha256": test_apk_sha256,
        },
        "instrumentation": {
            "runner": "ai.drsai.remote.test/androidx.test.runner.AndroidJUnitRunner",
            "test_class": "ai.drsai.remote.P5LongSessionPerformanceTest",
            "tests": 1, "failures": 0,
        },
        "gates": {
            key: True for key in (
                "checkpoint_item_count", "cold_window_items", "cold_start", "cold_memory",
                "full_history", "full_history_time", "history_hash", "delta_count",
                "delta_time", "main_responsive", "delta_hash", "terminal",
                "worker_bounded", "render_bounded",
            )
        },
        "metrics": {
            "history": {
                "checkpoint_item_count": 100_000, "cold_window_items": 500,
                "cold_start_ms": 100, "cold_pss_delta_kb": 1024,
                "full_history_items": 100_000, "full_history_ms": 10_000,
                "history_hash": "7" * 64,
            },
            "delta": {
                "delta_count": 10_000, "duration_ms": 1000, "main_ticks": 40,
                "worker_starts": 10, "render_cycles": 10, "content_hash": "6" * 64,
                "terminal_barrier_complete": True,
            },
        },
        "budgets": {
            "cold_start_max_ms": 3000, "cold_pss_max_kb": 32 * 1024,
            "history_max_ms": 180_000, "delta_count": 10_000,
            "delta_duration_max_ms": 5000, "minimum_main_ticks": 20,
        },
    }


def valid() -> dict:
    evidence, feature_digest = _evidence_rows()
    return {
        "schema_version": "p5/1",
        "environment": {"environment_id": "ai-dev-1", "relay_url": "https://ai-dev.example",
                        "runtime_version": "2.0.0", "schema_hash": DIGEST,
                        "platform_contract_sha256": platform_contract_sha256(),
                        "android_signer_policy_sha256": finalizer.release_signer_policy_sha256()},
        "build": {"type": "release", "version": "2.0.0",
                  "package_name": "ai.drsai.remote", "version_code": 20000,
                  "signing_cert_sha256": "3" * 64, "artifact": "build/app.apk",
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
            "canary_set_sha256": expected_canary_set_sha256("canary-one"),
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
    secret_canary_set_mismatch = valid()
    secret_canary_set_mismatch["secret_scan"]["canary_set_sha256"] = "0" * 64
    fixtures.append((secret_canary_set_mismatch, "p5_secret_canary_set_mismatch"))
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
    rollback_path = tmp_path / value["legacy_removal"]["rollback_artifact"]
    build_rollback_artifact(Path(__file__).parents[1], rollback_path, source_revision="1" * 40)
    rollback_raw = rollback_path.read_bytes()
    rollback_digest = hashlib.sha256(rollback_raw).hexdigest()
    value["legacy_removal"]["rollback_bytes"] = len(rollback_raw)
    value["legacy_removal"]["rollback_sha256"] = rollback_digest
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
        if set(row["feature_ids"]) == LONG_SESSION_FEATURE_SET:
            test_raw = b"release-test-apk"
            test_path = tmp_path / "artifacts/p5-long-session-test.apk"
            test_path.parent.mkdir(parents=True, exist_ok=True)
            test_path.write_bytes(test_raw)
            raw = json.dumps(valid_long_session_report(
                build_digest, test_apk_sha256=hashlib.sha256(test_raw).hexdigest(),
                test_apk_bytes=len(test_raw),
            ), sort_keys=True).encode()
        else:
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

    rollback_target = tmp_path / value["legacy_removal"]["rollback_artifact"]
    arbitrary = b"nonempty-but-not-a-valid-rollback"
    rollback_target.write_bytes(arbitrary)
    value["legacy_removal"]["rollback_bytes"] = len(arbitrary)
    value["legacy_removal"]["rollback_sha256"] = hashlib.sha256(arbitrary).hexdigest()
    value["legacy_removal"]["migration"]["rollback_artifact_sha256"] = value["legacy_removal"]["rollback_sha256"]
    result = finalize(value, tmp_path)
    assert "p5_legacy_rollback_content_invalid" in result["errors"]

    first = tmp_path / value["evidence"][0]["artifact"]
    first.write_bytes(first.read_bytes() + b"tampered")
    result = finalize(value, tmp_path)
    assert "p5_evidence_artifact_size_mismatch" in result["errors"]
    assert "p5_evidence_artifact_digest_mismatch" in result["errors"]


def test_long_session_evidence_is_semantically_bound_to_physical_release_build(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    value = valid()
    build_path = tmp_path / value["build"]["artifact"]
    build_path.parent.mkdir(parents=True, exist_ok=True)
    build_raw = b"release-apk"
    build_path.write_bytes(build_raw)
    value["build"]["bytes"] = len(build_raw)
    value["build"]["sha256"] = hashlib.sha256(build_raw).hexdigest()
    row = next(item for item in value["evidence"]
               if set(item["feature_ids"]) == LONG_SESSION_FEATURE_SET)
    path = tmp_path / row["artifact"]
    path.parent.mkdir(parents=True, exist_ok=True)

    def write(report: dict) -> list[str]:
        test_path = tmp_path / report["artifacts"]["test_apk_artifact"]
        test_path.parent.mkdir(parents=True, exist_ok=True)
        test_raw = b"release-test-apk"
        test_path.write_bytes(test_raw)
        report["artifacts"]["test_apk_bytes"] = len(test_raw)
        report["artifacts"]["test_apk_sha256"] = hashlib.sha256(test_raw).hexdigest()
        raw = json.dumps(report, sort_keys=True).encode()
        path.write_bytes(raw)
        row["bytes"] = len(raw)
        row["sha256"] = hashlib.sha256(raw).hexdigest()
        for feature in value["features"]:
            if feature["id"] in LONG_SESSION_FEATURE_SET:
                feature["evidence_sha256"] = row["sha256"]
        return finalize(value, tmp_path)["errors"]

    assert not any(error.startswith("p5_long_session_") for error in write(
        valid_long_session_report(value["build"]["sha256"])
    ))
    report = valid_long_session_report(value["build"]["sha256"])
    report["environment"]["kind"] = "emulator"
    assert "p5_long_session_physical_environment_invalid" in write(report)
    report = valid_long_session_report(value["build"]["sha256"])
    report["metrics"]["delta"]["duration_ms"] = 5001
    assert "p5_long_session_gate_failed" in write(report)
    report = valid_long_session_report("5" * 64)
    assert "p5_long_session_build_mismatch" in write(report)
    report = valid_long_session_report(value["build"]["sha256"])
    report["artifacts"]["app_build_type"] = "debug"
    report["instrumentation"]["runner"] = (
        "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner"
    )
    assert "p5_long_session_release_build_required" in write(report)

    def mismatched_signer(_path: Path, *, expected_package: str,
                          expected_target_package: str | None = None) -> dict:
        return {
            "package_name": expected_package, "version_code": 20000,
            "version_name": "2.0.0",
            "signing_cert_sha256": ("4" if expected_package.endswith(".test") else "3") * 64,
            "signer_dn": "CN=OpenDrSai Test Release",
            "target_package": expected_target_package,
        }
    monkeypatch.setattr(finalizer, "inspect_android_apk", mismatched_signer)
    assert "p5_long_session_test_apk_signer_mismatch" in write(
        valid_long_session_report(value["build"]["sha256"])
    )


def test_release_apk_metadata_is_independently_rechecked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    value = valid()
    path = tmp_path / value["build"]["artifact"]
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = b"release-apk"
    path.write_bytes(raw)
    value["build"]["bytes"] = len(raw)
    value["build"]["sha256"] = hashlib.sha256(raw).hexdigest()

    def drift(_path: Path, *, expected_package: str,
              expected_target_package: str | None = None) -> dict:
        return {
            "package_name": expected_package, "version_code": 99999,
            "version_name": "9.9.9", "signing_cert_sha256": "5" * 64,
            "signer_dn": "CN=Unknown Release",
            "target_package": expected_target_package,
        }
    monkeypatch.setattr(finalizer, "inspect_android_apk", drift)
    assert "p5_build_apk_identity_mismatch" in finalize(value, tmp_path)["errors"]


def test_release_signer_policy_is_pinned_and_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    value = valid()
    path = tmp_path / value["build"]["artifact"]
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = b"release-apk"
    path.write_bytes(raw)
    value["build"]["bytes"] = len(raw)
    value["build"]["sha256"] = hashlib.sha256(raw).hexdigest()
    monkeypatch.setattr(finalizer, "release_signer_is_trusted", lambda _cert, _dn: False)
    assert "p5_release_signer_untrusted" in finalize(value, tmp_path)["errors"]

    drift = valid()
    drift["environment"]["android_signer_policy_sha256"] = "0" * 64
    assert "p5_android_signer_policy_drift" in finalize(drift)["errors"]


def test_long_session_features_must_share_one_dedicated_android_report() -> None:
    value = valid()
    row = next(item for item in value["evidence"]
               if set(item["feature_ids"]) == LONG_SESSION_FEATURE_SET)
    moved = row["feature_ids"].pop()
    value["evidence"][0]["feature_ids"].append(moved)
    assert "p5_long_session_feature_mapping_invalid" in finalize(value)["errors"]


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
