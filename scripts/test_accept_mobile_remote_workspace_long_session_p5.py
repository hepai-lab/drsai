from __future__ import annotations

import copy
import base64
from datetime import UTC, datetime
import json
import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_long_session_p5.py"
SPEC = importlib.util.spec_from_file_location("p5_long_session", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def valid_report() -> dict[str, object]:
    return {
        "schema_version": "p5-long-session-physical/1",
        "passed": True,
        "physical": True,
        "history": {
            "checkpoint_item_count": 100_000,
            "cold_window_items": 500,
            "cold_start_ms": 100,
            "cold_pss_delta_kb": 1024,
            "full_history_items": 100_000,
            "full_history_ms": 10_000,
            "history_hash": "a" * 64,
            "offline_search_matches": 1,
            "offline_search_literal_metacharacters": True,
            "reading_anchor_stable": True,
            "search_anchor_stable": True,
            "history_restore_anchor_stable": True,
        },
        "delta": {
            "delta_count": 10_000,
            "duration_ms": 1000,
            "throughput_per_second": 10_000,
            "main_ticks": 40,
            "worker_starts": 10,
            "render_cycles": 10,
            "content_hash": "b" * 64,
            "terminal_barrier_complete": True,
        },
        "budgets": {
            "cold_start_max_ms": 3000,
            "cold_pss_max_kb": 32 * 1024,
            "history_max_ms": 180_000,
            "delta_count": 10_000,
            "delta_duration_max_ms": 5000,
            "delta_min_throughput_per_second": 10_000,
            "minimum_main_ticks": 20,
        },
    }


def test_valid_report_passes_all_fail_closed_gates() -> None:
    gates = module.validate_device_report(valid_report())
    assert gates and all(gates.values())


def valid_acceptance_report() -> dict[str, object]:
    physical = valid_report()
    return {
        "schema_version": "p5-long-session-acceptance/1",
        "feature_ids": list(module.LONG_SESSION_FEATURE_IDS),
        "generated_at": datetime.now(UTC).isoformat(),
        "passed": True,
        "environment": {
            "kind": "physical_device", "device_id_sha256": "c" * 64,
            "manufacturer": "Vendor", "model": "Tablet", "api": 36, "abi": "arm64-v8a",
        },
        "artifacts": {
            "app_build_type": "debug", "app_apk_sha256": "a" * 64,
            "test_apk_artifact": "artifacts/p5-long-session-test.apk",
            "test_apk_bytes": 10, "test_apk_sha256": "b" * 64,
        },
        "instrumentation": {
            "runner": module.RUNNER, "test_class": module.TEST_CLASS,
            "tests": 1, "failures": 0,
        },
        "gates": module.validate_device_report(physical),
        "metrics": {"history": physical["history"], "delta": physical["delta"]},
        "budgets": physical["budgets"],
    }


def test_host_acceptance_report_binds_features_physical_device_and_build() -> None:
    report = valid_acceptance_report()
    assert module.validate_acceptance_report(report, expected_build_sha256="a" * 64)

    release = copy.deepcopy(report)
    release["artifacts"]["app_build_type"] = "release"
    release["instrumentation"]["runner"] = (
        "ai.drsai.remote.test/androidx.test.runner.AndroidJUnitRunner"
    )
    assert module.validate_acceptance_report(
        release, expected_build_sha256="a" * 64, required_build_type="release",
    )
    with pytest.raises(ValueError, match="release_build_required"):
        module.validate_acceptance_report(report, required_build_type="release")

    mvp = copy.deepcopy(report)
    mvp["artifacts"]["app_build_type"] = "mvp"
    mvp["instrumentation"]["runner"] = (
        "ai.drsai.remote.test/androidx.test.runner.AndroidJUnitRunner"
    )
    assert module.validate_acceptance_report(
        mvp, expected_build_sha256="a" * 64, required_build_type="mvp",
    )


def test_content_free_report_is_read_from_release_instrumentation_status() -> None:
    device = valid_report()
    encoded = base64.b64encode(json.dumps(device).encode()).decode()
    output = "\n".join((
        "INSTRUMENTATION_STATUS: class=ai.drsai.remote.P5LongSessionPerformanceTest",
        f"INSTRUMENTATION_STATUS: p5LongSessionReportBase64={encoded}",
        "OK (1 test)",
    ))
    assert module.report_from_instrumentation(output) == device

    with pytest.raises(ValueError, match="report_missing"):
        module.report_from_instrumentation("OK (1 test)")
    with pytest.raises(ValueError, match="report_invalid"):
        module.report_from_instrumentation(
            "INSTRUMENTATION_STATUS: p5LongSessionReportBase64=not-base64!"
        )


@pytest.mark.parametrize(
    ("mutation", "error"),
    [
        (lambda value: value.update(feature_ids=["M06-F02", "M06-F03"]), "feature_set_invalid"),
        (lambda value: value["environment"].update(kind="emulator"), "physical_environment_invalid"),
        (lambda value: value["artifacts"].update(app_apk_sha256="f" * 64), "build_mismatch"),
        (lambda value: value["gates"].update(terminal=False), "gate_attestation_invalid"),
        (lambda value: value["budgets"].update(delta_duration_max_ms=50_000), "metrics_shape_invalid"),
    ],
)
def test_host_acceptance_report_fails_closed(mutation, error: str) -> None:
    report = valid_acceptance_report()
    mutation(report)
    with pytest.raises(ValueError, match=error):
        module.validate_acceptance_report(report, expected_build_sha256="a" * 64)


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("root", "physical", False),
        ("history", "checkpoint_item_count", 99_999),
        ("history", "cold_window_items", 501),
        ("history", "cold_start_ms", 3001),
        ("history", "cold_pss_delta_kb", 32 * 1024 + 1),
        ("history", "full_history_items", 99_999),
        ("history", "history_hash", "not-a-hash"),
        ("history", "offline_search_matches", 0),
        ("history", "offline_search_literal_metacharacters", False),
        ("history", "reading_anchor_stable", False),
        ("history", "search_anchor_stable", False),
        ("history", "history_restore_anchor_stable", False),
        ("delta", "delta_count", 9999),
        ("delta", "duration_ms", 5001),
        ("delta", "throughput_per_second", 9999),
        ("delta", "main_ticks", 19),
        ("delta", "terminal_barrier_complete", False),
    ],
)
def test_invalid_or_incomplete_physical_evidence_fails_closed(
    section: str, field: str, value: object,
) -> None:
    report = copy.deepcopy(valid_report())
    target = report if section == "root" else report[section]
    assert isinstance(target, dict)
    target[field] = value
    with pytest.raises(ValueError):
        module.validate_device_report(report)


