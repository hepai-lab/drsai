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
    state_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/plan_state.py"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    catalog_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/FullRuntimeToolCatalog.kt"
    mapper_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_plan_state.py"
    mobile_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    mapper_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeCriticalJourneyTest.kt"

    state = state_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    catalog = catalog_path.read_text(encoding="utf-8")
    mapper = mapper_path.read_text(encoding="utf-8")
    tests = python_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(python_test_path.relative_to(REPO)), str(mobile_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=120, check=False,
    )
    android_suites = {
        name: suite(REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml")
        for name in ("PythonRuntimeEventMapperTest", "ToolSchemaContractTest")
    }
    connected = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    device_path = next(
        (path for path in connected if "PythonRuntimeCriticalJourneyTest" in path.read_text(encoding="utf-8")), None,
    )
    device_suite = suite(device_path)
    durable = REPO / "docs/android/reports/evidence/p9/m08-f01-plan-state-instrumentation.xml"
    if device_path is not None:
        durable.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable)

    gates = {
        "single_versioned_plan_item_and_digest": all(value in state for value in (
            'PLAN_SCHEMA_VERSION = "p9-plan-state-v1"', '"item_id"', '"version"', '"sha256"',
        )),
        "legal_step_states_and_single_in_progress": (
            'STEP_STATUSES = frozenset({"pending", "in_progress", "completed", "failed"})' in state
            and "core_plan_multiple_in_progress" in state
            and "core_plan_terminal_step_changed" in state
            and "core_plan_step_regressed" in state
        ),
        "optimistic_concurrency_fails_closed": (
            "expected_version != current_version" in state
            and "core_plan_version_conflict" in state
            and "core_plan_concurrent_update" in engine
        ),
        "create_update_complete_fail_events_are_deterministic": all(value in state for value in (
            'return "plan.completed"', 'return "plan.failed"', 'return "plan.started" if plan["version"] == 1 else "plan.updated"',
        )),
        "checkpoint_and_resume_preserve_validated_plan": (
            "plan_state=normalize_plan_state(raw.get(\"plan_state\"))" in engine
            and '"plan_state": dict(state.plan_state)' in engine
            and "kernel_replay_and_checkpoint_recovery_keep_one_identical_plan" in tests
        ),
        "desktop_and_android_share_identical_plan_digest": (
            'pytest.mark.parametrize("surface", ["android", "desktop"])' in tests
            and "android_and_desktop_plan_digest_match_for_the_same_update" in tests
        ),
        "model_schema_requires_version_and_supports_failure": (
            'put("expected_version"' in catalog and '"failed"' in catalog and 'setOf("expected_version", "steps")' in catalog
        ),
        "oaep_maps_running_completed_and_failed_plan": (
            '"plan.started", "plan.updated"' in mapper and '"plan.completed"' in mapper and '"plan.failed"' in mapper
        ),
        "python_plan_and_mobile_regression_green": pytest.returncode == 0,
        "android_oaep_and_schema_suites_green": (
            green(android_suites["PythonRuntimeEventMapperTest"], 1)
            and green(android_suites["ToolSchemaContractTest"], 1)
        ),
        "api35_real_runtime_plan_journey_green": green(device_suite, 1),
    }
    sources = (
        state_path, engine_path, catalog_path, mapper_path, python_test_path, mobile_test_path,
        mapper_test_path, device_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M08-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_suites": android_suites,
        "connected_suite": device_suite,
        "connected_report": str(durable.relative_to(REPO)).replace("\\", "/") if device_path else None,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m08-f01-plan-state.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
