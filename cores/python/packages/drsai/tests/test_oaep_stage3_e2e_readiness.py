from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/verify_oaep_stage3_e2e_readiness.py"
SPEC = importlib.util.spec_from_file_location("oaep_stage3_readiness", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_stage3_readiness_contract_covers_real_convergence_artifacts() -> None:
    checks = MODULE.repository_contract(ROOT)
    failed = [row["name"] for row in checks if row["status"] != "passed"]
    assert failed == []
    names = {row["name"] for row in checks}
    assert "android_phase:oaep-session-proof" in names
    assert "android_phase:oaep-controlled-session" in names
    assert "android_phase:device-proof" in names
    assert "android_phase:revocation-monitor" in names
    assert "release_check:oaep_hash_convergence" in names
    assert "release_check:file_change_safe_paths" in names
    assert "release_check:two_device_isolation" in names
    assert "release_check:revocation_stream_closed" in names
    assert "collector_hash_convergence" in names
    assert "android_file_change_stats" in names
    assert "android_bidirectional_oaep_stream" in names
    assert "android_bidirectional_delta_gate" in names
    assert "android_bidirectional_tool_gate" in names
    assert "collector_file_change_safe_paths" in names
    assert "collector_physical_device_preflight" in names
    assert "collector_two_device_stream_gate" in names
    assert "assembler_file_change_safe_paths" in names
    assert "assembler_bidirectional_delta_gate" in names
    assert "assembler_windows_tool_gate" in names
    assert "finalizer_file_change_safe_paths" in names
    assert "finalizer_bidirectional_delta_gate" in names
    assert "finalizer_windows_tool_gate" in names
    assert "stability_five_faults" in names


def test_stage3_readiness_reports_missing_device_without_claiming_e2e() -> None:
    report = MODULE.build_report(
        root=ROOT,
        adb="definitely-not-an-adb-binary",
        require_device=False,
    )
    assert report["passed"] is True
    assert report["ready_for_real_device_e2e"] is False
    assert any(row["code"] == "adb_not_found" for row in report["blockers"])


def test_stage3_readiness_can_fail_closed_when_device_is_required() -> None:
    report = MODULE.build_report(
        root=ROOT,
        adb="definitely-not-an-adb-binary",
        require_device=True,
    )
    assert report["passed"] is False
    assert report["ready_for_real_device_e2e"] is False


def test_stage3_readiness_does_not_treat_emulator_as_real_device(monkeypatch) -> None:
    monkeypatch.setattr(
        MODULE,
        "adb_status",
        lambda _adb: {
            "available": True,
            "path": "adb",
            "devices": [{"serial": "emulator-5554", "kind": "emulator"}],
        },
    )
    report = MODULE.build_report(root=ROOT, adb="adb", require_device=False)
    assert report["passed"] is True
    assert report["ready_for_real_device_e2e"] is False
    assert any(row["code"] == "physical_android_device_missing" for row in report["blockers"])


def test_stage3_readiness_accepts_physical_android_device(monkeypatch) -> None:
    monkeypatch.setattr(
        MODULE,
        "adb_status",
        lambda _adb: {
            "available": True,
            "path": "adb",
            "devices": [{"serial": "R5GYB3S8ACH", "kind": "physical"}],
        },
    )
    report = MODULE.build_report(root=ROOT, adb="adb", require_device=True)
    assert report["passed"] is True
    assert report["ready_for_real_device_e2e"] is True


def test_stage3_readiness_resolves_default_android_sdk_adb() -> None:
    resolved = MODULE.resolve_adb()
    if resolved is not None:
        assert resolved.endswith(("adb", "adb.exe"))
