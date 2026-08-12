"""Run the Android P9 natural-task preflight on an x86_64 emulator.

This runner is deliberately incapable of writing P9 release evidence. It may
create/start an installed AVD, upgrade-install the current Debug APKs, collect
raw observations and invoke the emulator-only scorer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
DEFAULT_OUTPUT_DIR = ROOT / "docs/android/reports/preflight/p9-emulator"
FORMAL_EVIDENCE = (ROOT / "docs/android/reports/evidence/p9").resolve()
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.P9NaturalToolSelectionInstrumentedTest"
LIFECYCLE_TEST_CLASS = "ai.drsai.remote.FullRuntimePhysicalAcceptanceTest"
MIGRATION_TEST_CLASS = "ai.drsai.remote.P9RuntimeMigrationInstrumentedTest"
CANCEL_BACKGROUND_TEST_CLASS = "ai.drsai.remote.P9RuntimeCancelBackgroundInstrumentedTest"
DEFAULT_BINDING_MARKER = "V156_PHYSICAL_DEFAULT_BINDING"
FAULT_RECOVERY_MARKER = "V156_PHYSICAL_FAULT_RECOVERY"
TOOL_RECOVERY_MARKER = "V156_PHYSICAL_TOOL_RECOVERY"
DEVICE_OUTPUT = "p9-m04-f06-natural-tool-selection-observations.json"
MODELS = ("deepseek-v4-flash", "deepseek-v4-pro")
EXPECTED_PYTHON_VERSION = "3.12"
EXPECTED_ABIS = ("arm64-v8a", "x86_64")


class EmulatorPreflightError(RuntimeError):
    pass


def command(
    arguments: list[str], *, timeout: int = 300, input_text: str | None = None, check: bool = True,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        arguments, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
        input=input_text, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if check and completed.returncode:
        raise EmulatorPreflightError(
            f"command_failed:{completed.returncode}:{' '.join(arguments)}\n{completed.stdout[-8000:]}"
        )
    return completed


def adb(adb_path: Path, serial: str, *arguments: str, timeout: int = 300, check: bool = True) -> str:
    return command([str(adb_path), "-s", serial, *arguments], timeout=timeout, check=check).stdout


def safe_output_dir(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == FORMAL_EVIDENCE or FORMAL_EVIDENCE in resolved.parents:
        raise EmulatorPreflightError("emulator_preflight_formal_evidence_forbidden")
    return resolved


def newest(directory: Path, pattern: str) -> Path:
    candidates = sorted(directory.glob(pattern), key=lambda item: item.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError(f"artifact_missing:{directory}:{pattern}")
    return candidates[0]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def embedded_python_runtime(apk: Path) -> dict[str, Any]:
    """Prove the candidate embeds one supported Python runtime for every release ABI."""
    with zipfile.ZipFile(apk) as archive:
        entries = set(archive.namelist())
    versions: dict[str, str] = {}
    for abi in EXPECTED_ABIS:
        matches = sorted(
            match.group(1)
            for entry in entries
            if (match := re.fullmatch(rf"lib/{re.escape(abi)}/libpython(\d+\.\d+)\.so", entry))
        )
        if len(matches) != 1:
            raise EmulatorPreflightError(f"embedded_python_runtime_invalid:{abi}:{matches}")
        versions[abi] = matches[0]
    if set(versions.values()) != {EXPECTED_PYTHON_VERSION}:
        raise EmulatorPreflightError(f"embedded_python_version_mismatch:{versions}")
    return {"python_version": EXPECTED_PYTHON_VERSION, "abis": versions}


def ensure_java_home() -> Path:
    configured = os.environ.get("JAVA_HOME")
    candidates = [
        Path(configured) if configured else None,
        Path(r"C:\Program Files\Android\Android Studio\jbr") if os.name == "nt" else None,
    ]
    for candidate in candidates:
        if candidate is not None and (candidate / ("bin/java.exe" if os.name == "nt" else "bin/java")).is_file():
            os.environ["JAVA_HOME"] = str(candidate)
            return candidate
    raise EmulatorPreflightError("java_home_missing")


def online_devices(adb_path: Path) -> set[str]:
    output = command([str(adb_path), "devices"], timeout=30).stdout
    return {
        parts[0] for line in output.splitlines()
        if len(parts := line.split()) >= 2 and parts[1] == "device"
    }


def installed_avds(emulator: Path) -> set[str]:
    return {line.strip() for line in command([str(emulator), "-list-avds"], timeout=30).stdout.splitlines() if line.strip()}


def ensure_avd(*, avdmanager: Path, emulator: Path, sdk: Path, avd: str, api: int) -> None:
    if avd in installed_avds(emulator):
        return
    package = f"system-images;android-{api};google_apis;x86_64"
    image = sdk / "system-images" / f"android-{api}" / "google_apis" / "x86_64" / "package.xml"
    if not image.is_file():
        raise EmulatorPreflightError(f"emulator_system_image_missing:{package}")
    command([
        str(avdmanager), "create", "avd", "--force", "--name", avd,
        "--package", package, "--device", "pixel_6",
    ], timeout=180, input_text="no\n")


def start_emulator(emulator: Path, avd: str, serial: str) -> subprocess.Popen[str]:
    match = re.fullmatch(r"emulator-(\d+)", serial)
    if not match:
        raise EmulatorPreflightError(f"emulator_serial_invalid:{serial}")
    return subprocess.Popen(
        [
            str(emulator), "-avd", avd, "-port", match.group(1), "-no-window", "-no-audio",
            "-no-boot-anim", "-no-snapshot-save", "-gpu", "swiftshader_indirect",
        ], cwd=ROOT, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def wait_boot(adb_path: Path, serial: str, timeout: int) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if serial in online_devices(adb_path):
            booted = adb(adb_path, serial, "shell", "getprop", "sys.boot_completed", timeout=20, check=False).strip()
            if booted == "1":
                adb(adb_path, serial, "shell", "input", "keyevent", "82", timeout=20, check=False)
                return
        time.sleep(2)
    raise EmulatorPreflightError(f"emulator_boot_timeout:{serial}")


def emulator_identity(adb_path: Path, serial: str) -> dict[str, Any]:
    def prop(name: str) -> str:
        last_error: BaseException | None = None
        for attempt in range(3):
            try:
                value = adb(adb_path, serial, "shell", "getprop", name, timeout=20).strip()
                if value:
                    return value
                last_error = EmulatorPreflightError(f"emulator_property_empty:{name}")
            except (subprocess.TimeoutExpired, EmulatorPreflightError) as error:
                last_error = error
            if attempt < 2:
                time.sleep(2)
        raise EmulatorPreflightError(f"emulator_property_unavailable:{name}") from last_error

    state = adb(adb_path, serial, "get-state", timeout=20).strip()
    qemu = prop("ro.kernel.qemu")
    abi = prop("ro.product.cpu.abi")
    if state != "device" or qemu != "1" or not serial.startswith("emulator-") or abi != "x86_64":
        raise EmulatorPreflightError(f"x86_64_emulator_gate_failed:state={state}:qemu={qemu}:abi={abi}")
    fingerprint = prop("ro.build.fingerprint")
    return {
        "kind": "emulator", "serial": serial,
        "device_id_sha256": hashlib.sha256(f"p9-emulator-preflight\0{serial}\0{fingerprint}".encode()).hexdigest(),
        "avd": prop("ro.boot.qemu.avd_name"), "api": int(prop("ro.build.version.sdk")), "abi": abi,
        "manufacturer": prop("ro.product.manufacturer"), "model": prop("ro.product.model"),
    }


def run_model(
    *, adb_path: Path, serial: str, model: str, attempts: int, case_filter: str | None, timeout: int,
) -> tuple[dict[str, Any], str]:
    arguments = [
        "shell", "am", "instrument", "-w", "-r",
        "-e", "runP9NaturalToolSelection", "true", "-e", "p9Model", model,
        "-e", "p9Attempts", str(attempts),
    ]
    if case_filter:
        arguments += ["-e", "p9Case", case_filter]
    arguments += ["-e", "class", TEST_CLASS, RUNNER]
    output = adb(adb_path, serial, *arguments, timeout=timeout)
    if "FAILURES!!!" in output or "INSTRUMENTATION_FAILED" in output or "OK (1 test)" not in output:
        raise EmulatorPreflightError(f"emulator_instrumentation_failed:{model}\n{output[-8000:]}")
    raw = adb(
        adb_path, serial, "exec-out", "run-as", PACKAGE, "cat", f"files/{DEVICE_OUTPUT}", timeout=60,
    )
    document = json.loads(raw)
    if document.get("model") != model:
        raise EmulatorPreflightError(f"emulator_observation_model_invalid:{model}")
    return document, output


def run_test_class(*, adb_path: Path, serial: str, test_class: str, timeout: int) -> tuple[int, str]:
    output = adb(
        adb_path, serial, "shell", "am", "instrument", "-w", "-r",
        "-e", "class", test_class, RUNNER, timeout=timeout,
    )
    if "FAILURES!!!" in output or "INSTRUMENTATION_FAILED" in output:
        raise EmulatorPreflightError(f"emulator_smoke_failed:{test_class}\n{output[-8000:]}")
    matched = re.search(r"OK \((\d+) tests?\)", output)
    if not matched:
        raise EmulatorPreflightError(f"emulator_smoke_result_missing:{test_class}\n{output[-8000:]}")
    return int(matched.group(1)), output


def run_lifecycle_method(*, adb_path: Path, serial: str, method: str, timeout: int) -> str:
    output = adb(
        adb_path, serial, "shell", "am", "instrument", "-w", "-r",
        "-e", "runP9EmulatorLifecycle", "true",
        "-e", "class", f"{LIFECYCLE_TEST_CLASS}#{method}", RUNNER, timeout=timeout,
    )
    if "FAILURES!!!" in output or "INSTRUMENTATION_FAILED" in output or "OK (1 test)" not in output:
        raise EmulatorPreflightError(f"emulator_lifecycle_failed:{method}\n{output[-8000:]}")
    return output


def read_log_marker(*, adb_path: Path, serial: str, marker: str) -> dict[str, Any]:
    output = adb(adb_path, serial, "logcat", "-d", "-s", f"{marker}:I", "*:S", timeout=30)
    matches = re.findall(rf"{re.escape(marker)}:\s*(\{{.*\}})", output)
    if not matches:
        raise EmulatorPreflightError(f"emulator_lifecycle_marker_missing:{marker}")
    return json.loads(matches[-1])


def lifecycle_gates(
    default: dict[str, Any], faults: dict[str, Any], tool: dict[str, Any],
    migration_tests: int, cancel_background_tests: int,
) -> dict[str, bool]:
    return {
        "cold_start_full_runtime_only": default.get("full_runtime_enabled") is True
        and default.get("kotlin_lite_enabled") is False,
        "cold_start_binding_ready": default.get("binding_state") == "READY"
        and default.get("python_status") == "python_runtime_ready",
        "dedicated_runtime_process": int(default.get("runtime_pid", 0)) > 0
        and default.get("runtime_pid") != default.get("main_pid"),
        "binding_observable": int(default.get("starts_delta", 0)) > 0
        and int(default.get("bind_attempts_delta", 0)) > 0
        and int(default.get("bind_successes_delta", 0)) > 0
        and int(default.get("safe_fallbacks_delta", -1)) == 0,
        "waiting_model_same_run_recovered": faults.get("process_reclaim") is True
        and faults.get("same_run_resumed") is True
        and faults.get("resume_event") == "run.recovered"
        and faults.get("resume_model_request") is True,
        "runtime_death_rebinds_without_lite": faults.get("bind_death") is True
        and faults.get("python_crash") is True
        and faults.get("kotlin_fallback_available") is False,
        "waiting_tool_same_run_recovered": tool.get("process_reclaim") is True
        and tool.get("same_run_resumed") is True
        and tool.get("resume_phase") == "waiting_tool"
        and int(tool.get("resume_event_count", 0)) == 1,
        "unfinished_tool_replayed_once": int(tool.get("tool_request_count", 0)) == 1
        and tool.get("call_id") == "physical-tool-call"
        and tool.get("kotlin_fallback_available") is False,
        "unrecoverable_checkpoint_fails_explicitly": migration_tests == 1,
        "cancel_background_oaep_and_anr_suite": cancel_background_tests == 2,
    }


def run_lifecycle_preflight(
    *, adb_path: Path, serial: str, output_dir: Path, timeout: int,
    environment: dict[str, Any], app_apk: Path, test_apk: Path,
) -> dict[str, Any]:
    adb(adb_path, serial, "shell", "pm", "clear", PACKAGE, timeout=60)
    adb(adb_path, serial, "shell", "am", "force-stop", PACKAGE, timeout=30)
    adb(adb_path, serial, "logcat", "-c", timeout=30)
    methods = [
        "defaultFullRuntimeBindingIsReadyAndObservable",
        "binderPythonAndNetworkFaultsRemainOnFullRuntime",
        "seedProcessReclaimCheckpoint",
    ]
    logs: dict[str, str] = {}
    for method in methods:
        logs[method] = run_lifecycle_method(
            adb_path=adb_path, serial=serial, method=method, timeout=timeout,
        )
    adb(adb_path, serial, "shell", "am", "force-stop", PACKAGE, timeout=30)
    logs["verifyProcessReclaimResumesSameRun"] = run_lifecycle_method(
        adb_path=adb_path, serial=serial, method="verifyProcessReclaimResumesSameRun", timeout=timeout,
    )
    logs["seedWaitingToolProcessReclaimCheckpoint"] = run_lifecycle_method(
        adb_path=adb_path, serial=serial, method="seedWaitingToolProcessReclaimCheckpoint", timeout=timeout,
    )
    adb(adb_path, serial, "shell", "am", "force-stop", PACKAGE, timeout=30)
    logs["verifyWaitingToolProcessReclaimReplaysUnfinishedCallOnce"] = run_lifecycle_method(
        adb_path=adb_path, serial=serial,
        method="verifyWaitingToolProcessReclaimReplaysUnfinishedCallOnce", timeout=timeout,
    )
    migration_count, migration_log = run_test_class(
        adb_path=adb_path, serial=serial, test_class=MIGRATION_TEST_CLASS, timeout=timeout,
    )
    logs["unrecoverableCheckpointMigration"] = migration_log
    cancel_background_count, cancel_background_log = run_test_class(
        adb_path=adb_path, serial=serial, test_class=CANCEL_BACKGROUND_TEST_CLASS, timeout=timeout,
    )
    logs["cancelBackgroundOaepAndAnr"] = cancel_background_log
    default = read_log_marker(adb_path=adb_path, serial=serial, marker=DEFAULT_BINDING_MARKER)
    faults = read_log_marker(adb_path=adb_path, serial=serial, marker=FAULT_RECOVERY_MARKER)
    tool = read_log_marker(adb_path=adb_path, serial=serial, marker=TOOL_RECOVERY_MARKER)
    log_files: dict[str, dict[str, Any]] = {}
    for method, contents in logs.items():
        path = output_dir / f"lifecycle-{method}.txt"
        path.write_text(contents, encoding="utf-8")
        log_files[method] = {
            "path": str(path.relative_to(ROOT)).replace("\\", "/"), "sha256": sha256(path),
        }
    gates = lifecycle_gates(default, faults, tool, migration_count, cancel_background_count)
    report = {
        "schema_version": "opendrsai.p9-emulator-lifecycle-preflight/1",
        "evidence_tier": "emulator_preflight", "release_evidence": False,
        "feature_ids": ["E02-F03", "E02-F04", "E02-F05"],
        "generated_at": datetime.now(UTC).isoformat(), "environment": environment,
        "artifacts": {
            "app_apk": {"name": app_apk.name, "sha256": sha256(app_apk)},
            "test_apk": {"name": test_apk.name, "sha256": sha256(test_apk)},
        },
        "observed": {"default_binding": default, "fault_recovery": faults, "tool_recovery": tool},
        "instrumentation": log_files, "gates": gates, "passed": all(gates.values()),
    }
    report_path = output_dir / f"lifecycle-api{environment['api']}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {
        "path": str(report_path.relative_to(ROOT)).replace("\\", "/"),
        "sha256": sha256(report_path), "passed": report["passed"], "gates": gates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk_default = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--sdk", type=Path, default=sdk_default)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--avd", default="OpenDrSai_P9_API35")
    parser.add_argument("--api", type=int, default=35)
    parser.add_argument("--app-apk", type=Path)
    parser.add_argument("--test-apk", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--case")
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--model", action="append", choices=MODELS)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--lifecycle-preflight", action="store_true")
    parser.add_argument("--smoke-class", action="append", default=[])
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--keep-emulator", action="store_true")
    parser.add_argument("--boot-timeout-seconds", type=int, default=300)
    parser.add_argument("--model-timeout-seconds", type=int, default=7200)
    options = parser.parse_args()
    if options.attempts < 1:
        raise EmulatorPreflightError("emulator_attempts_invalid")

    sdk = options.sdk.resolve()
    ensure_java_home()
    adb_path = sdk / "platform-tools/adb.exe"
    emulator = sdk / "emulator/emulator.exe"
    avdmanager = sdk / "cmdline-tools/latest/bin/avdmanager.bat"
    for tool in (adb_path, emulator, avdmanager):
        if not tool.is_file():
            raise FileNotFoundError(tool)
    output_dir = safe_output_dir(options.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    app_apk = options.app_apk or newest(ANDROID / "app/build/outputs/apk/debug", "*.apk")
    test_apk = options.test_apk or newest(ANDROID / "app/build/outputs/apk/androidTest/debug", "*.apk")

    started_process: subprocess.Popen[str] | None = None
    started_at = datetime.now(UTC).isoformat()
    try:
        if options.serial not in online_devices(adb_path):
            ensure_avd(avdmanager=avdmanager, emulator=emulator, sdk=sdk, avd=options.avd, api=options.api)
            started_process = start_emulator(emulator, options.avd, options.serial)
            wait_boot(adb_path, options.serial, options.boot_timeout_seconds)
        environment = emulator_identity(adb_path, options.serial)
        # API 26 doesn't expose ro.boot.qemu.avd_name. The runner-created or
        # explicitly selected AVD remains the authoritative non-secret name.
        if not environment["avd"]:
            environment["avd"] = options.avd
        if environment["api"] != options.api:
            raise EmulatorPreflightError(f"emulator_api_mismatch:{environment['api']}:{options.api}")
        if not options.skip_install:
            adb(adb_path, options.serial, "install", "-r", "-t", str(app_apk.resolve()), timeout=300)
            adb(adb_path, options.serial, "install", "-r", "-t", str(test_apk.resolve()), timeout=300)

        package_dump = adb(adb_path, options.serial, "shell", "dumpsys", "package", PACKAGE, timeout=60)
        version_name = next((line.split("=", 1)[1].strip() for line in package_dump.splitlines() if "versionName=" in line), None)
        manifest: dict[str, Any] = {
            "schema_version": "opendrsai.p9-emulator-preflight-manifest/1",
            "evidence_tier": "emulator_preflight", "release_evidence": False, "feature_ids": [],
            "started_at": started_at, "generated_at": datetime.now(UTC).isoformat(),
            "environment": environment,
            "application": {"application_id": PACKAGE, "version_name": version_name},
            "runtime": embedded_python_runtime(app_apk),
            "artifacts": {
                "app_apk": {"name": app_apk.name, "sha256": sha256(app_apk)},
                "test_apk": {"name": test_apk.name, "sha256": sha256(test_apk)},
            },
            "requested": {"models": options.model or list(MODELS), "attempts": options.attempts, "case": options.case},
            "smoke_tests": {},
            "lifecycle": None,
            "observations": {},
        }
        if options.lifecycle_preflight:
            manifest["lifecycle"] = run_lifecycle_preflight(
                adb_path=adb_path, serial=options.serial, output_dir=output_dir,
                timeout=options.model_timeout_seconds, environment=environment,
                app_apk=app_apk, test_apk=test_apk,
            )
            if not manifest["lifecycle"]["passed"]:
                raise EmulatorPreflightError("emulator_lifecycle_gates_failed")
        for test_class in options.smoke_class:
            tests, instrumentation = run_test_class(
                adb_path=adb_path, serial=options.serial, test_class=test_class,
                timeout=options.model_timeout_seconds,
            )
            log_path = output_dir / f"instrumentation-{test_class}.txt"
            log_path.write_text(instrumentation, encoding="utf-8")
            manifest["smoke_tests"][test_class] = {
                "passed": True, "tests": tests,
                "path": str(log_path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256(log_path),
            }
        if not options.prepare_only:
            models = options.model or list(MODELS)
            for model in models:
                document, instrumentation = run_model(
                    adb_path=adb_path, serial=options.serial, model=model, attempts=options.attempts,
                    case_filter=options.case, timeout=options.model_timeout_seconds,
                )
                raw_path = output_dir / f"real-model-{model}.json"
                raw_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                log_path = output_dir / f"instrumentation-{model}.txt"
                log_path.write_text(instrumentation, encoding="utf-8")
                manifest["observations"][model] = {
                    "path": str(raw_path.relative_to(ROOT)).replace("\\", "/"),
                    "sha256": sha256(raw_path), "count": len(document.get("observations", [])),
                }
            if set(models) == set(MODELS) and options.case is None and options.attempts == 3:
                scorer = ROOT / "scripts/score_android_p9_emulator_preflight.py"
                command([
                    sys.executable, str(scorer),
                    "--flash", str(output_dir / "real-model-deepseek-v4-flash.json"),
                    "--pro", str(output_dir / "real-model-deepseek-v4-pro.json"),
                    "--output", str(output_dir / "real-model-statistics.json"),
                ], timeout=120)
                manifest["statistics"] = {
                    "path": str((output_dir / "real-model-statistics.json").relative_to(ROOT)).replace("\\", "/"),
                    "sha256": sha256(output_dir / "real-model-statistics.json"),
                }
        manifest_path = output_dir / "manifest.json"
        manifest["generated_at"] = datetime.now(UTC).isoformat()
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({
            "evidence_tier": "emulator_preflight", "prepared": True, "environment": environment,
            "manifest": str(manifest_path), "observations": manifest["observations"],
        }, ensure_ascii=False, indent=2))
        return 0
    finally:
        if started_process is not None and not options.keep_emulator:
            adb(adb_path, options.serial, "emu", "kill", timeout=30, check=False)
            try:
                started_process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                started_process.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
