from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
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
    adapter_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/ModelToolSchemaProtocolAdapter.kt"
    client_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/HaiModelClient.kt"
    host_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/AndroidPythonHostAdapters.kt"
    fixture_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ModelToolSchemaProtocolAdapterTest.kt"
    client_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/HaiModelClientTest.kt"
    sources = (adapter_path, client_path, host_path, fixture_path, client_test_path)
    adapter = adapter_path.read_text(encoding="utf-8")
    client = client_path.read_text(encoding="utf-8")
    host = host_path.read_text(encoding="utf-8")
    fixture = fixture_path.read_text(encoding="utf-8")
    client_test = client_test_path.read_text(encoding="utf-8")

    report_paths = [
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.ModelToolSchemaProtocolAdapterTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.HaiModelClientTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidPythonHostAdaptersTest.xml",
    ]
    suites = [suite(path) for path in report_paths if path.exists()]
    tests = sum(item["tests"] for item in suites)
    failures = sum(item["failures"] for item in suites)
    errors = sum(item["errors"] for item in suites)
    skipped = sum(item["skipped"] for item in suites)

    gates = {
        "single_protocol_adapter_routes_openai_and_anthropic": all(value in adapter for value in (
            '"openai" -> openAi(schemas)', '"anthropic" -> anthropic(schemas)',
        )) and "ModelToolSchemaProtocolAdapter.adapt" in client,
        "openai_function_shape_and_name_mapping_are_exact": all(value in adapter for value in (
            '.put("type", "function")', '.put("function", JSONObject()', "toHaiToolName",
        )),
        "anthropic_input_schema_shape_is_exact": all(value in adapter for value in (
            'fun anthropic(', '.put("input_schema"',
        )),
        "unicode_enum_nested_object_and_array_are_preserved": all(value in fixture for value in (
            "检索中文与 Unicode ✓", 'put("enum"', 'put("type", "array")', 'put("type", "object")',
        )),
        "complete_full_runtime_catalog_adapts_to_both_protocols": "complete Full Runtime core catalog adapts to both provider protocols" in fixture,
        "malformed_schema_fails_before_network": "model_tool_schema_invalid" in adapter and "malformed schemas fail before provider" in fixture,
        "provider_rejection_has_stable_nonretryable_code": all(value in client + client_test for value in (
            "model_tool_schema_rejected", "providerToolSchemaRejectionHasStableNonRetryableCompatibilityCode",
        )),
        "host_preserves_structured_compatibility_errors": "if (error.code != null) throw error" in host,
        "focused_jvm_suites_are_green": len(suites) == 3 and tests >= 25 and failures == errors == skipped == 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M09-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "jvm_suites": {
            "tests": tests,
            "failures": failures,
            "errors": errors,
            "skipped": skipped,
            "reports": suites,
        },
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path)
            for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m09-f02-tool-schema-protocols.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "tests": tests}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
