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


def suite(path: Path) -> dict:
    root = ET.parse(path).getroot()
    return {
        key: int(root.attrib.get(key, 0))
        for key in ("tests", "failures", "errors", "skipped")
    } | {"name": root.attrib.get("name", ""), "sha256": digest(path)}


def main() -> int:
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    protocol_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/ModelToolChoiceProtocolAdapter.kt"
    client_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/HaiModelClient.kt"
    host_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/AndroidPythonHostAdapters.kt"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_tool_choice_policy.py"
    android_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ModelToolChoiceProtocolAdapterTest.kt"
    host_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/AndroidPythonHostAdaptersTest.kt"
    sources = (kernel_path, engine_path, protocol_path, client_path, host_path, python_test_path, android_test_path, host_test_path)
    kernel = kernel_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    protocol = protocol_path.read_text(encoding="utf-8")
    client = client_path.read_text(encoding="utf-8")
    host = host_path.read_text(encoding="utf-8")
    python_test = python_test_path.read_text(encoding="utf-8")
    android_test = android_test_path.read_text(encoding="utf-8")
    host_test = host_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", str(python_test_path.relative_to(REPO))],
        cwd=REPO, capture_output=True, text=True, timeout=60, check=False,
    )
    report_paths = [
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.ModelToolChoiceProtocolAdapterTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidPythonHostAdaptersTest.xml",
    ]
    suites = [suite(path) for path in report_paths if path.exists()]
    tests = sum(item["tests"] for item in suites)
    failures = sum(item["failures"] for item in suites)
    errors = sum(item["errors"] for item in suites)
    skipped = sum(item["skipped"] for item in suites)

    gates = {
        "shared_kernel_policy_is_versioned_and_digest_bound": "p9-tool-choice-v1" in kernel and "build_tool_choice_policy" in kernel and '"sha256": _canonical_digest(unsigned)' in kernel,
        "ordinary_requests_remain_auto": 'mode, selected, reason = "auto"' in kernel and "test_tool_choice_auto_for_stable_ordinary_request" in python_test,
        "required_host_fact_requests_use_required": 'mode, selected, reason = "required"' in kernel and "HEPiX2026是什么" in python_test,
        "no_visible_tools_uses_none": 'mode, selected, reason = "none"' in kernel and 'tool_choice"]["mode"] == "none"' in python_test,
        "specified_tool_is_validated_and_pinned": "tool_choice_specified_tool_unavailable" in kernel and "specified_tool" in python_test,
        "real_mobile_model_requests_carry_policy": 'request_payload.setdefault("tool_choice"' in engine and "test_mobile_kernel_attaches_none_auto_and_required" in python_test,
        "openai_and_anthropic_wire_mappings_are_complete": all(value in protocol + android_test for value in (
            '"auto", "required", "none"', 'JSONObject().put("type", "any")', 'JSONObject().put("type", "tool")',
        )),
        "production_hai_client_consumes_kernel_policy": "streamCompletionWithToolChoice" in client and "ModelToolChoiceProtocolAdapter.openAi(toolChoice)" in client,
        "android_host_forwards_policy_without_reclassification": "request.toolChoice" in host and "shared Kernel tool choice policy reaches production-aware gateway" in host_test,
        "python_and_android_focused_suites_are_green": pytest.returncode == 0 and len(suites) == 2 and tests >= 10 and failures == errors == skipped == 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M09-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "jvm_suites": {"tests": tests, "failures": failures, "errors": errors, "skipped": skipped, "reports": suites},
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m09-f03-tool-choice-policy.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "jvm_tests": tests}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
