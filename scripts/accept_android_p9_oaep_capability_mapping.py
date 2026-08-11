from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit(path: Path) -> dict:
    root = ET.parse(path).getroot()
    return {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")} | {
        "name": root.attrib.get("name", ""), "sha256": digest(path),
    }


def main() -> int:
    sources = [
        ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt",
        ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/coordinator/DesktopHandoffOaep.kt",
        ROOT / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt",
        ROOT / "apps/android/app/src/test/java/ai/drsai/remote/P9OaepCapabilityMappingTest.kt",
        ROOT / "apps/android/app/src/test/java/ai/drsai/remote/DesktopHandoffOaepTest.kt",
        ROOT / "apps/android/app/src/test/java/ai/drsai/remote/DesktopHandoffContractTest.kt",
        ROOT / "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt",
        ROOT / "cores/python/packages/drsai/tests/test_mobile_agent_core.py",
    ]
    engine, mapper, handoff, view_model, capability_test, _, handoff_contract, _, _ = [path.read_text(encoding="utf-8") for path in sources]
    report_paths = [
        ROOT / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.P9OaepCapabilityMappingTest.xml",
        ROOT / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.DesktopHandoffOaepTest.xml",
        ROOT / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonRuntimeEventMapperTest.xml",
    ]
    suites = [junit(path) for path in report_paths if path.is_file()]
    python = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "cores/python/packages/drsai/tests/test_mobile_agent_core.py"],
        cwd=ROOT, text=True, encoding="utf-8", errors="replace", capture_output=True,
    )
    tests = sum(item["tests"] for item in suites)
    failures = sum(item["failures"] + item["errors"] for item in suites)
    gates = {
        "web_tool_has_oaep_tool_call": all(value in capability_test for value in ("web.search", "OaepToolCallContent")),
        "citation_has_message_and_notice": all(value in mapper for value in ("citations", "citation.required", "citation.verified")),
        "mcp_preserves_server_identity": 'server = payload.optString("server")' in mapper and "mcp.docs.lookup" in capability_test,
        "skill_has_redacted_oaep_snapshot": "skill_manifest_snapshot" in mapper and "skill_snapshot" in engine,
        "skill_instructions_never_enter_diagnostic": '"instructions_sha256"' in engine and '"instructions":' not in engine[engine.index('"skill_snapshot"'):engine.index('"host_port_protocol_version"')],
        "handoff_offer_and_decision_are_oaep": all(value in handoff for value in ("OaepInteractionContent", "RunWaiting", "RunCompleted", "RunCancelled")),
        "handoff_ui_is_commit_after_oaep": "persistOaepEvents" in view_model and "DesktopHandoffOaep.accepted" in view_model and "DesktopHandoffOaep.declined" in view_model and "persistOaepEvents" in handoff_contract,
        "subagent_has_oaep_subtask": all(value in mapper for value in ("subagent.started", "subagent.completed", "OaepSubtaskContent")),
        "unknown_extension_is_visible": "unknown_runtime_event" in mapper and "must-not-export" in capability_test,
        "focused_jvm_suites_green": len(suites) == 3 and tests >= 27 and failures == 0 and all(item["skipped"] == 0 for item in suites),
        "shared_kernel_suite_green": python.returncode == 0 and "39 passed" in python.stdout,
    }
    report = {
        "schema_version": 1, "feature_id": "M10-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "jvm_suites": {"tests": tests, "failures_and_errors": failures, "reports": suites},
        "python_suite": {"returncode": python.returncode, "summary": (python.stdout + python.stderr)[-1000:]},
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m10-f01-oaep-capability-mapping.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "jvm_tests": tests}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
