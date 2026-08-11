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
    test = "cores/python/packages/drsai/tests/test_citation_evidence.py"
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", test, "-q"], cwd=REPO,
        capture_output=True, text=True, timeout=60, check=False,
    )
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    mapper_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt"
    mapper_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt"
    kernel, engine, mapper = (path.read_text(encoding="utf-8") for path in (kernel_path, engine_path, mapper_path))
    mapper_xml_path = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonRuntimeEventMapperTest.xml"
    mapper_suite = None
    if mapper_xml_path.is_file():
        root = ET.parse(mapper_xml_path).getroot()
        mapper_suite = {
            "tests": int(root.attrib.get("tests", 0)), "failures": int(root.attrib.get("failures", 0)),
            "errors": int(root.attrib.get("errors", 0)), "sha256": digest(mapper_xml_path),
            "cases": [item.attrib.get("name", "") for item in root.findall("testcase")],
        }
    gates = {
        "citation_policy_is_versioned_and_digest_bound": "p9-citation-policy-v1" in kernel and "citation_evidence_digest_mismatch" in kernel,
        "source_urls_are_bound_to_successful_retrieval_receipts": "source_call_ids" in kernel and "source_url_sha256" in kernel and '_tool_decision_domain(name) != "retrieval"' in kernel,
        "missing_citation_is_buffered_and_retried": '"citation.required"' in engine and "before_citation_retry" in engine,
        "fabricated_url_fails_closed": "citation_evidence_invalid" in engine and "fabricated_url_sha256" in kernel,
        "exact_tool_source_can_complete": pytest.returncode == 0,
        "checkpoint_preserves_and_verifies_evidence": "normalize_citation_evidence(raw.get(\"citation_evidence\"))" in engine and '"citation_evidence": dict(state.citation_evidence)' in engine,
        "oaep_exports_only_call_ids_and_digests": '"citation.verified"' in mapper and '"source_url_sha256"' in mapper and '"source_url"' not in mapper,
        "android_mapper_regression_passed": mapper_suite is not None and mapper_suite["failures"] == 0 and mapper_suite["errors"] == 0 and any("citation provenance maps only call ids" in name for name in mapper_suite["cases"]),
    }
    sources = (kernel_path, engine_path, mapper_path, mapper_test_path, REPO / test)
    report = {
        "schema_version": 1, "feature_id": "M05-F03", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_mapper": mapper_suite,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m05-f03-citation-evidence.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
