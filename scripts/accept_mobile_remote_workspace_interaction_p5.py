#!/usr/bin/env python3
"""Run the controlled P5 Approval and response-loss gate on a physical Android device."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DRIVER = ROOT / "scripts/accept_mobile_remote_workspace_local_e2e_v2.py"
FEATURE_IDS = ("P5-M04-F03", "P5-M04-F05")
DEFAULT_OUTPUT = (
    ROOT / "release/product-evidence/mobile-remote-workspace-p5"
    / "m04-interaction-physical.json"
)
REQUIRED_CHECKS = {
    "runtime_registration_heartbeat",
    "grant_association",
    "workspace_session_browse",
    "run_approval_tool_artifact",
    "m08_f07_approval_branches",
    "cross_client_transcript_hash",
    "m09_f01_response_loss_recovery",
}

_RFC1918_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def validated_transport_arguments(
    transport: str,
    host_address: str | None,
    *,
    allow_insecure_private_lan: bool,
) -> list[str]:
    if transport != "lan":
        if host_address:
            raise ValueError("p5_interaction_host_address_requires_lan")
        if allow_insecure_private_lan:
            raise ValueError("p5_interaction_lan_consent_requires_lan")
        return ["--transport", "adb-reverse"]
    if not allow_insecure_private_lan:
        raise ValueError("p5_interaction_insecure_private_lan_consent_required")
    try:
        candidate = ipaddress.ip_address(host_address or "")
    except ValueError as exc:
        raise ValueError("p5_interaction_rfc1918_ipv4_required") from exc
    if not isinstance(candidate, ipaddress.IPv4Address) or not any(
        candidate in network for network in _RFC1918_NETWORKS
    ):
        raise ValueError("p5_interaction_rfc1918_ipv4_required")
    return [
        "--transport", "lan",
        "--host-address", str(candidate),
        "--allow-insecure-private-lan",
    ]


def run(command: list[str], *, timeout: int = 900) -> str:
    completed = subprocess.run(
        command, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        # The legacy source report can contain fixture identifiers. Never echo
        # its stdout or exception payload into the P5 operator boundary.
        raise RuntimeError(f"p5_interaction_source_gate_failed:{completed.returncode}")
    return completed.stdout


def adb(adb_path: Path, serial: str, *arguments: str) -> str:
    return run([str(adb_path), "-s", serial, *arguments], timeout=30)


def physical_environment(adb_path: Path, serial: str) -> dict[str, Any]:
    def prop(name: str) -> str:
        return adb(adb_path, serial, "shell", "getprop", name).strip()

    if adb(adb_path, serial, "get-state").strip() != "device" \
            or prop("ro.kernel.qemu") == "1" or serial.startswith("emulator-"):
        raise RuntimeError("p5_interaction_physical_device_required")
    fingerprint = prop("ro.build.fingerprint")
    return {
        "kind": "physical_device",
        "device_id_sha256": hashlib.sha256(
            f"p5-interaction/1\0{serial}\0{fingerprint}".encode()
        ).hexdigest(),
        "manufacturer": prop("ro.product.manufacturer")[:80],
        "model": prop("ro.product.model")[:80],
        "api": int(prop("ro.build.version.sdk")),
    }


def run_encrypted_ledger_gate(adb_path: Path, serial: str) -> int:
    output = run([
        str(adb_path), "-s", serial, "shell", "am", "instrument", "-w", "-r",
        "-e", "class", ",".join((
            "ai.drsai.remote.RemoteRunControlLedgerTest",
            "ai.drsai.remote.RemoteApprovalDecisionLedgerTest",
        )),
        "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
    ], timeout=180)
    match = re.search(r"\bOK \((\d+) tests?\)", output)
    if match is None or int(match.group(1)) != 7 or "FAILURES!!!" in output:
        raise RuntimeError("p5_interaction_encrypted_ledger_gate_failed")
    return int(match.group(1))


def run_process_death_ledger_gate(adb_path: Path, serial: str) -> int:
    nonce = secrets.token_hex(16)
    phases = ("write", "recover", "verify-cleared")
    for index, phase in enumerate(phases):
        output = run([
            str(adb_path), "-s", serial, "shell", "am", "instrument", "-w", "-r",
            "-e", "class",
            "ai.drsai.remote.P5LedgerProcessDeathTest#executeRequestedPhase",
            "-e", "ledgerPhase", phase,
            "-e", "ledgerNonce", nonce,
            "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
        ], timeout=90)
        if re.search(r"\bOK \(1 test\)", output) is None or "FAILURES!!!" in output:
            raise RuntimeError("p5_interaction_process_death_ledger_gate_failed")
        if index + 1 < len(phases):
            run([
                str(adb_path), "-s", serial, "shell", "am", "force-stop",
                "ai.drsai.remote.debug",
            ], timeout=30)
    return len(phases)


def validate_source_report(value: Any, *, expected_serial: str | None = None) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema_version") != 1 \
            or value.get("passed") is not True or "error" in value:
        raise ValueError("p5_interaction_source_report_not_passed")
    if expected_serial is not None and value.get("serial") != expected_serial:
        raise ValueError("p5_interaction_source_device_mismatch")
    checks = value.get("checks")
    if not isinstance(checks, list) or any(not isinstance(item, dict) for item in checks):
        raise ValueError("p5_interaction_source_checks_invalid")
    by_name = {item.get("name"): item for item in checks}
    if not REQUIRED_CHECKS.issubset(by_name) or any(
        by_name[name].get("status") != "passed" for name in REQUIRED_CHECKS
    ):
        raise ValueError("p5_interaction_source_checks_incomplete")

    approvals = by_name["m08_f07_approval_branches"]
    if {
        "approved_status": approvals.get("approved_status"),
        "rejected_status": approvals.get("rejected_status"),
        "rejected_side_effect": approvals.get("rejected_side_effect"),
        "rejected_audit": approvals.get("rejected_audit"),
    } != {
        "approved_status": "completed",
        "rejected_status": "cancelled",
        "rejected_side_effect": False,
        "rejected_audit": True,
    }:
        raise ValueError("p5_interaction_approval_branches_invalid")

    recovery = by_name["m09_f01_response_loss_recovery"]
    if recovery.get("faults") != {
        "run_response_dropped": True,
        "approval_response_dropped": True,
    } or recovery.get("run_bindings") != 1 \
            or recovery.get("approval_bindings") != 2 \
            or recovery.get("approved_events") != 1 \
            or recovery.get("artifact_events") != 1:
        raise ValueError("p5_interaction_response_loss_invalid")
    if not isinstance(recovery.get("tool_finished_events"), int) \
            or recovery["tool_finished_events"] < 1:
        raise ValueError("p5_interaction_response_loss_invalid")

    transcript = by_name["cross_client_transcript_hash"]
    digest = transcript.get("sha256")
    if not isinstance(transcript.get("event_count"), int) or transcript["event_count"] < 1 \
            or not isinstance(digest, str) or len(digest) != 64 \
            or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError("p5_interaction_transcript_invalid")
    return {
        "approval": {
            "approved_terminal": True,
            "denied_terminal": True,
            "denied_side_effect_count": 0,
            "denied_audit_present": True,
        },
        "response_loss": {
            "run_response_dropped_after_commit": True,
            "approval_response_dropped_after_commit": True,
            "run_side_effect_count": recovery["run_bindings"],
            "approval_decision_count": recovery["approved_events"],
            "artifact_side_effect_count": recovery["artifact_events"],
        },
        "convergence": {
            "event_count": transcript["event_count"],
            "transcript_sha256": digest,
        },
    }


def newest(pattern: str) -> Path:
    values = sorted(ROOT.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
    if not values:
        raise FileNotFoundError("p5_interaction_android_artifact_missing")
    return values[0]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--adb", type=Path, default=sdk / "platform-tools/adb.exe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--transport", choices=("adb-reverse", "lan"), default="adb-reverse")
    parser.add_argument("--host-address")
    parser.add_argument(
        "--allow-insecure-private-lan",
        action="store_true",
        help=(
            "Explicitly consent to sending the one-run test bearer and grant over "
            "unencrypted RFC1918 LAN HTTP. Prefer adb-reverse."
        ),
    )
    options = parser.parse_args(argv)
    if not options.adb.is_file() or not SOURCE_DRIVER.is_file():
        raise FileNotFoundError("p5_interaction_required_artifact_missing")
    if not 300 <= options.timeout_seconds <= 1800:
        raise ValueError("p5_interaction_timeout_invalid")
    transport_arguments = validated_transport_arguments(
        options.transport,
        options.host_address,
        allow_insecure_private_lan=options.allow_insecure_private_lan,
    )
    environment = physical_environment(options.adb, options.serial)
    with tempfile.TemporaryDirectory(prefix="p5-interaction-source-") as temporary:
        source_path = Path(temporary) / "source.json"
        run([
            sys.executable, str(SOURCE_DRIVER), "--serial", options.serial,
            "--output", str(source_path),
            *transport_arguments,
        ], timeout=options.timeout_seconds)
        source_bytes = source_path.read_bytes()
        source = json.loads(source_bytes.decode("utf-8"))
        gates = validate_source_report(source, expected_serial=options.serial)
        source_digest = hashlib.sha256(source_bytes).hexdigest()
    ledger_test_count = run_encrypted_ledger_gate(options.adb, options.serial)
    process_death_phase_count = run_process_death_ledger_gate(options.adb, options.serial)

    app_apk = newest("apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-*.apk")
    test_apk = newest("apps/android/app/build/outputs/apk/androidTest/debug/*.apk")
    report = {
        "schema_version": "p5-interaction-physical/1",
        "feature_ids": list(FEATURE_IDS),
        "generated_at": datetime.now(UTC).isoformat(),
        "passed": True,
        "protocol": "oaep/1+owop/1",
        "environment": environment,
        "artifacts": {
            "app_apk_sha256": sha256(app_apk),
            "test_apk_sha256": sha256(test_apk),
            "source_report_sha256": source_digest,
            "source_report_retained": False,
        },
        "gates": gates,
        "encrypted_ledger": {
            "process_recreation": True,
            "conflicting_operation_rejected": True,
            "stale_clear_fenced": True,
            "test_count": ledger_test_count,
            "process_death_phase_count": process_death_phase_count,
            "target_force_stopped_between_phases": True,
            "application_data_cleared": False,
        },
        "fixture": {
            "isolated_temporary_workspace": True,
            "fixture_removed_after_test": True,
            "raw_identifiers_retained": False,
            "raw_content_retained": False,
        },
    }
    output = options.output.resolve()
    atomic_json(output, report)
    print(json.dumps({
        "schema_version": report["schema_version"], "passed": True,
        "feature_count": len(FEATURE_IDS), "output_sha256": sha256(output),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
