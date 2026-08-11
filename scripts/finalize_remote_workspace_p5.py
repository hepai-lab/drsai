from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

import jsonschema

FEATURE_IDS = {f"P5-M{module:02d}-F{feature:02d}" for module in range(1, 9) for feature in range(1, 7)}
REQUIRED_EVIDENCE = {"contract", "android", "desktop", "runtime", "relay", "security", "stability", "accessibility"}
SECRET_SOURCES = {
    "android_apk", "android_logs", "android_room", "android_backup",
    "windows_database", "windows_dpapi", "windows_logs", "windows_dump",
    "relay_postgres", "relay_redis", "relay_logs",
}
REQUIRED_FAULTS = {
    "android_background", "android_process_death", "network_change",
    "runtime_restart", "relay_restart",
}
REQUIRED_PLATFORM_ENDPOINTS = {
    "/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream",
    "/metrics/protocol-usage",
    "/metrics/protocol-usage/deletion-decision",
    "/associations/{runtime_id}/push-registration#PUT",
    "/associations/{runtime_id}/push-registration#DELETE",
}
REQUIRED_EXPERIENCE_CHECKS = {
    "talkback_navigation", "touch_target_48dp", "dynamic_text_200_percent", "contrast",
    "connection_state_action", "approval_risk_announcement", "notification_deep_link",
    "offline_stale_semantics",
}
REQUIRED_MANUAL_SCENARIOS = {
    "pair_by_qr", "browse_catalog", "open_session", "send_message",
    "approval_decision", "cancel_and_retry", "revoke_device", "recover_after_restart",
}
PLATFORM_CONTRACT = Path(__file__).parents[1] / "cores/protocol/relay/p5-platform-adapter.contract.json"
EVIDENCE_SCHEMA = Path(__file__).parents[1] / "cores/protocol/relay/remote-workspace-p5-evidence.schema.json"


def platform_contract_sha256() -> str:
    if not PLATFORM_CONTRACT.is_file() or not PLATFORM_CONTRACT.read_bytes():
        return ""
    return hashlib.sha256(PLATFORM_CONTRACT.read_bytes()).hexdigest()


def finalize(value: object, artifact_root: Path | None = None) -> dict[str, object]:
    try:
        return _finalize(value, artifact_root)
    except (OSError, RuntimeError, TypeError, ValueError, OverflowError):
        return {"status": "failed", "features": 0, "errors": ["p5_evidence_malformed"]}


