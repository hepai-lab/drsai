from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit(path: Path) -> dict:
    root = ET.parse(path).getroot()
    return {
        key: int(root.attrib.get(key, 0))
        for key in ("tests", "failures", "errors", "skipped")
    } | {"name": root.attrib.get("name", ""), "sha256": digest(path)}


def main() -> int:
    contract_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/ModelRuntimeCapabilities.kt"
    adapter_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/AndroidPythonHostAdapters.kt"
    view_model_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    models_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/Models.kt"
    fixture_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ModelRuntimeCapabilitiesTest.kt"
    adapter_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/AndroidPythonHostAdaptersTest.kt"
    sources = (contract_path, adapter_path, view_model_path, models_path, fixture_path, adapter_test_path)
    contract = contract_path.read_text(encoding="utf-8")
    adapter = adapter_path.read_text(encoding="utf-8")
    view_model = view_model_path.read_text(encoding="utf-8")
    models = models_path.read_text(encoding="utf-8")
    fixture = fixture_path.read_text(encoding="utf-8")
    adapter_test = adapter_test_path.read_text(encoding="utf-8")

    report_paths = [
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.ModelRuntimeCapabilitiesTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidPythonHostAdaptersTest.xml",
    ]
    suites = [junit(path) for path in report_paths if path.exists()]
    tests = sum(item["tests"] for item in suites)
    failures = sum(item["failures"] for item in suites)
    errors = sum(item["errors"] for item in suites)
    skipped = sum(item["skipped"] for item in suites)

    send_start = view_model.index("private fun sendMessage(")
    run_start = view_model.index("runJob = viewModelScope.launch", send_start)
    send_preflight = view_model[send_start:run_start]
    stream_preflight = adapter.index("requireRunSupport") < adapter.index("gateway.streamCompletionWithTools")
    gates = {
        "versioned_capability_contract_has_provenance_and_digest": all(value in contract for value in (
            "wireApi", "parallelTools", "reasoning", "source", "status", "SHA-256",
        )),
        "openai_and_anthropic_fixtures_are_covered": all(value in fixture for value in (
            '"openai"', '"anthropic"', "OpenAI and Anthropic configured fixtures",
        )),
        "known_no_tools_model_is_blocked_before_provider": stream_preflight and all(value in adapter_test for value in (
            "known no-tools capability blocks before provider invocation", "requestedToolCounts.isEmpty()",
        )),
        "unknown_capability_fails_closed_before_run": "model_capabilities_unknown" in contract and "unknown discovery fixtures fail closed before Run" in fixture,
        "parallel_tools_require_explicit_positive_capability": all(value in contract + fixture + adapter_test for value in (
            "model_parallel_tools_unsupported", "parallelTools", "emitParallelCalls",
        )),
        "reasoning_capability_is_preserved_and_diagnosable": "modelSupportsReasoning" in models and "model_supports_reasoning" in models and "reasoning status are diagnosable" in fixture,
        "app_preflights_selected_model_before_run_creation": "requireRunSupport(toolCount)" in send_preflight and "modelCapabilityDigest" in send_preflight,
        "model_adapter_enforces_same_contract": "capabilityResolver(request.modelId)" in adapter and stream_preflight,
        "focused_jvm_suites_are_green": len(suites) == 2 and tests >= 10 and failures == errors == skipped == 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M09-F01",
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
    output = REPO / "docs/android/reports/evidence/p9/m09-f01-model-capabilities.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "tests": tests}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
