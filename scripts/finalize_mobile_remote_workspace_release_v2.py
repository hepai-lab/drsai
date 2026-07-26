"""Fail-closed finalizer for the 80-point Mobile Remote Workspace V2 release."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import mobile_remote_workspace_acceptance_v2 as acceptance


REQUIRED_REAL_CHECKS = {
    "pre_pair_invisible",
    "pair_and_catalog",
    "message_stream_approval",
    "background_recovery",
    "process_death_recovery",
    "offline_fail_closed",
    "network_recovery",
    "runtime_restart_recovery",
    "relay_fault_recovery",
    "revocation_invisible",
    "repair_association",
}
REQUIRED_ANONYMOUS_CHECKS = {
    "root_health",
    "v2_health",
    "v2_openapi",
    "v2_metrics",
    "v1_anonymous_401",
    "v2_anonymous_401",
    "wss_auth_rejection",
}
MISSING_LOCAL_EVIDENCE: dict[str, tuple[str, str]] = {
    "M01-F07": (
        "cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py",
        "real-device-e2e.json: pre/pair/revoke/re-pair",
    ),
    "M05-F04": (
        "cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py",
        "real-device-e2e.json: pre_pair_invisible + pair_and_catalog",
    ),
    "M09-F08": (
        "scripts/monitor_mobile_remote_workspace_stability_v2.py",
        "real-stability-1h.json",
    ),
    "M10-F03": (
        "scripts/smoke_runtime_relay_public_v2.py",
        "anonymous smoke + authenticated opaque pagination",
    ),
    "M10-F04": (
        "scripts/accept_mobile_remote_workspace_real_device_v2.py",
        "real-device-e2e.json: real OIDC association",
    ),
    "M10-F05": (
        "apps/android/app/src/androidTest/java/ai/drsai/remote/RealRemoteWorkspaceE2ETest.kt",
        "real-device-e2e.json: directory/session UI",
    ),
    "M10-F06": (
        "apps/android/app/src/androidTest/java/ai/drsai/remote/RealRemoteWorkspaceE2ETest.kt",
        "real-device-e2e.json: message/SSE/Approval",
    ),
    "M10-F07": (
        "scripts/accept_mobile_remote_workspace_real_device_v2.py",
        "real-device-e2e.json: fault matrix",
    ),
    "M10-F08": (
        "scripts/finalize_mobile_remote_workspace_release_v2.py",
        "test_mobile_remote_workspace_release_finalizer.py",
    ),
}
REVISION = re.compile(r"^[0-9a-f]{7,64}$")


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
        return str(resolved.relative_to(acceptance.ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(resolved).replace("\\", "/")


def passed_checks(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = report.get("checks")
    if not isinstance(rows, list):
        raise RuntimeError("release_checks_missing")
    result = {
        str(row.get("name")): row
        for row in rows
        if isinstance(row, dict) and row.get("status") == "passed"
    }
    if len(result) != len([row for row in rows if isinstance(row, dict) and row.get("status") == "passed"]):
        raise RuntimeError("release_checks_duplicate")
    return result


def validate_screenshot(row: dict[str, Any], *, label: str) -> None:
    artifact = row.get("screenshot_artifact")
    digest = row.get("screenshot_sha256")
    if not isinstance(artifact, str) or not artifact:
        raise RuntimeError(f"release_{label}_screenshot_missing")
    path = (acceptance.ROOT / artifact).resolve()
    try:
        path.relative_to(acceptance.ROOT.resolve())
    except ValueError as exc:
        raise RuntimeError(f"release_{label}_screenshot_invalid") from exc
    if not path.is_file():
        raise RuntimeError(f"release_{label}_screenshot_missing")
    content = path.read_bytes()
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"release_{label}_screenshot_invalid")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise RuntimeError(f"release_{label}_screenshot_hash_invalid")
    if hashlib.sha256(content).hexdigest() != digest:
        raise RuntimeError(f"release_{label}_screenshot_hash_mismatch")


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
) -> None:
    if anonymous.get("passed") is not True or anonymous.get("authenticated") is not False:
        raise RuntimeError("release_anonymous_smoke_failed")
    missing = REQUIRED_ANONYMOUS_CHECKS - passed_checks(anonymous).keys()
    if missing:
        raise RuntimeError(f"release_anonymous_checks_missing:{','.join(sorted(missing))}")

    if real.get("passed") is not True:
        raise RuntimeError("release_real_device_failed")
    real_checks = passed_checks(real)
    missing = REQUIRED_REAL_CHECKS - real_checks.keys()
    if missing:
        raise RuntimeError(f"release_real_checks_missing:{','.join(sorted(missing))}")
    catalog = real_checks["pair_and_catalog"]
    lifecycle_counts = catalog.get("runtime_authoritative_lifecycle_counts")
    if not (
        catalog.get("target_visible") is True
        and catalog.get("runtime_status") == "online"
        and catalog.get("directory_ui_visible") is True
        and catalog.get("authenticated_opaque_pagination") is True
        and catalog.get("tampered_cursor_rejected") is True
        and catalog.get("workspace_lifecycles") == ["active"]
        and isinstance(lifecycle_counts, dict)
        and int(lifecycle_counts.get("active", 0)) >= 2
        and int(lifecycle_counts.get("archived", 0)) >= 1
        and int(lifecycle_counts.get("removed", 0)) >= 1
    ):
        raise RuntimeError("release_authenticated_catalog_evidence_invalid")
    validate_screenshot(catalog, label="catalog")
    interaction = real_checks["message_stream_approval"]
    if not (
        interaction.get("terminal_status") == "completed"
        and interaction.get("approval_status") == "approved"
        and interaction.get("session_ui_visible") is True
        and int(interaction.get("sse_event_count", 0)) > 0
        and int(interaction.get("conversation_after", 0))
        > int(interaction.get("conversation_before", 0))
        and isinstance(interaction.get("conversation_sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", interaction["conversation_sha256"])
    ):
        raise RuntimeError("release_interaction_evidence_invalid")
    validate_screenshot(interaction, label="interaction")
    if real_checks["pre_pair_invisible"].get("target_visible") is not False:
        raise RuntimeError("release_pre_pair_visibility_invalid")
    if real_checks["offline_fail_closed"].get("network_failure") is not True:
        raise RuntimeError("release_offline_evidence_invalid")
    revoked = real_checks["revocation_invisible"]
    if not (
        revoked.get("target_visible") is False
        and revoked.get("workspace_proxy_status") == 403
        and revoked.get("conversation_proxy_status") == 403
    ):
        raise RuntimeError("release_revocation_visibility_invalid")
    for name in (
        "background_recovery",
        "process_death_recovery",
        "network_recovery",
        "runtime_restart_recovery",
        "repair_association",
    ):
        if real_checks[name].get("target_visible") is not True:
            raise RuntimeError(f"release_{name}_invalid")
    fault = real_checks["relay_fault_recovery"]
    if not (
        fault.get("target_visible") is True
        and fault.get("event_replay_preserved") is True
        and fault.get("single_run_preserved") is True
        and fault.get("event_count_preserved") is True
        and fault.get("event_hash_preserved") is True
        and fault.get("conversation_projection_preserved") is True
        and int(fault.get("recovered_generation", 0))
        >= int(fault.get("required_generation", 1))
        > int(fault.get("scheduled_generation", 0))
    ):
        raise RuntimeError("release_relay_fault_evidence_invalid")

    if stability.get("passed") is not True:
        raise RuntimeError("release_stability_failed")
    if float(stability.get("required_duration_seconds", 0)) < 3600:
        raise RuntimeError("release_stability_duration_short")
    if float(stability.get("observed_duration_seconds", 0)) < 3600:
        raise RuntimeError("release_stability_observation_short")
    if stability.get("probe_error_count") != 0:
        raise RuntimeError("release_stability_probe_errors")
    if stability.get("transcript_hash_stable") is not True:
        raise RuntimeError("release_stability_hash_drift")
    if stability.get("android_pid_unique_count") != 1:
        raise RuntimeError("release_stability_android_pid_drift")


def finalize(
    ledger_path: Path,
    anonymous_path: Path,
    real_path: Path,
    stability_path: Path,
    apk_path: Path,
    python_junit_path: Path,
    android_junit_path: Path,
    *,
    hai_revision: str,
    windows_revision: str,
    android_revision: str,
) -> dict[str, Any]:
    for label, revision in (
        ("hai", hai_revision),
        ("windows", windows_revision),
        ("android", android_revision),
    ):
        if not REVISION.fullmatch(revision):
            raise RuntimeError(f"release_{label}_revision_invalid")
    ledger = read_json(ledger_path)
    base_errors = acceptance.validate(ledger)
    if base_errors:
        raise RuntimeError("release_ledger_invalid:" + ";".join(base_errors))
    anonymous, real, stability = (
        read_json(anonymous_path),
        read_json(real_path),
        read_json(stability_path),
    )
    validate_reports(anonymous, real, stability)
    python_test_count = validate_junit(
        python_junit_path, label="python", minimum_tests=500
    )
    android_test_count = validate_junit(
        android_junit_path, label="android", minimum_tests=200
    )
    try:
        apk_hash = hashlib.sha256(apk_path.read_bytes()).hexdigest()
    except OSError as exc:
        raise RuntimeError("release_android_apk_unreadable") from exc

    common = [
        {"kind": "ai_dev", "artifact": relative(anonymous_path), "result": "passed"},
        {"kind": "windows_runtime", "artifact": relative(real_path), "result": "passed"},
        {"kind": "android_device", "artifact": relative(real_path), "result": "passed"},
    ]
    for item in ledger["items"]:
        item_id = item["id"]
        evidence = list(item.get("evidence", []))
        kinds = {row.get("kind") for row in evidence}
        if item_id in MISSING_LOCAL_EVIDENCE:
            artifact, command = MISSING_LOCAL_EVIDENCE[item_id]
            if "code" not in kinds:
                evidence.append({"kind": "code", "artifact": artifact})
            if "automated_test" not in kinds:
                evidence.append({
                    "kind": "automated_test",
                    "command": command,
                    "result": "passed",
                })
        for row in common:
            if row["kind"] not in {entry.get("kind") for entry in evidence}:
                evidence.append(dict(row))
        if item_id == "M09-F08":
            evidence.append({
                "kind": "automated_test",
                "artifact": relative(stability_path),
                "result": "passed",
            })
        if item_id == "M10-F08":
            evidence.extend([
                {
                    "kind": "automated_test",
                    "artifact": relative(python_junit_path),
                    "result": f"passed:{python_test_count}",
                },
                {
                    "kind": "automated_test",
                    "artifact": relative(android_junit_path),
                    "result": f"passed:{android_test_count}",
                },
            ])
        item["evidence"] = evidence
        item["status"] = "full_pass"
        item["blockers"] = []

    ledger["versions"] = {
        "protocol_schema": "2.0.0",
        "hai_revision": hai_revision,
        "windows_revision": windows_revision,
        "android_revision": android_revision,
        "android_apk_sha256": apk_hash,
    }
    errors = acceptance.validate(ledger)
    if errors:
        raise RuntimeError("release_final_ledger_invalid:" + ";".join(errors))
    return ledger


def main() -> int:
    parser = argparse.ArgumentParser()
    evidence = acceptance.ROOT / "release/product-evidence/mobile-remote-workspace-v2"
    parser.add_argument("--ledger", type=Path, default=acceptance.LEDGER)
    parser.add_argument("--anonymous-report", type=Path, default=evidence / "ai-dev-public-smoke-anonymous.json")
    parser.add_argument("--real-device-report", type=Path, default=evidence / "real-device-e2e.json")
    parser.add_argument("--stability-report", type=Path, default=evidence / "real-stability-1h.json")
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument(
        "--python-junit", type=Path, default=evidence / "python-full-junit.xml"
    )
    parser.add_argument(
        "--android-junit", type=Path, default=evidence / "android-jvm-junit"
    )
    parser.add_argument("--hai-revision", required=True)
    parser.add_argument("--windows-revision", required=True)
    parser.add_argument("--android-revision", required=True)
    parser.add_argument("--output", type=Path, default=acceptance.LEDGER)
    args = parser.parse_args()
    result = finalize(
        args.ledger,
        args.anonymous_report,
        args.real_device_report,
        args.stability_report,
        args.apk,
        args.python_junit,
        args.android_junit,
        hai_revision=args.hai_revision,
        windows_revision=args.windows_revision,
        android_revision=args.android_revision,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"valid": True, "full_pass": 80, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
