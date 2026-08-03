"""Preflight the OAEP Stage 3 real-device convergence gate.

This script is intentionally not a substitute for the Android real-device E2E.
It verifies that the repo has the required fail-closed proof collectors wired
up, then reports whether the local machine is ready to run them.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_ANDROID_PHASES = {
    "windows-two-runs-monitor",
    "android-two-runs",
    "oaep-controlled-session",
    "oaep-session-proof",
    "device-proof",
    "revocation-monitor",
}
REQUIRED_REAL_CHECKS = {
    "pre_pair_invisible",
    "pair_and_catalog",
    "two_device_isolation",
    "windows_to_android_two_runs",
    "android_to_windows_two_runs",
    "oaep_hash_convergence",
    "approval_single_decision",
    "file_change_safe_paths",
    "revocation_stream_closed",
}


def _read(root: Path, relative: str) -> str:
    path = root / relative
    if not path.is_file():
        raise RuntimeError(f"stage3_required_file_missing:{relative}")
    return path.read_text(encoding="utf-8")


def _check_contains(source: str, tokens: set[str], label: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for token in sorted(tokens):
        checks.append({
            "name": f"{label}:{token}",
            "status": "passed" if token in source else "failed",
        })
    return checks


def repository_contract(root: Path = ROOT) -> list[dict[str, Any]]:
    android_test = _read(
        root,
        "apps/android/app/src/androidTest/java/ai/drsai/remote/RealRemoteWorkspaceE2ETest.kt",
    )
    acceptor = _read(root, "scripts/accept_mobile_remote_workspace_real_device_v4.py")
    two_device = _read(root, "scripts/accept_mobile_remote_workspace_two_device_v4.py")
    assembler = _read(root, "scripts/assemble_mobile_remote_workspace_real_evidence_v4.py")
    stability = _read(root, "scripts/monitor_mobile_remote_workspace_stability_v4.py")
    finalizer = _read(root, "scripts/finalize_mobile_remote_workspace_release_v4.py")
    digest = _read(root, "apps/desktop/windows/scripts/digest-oaep-items.mts")

    checks: list[dict[str, Any]] = []
    checks.extend(_check_contains(android_test, REQUIRED_ANDROID_PHASES, "android_phase"))
    checks.extend(_check_contains(finalizer, REQUIRED_REAL_CHECKS, "release_check"))
    for name, source, required in (
        ("android_oaep_snapshot", android_test, "repository.oaepSnapshot("),
        ("android_oaep_events", android_test, "repository.oaepEvents("),
        ("android_oaep_schema_hash", android_test, "OaepContract.SCHEMA_SHA256"),
        ("android_oaep_digest", android_test, "oaepItemsDigest(snapshot.items)"),
        ("android_bidirectional_oaep_stream", android_test, ").oaepSessionStream("),
        ("android_bidirectional_delta_gate", android_test, '"delta_run_count"'),
        ("android_bidirectional_tool_gate", android_test, '"tool_run_count"'),
        ("android_file_change_stats", android_test, "oaepFileChangeStats(snapshot.items)"),
        ("collector_runtime_snapshot", acceptor, "/v1/sessions/{args.session_id}/oaep-snapshot"),
        ("collector_desktop_digest", acceptor, "desktop_digest(snapshot)"),
        ("collector_android_proof", acceptor, "oaep-session-proof"),
        ("collector_screenshot", acceptor, "capture_screenshot(args, \"oaep-convergence\")"),
        ("collector_hash_convergence", acceptor, "runtime_sha256 == windows_sha256"),
        ("collector_file_change_safe_paths", acceptor, "validate_file_change_proof(snapshot, proof)"),
        ("collector_physical_device_preflight", acceptor, "require_physical_android_device(args.adb, args.device)"),
        ("collector_two_device_pairing", two_device, "await _pair(args, client, args.device_b)"),
        ("collector_two_device_revoke", two_device, '"DELETE",\n            f"/v1/mobile-pairing/associations/{association_a}"'),
        ("collector_two_device_stream_gate", two_device, '"revocation-monitor"'),
        ("assembler_all_real_checks", assembler, "REQUIRED_CHECKS"),
        ("assembler_file_change_safe_paths", assembler, '"file_change_safe_paths"'),
        ("assembler_v3_inherited", assembler, "V3_INHERITED"),
        ("assembler_bidirectional_delta_gate", assembler, 'row.get("delta_run_count"'),
        ("assembler_windows_tool_gate", assembler, 'row.get("tool_run_count"'),
        ("finalizer_file_change_safe_paths", finalizer, '"file_change_safe_paths"'),
        ("finalizer_bidirectional_delta_gate", finalizer, 'row.get("delta_run_count"'),
        ("finalizer_windows_tool_gate", finalizer, 'row.get("tool_run_count"'),
        ("stability_3600_seconds", stability, "args.duration_seconds < 3600"),
        ("stability_five_faults", stability, "good_faults == set(FAULT_NAMES)"),
        ("desktop_digest_schema", digest, "oaepItemsDigest"),
    ):
        checks.append({"name": name, "status": "passed" if required in source else "failed"})
    return checks


def adb_status(adb: str = "adb", *, timeout_seconds: int = 15) -> dict[str, Any]:
    executable = resolve_adb(adb)
    if executable is None:
        return {
            "available": False,
            "devices": [],
            "error": {"code": "adb_not_found", "message": "adb was not found on PATH"},
        }
    completed = subprocess.run(
        [executable, "devices"],
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        return {
            "available": True,
            "path": executable,
            "devices": [],
            "error": {
                "code": "adb_devices_failed",
                "message": (completed.stderr or completed.stdout).strip()[:500],
            },
        }
    devices = []
    for line in completed.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            serial = parts[0]
            devices.append({
                "serial": serial,
                "kind": "emulator" if serial.startswith("emulator-") else "physical",
            })
    return {"available": True, "path": executable, "devices": devices}


def resolve_adb(adb: str = "adb") -> str | None:
    resolved = shutil.which(adb)
    if resolved is not None:
        return resolved
    raw = Path(adb)
    if raw.is_file():
        return str(raw)
    if adb != "adb":
        return None
    candidates = []
    for root in (
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        str(Path.home() / "AppData" / "Local" / "Android" / "Sdk"),
        os.environ.get("LOCALAPPDATA") and str(Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk"),
    ):
        if root:
            candidates.append(Path(root) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"))
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def build_report(
    *,
    root: Path = ROOT,
    adb: str = "adb",
    require_device: bool = False,
) -> dict[str, Any]:
    checks = repository_contract(root)
    failed = [row["name"] for row in checks if row.get("status") != "passed"]
    device = adb_status(adb)
    blockers: list[dict[str, str]] = []
    if failed:
        blockers.append({
            "code": "stage3_contract_incomplete",
            "message": ",".join(failed),
        })
    if not device.get("available"):
        blockers.append({"code": "adb_not_found", "message": "Install Android platform-tools or put adb on PATH."})
    physical_devices = [
        item for item in device.get("devices", [])
        if isinstance(item, dict) and item.get("kind") == "physical"
    ]
    if device.get("available") and not physical_devices:
        blockers.append({
            "code": "physical_android_device_missing",
            "message": "Connect and authorize a physical Android device for real-device E2E.",
        })

    ready_for_real_device = not failed and not blockers
    passed = not failed and (ready_for_real_device or not require_device)
    return {
        "schema_version": 1,
        "protocol": "oaep/1",
        "passed": passed,
        "ready_for_real_device_e2e": ready_for_real_device,
        "checks": checks,
        "adb": device,
        "blockers": blockers,
        "real_device_command": (
            "python scripts/accept_mobile_remote_workspace_real_device_v4.py "
            "--runtime-id <runtime_id> --workspace-id <workspace_id> "
            "--session-id <session_id> --expected-source-message-id <id>"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--require-device", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(adb=args.adb, require_device=args.require_device)
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
