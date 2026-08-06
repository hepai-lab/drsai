from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path) -> dict:
    root = ET.parse(path).getroot()
    return {
        key: int(root.attrib.get(key, 0))
        for key in ("tests", "failures", "errors", "skipped")
    } | {"name": root.attrib.get("name", ""), "sha256": digest(path)}


def main() -> int:
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    policy_test_path = REPO / "cores/python/packages/drsai/tests/test_tool_verification_policy.py"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/P9NaturalMultiStepAgentE2ETest.kt"
    sources = (kernel_path, policy_test_path, device_test_path)
    kernel = kernel_path.read_text(encoding="utf-8")
    policy_test = policy_test_path.read_text(encoding="utf-8")
    device_test = device_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [
            sys.executable, "-m", "pytest", "-q",
            "cores/python/packages/drsai/tests/test_tool_verification_policy.py",
            "cores/python/packages/drsai/tests/test_forced_retrieval_policy.py",
            "cores/python/packages/drsai/tests/test_tool_decision_diagnostics.py",
            "cores/python/packages/drsai/tests/test_citation_evidence.py",
            "cores/python/packages/drsai/tests/test_subagent_kernel_parity.py",
            "cores/python/packages/drsai/tests/test_mobile_agent_core.py",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    device_reports = [
        path for path in reports
        if "P9NaturalMultiStepAgentE2ETest" in path.read_text(encoding="utf-8")
    ]
    device_suites = [suite(path) for path in device_reports]
    connected = {
        "tests": sum(item["tests"] for item in device_suites),
        "failures": sum(item["failures"] for item in device_suites),
        "errors": sum(item["errors"] for item in device_suites),
        "skipped": sum(item["skipped"] for item in device_suites),
        "reports": len(device_suites),
    } if device_suites else None
    durable = REPO / "docs/android/reports/evidence/p9/m08-f06-natural-multistep-e2e-instrumentation.xml"
    if device_reports:
        durable.parent.mkdir(parents=True, exist_ok=True)
        durable.write_text("\n".join(path.read_text(encoding="utf-8") for path in reversed(device_reports)), encoding="utf-8")

    gates = {
        "natural_prompt_does_not_name_implementation_tools": "检索 HEPiX 2026" in device_test and '.put("input",' in device_test and all(
            name not in device_test.split('.put("input",', 1)[1].split('.put("model_id"', 1)[0]
            for name in ("web.search", "workspace.read", "core.update_plan", "delegate", "save_artifact")
        ),
        "satisfied_retrieval_allows_later_multistep_tools": "if prior_tool_use and required:" in kernel and "test_satisfied_required_retrieval_allows_later_multistep_tools" in policy_test,
        "agent_plans_and_uses_search_and_local_file": all(value in device_test for value in ("core.update_plan", "web.search", "workspace.read", "plan.started")),
        "agent_delegates_a_scoped_research_subtask": all(value in device_test for value in ("delegate-1", "hepix-research", "subagent.started", "subagent.completed")),
        "artifact_creation_requires_approval_and_descriptor": all(value in device_test for value in ("save_artifact", "artifact creation must carry approval", "HostArtifactDescriptor", "artifact.created")),
        "final_answer_cites_external_and_local_results": all(value in device_test for value in ("https://www.hepix.org/", "notes/android-runtime-baseline.md", "citation.verified")),
        "oaep_terminal_and_artifact_identity_are_asserted": all(value in device_test for value in ("message.completed", "run.completed", "p9-hepix-2026-comparison-report")),
        "shared_kernel_regression_is_green": pytest.returncode == 0,
        "emulator_and_physical_device_e2e_are_green": bool(connected and connected["reports"] >= 2 and connected["tests"] >= 2 and connected["failures"] == connected["errors"] == connected["skipped"] == 0),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M08-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {
            "returncode": pytest.returncode,
            "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:]),
        },
        "connected_suite": connected,
        "connected_report": str(durable.relative_to(REPO)).replace("\\", "/") if device_reports else None,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m08-f06-natural-multistep-e2e.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