def _finalize(value: object, artifact_root: Path | None = None) -> dict[str, object]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return {"status": "failed", "errors": ["p5_evidence_object_required"]}
    try:
        schema = json.loads(EVIDENCE_SCHEMA.read_text(encoding="utf-8"))
        if next(jsonschema.Draft202012Validator(schema).iter_errors(value), None) is not None:
            errors.append("p5_schema_validation_failed")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, jsonschema.SchemaError):
        errors.append("p5_schema_unavailable_or_invalid")
    if value.get("schema_version") != "p5/1": errors.append("p5_schema_version_invalid")
    environment = value.get("environment")
    if not isinstance(environment, dict): errors.append("p5_environment_missing")
    else:
        relay_url = str(environment.get("relay_url", ""))
        if urlparse(relay_url).scheme != "https" or not urlparse(relay_url).netloc: errors.append("p5_relay_url_invalid")
        if not _digest(environment.get("schema_hash")): errors.append("p5_schema_hash_invalid")
        contract_hash = environment.get("platform_contract_sha256")
        expected_contract_hash = platform_contract_sha256()
        if not _digest(contract_hash): errors.append("p5_platform_contract_hash_invalid")
        elif not expected_contract_hash or contract_hash != expected_contract_hash:
            errors.append("p5_platform_contract_drift")
        if not str(environment.get("environment_id", "")).strip(): errors.append("p5_environment_id_missing")
    build = value.get("build")
    if not isinstance(build, dict): errors.append("p5_build_missing")
    else:
        if build.get("type") != "release": errors.append("p5_release_build_required")
        if not _digest(build.get("sha256")): errors.append("p5_build_sha256_invalid")
        _verify_artifact(errors, "p5_build", build, "artifact", "sha256", "bytes", artifact_root)
    contract_report = value.get("contract_report")
    if not isinstance(contract_report, dict): errors.append("p5_contract_report_missing")
    else:
        _verify_artifact(errors, "p5_contract_report", contract_report, "artifact", "artifact_sha256",
                         "artifact_bytes", artifact_root)
        if contract_report.get("schema_version") != "p5-contract-evidence/1" \
                or contract_report.get("passed") is not True:
            errors.append("p5_contract_report_invalid")
        if not _digest(contract_report.get("openapi_sha256")) \
                or not isinstance(contract_report.get("openapi_bytes"), int) \
                or isinstance(contract_report.get("openapi_bytes"), bool) \
                or contract_report.get("openapi_bytes", 0) <= 0:
            errors.append("p5_contract_openapi_attestation_invalid")
        _verify_artifact(errors, "p5_contract_openapi", contract_report, "openapi_artifact",
                         "openapi_sha256", "openapi_bytes", artifact_root)
        if set(contract_report.get("verified_endpoints") or []) != REQUIRED_PLATFORM_ENDPOINTS:
            errors.append("p5_contract_endpoint_attestation_invalid")
        if isinstance(environment, dict) and (
            contract_report.get("environment_id") != environment.get("environment_id")
            or contract_report.get("relay_url") != str(environment.get("relay_url", "")).rstrip("/")
            or contract_report.get("platform_contract_sha256") != environment.get("platform_contract_sha256")
        ):
            errors.append("p5_contract_mixed_environment")
        if artifact_root is not None and not _report_content_matches(
            contract_report, artifact_root,
            {"artifact", "artifact_bytes", "artifact_sha256", "openapi_artifact"},
        ):
            errors.append("p5_contract_report_artifact_content_mismatch")
    devices = value.get("devices")
    device_proofs: set[str] = set()
    if not isinstance(devices, list) or len(devices) < 2: errors.append("p5_two_devices_required")
    else:
        for device in devices:
            if not isinstance(device, dict) or device.get("physical") is not True or device.get("emulator") is not False:
                errors.append("p5_physical_device_required"); continue
            proof = str(device.get("proof_sha256", ""))
            if not _digest(proof): errors.append("p5_device_proof_invalid")
            elif proof in device_proofs: errors.append("p5_distinct_devices_required")
            device_proofs.add(proof)
            _verify_artifact(errors, "p5_device_proof", device, "proof_artifact", "proof_sha256",
                             "proof_bytes", artifact_root)
    features = value.get("features")
    if not isinstance(features, list): errors.append("p5_features_missing")
    else:
        rows = {str(row.get("id")): row for row in features if isinstance(row, dict)}
        if len(features) != len(FEATURE_IDS) or len(rows) != len(features):
            errors.append("p5_feature_rows_invalid")
        if set(rows) != FEATURE_IDS: errors.append("p5_feature_set_incomplete")
        if any(row.get("status") != "passed" for row in rows.values()): errors.append("p5_feature_not_passed")
        if any(not _digest(row.get("evidence_sha256")) for row in rows.values()): errors.append("p5_feature_evidence_invalid")
    evidence = value.get("evidence")
    if not isinstance(evidence, list): errors.append("p5_evidence_missing")
    else:
        categories = {row.get("category") for row in evidence if isinstance(row, dict)
                      and isinstance(row.get("category"), str)
                      and _positive_int(row.get("bytes")) and _digest(row.get("sha256"))}
        missing = REQUIRED_EVIDENCE - categories
        if missing: errors.append("p5_evidence_categories_missing:" + ",".join(sorted(missing)))
        environment_values = [row.get("environment_id") for row in evidence if isinstance(row, dict)]
        environment_ids = set(environment_values) if all(isinstance(item, str) for item in environment_values) else set()
        if isinstance(environment, dict) and environment_ids != {environment.get("environment_id")}:
            errors.append("p5_mixed_environment_evidence")
        digests = [row.get("sha256") for row in evidence if isinstance(row, dict)]
        artifacts = [row.get("artifact") for row in evidence if isinstance(row, dict)]
        if not all(isinstance(item, str) for item in digests) or len(set(digests)) != len(digests):
            errors.append("p5_evidence_digest_reused")
        if not all(isinstance(item, str) for item in artifacts) or len(set(artifacts)) != len(artifacts):
            errors.append("p5_evidence_artifact_reused")
        coverage: dict[str, set[str]] = {}
        for row in evidence:
            if not isinstance(row, dict): continue
            digest = row.get("sha256")
            feature_ids = row.get("feature_ids")
            if not _digest(digest) or not isinstance(feature_ids, list) \
                    or not feature_ids or not all(isinstance(feature_id, str) for feature_id in feature_ids) \
                    or len(set(feature_ids)) != len(feature_ids) \
                    or any(feature_id not in FEATURE_IDS for feature_id in feature_ids):
                errors.append("p5_evidence_feature_mapping_invalid")
            else:
                coverage[str(digest)] = set(feature_ids)
            artifact = row.get("artifact")
            if not isinstance(artifact, str) or not _safe_relative_artifact(artifact):
                errors.append("p5_evidence_artifact_path_invalid")
                continue
            if artifact_root is not None:
                path = (artifact_root / artifact).resolve()
                root = artifact_root.resolve()
                if root not in path.parents or not path.is_file():
                    errors.append("p5_evidence_artifact_missing")
                    continue
                raw = path.read_bytes()
                if not raw or len(raw) != row.get("bytes"):
                    errors.append("p5_evidence_artifact_size_mismatch")
                if hashlib.sha256(raw).hexdigest() != digest:
                    errors.append("p5_evidence_artifact_digest_mismatch")
        if isinstance(features, list):
            for feature in features:
                if not isinstance(feature, dict): continue
                feature_id = str(feature.get("id"))
                if feature_id not in coverage.get(str(feature.get("evidence_sha256")), set()):
                    errors.append("p5_feature_evidence_unbound")
            mapped = set().union(*coverage.values()) if coverage else set()
            if mapped != FEATURE_IDS:
                errors.append("p5_evidence_feature_coverage_incomplete")
    secret_scan = value.get("secret_scan")
    if not isinstance(secret_scan, dict): errors.append("p5_secret_scan_missing")
    else:
        _verify_artifact(errors, "p5_secret_scan", secret_scan, "artifact", "artifact_sha256",
                         "artifact_bytes", artifact_root)
        if secret_scan.get("schema_version") != "p5-secret/1": errors.append("p5_secret_scan_schema_invalid")
        if secret_scan.get("profile") != "mobile-remote-workspace-p5": errors.append("p5_secret_scan_profile_invalid")
        if secret_scan.get("passed") is not True or secret_scan.get("matches") != 0:
            errors.append("p5_secret_scan_failed")
        if secret_scan.get("raw_artifacts_crossed_trust_boundary") is not False:
            errors.append("p5_secret_raw_artifact_boundary_violated")
        if artifact_root is not None and not _report_content_matches(
            secret_scan, artifact_root, {"artifact", "artifact_bytes", "artifact_sha256"}
        ):
            errors.append("p5_secret_scan_artifact_content_mismatch")
        if isinstance(environment, dict) and secret_scan.get("environment_id") != environment.get("environment_id"):
            errors.append("p5_secret_scan_mixed_environment")
        sources = secret_scan.get("sources")
        if not isinstance(sources, list): errors.append("p5_secret_sources_missing")
        else:
            indexed = {row.get("name"): row for row in sources if isinstance(row, dict)}
            if set(indexed) != SECRET_SOURCES or len(sources) != len(SECRET_SOURCES):
                errors.append("p5_secret_source_set_incomplete")
            elif any(row.get("status") != "clean" or not isinstance(row.get("bytes_scanned"), int)
                     or isinstance(row.get("bytes_scanned"), bool) or row.get("bytes_scanned", 0) <= 0
                     or not isinstance(row.get("files_scanned"), int)
                     or isinstance(row.get("files_scanned"), bool) or row.get("files_scanned", 0) <= 0
                     for row in indexed.values()):
                errors.append("p5_secret_source_not_clean")
        boundary_reports = secret_scan.get("boundary_reports")
        if not isinstance(boundary_reports, list): errors.append("p5_secret_boundary_reports_missing")
        else:
            boundaries = {row.get("boundary") for row in boundary_reports if isinstance(row, dict)}
            if boundaries != {"android", "windows", "relay"} or len(boundary_reports) != 3:
                errors.append("p5_secret_boundary_reports_invalid")
            elif any(not _digest(row.get("report_sha256")) or row.get("source_count") not in {3, 4}
                     for row in boundary_reports):
                errors.append("p5_secret_boundary_attestation_invalid")
            else:
                android_report = next(row for row in boundary_reports if row.get("boundary") == "android")
                if not _digest(android_report.get("artifact_sha256")):
                    errors.append("p5_android_artifact_attestation_invalid")
                elif isinstance(build, dict) and android_report.get("artifact_sha256") != build.get("sha256"):
                    errors.append("p5_android_secret_scan_build_mismatch")
    stability = value.get("stability_report")
    if not isinstance(stability, dict): errors.append("p5_stability_report_missing")
    else:
        _verify_artifact(errors, "p5_stability", stability, "artifact", "artifact_sha256",
                         "artifact_bytes", artifact_root)
        if stability.get("schema_version") != "p5-stability/1": errors.append("p5_stability_schema_invalid")
        if stability.get("passed") is not True: errors.append("p5_stability_failed")
        if artifact_root is not None and not _report_content_matches(
            stability, artifact_root, {"artifact", "artifact_bytes", "artifact_sha256"}
        ):
            errors.append("p5_stability_artifact_content_mismatch")
        if isinstance(environment, dict) and stability.get("environment_id") != environment.get("environment_id"):
            errors.append("p5_stability_mixed_environment")
        if int(stability.get("required_duration_seconds", 0)) < 3600 or int(stability.get("observed_duration_seconds", 0)) < 3600:
            errors.append("p5_stability_duration_incomplete")
        if int(stability.get("probe_error_count", -1)) != 0 or int(stability.get("duplicate_sequence_count", -1)) != 0 \
                or int(stability.get("missing_sequence_count", -1)) != 0 \
                or int(stability.get("reexecuted_side_effect_count", -1)) != 0:
            errors.append("p5_stability_integrity_failed")
        if float(stability.get("relay_latency_p95_ms", 999999)) >= 2000 \
                or float(stability.get("windows_memory_slope_bytes_per_second", 999999)) >= 1024 * 1024 / 60 \
                or float(stability.get("windows_handle_slope_per_second", 999999)) >= 1 / 60:
            errors.append("p5_stability_resource_threshold_failed")
        hashes = stability.get("transcript_hashes")
        if not isinstance(hashes, dict) or set(hashes) != {"android", "desktop", "runtime"} \
                or any(not _digest(item) for item in hashes.values()) or len(set(hashes.values())) != 1:
            errors.append("p5_stability_transcript_mismatch")
        faults = stability.get("faults")
        if not isinstance(faults, list): errors.append("p5_stability_faults_missing")
        else:
            indexed = {row.get("name"): row for row in faults if isinstance(row, dict)}
            if set(indexed) != REQUIRED_FAULTS or len(faults) != len(REQUIRED_FAULTS):
                errors.append("p5_stability_fault_set_incomplete")
            elif any(row.get("status") != "passed" or row.get("sequence_preserved") is not True
                     or row.get("transcript_preserved") is not True
                     or int(row.get("duplicate_sequence_count", -1)) != 0
                     or int(row.get("missing_sequence_count", -1)) != 0
                     or int(row.get("reexecuted_side_effect_count", -1)) != 0
                     for row in indexed.values()):
                errors.append("p5_stability_fault_failed")
    legacy_removal = value.get("legacy_removal")
    if not isinstance(legacy_removal, dict):
        errors.append("p5_legacy_removal_missing")
    else:
        _validate_legacy_removal(errors, legacy_removal, environment, artifact_root)
    experience = value.get("experience_report")
    if not isinstance(experience, dict):
        errors.append("p5_experience_report_missing")
    else:
        _verify_artifact(errors, "p5_experience", experience, "artifact", "artifact_sha256",
                         "artifact_bytes", artifact_root)
        if experience.get("schema_version") != "p5-experience/1" or experience.get("passed") is not True:
            errors.append("p5_experience_report_invalid")
        if isinstance(environment, dict) and experience.get("environment_id") != environment.get("environment_id"):
            errors.append("p5_experience_mixed_environment")
        proof_values = experience.get("device_proof_sha256s")
        if not isinstance(proof_values, list) or not all(_digest(item) for item in proof_values) \
                or set(proof_values) != device_proofs:
            errors.append("p5_experience_device_proofs_mismatch")
        checks = experience.get("checks")
        if not isinstance(checks, list) or not all(isinstance(item, str) for item in checks) \
                or len(checks) != len(set(checks)) or set(checks) != REQUIRED_EXPERIENCE_CHECKS:
            errors.append("p5_experience_checks_incomplete")
        scenarios = experience.get("manual_scenarios")
        if not isinstance(scenarios, list):
            errors.append("p5_experience_scenarios_missing")
        else:
            indexed = {row.get("name"): row for row in scenarios if isinstance(row, dict)
                       and isinstance(row.get("name"), str)}
            if len(scenarios) != len(REQUIRED_MANUAL_SCENARIOS) \
                    or set(indexed) != REQUIRED_MANUAL_SCENARIOS \
                    or any(row.get("status") != "passed" for row in indexed.values()):
                errors.append("p5_experience_scenarios_incomplete")
        if experience.get("accessibility_violations") != 0 \
                or experience.get("raw_sensitive_content_exported") is not False:
            errors.append("p5_experience_accessibility_failed")
        if artifact_root is not None:
            loaded = _read_json_artifact(experience.get("artifact"), artifact_root)
            embedded = {key: item for key, item in experience.items()
                        if key not in {"artifact", "artifact_bytes", "artifact_sha256"}}
            if loaded is None:
                errors.append("p5_experience_artifact_json_invalid")
            elif loaded != embedded:
                errors.append("p5_experience_artifact_content_mismatch")
    return {"status": "passed" if not errors else "failed", "features": len(FEATURE_IDS) if not errors else 0,
            "errors": sorted(set(errors))}


