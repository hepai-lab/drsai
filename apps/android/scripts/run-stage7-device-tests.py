"""Run Stage 7 instrumentation filters in isolated processes and emit bound evidence.

Android UTP treats an intentional exit of the app's dedicated ``:runtime``
process as a crash when several lifecycle tests share one invocation.  This
runner executes each filter through ``am instrument`` independently, while
still failing closed on any failed, skipped, incomplete, or malformed result.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(command: list[str], timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=timeout, check=False)


def parse_instrumentation(output: str) -> list[dict[str, str]]:
    """Return completed tests, rejecting non-passing or incomplete runners."""
    current: dict[str, str] = {}
    completed: list[dict[str, str]] = []
    for line in output.splitlines():
        match = re.match(r"INSTRUMENTATION_STATUS: ([^=]+)=(.*)", line)
        if match:
            current[match.group(1)] = match.group(2)
            continue
        code = re.match(r"INSTRUMENTATION_STATUS_CODE: (-?\d+)", line)
        if not code:
            continue
        status = int(code.group(1))
        if status == 1:
            current = {key: value for key, value in current.items() if key in {"class", "test"}}
        elif status == 0:
            if not current.get("class") or not current.get("test"):
                raise RuntimeError("instrumentation_pass_without_test_identity")
            completed.append({"classname": current["class"], "name": current["test"]})
            current = {}
        elif status in {-2, -3, -4}:
            raise RuntimeError(f"instrumentation_test_not_passed:{current.get('class')}:{current.get('test')}:{status}")
    if "INSTRUMENTATION_CODE: -1" not in output or not re.search(r"\bOK \(\d+ tests?\)", output):
        raise RuntimeError("instrumentation_run_incomplete")
    if not completed:
        raise RuntimeError("instrumentation_no_completed_tests")
    return completed


def adb(adb_path: Path, serial: str, *args: str, timeout: int = 300) -> str:
    result = run([str(adb_path), "-s", serial, *args], timeout=timeout)
    output = result.stdout + result.stderr
    if result.returncode != 0:
        raise RuntimeError(f"adb_failed:{result.returncode}:{output[-1000:]}")
    return output


def write_junit(path: Path, filter_name: str, cases: list[dict[str, str]], seconds: float) -> None:
    suite = ET.Element("testsuite", name=filter_name, tests=str(len(cases)), failures="0", errors="0",
                       skipped="0", time=f"{seconds:.3f}")
    for case in cases:
        ET.SubElement(suite, "testcase", classname=case["classname"], name=case["name"])
    ET.ElementTree(suite).write(path, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--app-apk", type=Path, required=True)
    parser.add_argument("--test-apk", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--test-package", required=True)
    parser.add_argument("--runner", default="androidx.test.runner.AndroidJUnitRunner")
    parser.add_argument("--filter", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    app_hash = sha256(args.app_apk)
    if identity.get("apk_sha256") != app_hash:
        raise RuntimeError("candidate_apk_identity_mismatch")
    if not args.test_apk.is_file() or not args.adb.is_file():
        raise RuntimeError("device_test_input_missing")

    started = utc_now()
    fingerprint = adb(args.adb, args.serial, "shell", "getprop", "ro.build.fingerprint").strip()
    serial_hash = hashlib.sha256(
        f"stage7-device-v1\0{identity['acceptance_run_id']}\0{args.serial}\0{fingerprint}".encode()
    ).hexdigest()
    manufacturer = adb(args.adb, args.serial, "shell", "getprop", "ro.product.manufacturer").strip()
    model = adb(args.adb, args.serial, "shell", "getprop", "ro.product.model").strip()
    api = int(adb(args.adb, args.serial, "shell", "getprop", "ro.build.version.sdk").strip())
    abi = adb(args.adb, args.serial, "shell", "getprop", "ro.product.cpu.abi").strip()
    qemu = adb(args.adb, args.serial, "shell", "getprop", "ro.kernel.qemu").strip()
    meminfo = adb(args.adb, args.serial, "shell", "cat", "/proc/meminfo")
    memory = re.search(r"MemTotal:\s+(\d+)\s+kB", meminfo)
    kind = "emulator" if qemu == "1" or args.serial.startswith("emulator-") else "physical_device"
    if "Success" not in adb(args.adb, args.serial, "install", "-r", "-t", str(args.app_apk), timeout=180):
        raise RuntimeError("candidate_apk_install_not_confirmed")
    if "Success" not in adb(args.adb, args.serial, "install", "-r", "-t", str(args.test_apk), timeout=180):
        raise RuntimeError("test_apk_install_not_confirmed")
    package_dump = adb(args.adb, args.serial, "shell", "dumpsys", "package", args.package)
    if f"versionName={identity['version_name']}" not in package_dump or not re.search(
            rf"versionCode={re.escape(str(identity['version_code']))}\b", package_dump):
        raise RuntimeError("installed_package_identity_mismatch")
    registered = adb(args.adb, args.serial, "shell", "pm", "list", "instrumentation")
    component = f"instrumentation:{args.test_package}/{args.runner} (target={args.package})"
    if component not in registered:
        raise RuntimeError("instrumentation_target_identity_mismatch")

    output_dir = args.output.parent / (args.output.stem + "-junit")
    output_dir.mkdir(parents=True, exist_ok=True)
    reports = []
    total = 0
    for index, filter_name in enumerate(args.filter, 1):
        filter_started = datetime.now(timezone.utc)
        # API 26 may reject every logcat clear form, including on debuggable
        # emulators. Use an identity-bound boundary marker instead: this is
        # non-destructive and gives every filter a provably isolated suffix.
        marker_digest = hashlib.sha256(
            f"{identity['acceptance_run_id']}\0{index}\0{filter_name}".encode()
        ).hexdigest()[:24]
        log_marker = f"STAGE7_LOG_BOUNDARY_{marker_digest}"
        adb(args.adb, args.serial, "shell", "log", "-t", "Stage7Evidence", log_marker)
        raw = adb(args.adb, args.serial, "shell", "am", "instrument", "-w", "-r", "-e", "class",
                  filter_name, f"{args.test_package}/{args.runner}", timeout=600)
        stem = f"{index:02d}-{re.sub(r'[^A-Za-z0-9_.-]', '_', filter_name)}"
        raw_path = output_dir / f"{stem}.instrumentation.txt"
        raw_path.write_text(raw, encoding="utf-8")
        full_logcat = adb(args.adb, args.serial, "logcat", "-d", "-v", "threadtime")
        marker_offset = full_logcat.rfind(log_marker)
        if marker_offset < 0:
            raise RuntimeError("logcat_boundary_marker_missing")
        logcat = full_logcat[marker_offset:]
        logcat_path = output_dir / f"{stem}.logcat.txt"
        logcat_path.write_text(logcat, encoding="utf-8")
        cases = parse_instrumentation(raw)
        seconds = (datetime.now(timezone.utc) - filter_started).total_seconds()
        junit = output_dir / f"{stem}.xml"
        write_junit(junit, filter_name, cases, seconds)
        total += len(cases)
        report = {"filter": filter_name, "tests": len(cases), "junit": junit.name,
                        "junit_sha256": sha256(junit), "raw_output": raw_path.name,
                        "raw_output_sha256": sha256(raw_path), "logcat": logcat_path.name,
                        "logcat_sha256": sha256(logcat_path), "duration_seconds": round(seconds, 3)}
        marker = "PYTHON_RUNTIME_PERF="
        metric_lines = [line.split(marker, 1)[1].strip() for line in logcat.splitlines() if marker in line]
        if metric_lines:
            try:
                report["performance"] = json.loads(metric_lines[-1])
            except json.JSONDecodeError as exc:
                raise RuntimeError("performance_marker_invalid_json") from exc
        recovery_marker = "PYTHON_RUNTIME_RECOVERY="
        recovery_lines = [line.split(recovery_marker, 1)[1].strip() for line in logcat.splitlines() if recovery_marker in line]
        if recovery_lines:
            try:
                report["recovery"] = json.loads(recovery_lines[-1])
            except json.JSONDecodeError as exc:
                raise RuntimeError("recovery_marker_invalid_json") from exc
        reports.append(report)

    completed = utc_now()
    provenance = {
        "runner": "stage7-isolated-am-instrument-v1", "acceptance_run_id": identity["acceptance_run_id"],
        "package_version_code": identity["version_code"], "package_version_name": identity["version_name"],
        "apk_sha256": app_hash, "started_at": started, "completed_at": completed,
        "device_ids_sha256": [serial_hash], "test_filters": args.filter,
    }
    value = {
        "schema_version": 2, "generated_at": completed, "identity": identity, "provenance": provenance,
        "environment": {"device_id_sha256": serial_hash, "device_id_scheme": "stage7-device-v1",
                        "manufacturer": manufacturer, "model": model,
                        "api": api, "abi": abi, "kind": kind,
                        "memory_mb": int(memory.group(1)) // 1024 if memory else 0},
        "artifacts": {"app_apk_sha256": app_hash, "test_apk_sha256": sha256(args.test_apk)},
        "summary": {"filters": len(args.filter), "tests": total, "failed": 0, "skipped": 0},
        "reports": reports, "result": "passed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
