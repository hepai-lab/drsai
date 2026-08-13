#!/usr/bin/env python3
"""Run the P5 long-session performance gate on one physical Android device."""
from __future__ import annotations

import argparse
import base64
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
BUILD_VARIANTS = {
    "debug": {
        "package": "ai.drsai.remote.debug",
        "apk_directory": "debug",
        "test_apk_directory": "debug",
    },
    "release": {
        "package": "ai.drsai.remote",
        "apk_directory": "release",
        "test_apk_directory": "release",
    },
    # Installable, minified release-derived artifact for physical performance gates.
    # It is intentionally not equivalent to an organization-signed public release.
    "mvp": {
        "package": "ai.drsai.remote",
        "apk_directory": "mvp",
        "test_apk_directory": "mvp",
    },
}
PACKAGE = str(BUILD_VARIANTS["debug"]["package"])
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.P5LongSessionPerformanceTest"
DEVICE_REPORT = "p5-long-session-performance.json"
DEFAULT_OUTPUT = (
    ROOT / "release/product-evidence/mobile-remote-workspace-p5"
    / "m06-long-session-physical.json"
)
EXPECTED_TOP_LEVEL = {"schema_version", "passed", "physical", "history", "delta", "budgets"}
LONG_SESSION_FEATURE_IDS = ("P5-M06-F02", "P5-M06-F03")
EXPECTED_ACCEPTANCE_TOP_LEVEL = {
    "schema_version", "feature_ids", "generated_at", "passed", "environment",
    "artifacts", "instrumentation", "gates", "metrics", "budgets",
}
LEGACY_HISTORY_KEYS = {
    "checkpoint_item_count", "cold_window_items", "cold_start_ms", "cold_pss_delta_kb",
    "full_history_items", "full_history_ms", "history_hash",
}
EXTENDED_HISTORY_KEYS = {
    "offline_search_matches",
    "offline_search_literal_metacharacters", "reading_anchor_stable",
    "search_anchor_stable", "history_restore_anchor_stable",
}
EXPECTED_HISTORY_KEYS = LEGACY_HISTORY_KEYS | EXTENDED_HISTORY_KEYS
EXPECTED_DELTA_KEYS = {
    "delta_count", "duration_ms", "throughput_per_second", "main_ticks", "worker_starts", "render_cycles",
    "content_hash", "terminal_barrier_complete",
}
EXPECTED_BUDGETS = {
    "cold_start_max_ms": 3_000,
    "cold_pss_max_kb": 32 * 1024,
    "history_max_ms": 180_000,
    "delta_count": 10_000,
    "delta_duration_max_ms": 5_000,
    "delta_min_throughput_per_second": 10_000,
    "minimum_main_ticks": 20,
}
EXPECTED_GATE_KEYS = {
    "checkpoint_item_count", "cold_window_items", "cold_start", "cold_memory",
    "full_history", "full_history_time", "history_hash", "delta_count", "delta_time",
    "delta_throughput", "main_responsive", "delta_hash", "terminal", "worker_bounded", "render_bounded",
    "offline_search", "reading_anchor", "search_anchor", "history_restore_anchor",
}


def run(command: list[str], *, timeout: int = 300) -> str:
    completed = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"p5_long_session_command_failed:{completed.returncode}\n{completed.stdout[-4000:]}")
    return completed.stdout


