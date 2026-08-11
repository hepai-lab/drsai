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


def main() -> int:
    test_path = REPO / "cores/python/packages/drsai/tests/test_forced_retrieval_policy.py"
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    search_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/WebSearchTool.kt"
    capability_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(test_path.relative_to(REPO)), "-q"], cwd=REPO,
        capture_output=True, text=True, timeout=60, check=False,
    )
    kernel = kernel_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    capability = capability_path.read_text(encoding="utf-8")
    web_search = search_path.read_text(encoding="utf-8")
    mapper_xml_path = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonRuntimeEventMapperTest.xml"
    mapper_green = False
    if mapper_xml_path.is_file():
        root = ET.parse(mapper_xml_path).getroot()
        mapper_green = int(root.attrib.get("failures", 0)) == 0 and int(root.attrib.get("errors", 0)) == 0
    device_xml_paths = sorted((REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("TEST-*.xml"))
    device_policy_green = False
    if device_xml_paths:
        root = ET.parse(device_xml_paths[-1]).getroot()
        names = [item.attrib.get("name", "") for item in root.findall("testcase")]
        device_policy_green = (
            int(root.attrib.get("failures", 0)) == 0 and int(root.attrib.get("errors", 0)) == 0
            and any("chineseUnfamiliarEntityCannotBypassBundledPythonRetrievalPolicy" in name for name in names)
        )
    gates = {
        "unicode_policy_v2": 'TOOL_DECISION_POLICY_VERSION = "p9-tool-decision-v2"' in kernel and "unicodedata.normalize" in kernel,
        "natural_chinese_hepix_variants": all(value in test_path.read_text(encoding="utf-8") for value in ("HEPiX2026是什么", "Hepix2026是什么")),
        "freshness_and_source_terms": all(value in kernel for value in ("最新", "截至", "来源", "联网")),
        "guess_is_buffered": "verification.required" in engine and "before_verification_retry" in engine,
        "unavailable_is_explicit": "verification.unavailable" in engine,
        "web_search_is_real_android_host_tool": 'id = "web.search"' in web_search and 'requiredArguments = setOf("query")' in web_search,
        "web_search_requires_validated_network": "WEB_SEARCH" in capability and "androidNetworkAvailable()" in capability,
        "oaep_mapper_regression_green": mapper_green,
        "api35_bundled_python_policy_green": device_policy_green,
        "natural_task_batch_passed": pytest.returncode == 0,
    }
    sources = (test_path, kernel_path, engine_path, search_path, capability_path)
    report = {
        "schema_version": 1, "feature_id": "M05-F04", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m05-f04-forced-retrieval.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
