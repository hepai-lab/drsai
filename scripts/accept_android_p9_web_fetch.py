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


def main() -> int:
    source_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/WebFetchTool.kt"
    registry_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    diagnostics_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RunCapabilityDiagnostics.kt"
    test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/WebFetchToolTest.kt"
    source = source_path.read_text(encoding="utf-8")
    registry = registry_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    diagnostics = diagnostics_path.read_text(encoding="utf-8")
    tests = test_path.read_text(encoding="utf-8")
    xml_path = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.WebFetchToolTest.xml"
    unit = None
    if xml_path.is_file():
        root = ET.parse(xml_path).getroot()
        unit = {
            "tests": int(root.attrib.get("tests", 0)), "failures": int(root.attrib.get("failures", 0)),
            "errors": int(root.attrib.get("errors", 0)), "sha256": digest(xml_path),
            "cases": [item.attrib.get("name", "") for item in root.findall("testcase")],
        }
    manifest = production_capability_manifest("android")
    web_fetch = next(item for item in manifest["capabilities"] if item["id"] == "tool.web.fetch")
    gates = {
        "android_manifest_declares_local_equivalent": web_fetch["classification"] == "local-equivalent",
        "host_registry_exposes_versioned_web_fetch": 'id = "web.fetch"' in source and "p9-web-fetch-v1" in source and "registerWebFetchTool(this" in registry,
        "html_is_bounded_decoded_and_script_free": all(token in source for token in ("MAX_FETCH_TEXT_CHARS", "detectCharset", "script|style|noscript|svg|template")) and "GBK" in tests,
        "redirects_are_bounded_and_https_only": "MAX_REDIRECTS = 5" in source and "redirect_https_required" in source and "redirect_limit" in source,
        "pdf_text_extraction_is_bounded": "BoundedPdfTextExtractor" in source and "MAX_FETCH_BYTES" in source and "Hello PDF" in tests,
        "robots_and_access_refusal_are_enforced": "robotsDisallows" in source and "robots_denied" in source and "access_denied" in source,
        "timeouts_sizes_and_content_types_are_structured": all(token in source for token in ("fetch_timeout", "response_too_large", "content_type_unsupported")),
        "network_capability_is_run_scoped": "RuntimeCapability.WEB_FETCH" in app and '"tool.web.fetch" to "network_unavailable"' in diagnostics,
        "fixture_suite_passed": unit is not None and unit["tests"] == 5 and unit["failures"] == 0 and unit["errors"] == 0,
    }
    sources = (source_path, registry_path, app_path, diagnostics_path, test_path)
    report = {
        "schema_version": 1, "feature_id": "M05-F02", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates, "unit": unit,
        "capability_manifest_sha256": manifest["sha256"],
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m05-f02-web-fetch.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