def _digest(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(ch in "0123456789abcdef" for ch in value)


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _safe_relative_artifact(value: str) -> bool:
    path = Path(value)
    return bool(value.strip()) and not path.is_absolute() and ".." not in path.parts


def _verify_artifact(errors: list[str], prefix: str, row: dict[str, object], artifact_key: str,
                     digest_key: str, bytes_key: str, artifact_root: Path | None) -> None:
    artifact = row.get(artifact_key)
    digest = row.get(digest_key)
    declared_bytes = row.get(bytes_key)
    if not isinstance(artifact, str) or not _safe_relative_artifact(artifact):
        errors.append(f"{prefix}_artifact_path_invalid")
        return
    if not _digest(digest) or not _positive_int(declared_bytes):
        errors.append(f"{prefix}_artifact_attestation_invalid")
        return
    if artifact_root is None:
        return
    root = artifact_root.resolve()
    path = (root / artifact).resolve()
    if root not in path.parents or not path.is_file():
        errors.append(f"{prefix}_artifact_missing")
        return
    raw = path.read_bytes()
    if not raw or len(raw) != declared_bytes:
        errors.append(f"{prefix}_artifact_size_mismatch")
    if hashlib.sha256(raw).hexdigest() != digest:
        errors.append(f"{prefix}_artifact_digest_mismatch")


def _validate_legacy_removal(errors: list[str], row: dict[str, object],
                             environment: object, artifact_root: Path | None) -> None:
    if row.get("schema_version") != "p5-legacy-removal/1" or row.get("passed") is not True:
        errors.append("p5_legacy_removal_report_invalid")
    if isinstance(environment, dict) and row.get("environment_id") != environment.get("environment_id"):
        errors.append("p5_legacy_removal_mixed_environment")
    for label in ("decision", "rollback", "migration"):
        _verify_artifact(errors, f"p5_legacy_{label}", row, f"{label}_artifact",
                         f"{label}_sha256", f"{label}_bytes", artifact_root)

    decision = row.get("decision")
    try:
        contract = json.loads(PLATFORM_CONTRACT.read_text(encoding="utf-8"))
        schema = contract["$defs"]["protocol_deletion_decision"]
        jsonschema.Draft202012Validator(schema).validate(decision)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError,
            jsonschema.SchemaError, jsonschema.ValidationError):
        errors.append("p5_legacy_deletion_decision_invalid")
    if not isinstance(decision, dict) or not (
        decision.get("status") == "eligible"
        and decision.get("eligible") is True
        and _at_least(decision.get("oaep_ratio"), 0.999)
        and _less_than(decision.get("legacy_ratio"), 0.001)
        and decision.get("migration_ratio") == 1.0
        and _at_most(decision.get("fallback_error_ratio"), 0.001)
    ):
        errors.append("p5_legacy_deletion_not_eligible")

    migration = row.get("migration")
    if not isinstance(migration, dict) or not (
        migration.get("schema_version") == "p5-legacy-migration/1"
        and migration.get("database_migration_verified") is True
        and _digest(migration.get("migration_transcript_before_sha256"))
        and migration.get("migration_transcript_before_sha256")
        == migration.get("migration_transcript_after_sha256")
        and migration.get("rollback_artifact_sha256") == row.get("rollback_sha256")
    ):
        errors.append("p5_legacy_migration_evidence_invalid")

    if artifact_root is not None:
        for label, embedded in (("decision", decision), ("migration", migration)):
            loaded = _read_json_artifact(row.get(f"{label}_artifact"), artifact_root)
            if loaded is None:
                errors.append(f"p5_legacy_{label}_artifact_json_invalid")
            elif loaded != embedded:
                errors.append(f"p5_legacy_{label}_artifact_content_mismatch")


def _read_json_artifact(relative: object, artifact_root: Path) -> object | None:
    if not isinstance(relative, str) or not _safe_relative_artifact(relative):
        return None
    root = artifact_root.resolve()
    path = (root / relative).resolve()
    if root not in path.parents or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def _report_content_matches(row: dict[str, object], artifact_root: Path,
                            excluded_keys: set[str]) -> bool:
    loaded = _read_json_artifact(row.get("artifact"), artifact_root)
    if loaded is None:
        return False
    embedded = {key: item for key, item in row.items() if key not in excluded_keys}
    return loaded == embedded


def _at_least(value: object, threshold: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= threshold


def _at_most(value: object, threshold: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value <= threshold


def _less_than(value: object, threshold: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value < threshold


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("ledger", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.ledger.is_file() or not args.ledger.read_bytes(): raise SystemExit("p5_ledger_missing")
    result = finalize(json.loads(args.ledger.read_text(encoding="utf-8")), args.ledger.parent)
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output: args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__": raise SystemExit(main())
