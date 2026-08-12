from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import zipfile

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/run_android_p9_emulator_preflight.py"
SPEC = importlib.util.spec_from_file_location("run_android_p9_emulator_preflight", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_preflight_output_cannot_target_formal_evidence(tmp_path: Path) -> None:
    with pytest.raises(MODULE.EmulatorPreflightError, match="formal_evidence_forbidden"):
        MODULE.safe_output_dir(MODULE.FORMAL_EVIDENCE)
    with pytest.raises(MODULE.EmulatorPreflightError, match="formal_evidence_forbidden"):
        MODULE.safe_output_dir(MODULE.FORMAL_EVIDENCE / "nested")
    assert MODULE.safe_output_dir(tmp_path) == tmp_path.resolve()


def test_expected_models_and_package_are_frozen() -> None:
    assert MODULE.MODELS == ("deepseek-v4-flash", "deepseek-v4-pro")
    assert MODULE.PACKAGE == "ai.drsai.remote.debug"
    assert MODULE.DEFAULT_OUTPUT_DIR.parts[-3:] == ("reports", "preflight", "p9-emulator")
    assert MODULE.EXPECTED_PYTHON_VERSION == "3.12"


def test_embedded_python_runtime_requires_312_for_both_abis(tmp_path: Path) -> None:
    apk = tmp_path / "candidate.apk"
    with zipfile.ZipFile(apk, "w") as archive:
        archive.writestr("lib/arm64-v8a/libpython3.12.so", b"arm64")
        archive.writestr("lib/x86_64/libpython3.12.so", b"x86_64")
    assert MODULE.embedded_python_runtime(apk) == {
        "python_version": "3.12",
        "abis": {"arm64-v8a": "3.12", "x86_64": "3.12"},
    }

    mismatched = tmp_path / "mismatched.apk"
    with zipfile.ZipFile(mismatched, "w") as archive:
        archive.writestr("lib/arm64-v8a/libpython3.13.so", b"arm64")
        archive.writestr("lib/x86_64/libpython3.13.so", b"x86_64")
    with pytest.raises(MODULE.EmulatorPreflightError, match="embedded_python_version_mismatch"):
        MODULE.embedded_python_runtime(mismatched)


def test_java_home_resolves_to_a_java_binary() -> None:
    java_home = MODULE.ensure_java_home()
    executable = java_home / ("bin/java.exe" if MODULE.os.name == "nt" else "bin/java")
    assert executable.is_file()


def test_smoke_result_parser_requires_an_explicit_junit_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(MODULE, "adb", lambda *args, **kwargs: "OK (3 tests)\n")
    count, output = MODULE.run_test_class(
        adb_path=Path("adb"), serial="emulator-5554", test_class="ExampleTest", timeout=1,
    )
    assert count == 3 and "OK" in output

    monkeypatch.setattr(MODULE, "adb", lambda *args, **kwargs: "INSTRUMENTATION_FAILED\n")
    with pytest.raises(MODULE.EmulatorPreflightError, match="emulator_smoke_failed"):
        MODULE.run_test_class(
            adb_path=Path("adb"), serial="emulator-5554", test_class="ExampleTest", timeout=1,
        )


def test_emulator_identity_retries_transient_adb_property_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, int] = {}

    def fake_adb(_adb_path: Path, _serial: str, *arguments: str, **_kwargs: object) -> str:
        if arguments == ("get-state",):
            return "device\n"
        name = arguments[-1]
        calls[name] = calls.get(name, 0) + 1
        if name == "ro.kernel.qemu" and calls[name] == 1:
            raise subprocess.TimeoutExpired(["adb", "getprop", name], 20)
        return {
            "ro.kernel.qemu": "1",
            "ro.product.cpu.abi": "x86_64",
            "ro.build.fingerprint": "fixture/fingerprint",
            "ro.boot.qemu.avd_name": "OpenDrSai_P9_API35",
            "ro.build.version.sdk": "35",
            "ro.product.manufacturer": "Google",
            "ro.product.model": "sdk_gphone64_x86_64",
        }[name]

    monkeypatch.setattr(MODULE, "adb", fake_adb)
    monkeypatch.setattr(MODULE.time, "sleep", lambda _seconds: None)
    identity = MODULE.emulator_identity(Path("adb"), "emulator-5554")
    assert identity["api"] == 35
    assert calls["ro.kernel.qemu"] == 2


def test_lifecycle_gates_require_model_tool_and_explicit_unrecoverable_recovery() -> None:
    default = {
        "full_runtime_enabled": True, "kotlin_lite_enabled": False,
        "binding_state": "READY", "python_status": "python_runtime_ready",
        "main_pid": 10, "runtime_pid": 20, "starts_delta": 1,
        "bind_attempts_delta": 1, "bind_successes_delta": 1, "safe_fallbacks_delta": 0,
    }
    faults = {
        "process_reclaim": True, "same_run_resumed": True, "resume_event": "run.recovered",
        "resume_model_request": True, "bind_death": True, "python_crash": True,
        "kotlin_fallback_available": False,
    }
    tool = {
        "process_reclaim": True, "same_run_resumed": True, "resume_phase": "waiting_tool",
        "resume_event_count": 1, "tool_request_count": 1,
        "call_id": "physical-tool-call", "kotlin_fallback_available": False,
    }
    gates = MODULE.lifecycle_gates(default, faults, tool, migration_tests=1, cancel_background_tests=2)
    assert all(gates.values())

    duplicate_tool = {**tool, "tool_request_count": 2}
    rejected = MODULE.lifecycle_gates(
        default, faults, duplicate_tool, migration_tests=1, cancel_background_tests=2,
    )
    assert rejected["unfinished_tool_replayed_once"] is False

    missing_migration = MODULE.lifecycle_gates(
        default, faults, tool, migration_tests=0, cancel_background_tests=2,
    )
    assert missing_migration["unrecoverable_checkpoint_fails_explicitly"] is False

    missing_background = MODULE.lifecycle_gates(
        default, faults, tool, migration_tests=1, cancel_background_tests=1,
    )
    assert missing_background["cancel_background_oaep_and_anr_suite"] is False