def test_extra_top_level_field_is_rejected() -> None:
    report = valid_report()
    report["serial"] = "must-not-be-accepted"
    with pytest.raises(ValueError, match="shape_invalid"):
        module.validate_device_report(report)


def test_emulator_environment_is_rejected_before_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_adb(_path: Path, _serial: str, *arguments: str, timeout: int = 300) -> str:
        if arguments == ("get-state",):
            return "device\n"
        if arguments[-1] == "ro.kernel.qemu":
            return "1\n"
        return "synthetic\n"

    monkeypatch.setattr(module, "adb", fake_adb)
    with pytest.raises(RuntimeError, match="physical_device_required"):
        module.physical_environment(Path("adb"), "emulator-5554")


def test_physical_environment_exports_only_hashed_device_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    values = {
        "ro.kernel.qemu": "0",
        "ro.build.fingerprint": "vendor/device/release",
        "ro.product.cpu.abi": "arm64-v8a",
        "ro.product.manufacturer": "Vendor",
        "ro.product.model": "Tablet",
        "ro.build.version.sdk": "36",
    }

    def fake_adb(_path: Path, _serial: str, *arguments: str, timeout: int = 300) -> str:
        if arguments == ("get-state",):
            return "device\n"
        return values[arguments[-1]] + "\n"

    monkeypatch.setattr(module, "adb", fake_adb)
    result = module.physical_environment(Path("adb"), "hardware-secret-serial")
    assert set(result) == {"kind", "device_id_sha256", "manufacturer", "model", "api", "abi"}
    assert result["kind"] == "physical_device"
    assert len(result["device_id_sha256"]) == 64
    assert "hardware-secret-serial" not in str(result)
