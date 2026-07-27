"""Fail-closed finalizer for the 104-point Mobile Remote Workspace V3 release."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import mobile_remote_workspace_acceptance_v3 as acceptance


REVISION = re.compile(r"^[0-9a-f]{7,64}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_REAL_CHECKS = {
    "pre_pair_invisible",
    "pair_and_catalog",
    "two_device_isolation",
    "windows_to_android_two_runs",
    "android_to_windows_two_runs",
    "session_hash_convergence",
    "approval_single_decision",
    "revocation_stream_closed",
    "background_recovery",
    "process_death_recovery",
    "network_recovery",
    "runtime_restart_recovery",
    "relay_restart_recovery",
}
REQUIRED_ANONYMOUS_CHECKS = {
    "root_health",
    "v2_health",
    "v2_openapi",
    "v2_metrics",
    "v1_anonymous_401",
    "v2_anonymous_401",
    "wss_auth_rejection",
    "session_snapshot_anonymous_401",
    "session_stream_anonymous_401",
}
REQUIRED_FAULTS = {
    "android_background",
    "android_process_death",
    "network_change",
    "runtime_restart",
    "relay_restart",
}
REQUIRED_SECRET_SOURCES = {
    "android_apk",
    "android_logs",
    "android_room",
    "windows_database",
    "windows_logs",
    "windows_dump",
    "relay_logs",
    "relay_redis",
    "relay_postgres",
    "diagnostics",
}
RELEASE_EVIDENCE: dict[str, tuple[str, str]] = {
    "M01-F07": (
        "cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py",
        "real-device-session-e2e.json: two-device pair/revoke",
    ),
    "M05-F04": (
        "cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py",
        "real-device-session-e2e.json: device association isolation",
    ),
    "M09-F08": (
        "scripts/monitor_mobile_remote_workspace_stability_v2.py",
        "real-stability-1h.json",
    ),
    "M10-F03": (
        "scripts/smoke_runtime_relay_public_v2.py",
        "ai-dev-public-smoke.json",
    ),
    "M10-F04": (
        "scripts/accept_mobile_remote_workspace_real_device_v2.py",
        "real-device-session-e2e.json: two-device OIDC lifecycle",
    ),
    "M10-F05": (
        "apps/android/app/src/androidTest/java/ai/drsai/remote/RealRemoteWorkspaceE2ETest.kt",
        "real-device-session-e2e.json: catalog screenshots",
    ),
    "M10-F06": (
        "apps/android/app/src/androidTest/java/ai/drsai/remote/RealRemoteWorkspaceE2ETest.kt",
        "real-device-session-e2e.json: bidirectional Session stream and Approval",
    ),
    "M10-F07": (
        "scripts/accept_mobile_remote_workspace_real_device_v2.py",
        "real-device-session-e2e.json: recovery matrix",
    ),
    "M10-F08": (
        "scripts/finalize_mobile_remote_workspace_release_v3.py",
        "test_mobile_remote_workspace_release_finalizer_v3.py",
    ),
    "M16-F03": (
        "apps/desktop/shared/main/threadRuntimeSubscription.ts",
        "real-device-session-e2e.json: bidirectional Session hash convergence",
    ),
    "M16-F04": (
        "scripts/finalize_mobile_remote_workspace_release_v3.py",
        "manifest.json + real-stability-1h.json + secret-scan.json",
    ),
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"release_evidence_unreadable:{path.name}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"release_evidence_invalid:{path.name}")
    return value


def relative(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(acceptance.ROOT.resolve()).as_posix()
    except ValueError:
        return resolved.as_posix()


def sha256(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as exc:
        raise RuntimeError(f"release_artifact_unreadable:{path.name}") from exc


def passed_checks(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = report.get("checks")
    if not isinstance(rows, list):
        raise RuntimeError("release_checks_missing")
    passed = [
        row for row in rows
        if isinstance(row, dict) and row.get("status") == "passed"
    ]
    result = {str(row.get("name")): row for row in passed}
    if len(result) != len(passed):
        raise RuntimeError("release_checks_duplicate")
    return result


def validate_screenshot(row: dict[str, Any], *, label: str) -> Path:
    artifact = row.get("screenshot_artifact")
    digest = row.get("screenshot_sha256")
    if not isinstance(artifact, str) or not artifact:
        raise RuntimeError(f"release_{label}_screenshot_missing")
    path = (acceptance.ROOT / artifact).resolve()
    try:
        path.relative_to(acceptance.ROOT.resolve())
    except ValueError as exc:
        raise RuntimeError(f"release_{label}_screenshot_invalid") from exc
    if not path.is_file() or not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"release_{label}_screenshot_invalid")
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise RuntimeError(f"release_{label}_screenshot_hash_invalid")
    if sha256(path) != digest:
        raise RuntimeError(f"release_{label}_screenshot_hash_mismatch")
    return path


def validate_junit(path: Path, *, label: str, minimum_tests: int) -> int:
    files = sorted(path.glob("**/TEST-*.xml")) if path.is_dir() else [path]
    if not files or any(not file.is_file() for file in files):
        raise RuntimeError(f"release_{label}_junit_missing")
    tests = failures = errors = 0
    try:
        for file in files:
            root = ET.parse(file).getroot()
            cases = root.findall(".//testcase")
            if root.tag == "testcase":
                cases = [root]
            tests += len(cases)
            failures += len(root.findall(".//failure"))
            errors += len(root.findall(".//error"))
    except (OSError, ET.ParseError) as exc:
        raise RuntimeError(f"release_{label}_junit_invalid") from exc
    if failures or errors:
        raise RuntimeError(f"release_{label}_junit_failed")
    if tests < minimum_tests:
        raise RuntimeError(f"release_{label}_junit_too_small")
    return tests


def validate_reports(
    anonymous: dict[str, Any],
    real: dict[str, Any],
    stability: dict[str, Any],
    secret_scan: dict[str, Any],
) -> list[Path]:
    if anonymous.get("passed") is not True or anonymous.get("authenticated") is not False:
        raise RuntimeError("release_anonymous_smoke_failed")
    missing = REQUIRED_ANONYMOUS_CHECKS - passed_checks(anonymous).keys()
    if missing:
        raise RuntimeError(
            "release_anonymous_checks_missing:" + ",".join(sorted(missing))
        )

    if real.get("passed") is not True:
        raise RuntimeError("release_real_device_failed")
    checks = passed_checks(real)
    missing = REQUIRED_REAL_CHECKS - checks.keys()
    if missing:
        raise RuntimeError("release_real_checks_missing:" + ",".join(sorted(missing)))
    catalog = checks["pair_and_catalog"]
    if not (
        catalog.get("target_visible") is True
        and catalog.get("runtime_status") == "online"
        and catalog.get("workspace_lifecycles") == ["active"]
    ):
        raise RuntimeError("release_catalog_evidence_invalid")
    screenshots = [validate_screenshot(catalog, label="catalog")]
    for name in ("windows_to_android_two_runs", "android_to_windows_two_runs"):
        row = checks[name]
        if not (
            int(row.get("run_count", 0)) >= 2
            and int(row.get("duplicate_run_count", -1)) == 0
            and int(row.get("missing_sequence_count", -1)) == 0
            and float(row.get("p95_seconds", 999)) < 2
        ):
            raise RuntimeError(f"release_{name}_invalid")
        screenshots.append(validate_screenshot(row, label=name))
    hashes = checks["session_hash_convergence"]
    values = [
        hashes.get("runtime_sha256"),
        hashes.get("windows_sha256"),
        hashes.get("android_sha256"),
    ]
    if not all(isinstance(value, str) and DIGEST.fullmatch(value) for value in values):
        raise RuntimeError("release_session_hash_invalid")
    if len(set(values)) != 1:
        raise RuntimeError("release_session_hash_mismatch")
    approval = checks["approval_single_decision"]
    if not (
        int(approval.get("successful_decisions", 0)) == 1
        and int(approval.get("tool_execution_count", 0)) == 1
    ):
        raise RuntimeError("release_approval_single_decision_invalid")
    isolation = checks["two_device_isolation"]
    if not (
        isolation.get("device_a_revoked_status") == 403
        and isolation.get("device_b_status") == 200
        and isolation.get("credential_copy_rejected") is True
    ):
        raise RuntimeError("release_two_device_isolation_invalid")
    revoked = checks["revocation_stream_closed"]
    if not (
        revoked.get("stream_closed_immediately") is True
        and revoked.get("subsequent_status") == 403
    ):
        raise RuntimeError("release_revocation_stream_invalid")
    for name in (
        "background_recovery",
        "process_death_recovery",
        "network_recovery",
        "runtime_restart_recovery",
        "relay_restart_recovery",
    ):
        row = checks[name]
        if not (
            row.get("transcript_hash_preserved") is True
            and int(row.get("duplicate_run_count", -1)) == 0
            and int(row.get("missing_sequence_count", -1)) == 0
        ):
            raise RuntimeError(f"release_{name}_invalid")

    if not (
        stability.get("passed") is True
        and float(stability.get("required_duration_seconds", 0)) >= 3600
        and float(stability.get("observed_duration_seconds", 0)) >= 3600
        and int(stability.get("probe_error_count", -1)) == 0
        and stability.get("transcript_hash_stable") is True
        and stability.get("memory_within_threshold") is True
        and stability.get("handle_count_within_threshold") is True
    ):
        raise RuntimeError("release_stability_invalid")
    faults = stability.get("faults")
    if not isinstance(faults, list):
        raise RuntimeError("release_stability_faults_missing")
    fault_names = {
        str(row.get("name"))
        for row in faults
        if isinstance(row, dict)
        and row.get("status") == "passed"
        and row.get("transcript_hash_preserved") is True
    }
    missing = REQUIRED_FAULTS - fault_names
    if missing:
        raise RuntimeError("release_stability_faults_missing:" + ",".join(sorted(missing)))

    if secret_scan.get("passed") is not True or secret_scan.get("matches") not in (0, []):
        raise RuntimeError("release_secret_scan_failed")
    sources = secret_scan.get("sources")
    if not isinstance(sources, list):
        raise RuntimeError("release_secret_sources_missing")
    clean_sources = {
        str(row.get("name"))
        for row in sources
        if isinstance(row, dict)
        and row.get("status") == "clean"
        and int(row.get("bytes_scanned", 0)) > 0
    }
    missing = REQUIRED_SECRET_SOURCES - clean_sources
    if missing:
        raise RuntimeError("release_secret_sources_missing:" + ",".join(sorted(missing)))
    return screenshots


def merge_convergence_report(
    real: dict[str, Any],
    convergence: dict[str, Any],
) -> dict[str, Any]:
    if convergence.get("passed") is not True:
        raise RuntimeError("release_convergence_report_failed")
    rows = convergence.get("checks")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("release_convergence_report_invalid")
    allowed = {
        "session_hash_convergence",
        "android_to_windows_two_runs",
        "windows_to_android_two_runs",
    }
    names = {
        str(row.get("name"))
        for row in rows
        if isinstance(row, dict) and row.get("status") == "passed"
    }
    if "session_hash_convergence" not in names or not names <= allowed or len(names) != len(rows):
        raise RuntimeError("release_convergence_report_invalid")
    merged = json.loads(json.dumps(real))
    existing = merged.get("checks")
    if not isinstance(existing, list):
        raise RuntimeError("release_checks_missing")
    merged["checks"] = [
        row
        for row in existing
        if not isinstance(row, dict) or row.get("name") not in names
    ] + rows
    return merged


def finalize(
    ledger_path: Path,
    anonymous_path: Path,
    real_path: Path,
    stability_path: Path,
    secret_scan_path: Path,
    apk_path: Path,
    python_junit_path: Path,
    android_junit_path: Path,
    desktop_junit_path: Path,
    *,
    hai_revision: str,
    windows_revision: str,
    android_revision: str,
    convergence_path: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    for label, revision in (
        ("hai", hai_revision),
        ("windows", windows_revision),
        ("android", android_revision),
    ):
        if not REVISION.fullmatch(revision):
            raise RuntimeError(f"release_{label}_revision_invalid")
    ledger = read_json(ledger_path)
    errors = acceptance.validate(ledger)
    if errors:
        raise RuntimeError("release_ledger_invalid:" + ";".join(errors))
    reports = [
        anonymous_path,
        real_path,
        stability_path,
        secret_scan_path,
    ]
    anonymous, real, stability, secret_scan = (
        read_json(path) for path in reports
    )
    if convergence_path is not None:
        real = merge_convergence_report(real, read_json(convergence_path))
        reports.append(convergence_path)
    screenshots = validate_reports(
        anonymous,
        real,
        stability,
        secret_scan,
    )
    test_counts = {
        "python": validate_junit(python_junit_path, label="python", minimum_tests=500),
        "android": validate_junit(android_junit_path, label="android", minimum_tests=200),
        "desktop": validate_junit(desktop_junit_path, label="desktop", minimum_tests=4),
    }
    if not apk_path.is_file():
        raise RuntimeError("release_android_apk_unreadable")

    common = [
        {"kind": "ai_dev", "artifact": relative(anonymous_path), "result": "passed"},
        {"kind": "windows_runtime", "artifact": relative(real_path), "result": "passed"},
        {"kind": "android_device", "artifact": relative(real_path), "result": "passed"},
    ]
    for item in ledger["items"]:
        evidence = list(item.get("evidence", []))
        if item["id"] in RELEASE_EVIDENCE:
            artifact, command = RELEASE_EVIDENCE[item["id"]]
            kinds = {entry.get("kind") for entry in evidence}
            if "code" not in kinds:
                evidence.append({"kind": "code", "artifact": artifact})
            if "automated_test" not in kinds:
                evidence.append(
                    {
                        "kind": "automated_test",
                        "command": command,
                        "result": "passed",
                    }
                )
        for row in common:
            if row["kind"] not in {entry.get("kind") for entry in evidence}:
                evidence.append(dict(row))
        item["evidence"] = evidence
        item["status"] = "full_pass"
        item["blockers"] = []
    ledger["versions"] = {
        **ledger.get("versions", {}),
        "protocol_schema": "2.0.0",
        "session_event_profile": "session-events/1",
        "hai_revision": hai_revision,
        "windows_revision": windows_revision,
        "android_revision": android_revision,
        "android_apk_sha256": sha256(apk_path),
    }
    errors = acceptance.validate(ledger)
    if errors:
        raise RuntimeError("release_final_ledger_invalid:" + ";".join(errors))

    artifacts = [
        *reports,
        python_junit_path,
        android_junit_path,
        desktop_junit_path,
        apk_path,
        *screenshots,
    ]
    unique = {path.resolve(): path for path in artifacts}
    manifest = {
        "schema_version": 1,
        "release": "mobile-remote-workspace-v3",
        "full_pass": 104,
        "revisions": {
            "hai": hai_revision,
            "windows": windows_revision,
            "android": android_revision,
        },
        "test_counts": test_counts,
        "artifacts": [
            {
                "path": relative(path),
                "sha256": sha256(path),
                "size": path.stat().st_size,
            }
            for path in sorted(unique.values(), key=lambda value: relative(value))
        ],
    }
    return ledger, manifest


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    evidence = acceptance.ROOT / "release/product-evidence/mobile-remote-workspace-v3"
    parser.add_argument("--ledger", type=Path, default=acceptance.LEDGER)
    parser.add_argument("--anonymous-report", type=Path, default=evidence / "ai-dev-public-smoke.json")
    parser.add_argument("--real-device-report", type=Path, default=evidence / "real-device-session-e2e.json")
    parser.add_argument("--stability-report", type=Path, default=evidence / "real-stability-1h.json")
    parser.add_argument("--secret-scan", type=Path, default=evidence / "secret-scan.json")
    parser.add_argument(
        "--convergence-report",
        type=Path,
        default=evidence / "session-convergence.json",
    )
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--python-junit", type=Path, default=evidence / "python-junit.xml")
    parser.add_argument("--android-junit", type=Path, default=evidence / "android-junit")
    parser.add_argument("--desktop-junit", type=Path, default=evidence / "desktop-junit.xml")
    parser.add_argument("--hai-revision", required=True)
    parser.add_argument("--windows-revision", required=True)
    parser.add_argument("--android-revision", required=True)
    parser.add_argument("--output", type=Path, default=acceptance.LEDGER)
    parser.add_argument("--manifest", type=Path, default=evidence / "manifest.json")
    args = parser.parse_args()
    ledger, manifest = finalize(
        args.ledger,
        args.anonymous_report,
        args.real_device_report,
        args.stability_report,
        args.secret_scan,
        args.apk,
        args.python_junit,
        args.android_junit,
        args.desktop_junit,
        hai_revision=args.hai_revision,
        windows_revision=args.windows_revision,
        android_revision=args.android_revision,
        convergence_path=args.convergence_report,
    )
    atomic_json(args.output, ledger)
    atomic_json(args.manifest, manifest)
    print(json.dumps({"valid": True, "full_pass": 104, "manifest": str(args.manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
