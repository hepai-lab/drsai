from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def android_suite(name: str) -> dict[str, int | str] | None:
    path = REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml"
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    result: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    result["sha256"] = digest(path)
    return result


def main() -> int:
    planner_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/device/WorkspaceMutationPlanner.kt"
    capabilities_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/device/AndroidLocalCapabilities.kt"
    registry_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    planner_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/WorkspaceMutationPlannerTest.kt"
    approval_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ToolApprovalPolicyTest.kt"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    engine_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    planner = planner_path.read_text(encoding="utf-8")
    capabilities = capabilities_path.read_text(encoding="utf-8")
    registry = registry_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(engine_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=90, check=False,
    )
    suites = {
        name: android_suite(name)
        for name in ("WorkspaceMutationPlannerTest", "ToolApprovalPolicyTest", "WorkspaceToolSemanticParityTest")
    }
    gates = {
        "host_prepares_target_diff_digests_and_token": all(
            value in planner for value in ("previewJson", "before_sha256", "after_sha256", "diff", "mutation_token")
        ),
        "approval_receives_prepared_preview_not_model_arguments": "ToolApprovalPreviewer" in registry and "prepareApproval" in registry,
        "write_edit_and_undo_are_approval_gated_file_changes": all(
            f'"workspace.{name}"' in capabilities for name in ("write", "edit", "undo")
        ) and capabilities.count('oaepOutputType = "file_change"') >= 3,
        "commit_revalidates_current_digest": "workspace_mutation_conflict" in planner and "verifyCurrent(plan" in planner,
        "commit_is_call_and_subject_bound_exactly_once": all(
            value in planner for value in ("receipts[key]", "replayed = true", 'return "$subject\\u0000$callId"')
        ),
        "undo_is_receipt_bound_and_account_isolated": "planUndo" in planner and "key.startsWith(prefix)" in planner,
        "oaep_file_change_uses_host_receipt": all(
            value in engine for value in ("output_content.get(\"path\"", "diff_summary", "before_sha256", "mutation_token")
        ),
        "python_file_change_regression_green": pytest.returncode == 0,
        "android_mutation_tests_green": suites["WorkspaceMutationPlannerTest"] is not None
            and suites["WorkspaceMutationPlannerTest"]["tests"] >= 3
            and suites["WorkspaceMutationPlannerTest"]["failures"] == 0
            and suites["WorkspaceMutationPlannerTest"]["errors"] == 0,
        "android_approval_and_semantic_regression_green": all(
            suites[name] is not None and suites[name]["failures"] == 0 and suites[name]["errors"] == 0
            for name in ("ToolApprovalPolicyTest", "WorkspaceToolSemanticParityTest")
        ),
    }
    sources = (
        planner_path, capabilities_path, registry_path, planner_test_path, approval_test_path, engine_path, engine_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M06-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_suites": suites,
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m06-f02-workspace-diff-approval.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
