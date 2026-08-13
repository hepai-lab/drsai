from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

import accept_p6_capacity_recovery_physical as gate


def output_for(phase: str, **overrides) -> str:
    reports = {
        "seed": {
            "phase": "seed", "item_count": 100_000, "cursor": 100_000,
            "history_hash": "a" * 64, "terminal_approval_visible": True,
            "elapsed_ms": 1, "schema_version": "p6-capacity-recovery-physical/1",
            "passed": True, "physical": True, "synthetic": True,
        },
        "recover": {
            "phase": "recover", "restored_item_count": 100_000,
            "restored_history_hash": "a" * 64, "offline_search_matches": 1,
            "gap_detected_without_cursor_advance": True,
            "snapshot_then_cursor_replay": True, "final_item_count": 100_003,
            "final_cursor": 100_003, "terminal_approval_visible": True,
            "elapsed_ms": 1, "schema_version": "p6-capacity-recovery-physical/1",
            "passed": True, "physical": True, "synthetic": True,
        },
        "clear": {
            "phase": "clear", "database_deleted": True,
            "schema_version": "p6-capacity-recovery-physical/1",
            "passed": True, "physical": True, "synthetic": True,
        },
    }
    report = reports[phase] | overrides
    raw = json.dumps(report, separators=(",", ":")).encode()
    return "\n".join((
        f"INSTRUMENTATION_STATUS: {gate.REPORT_PHASE_KEY}={phase}",
        f"INSTRUMENTATION_STATUS: {gate.REPORT_KEY}="
        + base64.b64encode(raw).decode(),
        f"INSTRUMENTATION_STATUS: {gate.REPORT_HASH_KEY}="
        + hashlib.sha256(raw).hexdigest(),
        "OK (1 test)",
    ))


def completed(stdout: str = "", returncode: int = 0):
    return subprocess.CompletedProcess([], returncode, stdout, "")


def test_parse_phase_report_accepts_exact_content_free_shape() -> None:
    parsed = gate.parse_phase_report(output_for("recover"), "recover")
    assert parsed["report"]["final_cursor"] == 100_003


@pytest.mark.parametrize(
    "output,error",
    [
        (output_for("seed", item_count=99_999), "seed_invariants"),
        (output_for("recover", final_cursor=100_002), "recover_invariants"),
        (output_for("clear", database_deleted=False), "cleanup_invalid"),
        (output_for("seed") + "\nFAILURES!!!", "instrumentation_failed"),
        (output_for("seed", unexpected="value"), "fields_invalid"),
    ],
)
def test_parse_phase_report_fails_closed(output: str, error: str) -> None:
    with pytest.raises(gate.AcceptanceFailure, match=error):
        gate.parse_phase_report(output, "clear" if "cleanup" in error else (
            "recover" if "recover" in error else "seed"
        ))


def test_accept_runs_process_death_and_cleanup(tmp_path: Path) -> None:
    adb = tmp_path / "adb.exe"
    apk = tmp_path / "test.apk"
    adb.write_bytes(b"adb")
    apk.write_bytes(b"apk")
    calls: list[list[str]] = []

    def run(command, timeout):
        command = list(command)
        calls.append(command)
        if command[-2:] == ["devices", "-l"]:
            return completed("List of devices attached\nphysical-1   device model:phone\n")
        if "install" in command:
            return completed("Success\n")
        if "instrument" in command:
            phase = command[command.index("p6CapacityPhase") + 1]
            return completed(output_for(phase))
        return completed()

    report = gate.accept(
        adb=adb, serial="physical-1", target_package="target", test_package="test",
        runner="runner", test_apk=apk, build_type="release", run=run,
    )
    assert report["passed"] is True
    assert report["formal_release_candidate"] is True
    assert sum("force-stop" in call for call in calls) == 2
    assert [call[call.index("p6CapacityPhase") + 1] for call in calls if "instrument" in call] \
        == ["seed", "recover", "clear"]


def test_accept_always_clears_after_recover_failure(tmp_path: Path) -> None:
    adb = tmp_path / "adb.exe"
    apk = tmp_path / "test.apk"
    adb.write_bytes(b"adb")
    apk.write_bytes(b"apk")
    phases: list[str] = []

    def run(command, timeout):
        command = list(command)
        if command[-2:] == ["devices", "-l"]:
            return completed("List of devices attached\nphysical-1   device model:phone\n")
        if "install" in command:
            return completed("Success\n")
        if "instrument" in command:
            phase = command[command.index("p6CapacityPhase") + 1]
            phases.append(phase)
            if phase == "recover":
                return completed("FAILURES!!!")
            return completed(output_for(phase))
        return completed()

    with pytest.raises(gate.AcceptanceFailure, match="instrumentation_failed:recover"):
        gate.accept(
            adb=adb, serial="physical-1", target_package="target", test_package="test",
            runner="runner", test_apk=apk, build_type="debug", run=run,
        )
    assert phases == ["seed", "recover", "clear"]
