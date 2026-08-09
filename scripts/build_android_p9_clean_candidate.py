from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
DEFAULT_OUTPUT = ROOT / "docs/android/reports/evidence/p9/m12-f06-clean-build.json"


def run(command: list[str], *, cwd: Path, timeout: int) -> str:
    completed = subprocess.run(
        command, cwd=cwd, timeout=timeout, check=False, text=True,
        encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}:{' '.join(command)}\n{completed.stdout[-8000:]}")
    return completed.stdout


def junit(paths: list[Path]) -> dict[str, int]:
    result = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for path in paths:
        root = ET.parse(path).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
        for suite in suites:
            for key in result:
                result[key] += int(suite.attrib.get(key, 0))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the P9 candidate from a provably clean checkout")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    args = parser.parse_args()
    initial_status = run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT, timeout=30)
    if initial_status != "":
        raise RuntimeError(f"p9_clean_checkout_required:{len(initial_status.splitlines())}_changes")
    commit = run(["git", "rev-parse", "HEAD"], cwd=ROOT, timeout=30).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RuntimeError("p9_git_commit_invalid")

    environment = os.environ.copy()
    environment.setdefault("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr")
    gradle = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    completed = subprocess.run(
        [str(gradle), "--no-daemon", "--offline", "-Dkotlin.compiler.execution.strategy=in-process",
         ":app:assembleDebug", ":app:assembleDebugAndroidTest", ":app:testDebugUnitTest"],
        cwd=ANDROID, env=environment, timeout=args.timeout_seconds, check=False, text=True,
        encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"p9_clean_gradle_failed\n{completed.stdout[-8000:]}")

    python_xml = ANDROID / "build/p9-python-full.xml"
    run([
        str(ROOT / ".venv/Scripts/python.exe"), "-m", "pytest",
        "cores/python/packages/drsai/tests", "-q", f"--junitxml={python_xml}",
    ], cwd=ROOT, timeout=args.timeout_seconds)
    android_result = junit(sorted((ANDROID / "app/build/test-results/testDebugUnitTest").glob("TEST-*.xml")))
    python_result = junit([python_xml])
    apk = max((ANDROID / "app/build/outputs/apk/debug").glob("OpenDrSai-Android-*.apk"), key=lambda path: path.stat().st_mtime)
    test_apk = max((ANDROID / "app/build/outputs/apk/androidTest/debug").glob("*.apk"), key=lambda path: path.stat().st_mtime)
    tracked_after = run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, timeout=30)
    gates = {
        "clean_checkout_before_build": initial_status == "",
        "tracked_sources_unchanged_by_build": tracked_after == "",
        "assemble_debug": apk.is_file(),
        "assemble_android_test": test_apk.is_file(),
        "android_jvm_full_suite": android_result["tests"] >= 548 and android_result["failures"] == 0 and android_result["errors"] == 0,
        "python_full_suite": python_result["tests"] >= 1872 and python_result["failures"] == 0 and python_result["errors"] == 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M12-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "clean_checkout": initial_status == "",
        "git_status_porcelain": initial_status,
        "git_commit": commit,
        "assemble_debug": apk.is_file(),
        "assemble_android_test": test_apk.is_file(),
        "android_jvm": android_result,
        "android_jvm_failures": android_result["failures"] + android_result["errors"],
        "python": python_result,
        "python_failures": python_result["failures"] + python_result["errors"],
        "apk": apk.name,
        "apk_sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
        "test_apk": test_apk.name,
        "test_apk_sha256": hashlib.sha256(test_apk.read_bytes()).hexdigest(),
        "gates": gates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "commit": commit}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
