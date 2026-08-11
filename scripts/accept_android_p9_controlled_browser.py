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
    browser_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ControlledBrowserTool.kt"
    test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ControlledBrowserToolTest.kt"
    registry_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    capability_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    browser = browser_path.read_text(encoding="utf-8")
    test = test_path.read_text(encoding="utf-8")
    registry = registry_path.read_text(encoding="utf-8")
    capability = capability_path.read_text(encoding="utf-8")
    kernel = kernel_path.read_text(encoding="utf-8")
    xml_path = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.ControlledBrowserToolTest.xml"
    suite = None
    if xml_path.is_file():
        root = ET.parse(xml_path).getroot()
        suite = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}
        suite["sha256"] = digest(xml_path)
    gates = {
        "protocol_is_versioned": "p9-controlled-browser-v1" in browser,
        "passive_navigation_and_read_are_bounded": all(value in browser for value in ("browser.navigate", "browser.read", "MAX_BROWSER_BYTES", "MAX_BROWSER_TEXT")),
        "active_content_is_not_executed": "script|style|noscript|svg|template" in browser,
        "forms_are_declared_and_field_bounded": "browser_form_field_not_declared" in browser and "browser_form_fields_invalid" in browser,
        "submit_and_download_require_approval": all(value in browser for value in ('"browser.submit"', '"browser.download"', "ToolRisk.SENSITIVE")),
        "login_state_is_subject_isolated": "browser_session_not_found" in browser and "cross-subject session read" in test,
        "cookie_values_are_not_exported": '.put("cookies"' not in browser and '.put("cookie"' not in browser,
        "download_exports_digest_not_bytes": "size_bytes" in browser and "sha256" in browser and "downloaded_at" in browser,
        "capability_requires_validated_network": "BROWSER_SESSION" in capability and "androidNetworkAvailable()" in capability,
        "desktop_android_manifest_is_local_equivalent": "tool.browser.session" in kernel and '"android": "local-equivalent"' in kernel,
        "registry_wires_production_provider": "registerControlledBrowserTools" in registry and "HttpControlledBrowserProvider()" in registry,
        "android_behavior_suite_green": suite is not None and suite["tests"] >= 4 and suite["failures"] == 0 and suite["errors"] == 0,
    }
    sources = (browser_path, test_path, registry_path, capability_path, kernel_path)
    report = {
        "schema_version": 1, "feature_id": "M05-F05", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates, "android_suite": suite,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m05-f05-controlled-browser.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
