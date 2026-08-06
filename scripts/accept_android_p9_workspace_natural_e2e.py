from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_suite(path: Path) -> dict[str, int | str] | None:
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    result: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    result["name"] = root.attrib.get("name", "")
    result["sha256"] = digest(path)
    return result


def green(value: dict[str, int | str] | None, minimum: int = 1) -> bool:
    return value is not None and int(value["tests"]) >= minimum and value["failures"] == 0 and value["errors"] == 0


def main() -> int:
    e2e_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/WorkspaceNaturalTaskInstrumentedTest.kt"
    coordinator_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonAgentLoopCoordinator.kt"
    service_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeService.kt"
    result_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeExecutionResult.kt"
    coordinator_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonAgentLoopCoordinatorTest.kt"
    e2e = e2e_path.read_text(encoding="utf-8")
    coordinator = coordinator_path.read_text(encoding="utf-8")
    service = service_path.read_text(encoding="utf-8")
    coordinator_test = coordinator_test_path.read_text(encoding="utf-8")

    connected_reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    device_path = next(
        (path for path in connected_reports if "WorkspaceNaturalTaskInstrumentedTest" in path.read_text(encoding="utf-8")),
        None,
    )
    device_suite = parse_suite(device_path) if device_path else None
    coordinator_suite = parse_suite(
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonAgentLoopCoordinatorTest.xml"
    )
    required_order = [
        '"workspace.list"', '"workspace.search"', '"workspace.read"', '"workspace.edit"', '"workspace.read"',
    ]
    gates = {
        "natural_chinese_task_drives_workspace_agent_loop": "查找授权目录里的功能开关配置" in e2e
            and "NaturalWorkspaceModel" in e2e,
        "agent_lists_searches_reads_edits_and_verifies": all(value in e2e for value in required_order)
            and "feature.enabled=true" in e2e,
        "write_requires_durable_approval": "write must carry durable approval" in e2e
            and 'HostApprovalDecision(request.approvalId, "approved")' in e2e,
        "diff_is_visible_before_approval": "WorkspaceMutationPlanner.plan" in e2e
            and "+feature.enabled=true" in e2e,
        "mutation_is_conflict_checked_and_exactly_once": "WorkspaceMutationJournal" in e2e
            and "journal.prepare" in e2e and "journal.commit" in e2e,
        "kernel_and_host_checkpoint_state_are_deep_merged": "mergeHostState" in coordinator
            and "checkpointMutex.withLock" in coordinator and "persistCoreState" in coordinator,
        "approval_survives_later_kernel_checkpoint": "kernel checkpoint after approval cannot erase durable host approval" in coordinator_test
            and "_host_approved_calls" in coordinator_test,
        "runtime_restart_resumes_then_completes": "ExpectedRuntimeRestart" in e2e
            and "PythonRuntimeMessageType.RESUME_RUN" in e2e and '"run.recovered"' in e2e and '"run.completed"' in e2e,
        "oaep_file_change_is_complete": '"oaep_output_type", "file_change"' in e2e
            and '"file_change.completed"' in e2e and "before_sha256" in e2e and "after_sha256" in e2e,
        "runtime_boundary_failure_is_logged_and_redacted": "Python Runtime command failed" in service
            and "SensitiveDataRedactor.redact" in service,
        "api35_bundled_runtime_e2e_green": green(device_suite),
        "coordinator_regression_green": green(coordinator_suite, 1),
    }
    sources = (e2e_path, coordinator_path, service_path, result_path, coordinator_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M06-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "connected_suite": device_suite,
        "connected_report": None if device_path is None else str(device_path.relative_to(REPO)).replace("\\", "/"),
        "coordinator_suite": coordinator_suite,
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m06-f06-workspace-natural-e2e.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
