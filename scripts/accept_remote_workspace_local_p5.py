#!/usr/bin/env python3
"""Run the authoritative, content-free P5 local component gate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "release/product-evidence/mobile-remote-workspace-p5/local-acceptance.json"
RELEASE_TEST_FIREBASE_PROPERTIES = (
    "-Popendrsai.android.testBuildType=release",
    "-Popendrsai.android.firebase.apiKey=AIzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "-Popendrsai.android.firebase.applicationId=1:123:android:abcdef",
    "-Popendrsai.android.firebase.projectId=p5-test-project",
    "-Popendrsai.android.firebase.senderId=123",
)
PYTHON_TESTS = (
    "cores/python/packages/drsai/tests/test_relay_api.py",
    "cores/python/packages/drsai/tests/test_relay_contract_codegen.py",
    "cores/python/packages/drsai/tests/test_relay_runtime_api.py",
    "cores/python/packages/drsai/tests/test_relay_registry.py",
    "cores/python/packages/drsai/tests/test_relay_notifications.py",
    "cores/python/packages/drsai/tests/test_relay_idempotency.py",
    "cores/python/packages/drsai/tests/test_relay_gateway_control.py",
    "cores/python/packages/drsai/tests/test_relay_runtime_domain.py",
    "cores/python/packages/drsai/tests/test_gateway_opendrsai_approval.py",
    "cores/python/packages/drsai/tests/test_runtime_conversation_journal.py",
    "cores/python/packages/drsai/tests/test_runtime_observability.py",
    "cores/python/packages/drsai/tests/test_relay_runtime_client.py",
    "cores/python/packages/drsai/tests/test_relay_oaep_replay.py",
    "cores/python/packages/drsai/tests/test_relay_oaep_performance.py",
    "cores/python/packages/drsai/tests/test_oaep_snapshot_window.py",
    "scripts/test_preflight_remote_workspace_push.py",
    "scripts/test_accept_mobile_remote_workspace_long_session_p5.py",
    "scripts/test_accept_mobile_remote_workspace_session_catalog_p5.py",
    "scripts/test_accept_mobile_remote_workspace_interaction_p5.py",
    "scripts/test_p5_android_apk.py",
    "scripts/test_finalize_remote_workspace_p5.py",
    "scripts/test_assemble_remote_workspace_p5_evidence.py",
    "scripts/test_remote_workspace_cli.py",
)


def _gradle() -> tuple[str, Path]:
    android = ROOT / "apps/android"
    wrapper = android / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if not wrapper.is_file():
        raise RuntimeError("p5_local_gradle_wrapper_missing")
    return str(wrapper), android


def _java_environment() -> dict[str, str]:
    environment = dict(os.environ)
    if environment.get("JAVA_HOME"):
        return environment
    candidates = (
        Path(r"C:\Program Files\Android\Android Studio\jbr"),
        Path.home() / ".jdks",
        Path("/opt/android-studio/jbr"),
    )
    for candidate in candidates:
        if candidate.is_dir() and (candidate / ("bin/java.exe" if os.name == "nt" else "bin/java")).is_file():
            environment["JAVA_HOME"] = str(candidate)
            return environment
    raise RuntimeError("p5_local_java_home_missing")


def suite_catalog() -> list[tuple[str, list[str], Path, dict[str, str] | None]]:
    wrapper, android = _gradle()
    return [
        ("architecture", [sys.executable, str(ROOT / "scripts/verify_remote_workspace_p5_architecture.py")], ROOT, None),
        ("python", [sys.executable, "-m", "pytest", "-q", *PYTHON_TESTS], ROOT, None),
        ("android_unit", [wrapper, ":app:testDebugUnitTest", "--no-daemon"], android, _java_environment()),
        ("android_test_compile", [wrapper, ":app:compileDebugAndroidTestKotlin", "--no-daemon"], android, _java_environment()),
        ("android_release_test_compile", [
            wrapper, *RELEASE_TEST_FIREBASE_PROPERTIES,
            ":app:compileReleaseAndroidTestKotlin", "--no-daemon",
        ], android, _java_environment()),
    ]


def _run(name: str, command: list[str], cwd: Path, environment: dict[str, str] | None,
         timeout: int) -> dict[str, object]:
    started = time.monotonic()
    try:
        result = subprocess.run(
            command, cwd=cwd, env=environment, capture_output=True,
            timeout=timeout, check=False,
        )
        combined = bytes(result.stdout or b"") + bytes(result.stderr or b"")
        return {
            "name": name,
            "passed": result.returncode == 0,
            "return_code": result.returncode,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "output_bytes": len(combined),
            "output_sha256": hashlib.sha256(combined).hexdigest(),
        }
    except subprocess.TimeoutExpired:
        return {
            "name": name,
            "passed": False,
            "return_code": None,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "output_bytes": 0,
            "output_sha256": hashlib.sha256(b"").hexdigest(),
            "error_code": "p5_local_suite_timeout",
        }


def atomic_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args(argv)
    if not 30 <= args.timeout <= 3600:
        raise SystemExit("p5_local_timeout_invalid")
    try:
        suites = [
            _run(name, command, cwd, environment, args.timeout)
            for name, command, cwd, environment in suite_catalog()
        ]
    except RuntimeError as failure:
        suites = [{
            "name": "preflight", "passed": False, "return_code": None,
            "duration_ms": 0, "output_bytes": 0,
            "output_sha256": hashlib.sha256(b"").hexdigest(),
            "error_code": str(failure),
        }]
    payload: dict[str, object] = {
        "schema_version": "p5-local-acceptance/1",
        "protocols": ["oaep/1", "owop/1"],
        "suites": suites,
        "passed": bool(suites) and all(row["passed"] is True for row in suites),
    }
    atomic_json(args.output.resolve(), payload)
    print(json.dumps({
        "schema_version": payload["schema_version"],
        "suite_count": len(suites),
        "passed": payload["passed"],
    }, sort_keys=True))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
