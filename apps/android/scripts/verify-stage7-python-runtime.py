"""Fail-closed auditor for Android Stage 7 Python Runtime release evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPORTS = (
    "feature-evidence.json", "recovery-matrix.json", "side-effect-consistency.json",
    "ui-critical-journey.json", "device-matrix.json", "device-performance.json",
    "security-scan.json", "android-security-boundaries.json", "trusted-build-audit.json", "upgrade-rollback.json",
    "rollout-drill.json", "release-manifest.json",
)
IDENTITY_FIELDS = (
    "acceptance_run_id", "git_commit", "git_dirty", "build_id", "variant",
    "version_code", "version_name", "apk_sha256",
)
FEATURE_IDS = {f"M{module:02d}-F{feature:02d}" for module in range(1, 9) for feature in range(1, 7)}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SHA_COMMIT = re.compile(r"^[0-9a-f]{40,64}$")
PROVENANCE_REPORTS = set(REPORTS) - {"feature-evidence.json", "android-security-boundaries.json", "trusted-build-audit.json", "release-manifest.json"}
MAX_REPORT_WINDOW_HOURS = {"rollout-drill.json": 24 * 21, "device-matrix.json": 24 * 7,
                           "device-performance.json": 24 * 7}


def load(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid_json:{path.name}:{error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"root_not_object:{path.name}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def identity(document: dict, name: str) -> dict:
    value = document.get("identity")
    if not isinstance(value, dict):
        raise ValueError(f"identity_missing:{name}")
    missing = [field for field in IDENTITY_FIELDS if field not in value]
    if missing:
        raise ValueError(f"identity_fields_missing:{name}:{','.join(missing)}")
    return {field: value[field] for field in IDENTITY_FIELDS}


def audit(evidence: Path, apk: Path) -> dict:
    repo = Path(__file__).resolve().parents[3]
    errors: list[str] = []
    documents: dict[str, dict] = {}
    for name in REPORTS:
        try:
            documents[name] = load(evidence / name)
        except ValueError as error:
            errors.append(str(error))
    if not apk.is_file():
        errors.append("apk_missing")

    identities: dict[str, dict] = {}
    for name, document in documents.items():
        if document.get("schema_version") != 2:
            errors.append(f"schema_version_invalid:{name}")
        try:
            identities[name] = identity(document, name)
        except ValueError as error:
            errors.append(str(error))
    if identities:
        expected = next(iter(identities.values()))
        errors.extend(f"identity_mismatch:{name}" for name, value in identities.items() if value != expected)
        if not SHA256.fullmatch(str(expected["apk_sha256"])):
            errors.append("apk_sha256_invalid")
        elif apk.is_file() and sha256(apk) != expected["apk_sha256"]:
            errors.append("apk_sha256_mismatch")
        if expected.get("git_dirty") is not False:
            errors.append("git_tree_not_clean")
        now = datetime.now(timezone.utc)
        for name in PROVENANCE_REPORTS & documents.keys():
            document = documents[name]
            if document.get("result") != "passed":
                continue
            provenance = document.get("provenance")
            if not isinstance(provenance, dict):
                errors.append(f"provenance_missing:{name}")
                continue
            required = ("runner", "acceptance_run_id", "package_version_code", "package_version_name",
                        "apk_sha256", "started_at", "completed_at", "device_ids_sha256")
            if any(field not in provenance for field in required):
                errors.append(f"provenance_fields_missing:{name}")
                continue
            if (not str(provenance["runner"]).strip() or provenance["acceptance_run_id"] != expected["acceptance_run_id"] or
                provenance["package_version_code"] != expected["version_code"] or
                provenance["package_version_name"] != expected["version_name"] or provenance["apk_sha256"] != expected["apk_sha256"]):
                errors.append(f"provenance_identity_mismatch:{name}")
            devices = provenance["device_ids_sha256"]
            if not isinstance(devices, list) or not devices or any(not SHA256.fullmatch(str(value)) for value in devices):
                errors.append(f"provenance_devices_invalid:{name}")
            try:
                started = datetime.fromisoformat(str(provenance["started_at"]).replace("Z", "+00:00"))
                completed = datetime.fromisoformat(str(provenance["completed_at"]).replace("Z", "+00:00"))
                maximum = timedelta(hours=MAX_REPORT_WINDOW_HOURS.get(name, 24))
                if (started.tzinfo is None or completed.tzinfo is None or completed < started or
                        completed - started > maximum or now - completed > timedelta(days=7) or
                        completed - now > timedelta(minutes=5)):
                    errors.append(f"provenance_time_window_invalid:{name}")
            except ValueError:
                errors.append(f"provenance_time_invalid:{name}")

    features = documents.get("feature-evidence.json", {}).get("features", [])
    feature_map = {row.get("feature_id"): row for row in features if isinstance(row, dict)}
    if set(feature_map) != FEATURE_IDS or len(features) != 48:
        errors.append("feature_matrix_not_48_unique")
    failed_features = sorted(
        feature_id for feature_id in FEATURE_IDS
        if feature_map.get(feature_id, {}).get("status") != "passed"
    )
    if failed_features:
        errors.append("features_not_passed:" + ",".join(failed_features))
    for feature_id, row in feature_map.items():
        if row.get("status") != "passed":
            continue
        if row.get("requirement_id") != feature_id or row.get("mapping_version") != 2:
            errors.append(f"feature_mapping_invalid:{feature_id}")
        feature_evidence = row.get("evidence")
        valid = isinstance(feature_evidence, dict)
        sources = feature_evidence.get("sources", []) if valid else []
        tests = feature_evidence.get("tests", {}) if valid else {}
        reports = feature_evidence.get("reports", []) if valid else []
        valid = valid and bool(sources) and bool(tests) and all(
            isinstance(test, dict) and test.get("passed") is True for test in tests.values()
        ) and bool(reports) and all(
            report.get("result") == "passed" and report.get("identity_match") is True for report in reports
        )
        for source in sources if isinstance(sources, list) else []:
            relative = Path(str(source.get("path", "")))
            candidate = (repo / relative).resolve()
            if (relative.is_absolute() or repo not in candidate.parents or not candidate.is_file() or
                    not SHA256.fullmatch(str(source.get("sha256"))) or sha256(candidate) != source.get("sha256")):
                valid = False
        for report in reports if isinstance(reports, list) else []:
            actual = documents.get(str(report.get("path", "")))
            if actual is None or actual.get("result") != "passed" or actual.get("identity") != identities.get("feature-evidence.json"):
                valid = False
        for test in tests.values() if isinstance(tests, dict) else []:
            test_path = (evidence / str(test.get("report", ""))).resolve()
            if (evidence not in test_path.parents or not test_path.is_file() or
                    not SHA256.fullmatch(str(test.get("sha256"))) or sha256(test_path) != test.get("sha256")):
                valid = False
        if not valid:
            errors.append(f"feature_evidence_invalid:{feature_id}")

    for name in set(REPORTS) - {"feature-evidence.json"}:
        if documents.get(name, {}).get("result") != "passed":
            errors.append(f"report_not_passed:{name}")

    gate_fields = {
        "recovery-matrix.json": ("result", "passed"),
        "side-effect-consistency.json": ("duplicate_user_visible_side_effects", 0),
        "ui-critical-journey.json": ("result", "passed"),
        "device-matrix.json": ("result", "passed"),
        "security-scan.json": ("result", "passed"),
        "android-security-boundaries.json": ("result", "passed"),
        "trusted-build-audit.json": ("result", "passed"),
        "upgrade-rollback.json": ("result", "passed"),
        "rollout-drill.json": ("result", "passed"),
    }
    for name, (field, expected) in gate_fields.items():
        if documents.get(name, {}).get(field) != expected:
            errors.append(f"gate_failed:{name}:{field}")

    required_scenarios = {
        "recovery-matrix.json": {
            "waiting_model_process_death", "waiting_tool_before_execution", "tool_success_before_receipt",
            "waiting_approval", "approval_success_before_resume", "running_process_death", "paused_resume",
            "terminal_rejected", "cold_start_notification_reentry",
        },
        "side-effect-consistency.json": {
            "tool_intent_receipt", "durable_receipt_replay", "approval_first_decision_wins",
            "artifact_operation_id", "needs_reconciliation", "audit_chain_query",
        },
        "ui-critical-journey.json": {
            "recovery_statuses", "cancel_idempotent", "activity_recreation", "notification_scope",
            "logout_cleanup", "fallback_status",
        },
    }
    for name, expected in required_scenarios.items():
        field = "journeys" if name == "ui-critical-journey.json" else "scenarios"
        actual = documents.get(name, {})
        if set(actual.get(field, [])) != expected or actual.get("missing") != []:
            errors.append(f"scenario_coverage_invalid:{name}")
    side_effect = documents.get("side-effect-consistency.json", {})
    if set(side_effect.get("audit_chain", [])) != {"intent", "approval", "execution", "receipt", "replay", "terminal", "reconciliation"}:
        errors.append("side_effect_audit_chain_invalid")

    security = documents.get("security-scan.json", {})
    scans = {item.get("source"): item for item in security.get("scans", []) if isinstance(item, dict)}
    if (set(scans) != {"apk", "logcat", "app_data"} or security.get("findings") != [] or
            security.get("checkpoint_receipt_scan") is not True or
            any(item.get("status") != "passed" or not isinstance(item.get("files_scanned"), int) or
                item.get("files_scanned") < 1 for item in scans.values())):
        errors.append("security_scan_evidence_invalid")

    device = documents.get("device-matrix.json", {})
    required_device_checks = {"api_26_30_35_36", "arm64", "x86_64", "physical_device", "all_reports_passed",
                              "public_device_ids_hashed"}
    if (not device.get("devices") or any(device.get("checks", {}).get(key) is not True for key in required_device_checks)):
        errors.append("device_matrix_evidence_invalid")

    rollout = documents.get("rollout-drill.json", {})
    required_drills = {"remote_kill_switch", "kotlin_lite_fallback", "apk_rollback", "data_readable_after_rollback"}
    passed_drills = {item.get("id") for item in rollout.get("drills", []) if isinstance(item, dict) and item.get("status") == "passed"}
    if (not required_drills <= passed_drills or rollout.get("decision", {}).get("action") != "expand" or
            rollout.get("incident_register", {}).get("shape_valid") is not True or
            rollout.get("incident_register", {}).get("critical_closed") is not True or
            rollout.get("incident_register", {}).get("closed_loop_exercised") is not True):
        errors.append("rollout_evidence_invalid")

    trusted = documents.get("trusted-build-audit.json", {}).get("checks", {})
    if not trusted or any(value is not True for value in trusted.values()):
        errors.append("trusted_build_evidence_invalid")
    boundaries = documents.get("android-security-boundaries.json", {}).get("checks", {})
    if not boundaries or any(value is not True for value in boundaries.values()):
        errors.append("android_security_boundary_evidence_invalid")

    upgrade = documents.get("upgrade-rollback.json", {})
    required_legacy_steps = {
        "seed_room_7_with_historical_code",
        "migrate_room_7_to_11_and_read_with_candidate",
        "platform_rollback_restore_snapshot",
        "read_restored_room_7_with_historical_code",
    }
    upgrade_steps = {
        str(item.get("step")) for item in upgrade.get("journey", [])
        if isinstance(item, dict) and item.get("status") == "passed"
    }
    upgrade_artifacts = upgrade.get("artifacts", {})
    baseline = upgrade.get("baseline", {})
    candidate = upgrade.get("candidate", {})
    rolled_back = upgrade.get("rolled_back", {})
    migration = upgrade.get("migration", {})
    legacy_valid = (
        upgrade.get("report_schema_version") == 3
        and upgrade.get("rollback_data_policy") == "restore"
        and required_legacy_steps <= upgrade_steps
        and all(SHA256.fullmatch(str(upgrade_artifacts.get(key, ""))) for key in (
            "baseline_apk", "baseline_test_apk", "candidate_apk", "candidate_test_apk"
        ))
        and upgrade_artifacts.get("baseline_apk") != upgrade_artifacts.get("candidate_apk")
        and upgrade_artifacts.get("candidate_apk") == identities.get("upgrade-rollback.json", {}).get("apk_sha256")
        and SHA_COMMIT.fullmatch(str(baseline.get("git_commit", "")))
        and candidate.get("version_code") == identities.get("upgrade-rollback.json", {}).get("version_code")
        and isinstance(baseline.get("version_code"), int)
        and baseline.get("version_code") < candidate.get("version_code", 0)
        and rolled_back.get("version_code") == baseline.get("version_code")
        and migration == {"from_room_schema": 7, "to_room_schema": 11}
        and all(upgrade.get("preserved", {}).get(key) is True for key in (
            "encrypted_login_state", "local_session", "remote_association", "remote_session", "conversation_history"
        ))
    )
    compatible_steps = {
        "seed_current_schema_with_candidate", "install_forward_compatible_rollback_apk",
        "read_current_schema_after_compatible_rollback", "verify_checkpoint_after_compatible_rollback",
    }
    compatible_valid = (
        upgrade.get("report_schema_version") == 4
        and upgrade.get("rollback_strategy") == "forward_compatible_apk"
        and upgrade.get("rollback_data_policy") == "retain"
        and compatible_steps <= upgrade_steps
        and all(SHA256.fullmatch(str(upgrade_artifacts.get(key, ""))) for key in (
            "candidate_apk", "candidate_test_apk", "rollback_apk"
        ))
        and upgrade_artifacts.get("candidate_apk") == identities.get("upgrade-rollback.json", {}).get("apk_sha256")
        and candidate.get("version_code") == identities.get("upgrade-rollback.json", {}).get("version_code")
        and isinstance(rolled_back.get("version_code"), int)
        and rolled_back.get("version_code") < candidate.get("version_code", 0)
        and migration == {"from_room_schema": 11, "to_room_schema": 11}
        and all(upgrade.get("preserved", {}).get(key) is True for key in (
            "encrypted_login_state", "local_session", "remote_association", "remote_session",
            "conversation_history", "python_checkpoint"
        ))
        and upgrade.get("environment", {}).get("kind") == "physical_device"
    )
    upgrade_valid = legacy_valid or compatible_valid
    if not upgrade_valid:
        errors.append("upgrade_rollback_evidence_invalid")

    performance = documents.get("device-performance.json", {}).get("metrics", {})
    thresholds = {
        "cold_start_p95_ms": 3000, "recovery_interactive_p95_ms": 5000,
        "foreground_pss_p95_mb": 220, "peak_pss_mb": 320,
    }
    for field, limit in thresholds.items():
        value = performance.get(field)
        if not isinstance(value, (int, float)) or value > limit:
            errors.append(f"performance_gate_failed:{field}")

    manifest = documents.get("release-manifest.json", {})
    artifacts = manifest.get("artifacts", [])
    artifact_paths = {str(item.get("path")) for item in artifacts if isinstance(item, dict)} if isinstance(artifacts, list) else set()
    if not isinstance(artifacts, list) or len(artifact_paths) != len(artifacts):
        errors.append("manifest_artifact_paths_invalid_or_duplicate")
    required_artifacts = set(REPORTS) - {"release-manifest.json"}
    if not required_artifacts <= artifact_paths:
        errors.append("manifest_required_artifacts_missing:" + ",".join(sorted(required_artifacts - artifact_paths)))
    for artifact in artifacts if isinstance(artifacts, list) else []:
        path = (evidence / str(artifact.get("path", ""))).resolve()
        expected_hash = artifact.get("sha256")
        if (evidence not in path.parents or not path.is_file() or
                not SHA256.fullmatch(str(expected_hash)) or sha256(path) != expected_hash):
            errors.append(f"manifest_artifact_invalid:{artifact.get('path')}")
    if manifest.get("immutable") is not True or manifest.get("result") != "passed":
        errors.append("manifest_not_final")
    if manifest.get("source") != {"git_commit": identities.get("release-manifest.json", {}).get("git_commit"), "git_dirty": False}:
        errors.append("manifest_source_invalid")
    apk_record = manifest.get("apk", {})
    if apk_record.get("sha256") != identities.get("release-manifest.json", {}).get("apk_sha256"):
        errors.append("manifest_apk_invalid")
    if not str(manifest.get("rollback_version", "")).strip():
        errors.append("manifest_rollback_version_missing")
    external = manifest.get("external_artifacts", [])
    sbom = next((item for item in external if isinstance(item, dict) and item.get("kind") == "sbom"), None)
    if sbom is None:
        errors.append("manifest_sbom_missing")
    else:
        sbom_path = Path(str(sbom.get("path", "")))
        if not sbom_path.is_file() or not SHA256.fullmatch(str(sbom.get("sha256"))) or sha256(sbom_path) != sbom.get("sha256"):
            errors.append("manifest_sbom_invalid")
    mapping = manifest.get("mapping", {})
    if mapping.get("status") == "included":
        if not any(isinstance(item, dict) and item.get("kind") == "mapping" for item in external):
            errors.append("manifest_mapping_missing")
    elif not (mapping.get("status") == "not_applicable" and identities.get("release-manifest.json", {}).get("variant") == "acceptance"):
        errors.append("manifest_mapping_status_invalid")

    return {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "decision": "GO" if not errors else "NO_GO",
        "errors": sorted(set(errors)),
        "reports_checked": list(REPORTS),
        "feature_count": len(feature_map),
        "apk_sha256": sha256(apk) if apk.is_file() else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.evidence.resolve(), args.apk.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    blockers = result["errors"] or ["None"]
    (args.output.parent / "go-no-go.md").write_text(
        "# Android Stage 7 Python Runtime Go/No-Go\n\n"
        f"- Decision: **{result['decision']}**\n"
        f"- Generated: `{result['generated_at']}`\n\n"
        "## Blockers\n\n" + "\n".join(f"- `{item}`" for item in blockers) + "\n",
        encoding="utf-8",
    )
    return 0 if result["decision"] == "GO" else 2


if __name__ == "__main__":
    raise SystemExit(main())