def adb(adb_path: Path, serial: str, *arguments: str, timeout: int = 300) -> str:
    return run([str(adb_path), "-s", serial, *arguments], timeout=timeout)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_single(directory: Path, pattern: str) -> Path:
    values = sorted(directory.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
    if not values:
        raise FileNotFoundError(f"p5_long_session_artifact_missing:{directory}:{pattern}")
    return values[0]


def physical_environment(adb_path: Path, serial: str) -> dict[str, Any]:
    def prop(name: str) -> str:
        return adb(adb_path, serial, "shell", "getprop", name, timeout=20).strip()

    state = adb(adb_path, serial, "get-state", timeout=20).strip()
    qemu = prop("ro.kernel.qemu")
    fingerprint = prop("ro.build.fingerprint")
    abi = prop("ro.product.cpu.abi")
    physical = state == "device" and qemu != "1" and not serial.startswith("emulator-")
    if not physical:
        raise RuntimeError("p5_long_session_physical_device_required")
    return {
        "kind": "physical_device",
        "device_id_sha256": hashlib.sha256(
            f"p5-long-session/1\0{serial}\0{fingerprint}".encode()
        ).hexdigest(),
        "manufacturer": prop("ro.product.manufacturer")[:80],
        "model": prop("ro.product.model")[:80],
        "api": int(prop("ro.build.version.sdk")),
        "abi": abi[:40],
    }


def validate_device_report(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != EXPECTED_TOP_LEVEL:
        raise ValueError("p5_long_session_report_shape_invalid")
    if value.get("schema_version") != "p5-long-session-physical/1":
        raise ValueError("p5_long_session_report_version_invalid")
    if value.get("passed") is not True or value.get("physical") is not True:
        raise ValueError("p5_long_session_report_not_passed")
    history, delta, budgets = value.get("history"), value.get("delta"), value.get("budgets")
    if not all(isinstance(item, dict) for item in (history, delta, budgets)):
        raise ValueError("p5_long_session_metrics_missing")
    history_keys = frozenset(history)
    if history_keys not in {frozenset(LEGACY_HISTORY_KEYS), frozenset(EXPECTED_HISTORY_KEYS)} \
            or set(delta) != EXPECTED_DELTA_KEYS \
            or budgets != EXPECTED_BUDGETS:
        raise ValueError("p5_long_session_metrics_shape_invalid")
    checks = {
        "checkpoint_item_count": history.get("checkpoint_item_count") == 100_000,
        "cold_window_items": 1 <= int(history.get("cold_window_items", 0)) <= 500,
        "cold_start": 0 <= int(history.get("cold_start_ms", -1)) <= int(budgets.get("cold_start_max_ms", -1)),
        "cold_memory": 0 <= int(history.get("cold_pss_delta_kb", -1)) <= int(budgets.get("cold_pss_max_kb", -1)),
        "full_history": history.get("full_history_items") == 100_000,
        "full_history_time": 0 <= int(history.get("full_history_ms", -1)) <= int(budgets.get("history_max_ms", -1)),
        "history_hash": isinstance(history.get("history_hash"), str) and len(history["history_hash"]) == 64,
        "delta_count": delta.get("delta_count") == budgets.get("delta_count") == 10_000,
        "delta_time": 0 <= int(delta.get("duration_ms", -1)) <= int(budgets.get("delta_duration_max_ms", -1)),
        "delta_throughput": int(delta.get("throughput_per_second", -1))
        >= int(budgets.get("delta_min_throughput_per_second", -1)) >= 10_000,
        "main_responsive": int(delta.get("main_ticks", -1)) >= int(budgets.get("minimum_main_ticks", -1)) >= 1,
        "delta_hash": isinstance(delta.get("content_hash"), str) and len(delta["content_hash"]) == 64,
        "terminal": delta.get("terminal_barrier_complete") is True,
        "worker_bounded": 1 <= int(delta.get("worker_starts", -1)) <= 10,
        "render_bounded": 1 <= int(delta.get("render_cycles", -1)) <= 10,
    }
    if history_keys == frozenset(EXPECTED_HISTORY_KEYS):
        checks.update({
            "offline_search": history.get("offline_search_matches") == 1
            and history.get("offline_search_literal_metacharacters") is True,
            "reading_anchor": history.get("reading_anchor_stable") is True,
            "search_anchor": history.get("search_anchor_stable") is True,
            "history_restore_anchor": history.get("history_restore_anchor_stable") is True,
        })
    if not all(checks.values()):
        failed = ",".join(name for name, passed in checks.items() if not passed)
        raise ValueError(f"p5_long_session_gate_failed:{failed}")
    return checks


def validate_acceptance_report(
    value: Any, *, expected_build_sha256: str | None = None,
    required_build_type: str | None = None,
) -> dict[str, Any]:
    """Validate the attested host report, not merely its file digest."""
    if not isinstance(value, dict) or set(value) != EXPECTED_ACCEPTANCE_TOP_LEVEL:
        raise ValueError("p5_long_session_acceptance_shape_invalid")
    if value.get("schema_version") != "p5-long-session-acceptance/1" \
            or value.get("passed") is not True:
        raise ValueError("p5_long_session_acceptance_not_passed")
    if value.get("feature_ids") != list(LONG_SESSION_FEATURE_IDS):
        raise ValueError("p5_long_session_feature_set_invalid")
    try:
        generated_at = datetime.fromisoformat(str(value.get("generated_at", "")).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("p5_long_session_generated_at_invalid") from exc
    if generated_at.tzinfo is None:
        raise ValueError("p5_long_session_generated_at_invalid")

    environment = value.get("environment")
    if not isinstance(environment, dict) or set(environment) != {
        "kind", "device_id_sha256", "manufacturer", "model", "api", "abi",
    } or environment.get("kind") != "physical_device" \
            or not _digest(environment.get("device_id_sha256")) \
            or not all(isinstance(environment.get(key), str) and environment[key].strip()
                       for key in ("manufacturer", "model", "abi")) \
            or not isinstance(environment.get("api"), int) \
            or isinstance(environment.get("api"), bool) or environment["api"] < 21:
        raise ValueError("p5_long_session_physical_environment_invalid")

    artifacts = value.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != {
        "app_build_type", "app_apk_sha256", "test_apk_artifact", "test_apk_bytes",
        "test_apk_sha256",
    } or not all(_digest(artifacts.get(key))
                 for key in ("app_apk_sha256", "test_apk_sha256")):
        raise ValueError("p5_long_session_artifact_attestation_invalid")
    test_artifact = artifacts.get("test_apk_artifact")
    if not isinstance(test_artifact, str) or not test_artifact.strip() \
            or Path(test_artifact).is_absolute() or ".." in Path(test_artifact).parts \
            or not isinstance(artifacts.get("test_apk_bytes"), int) \
            or isinstance(artifacts.get("test_apk_bytes"), bool) \
            or artifacts["test_apk_bytes"] <= 0:
        raise ValueError("p5_long_session_test_apk_attestation_invalid")
    build_type = artifacts.get("app_build_type")
    if build_type not in BUILD_VARIANTS:
        raise ValueError("p5_long_session_build_type_invalid")
    if required_build_type is not None and build_type != required_build_type:
        raise ValueError("p5_long_session_release_build_required")
    if expected_build_sha256 is not None and artifacts["app_apk_sha256"] != expected_build_sha256:
        raise ValueError("p5_long_session_build_mismatch")

    instrumentation = value.get("instrumentation")
    expected_package = str(BUILD_VARIANTS[str(build_type)]["package"])
    expected_runner = f"{expected_package}.test/androidx.test.runner.AndroidJUnitRunner"
    if not isinstance(instrumentation, dict) or set(instrumentation) != {
        "runner", "test_class", "tests", "failures",
    } or instrumentation.get("runner") != expected_runner \
            or instrumentation.get("test_class") != TEST_CLASS \
            or instrumentation.get("tests") != 1 or instrumentation.get("failures") != 0:
        raise ValueError("p5_long_session_instrumentation_invalid")

    gates = value.get("gates")
    if not isinstance(gates, dict) or any(item is not True for item in gates.values()):
        raise ValueError("p5_long_session_gate_attestation_invalid")
    metrics = value.get("metrics")
    budgets = value.get("budgets")
    if not isinstance(metrics, dict) or set(metrics) != {"history", "delta"}:
        raise ValueError("p5_long_session_metrics_missing")
    validated = validate_device_report({
        "schema_version": "p5-long-session-physical/1",
        "passed": True,
        "physical": True,
        "history": metrics.get("history"),
        "delta": metrics.get("delta"),
        "budgets": budgets,
    })
    if set(gates) != set(validated) or gates != validated:
        raise ValueError("p5_long_session_gate_attestation_mismatch")
    return validated


def _digest(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 \
        and all(character in "0123456789abcdef" for character in value)


def report_from_instrumentation(output: str) -> dict[str, Any]:
    prefix = "INSTRUMENTATION_STATUS: p5LongSessionReportBase64="
    candidates = [line[len(prefix):].strip() for line in output.splitlines()
                  if line.startswith(prefix)]
    if len(candidates) != 1 or not candidates[0]:
        raise ValueError("p5_long_session_instrumentation_report_missing")
    try:
        raw = base64.b64decode(candidates[0], validate=True)
        value = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("p5_long_session_instrumentation_report_invalid") from exc
    if not isinstance(value, dict):
        raise ValueError("p5_long_session_instrumentation_report_invalid")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--adb", type=Path, default=sdk / "platform-tools/adb.exe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--build-type", choices=sorted(BUILD_VARIANTS), default="debug")
    parser.add_argument("--app-apk", type=Path)
    parser.add_argument("--test-apk", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    options = parser.parse_args(argv)
    if not 60 <= options.timeout_seconds <= 1800:
        raise ValueError("p5_long_session_timeout_invalid")
    variant = BUILD_VARIANTS[options.build_type]
    package = str(variant["package"])
    runner = f"{package}.test/androidx.test.runner.AndroidJUnitRunner"
    app_apk = options.app_apk or find_single(
        ANDROID / f"app/build/outputs/apk/{variant['apk_directory']}", "*.apk"
    )
    test_apk = options.test_apk or find_single(
        ANDROID / f"app/build/outputs/apk/androidTest/{variant['test_apk_directory']}", "*.apk"
    )
    for path in (options.adb, app_apk, test_apk):
        if not path.is_file():
            raise FileNotFoundError(path)
    environment = physical_environment(options.adb, options.serial)
    if not options.skip_install:
        # Replacement install preserves the user's OIDC and Device Proof state.
        adb(options.adb, options.serial, "install", "-r", "-t", str(app_apk.resolve()), timeout=300)
        adb(options.adb, options.serial, "install", "-r", "-t", str(test_apk.resolve()), timeout=300)
    instrumentation = adb(
        options.adb, options.serial,
        "shell", "am", "instrument", "-w", "-r",
        "-e", "runP5LongSessionPerformance", "true",
        "-e", "class", TEST_CLASS,
        runner,
        timeout=options.timeout_seconds,
    )
    if "OK (1 test)" not in instrumentation or "FAILURES!!!" in instrumentation:
        raise RuntimeError(f"p5_long_session_instrumentation_failed\n{instrumentation[-4000:]}")
    try:
        device_report = report_from_instrumentation(instrumentation)
    except ValueError:
        if options.build_type != "debug":
            raise
        # Compatibility fallback for a previously installed debug Test APK.
        raw = adb(
            options.adb, options.serial, "exec-out", "run-as", package,
            "cat", f"files/{DEVICE_REPORT}", timeout=60,
        )
        device_report = json.loads(raw)
    checks = validate_device_report(device_report)
    completed_at = datetime.now(UTC).isoformat()
    output = options.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    test_digest = sha256(test_apk)
    test_artifact = Path("artifacts") / f"p5-long-session-test-{test_digest[:16]}.apk"
    copied_test_apk = output.parent / test_artifact
    copied_test_apk.parent.mkdir(parents=True, exist_ok=True)
    if copied_test_apk.resolve() != test_apk.resolve():
        temporary_apk = copied_test_apk.with_suffix(copied_test_apk.suffix + ".tmp")
        shutil.copyfile(test_apk, temporary_apk)
        temporary_apk.replace(copied_test_apk)
    report = {
        "schema_version": "p5-long-session-acceptance/1",
        "feature_ids": list(LONG_SESSION_FEATURE_IDS),
        "generated_at": completed_at,
        "passed": True,
        "environment": environment,
        "artifacts": {
            "app_build_type": options.build_type,
            "app_apk_sha256": sha256(app_apk),
            "test_apk_artifact": test_artifact.as_posix(),
            "test_apk_bytes": copied_test_apk.stat().st_size,
            "test_apk_sha256": test_digest,
        },
        "instrumentation": {
            "runner": runner,
            "test_class": TEST_CLASS,
            "tests": 1,
            "failures": 0,
        },
        "gates": checks,
        "metrics": {"history": device_report["history"], "delta": device_report["delta"]},
        "budgets": device_report["budgets"],
    }
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({
        "schema_version": report["schema_version"],
        "passed": report["passed"],
        "feature_count": len(report["feature_ids"]),
        "output_sha256": sha256(output),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
