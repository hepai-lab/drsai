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
    "cores/python/packages/drsai/tests/test_mobile_pairing.py",
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
    "scripts/test_smoke_runtime_relay_write_contract_p6.py",
    "scripts/test_smoke_runtime_relay_error_actions_p6.py",
    "scripts/test_generate_remote_workspace_legacy_inventory_p6.py",
    "scripts/test_verify_p6_android_workspace_boundaries.py",
    "scripts/test_verify_p6_android_session_state_machines.py",
    "scripts/test_verify_p6_android_session_ui_authority.py",
    "scripts/test_verify_p6_android_resource_ownership.py",
    "scripts/test_verify_p6_android_time_scheduler.py",
    "scripts/test_verify_p6_android_host_status.py",
    "scripts/test_verify_p6_mobile_device_scope.py",
    "scripts/test_verify_p6_mobile_remote_diagnostics.py",
    "scripts/test_verify_p6_session_catalog_realtime.py",
    "scripts/test_verify_p6_conversation_realtime.py",
    "scripts/test_verify_p6_message_delivery.py",
    "scripts/test_verify_p6_run_approval_races.py",
    "scripts/test_verify_p6_long_session_navigation.py",
    "scripts/test_verify_p6_push_readiness.py",
    "scripts/test_verify_p6_safe_notification_navigation.py",
    "scripts/test_verify_p6_android_background_policy.py",
    "scripts/test_p5_legacy_rollback.py",
    "scripts/test_collect_oaep_legacy_migration_evidence.py",
    "scripts/test_check_oaep_legacy_removal.py",
    "scripts/test_remote_workspace_cli.py",
)
GRADLE_ISOLATION = ("--no-daemon", "--max-workers=1", "-Pkotlin.compiler.execution.strategy=in-process")


def _project_python() -> str:
    executable = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not executable.is_file():
        raise RuntimeError("p5_local_project_python_missing")
    return str(executable)


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
    project_python = _project_python()
    return [
        ("architecture", [project_python, str(ROOT / "scripts/verify_remote_workspace_p5_architecture.py")], ROOT, None),
        ("python", [project_python, "-m", "pytest", "-q", *PYTHON_TESTS], ROOT, None),
        ("desktop_error_actions", [
            project_python, str(ROOT / "scripts/verify_p6_relay_error_actions.py"),
        ], ROOT, None),
        ("legacy_inventory", [
            project_python, str(ROOT / "scripts/generate_remote_workspace_legacy_inventory_p6.py"), "--check",
        ], ROOT, None),
        ("android_boundaries", [
            project_python, str(ROOT / "scripts/verify_p6_android_workspace_boundaries.py"),
        ], ROOT, None),
        ("android_session_machines", [
            project_python, str(ROOT / "scripts/verify_p6_android_session_state_machines.py"),
        ], ROOT, None),
        ("android_session_ui_authority", [
            project_python, str(ROOT / "scripts/verify_p6_android_session_ui_authority.py"),
        ], ROOT, None),
        ("android_resource_ownership", [
            project_python, str(ROOT / "scripts/verify_p6_android_resource_ownership.py"),
        ], ROOT, None),
        ("android_time_scheduler", [
            project_python, str(ROOT / "scripts/verify_p6_android_time_scheduler.py"),
        ], ROOT, None),
        ("android_host_status", [
            project_python, str(ROOT / "scripts/verify_p6_android_host_status.py"),
        ], ROOT, None),
        ("mobile_pairing_wizard", [
            "node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_mobile_pairing_wizard.mjs"),
        ], ROOT, None),
        ("mobile_device_scope", [
            "node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_mobile_device_scope.mjs"),
        ], ROOT, None),
        ("mobile_remote_diagnostics", [
            "node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_mobile_remote_diagnostics.mjs"),
        ], ROOT, None),
        ("session_catalog_realtime", [
            "node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_session_catalog_realtime.mjs"),
        ], ROOT, None),
        ("conversation_realtime", [
            "node", str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(ROOT / "scripts/verify_p6_conversation_realtime.mjs"),
        ], ROOT, None),
        ("message_delivery", [
            "node", str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(ROOT / "apps/desktop/windows/scripts/verify-p6-message-delivery.mts"),
        ], ROOT / "apps/desktop/windows", None),
        ("run_approval_races", [
            "node", str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(ROOT / "apps/desktop/windows/scripts/verify-p6-run-approval-races.mts"),
        ], ROOT / "apps/desktop/windows", None),
        ("long_session_navigation", [
            "node", str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(ROOT / "scripts/verify_p6_long_session_navigation.mjs"),
        ], ROOT, None),
        ("push_readiness", [
            project_python, str(ROOT / "scripts/verify_p6_push_readiness.py"),
        ], ROOT, None),
        ("safe_notification_navigation", [
            project_python, str(ROOT / "scripts/verify_p6_safe_notification_navigation.py"),
        ], ROOT, None),
        ("android_background_policy", [
            project_python, str(ROOT / "scripts/verify_p6_android_background_policy.py"),
        ], ROOT, None),
        ("android_unit", [wrapper, ":app:testDebugUnitTest", *GRADLE_ISOLATION], android, _java_environment()),
        ("android_test_compile", [wrapper, ":app:compileDebugAndroidTestKotlin", *GRADLE_ISOLATION], android, _java_environment()),
        ("android_release_test_compile", [
            wrapper, *RELEASE_TEST_FIREBASE_PROPERTIES,
            ":app:compileReleaseAndroidTestKotlin", *GRADLE_ISOLATION,
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
