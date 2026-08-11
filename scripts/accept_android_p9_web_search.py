from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import production_capability_manifest  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path) -> dict[str, object] | None:
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    return {
        "name": root.attrib.get("name"),
        "tests": int(root.attrib.get("tests", 0)),
        "failures": int(root.attrib.get("failures", 0)),
        "errors": int(root.attrib.get("errors", 0)),
        "cases": [item.attrib.get("name", "") for item in root.findall("testcase")],
        "sha256": digest(path),
    }


def main() -> int:
    provider_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/WebSearchTool.kt"
    registry_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    diagnostics_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RunCapabilityDiagnostics.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    live_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/WebSearchProviderInstrumentedTest.kt"
    provider_source = provider_path.read_text(encoding="utf-8")
    registry_source = registry_path.read_text(encoding="utf-8")
    diagnostics_source = diagnostics_path.read_text(encoding="utf-8")
    app_source = app_path.read_text(encoding="utf-8")
    live_source = live_test_path.read_text(encoding="utf-8")

    unit = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.WebSearchToolTest.xml")
    result_dir = REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug"
    live_files = sorted(result_dir.glob("TEST-*.xml"), key=lambda item: item.stat().st_mtime, reverse=True)
    live = suite(live_files[0]) if live_files else None
    android_manifest = production_capability_manifest("android")
    web_capability = next(item for item in android_manifest["capabilities"] if item["id"] == "tool.web.search")

    gates = {
        "android_manifest_declares_local_equivalent": web_capability["classification"] == "local-equivalent",
        "host_registry_exposes_versioned_web_search": 'id = "web.search"' in provider_source and "p9-web-search-v1" in provider_source and "registerWebSearchTool(this" in registry_source,
        "result_schema_has_sources_time_and_provider": all(token in provider_source for token in (
            '"title"', '"url"', '"snippet"', '"searched_at"', '"provider"', '"last_modified_at"',
        )),
        "timeout_empty_and_provider_errors_are_structured": all(token in provider_source for token in (
            '"empty"', '"timeout"', '"provider_error"', '"provider_timeout"',
        )),
        "provider_chain_matches_desktop_route_and_has_fallback": all(token in provider_source for token in (
            "BingHtmlWebSearchProvider", "WikipediaWebSearchProvider", "FallbackWebSearchProvider",
        )),
        "network_capability_is_run_scoped": "androidNetworkAvailable()" in app_source and "RuntimeCapability.WEB_SEARCH" in app_source and '"tool.web.search" to "network_unavailable"' in diagnostics_source,
        "unit_fixtures_cover_english_chinese_and_failures": unit is not None and unit["tests"] == 4 and unit["failures"] == 0 and unit["errors"] == 0,
        "real_provider_returns_english_and_chinese_https_sources": live is not None and live["name"] == "ai.drsai.remote.WebSearchProviderInstrumentedTest" and live["tests"] == 1 and live["failures"] == 0 and live["errors"] == 0 and "realProviderReturnsNormalizedHttpsSourcesForEnglishAndChinese" in live["cases"] and 'listOf("Android operating system", "人工智能")' in live_source,
    }
    sources = (provider_path, registry_path, diagnostics_path, app_path, live_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M05-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "unit": unit,
        "instrumentation": live,
        "capability_manifest_sha256": android_manifest["sha256"],
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m05-f01-web-search.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
