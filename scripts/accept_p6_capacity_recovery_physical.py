#!/usr/bin/env python3
"""Run the isolated P6 Android capacity/process-death recovery gate."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any, Callable, Sequence


TEST_CLASS = "ai.drsai.remote.P6CapacityRecoveryPhysicalTest"
REPORT_KEY = "p6CapacityRecoveryReportBase64"
REPORT_HASH_KEY = "p6CapacityRecoveryReportSha256"
REPORT_PHASE_KEY = "p6CapacityRecoveryPhase"
PHASES = ("seed", "recover", "clear")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class AcceptanceFailure(RuntimeError):
    pass


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _run(command: Sequence[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command), capture_output=True, text=True, timeout=timeout, check=False,
    )


def _instrumentation_value(output: str, key: str) -> str:
    prefix = f"INSTRUMENTATION_STATUS: {key}="
    values = [line[len(prefix):].strip() for line in output.splitlines() if line.startswith(prefix)]
    if len(values) != 1 or not values[0]:
        raise AcceptanceFailure(f"p6_capacity_report_field_invalid:{key}")
    return values[0]


def parse_phase_report(output: str, expected_phase: str) -> dict[str, Any]:
    if "OK (1 test)" not in output or "FAILURES!!!" in output:
        raise AcceptanceFailure(f"p6_capacity_instrumentation_failed:{expected_phase}")
    phase = _instrumentation_value(output, REPORT_PHASE_KEY)
    if phase != expected_phase:
        raise AcceptanceFailure("p6_capacity_phase_mismatch")
    digest = _instrumentation_value(output, REPORT_HASH_KEY).lower()
    if SHA256.fullmatch(digest) is None:
        raise AcceptanceFailure("p6_capacity_report_hash_invalid")
    try:
        raw = base64.b64decode(_instrumentation_value(output, REPORT_KEY), validate=True)
        report = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        raise AcceptanceFailure("p6_capacity_report_payload_invalid") from exc
    if _sha256(raw) != digest:
        raise AcceptanceFailure("p6_capacity_report_hash_mismatch")
    if set(report) - {
        "phase", "database_deleted", "item_count", "cursor", "history_hash",
        "terminal_approval_visible", "elapsed_ms", "restored_item_count",
        "restored_history_hash", "offline_search_matches",
        "gap_detected_without_cursor_advance", "snapshot_then_cursor_replay",
        "final_item_count", "final_cursor", "schema_version", "passed",
        "physical", "synthetic",
    }:
        raise AcceptanceFailure("p6_capacity_report_fields_invalid")
    if report.get("phase") != expected_phase or report.get("passed") is not True \
            or report.get("physical") is not True or report.get("synthetic") is not True \
            or report.get("schema_version") != "p6-capacity-recovery-physical/1":
        raise AcceptanceFailure("p6_capacity_report_identity_invalid")
    if expected_phase == "seed" and not (
        report.get("item_count") == 100_000
        and report.get("cursor") == 100_000
        and report.get("terminal_approval_visible") is True
        and SHA256.fullmatch(str(report.get("history_hash", "")))
    ):
        raise AcceptanceFailure("p6_capacity_seed_invariants_invalid")
    if expected_phase == "recover" and not (
        report.get("restored_item_count") == 100_000
        and report.get("offline_search_matches") == 1
        and report.get("gap_detected_without_cursor_advance") is True
        and report.get("snapshot_then_cursor_replay") is True
        and report.get("final_item_count") == 100_003
        and report.get("final_cursor") == 100_003
        and report.get("terminal_approval_visible") is True
        and SHA256.fullmatch(str(report.get("restored_history_hash", "")))
    ):
        raise AcceptanceFailure("p6_capacity_recover_invariants_invalid")
    if expected_phase == "clear" and report.get("database_deleted") is not True:
        raise AcceptanceFailure("p6_capacity_cleanup_invalid")
    return {"report": report, "report_sha256": digest}


def _adb_base(adb: Path, serial: str) -> list[str]:
    return [str(adb), "-s", serial]


def _instrument(
    adb: Path,
    serial: str,
    test_package: str,
    runner: str,
    phase: str,
    run: Callable[[Sequence[str], int], subprocess.CompletedProcess[str]],
    timeout: int,
) -> dict[str, Any]:
    command = _adb_base(adb, serial) + [
        "shell", "am", "instrument", "-w", "-r",
        "-e", "runP6CapacityRecovery", "true",
        "-e", "p6CapacityPhase", phase,
        "-e", "class", TEST_CLASS,
        f"{test_package}/{runner}",
    ]
    result = run(command, timeout)
    if result.returncode != 0:
        raise AcceptanceFailure(f"p6_capacity_adb_failed:{phase}:{result.returncode}")
    return parse_phase_report(result.stdout, phase)


def accept(
    *,
    adb: Path,
    serial: str,
    target_package: str,
    test_package: str,
    runner: str,
    test_apk: Path,
    build_type: str,
    run: Callable[[Sequence[str], int], subprocess.CompletedProcess[str]] = _run,
    timeout: int = 240,
) -> dict[str, Any]:
    if not adb.is_file() or not test_apk.is_file() or not serial.strip():
        raise AcceptanceFailure("p6_capacity_input_invalid")
    if build_type not in {"debug", "release"}:
        raise AcceptanceFailure("p6_capacity_build_type_invalid")

    devices = run([str(adb), "devices", "-l"], 15)
    rows = [line.split() for line in devices.stdout.splitlines() if len(line.split()) >= 2]
    online = [row for row in rows if row[1] == "device"]
    matching = [row for row in online if row[0] == serial]
    if devices.returncode != 0 or len(matching) != 1 \
            or any("emulator" in " ".join(row).lower() for row in matching):
        raise AcceptanceFailure("p6_capacity_physical_device_required")

    install = run(_adb_base(adb, serial) + ["install", "-r", str(test_apk)], 120)
    if install.returncode != 0 or "Success" not in install.stdout:
        raise AcceptanceFailure("p6_capacity_test_apk_install_failed")

    phase_reports: dict[str, dict[str, Any]] = {}
    primary_error: Exception | None = None
    try:
        phase_reports["seed"] = _instrument(
            adb, serial, test_package, runner, "seed", run, timeout,
        )
        stopped = run(_adb_base(adb, serial) + ["shell", "am", "force-stop", target_package], 15)
        if stopped.returncode != 0:
            raise AcceptanceFailure("p6_capacity_process_death_failed")
        phase_reports["recover"] = _instrument(
            adb, serial, test_package, runner, "recover", run, timeout,
        )
    except Exception as exc:
        primary_error = exc
    finally:
        run(_adb_base(adb, serial) + ["shell", "am", "force-stop", target_package], 15)
        try:
            phase_reports["clear"] = _instrument(
                adb, serial, test_package, runner, "clear", run, timeout,
            )
        except Exception as cleanup_error:
            if primary_error is None:
                primary_error = cleanup_error
            else:
                primary_error = AcceptanceFailure(
                    f"{primary_error};p6_capacity_cleanup_also_failed:{type(cleanup_error).__name__}"
                )
    if primary_error is not None:
        raise primary_error

    seed = phase_reports["seed"]["report"]
    recover = phase_reports["recover"]["report"]
    if seed["history_hash"] != recover["restored_history_hash"]:
        raise AcceptanceFailure("p6_capacity_process_restore_hash_mismatch")
    return {
        "schema_version": "p6-capacity-recovery-host/1",
        "feature_id": "P6-M07-F05",
        "passed": True,
        "physical": True,
        "emulator": False,
        "synthetic": True,
        "build_type": build_type,
        "formal_release_candidate": build_type == "release",
        "test_apk_sha256": _sha256(test_apk.read_bytes()),
        "process_death_verified": True,
        "seed": phase_reports["seed"],
        "recover": phase_reports["recover"],
        "cleanup": phase_reports["clear"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--target-package", required=True)
    parser.add_argument("--test-package", required=True)
    parser.add_argument("--runner", default="androidx.test.runner.AndroidJUnitRunner")
    parser.add_argument("--test-apk", type=Path, required=True)
    parser.add_argument("--build-type", choices=("debug", "release"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args(argv)
    report = accept(
        adb=args.adb.resolve(), serial=args.serial, target_package=args.target_package,
        test_package=args.test_package, runner=args.runner, test_apk=args.test_apk.resolve(),
        build_type=args.build_type, timeout=args.timeout,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "passed": True,
        "build_type": report["build_type"],
        "formal_release_candidate": report["formal_release_candidate"],
        "output_sha256": _sha256(args.output.read_bytes()),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
