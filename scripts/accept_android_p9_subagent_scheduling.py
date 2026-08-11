from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path | None) -> dict[str, int | str] | None:
    if path is None or not path.is_file():
        return None
    root = ET.parse(path).getroot()
    value: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    value["name"] = root.attrib.get("name", "")
    value["sha256"] = digest(path)
    return value


def green(value: dict[str, int | str] | None, minimum: int) -> bool:
    return bool(value and int(value["tests"]) >= minimum and int(value["failures"]) == 0 and int(value["errors"]) == 0)


def main() -> int:
    scheduler_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/subagents.py"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    scheduler_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_subagents.py"
    parity_test_path = REPO / "cores/python/packages/drsai/tests/test_subagent_kernel_parity.py"
    mobile_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    coordinator_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonAgentLoopCoordinator.kt"
    coordinator_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonAgentLoopCoordinatorTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeCriticalJourneyTest.kt"

    scheduler = scheduler_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    coordinator = coordinator_path.read_text(encoding="utf-8")
    scheduler_tests = scheduler_test_path.read_text(encoding="utf-8")
    parity_tests = parity_test_path.read_text(encoding="utf-8")
    coordinator_tests = coordinator_test_path.read_text(encoding="utf-8")
    device_test = device_test_path.read_text(encoding="utf-8")
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(scheduler_test_path.relative_to(REPO)),
         str(parity_test_path.relative_to(REPO)), str(mobile_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=120, check=False,
    )
    coordinator_suite = suite(
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonAgentLoopCoordinatorTest.xml"
    )
    connected = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime, reverse=True,
    )
    device_path = next(
        (path for path in connected if "PythonRuntimeCriticalJourneyTest" in path.read_text(encoding="utf-8")), None,
    )
    device_suite = suite(device_path)
    durable = REPO / "docs/android/reports/evidence/p9/m08-f03-subagent-scheduling-instrumentation.xml"
    if device_path is not None:
        durable.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable)

    gates = {
        "canonical_versioned_scheduling_policy": (
            'SUBAGENT_SCHEDULING_POLICY_VERSION = "p9-subagent-scheduling-v1"' in scheduler
            and '"sha256"' in scheduler
        ),
        "foreground_parallelism_is_capped_at_two": (
            "SUBAGENT_FOREGROUND_MAX_PARALLEL = 2" in scheduler
            and "foreground host runs two logical subagent model requests concurrently" in coordinator_tests
        ),
        "active_children_are_capped_at_three": (
            "SUBAGENT_MAX_ACTIVE = 3" in scheduler and "subagent_active_limit" in engine
        ),
        "background_low_memory_and_thermal_are_serial": all(value in coordinator_tests for value in (
            "PythonRuntimeLifecycleState.BACKGROUND", "PythonRuntimeLifecycleState.LOW_MEMORY",
            "PythonRuntimeLifecycleState.THERMAL_LIMITED", "must serialize",
        )),
        "host_rechecks_resources_before_each_subagent_batch": (
            "val currentLifecycle = ports.lifecycle.current()" in coordinator
            and "PythonRuntimeMessageType.LIFECYCLE_CHANGED" in coordinator
        ),
        "resource_transition_is_checkpointed_by_kernel": (
            "state.subagent_scheduling_policy = build_subagent_scheduling_policy(lifecycle)" in engine
            and 'self._checkpoint(state, "lifecycle_changed")' in engine
        ),
        "checkpoint_resume_preserves_child_request_and_schedule": (
            "test_subagent_checkpoint_resume_preserves_child_kernel_request_and_schedule" in parity_tests
            and '{**dict(task["model_request"])' in engine
        ),
        "parent_cancel_closes_delegate_and_all_children": (
            "test_parent_cancellation_closes_all_subagent_state_without_orphans" in parity_tests
            and "cancelled: parent_cancelled" in engine
        ),
        "python_and_android_scheduler_regressions_are_green": pytest.returncode == 0 and green(coordinator_suite, 17),
        "api35_real_runtime_publishes_scheduling_identity": (
            green(device_suite, 1) and "p9-subagent-scheduling-v1" in device_test
            and 'getJSONObject("subagent_scheduling")' in device_test
        ),
    }
    sources = (
        scheduler_path, engine_path, scheduler_test_path, parity_test_path, mobile_test_path,
        coordinator_path, coordinator_test_path, device_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M08-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_coordinator_suite": coordinator_suite,
        "connected_suite": device_suite,
        "connected_report": str(durable.relative_to(REPO)).replace("\\", "/") if device_path else None,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m08-f03-subagent-scheduling.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
