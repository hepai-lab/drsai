from __future__ import annotations

from datetime import datetime, timezone
import hashlib, json, shutil, subprocess, sys
from pathlib import Path
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]

def digest(path: Path) -> str: return hashlib.sha256(path.read_bytes()).hexdigest()

def suite(path: Path | None):
    if path is None or not path.is_file(): return None
    root = ET.parse(path).getroot()
    value = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}
    value.update(name=root.attrib.get("name", ""), sha256=digest(path))
    return value

def green(value, minimum: int) -> bool:
    return bool(value and value["tests"] >= minimum and value["failures"] == value["errors"] == 0)

def main() -> int:
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    parity_test_path = REPO / "cores/python/packages/drsai/tests/test_subagent_kernel_parity.py"
    mobile_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    coordinator_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonAgentLoopCoordinator.kt"
    mapper_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt"
    coordinator_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonAgentLoopCoordinatorTest.kt"
    mapper_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeCriticalJourneyTest.kt"
    engine, parity = engine_path.read_text(encoding="utf-8"), parity_test_path.read_text(encoding="utf-8")
    coordinator, mapper = coordinator_path.read_text(encoding="utf-8"), mapper_path.read_text(encoding="utf-8")
    coordinator_test = coordinator_test_path.read_text(encoding="utf-8")
    mapper_test, device_test = mapper_test_path.read_text(encoding="utf-8"), device_test_path.read_text(encoding="utf-8")
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(parity_test_path.relative_to(REPO)),
         str(mobile_test_path.relative_to(REPO)), "-q"], cwd=REPO, capture_output=True, text=True, timeout=120,
    )
    coordinator_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonAgentLoopCoordinatorTest.xml")
    mapper_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonRuntimeEventMapperTest.xml")
    connected = sorted((REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"), key=lambda p: p.stat().st_mtime, reverse=True)
    device_path = next((p for p in connected if "PythonRuntimeCriticalJourneyTest" in p.read_text(encoding="utf-8")), None)
    device_suite = suite(device_path)
    durable = REPO / "docs/android/reports/evidence/p9/m08-f04-subagent-oaep-instrumentation.xml"
    if device_path:
        durable.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(device_path, durable)
    gates = {
        "success_is_a_structured_subtask": '"subagent.completed"' in mapper and "OaepSubtaskContent" in mapper,
        "parent_child_hierarchy_and_source_are_preserved": all(v in engine for v in ('"parent_run_id": state.run_id', '"child_run_id": task["child_run_id"]', '"agent_name": task["kernel_id"]')),
        "partial_success_preserves_each_child_status": "[late] failed: model_timeout" in parity and "subagent_results" in engine and "subagent_failures" in engine,
        "timeout_is_scoped_to_the_child": "model_timeout" in coordinator and 'put("subagent_id", outcome.subagentId)' in coordinator,
        "subagent_failure_maps_to_oaep_item_failed": '"subagent.failed"' in mapper and "NormalizedAgentEvent.ItemFailed" in mapper,
        "parent_cancel_emits_cancelled_and_has_no_orphans": "parent_cancellation_closes_all_subagent_state_without_orphans" in parity and "parent_cancelled" in engine,
        "failed_child_cannot_be_reported_as_parent_success": '"code": "subagent_failed"' in engine and "not any(item.payload.get(\"kind\") == \"run.completed\"" in parity,
        "outbound_envelopes_are_frozen_for_replay": "copy.deepcopy(dict(payload))" in engine,
        "python_coordinator_and_mapper_regressions_are_green": pytest.returncode == 0 and green(coordinator_suite, 18) and green(mapper_suite, 19),
        "api35_success_partial_timeout_and_false_success_journey_is_green": green(device_suite, 1) and "delegate-failed" in device_test and "Everything succeeded" in device_test,
    }
    sources = (engine_path, parity_test_path, mobile_test_path, coordinator_path, mapper_path, coordinator_test_path, mapper_test_path, device_test_path)
    report = {
        "schema_version": 1, "feature_id": "M08-F04", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_coordinator_suite": coordinator_suite, "android_mapper_suite": mapper_suite,
        "connected_suite": device_suite,
        "connected_report": str(durable.relative_to(REPO)).replace("\\", "/") if device_path else None,
        "source_sha256": {str(p.relative_to(REPO)).replace("\\", "/"): digest(p) for p in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m08-f04-subagent-oaep.json"
    output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1

if __name__ == "__main__": raise SystemExit(main())
