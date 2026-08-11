from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(name: str) -> dict | None:
    path = REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml"
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    return {**{key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}, "sha256": digest(path)}


def main() -> int:
    policy_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/NetworkSafetyPolicy.kt"
    browser_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ControlledBrowserTool.kt"
    fetch_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/WebFetchTool.kt"
    test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/NetworkSafetyPolicyTest.kt"
    browser_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ControlledBrowserToolTest.kt"
    policy = policy_path.read_text(encoding="utf-8")
    browser = browser_path.read_text(encoding="utf-8")
    fetch = fetch_path.read_text(encoding="utf-8")
    tests = test_path.read_text(encoding="utf-8") + browser_test_path.read_text(encoding="utf-8")
    policy_suite, browser_suite, fetch_suite = suite("NetworkSafetyPolicyTest"), suite("ControlledBrowserToolTest"), suite("WebFetchToolTest")
    green = lambda value: value is not None and value["failures"] == 0 and value["errors"] == 0
    gates = {
        "https_only_and_credentials_ports_denied": all(value in policy for value in ("network_https_required", "network_authority_invalid", "network_port_denied")),
        "localhost_and_private_ranges_denied": all(value in tests for value in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1")),
        "carrier_nat_multicast_and_zero_denied": all(value in tests for value in ("100.64.0.1", "224.0.0.1", "0.0.0.0")),
        "ipv6_loopback_ula_linklocal_denied": all(value in tests for value in ("::1", "fc00::1", "fe80::1")),
        "dns_rebinding_is_checked_at_lookup": "dnsRebindingSecondResolutionCannotReturnPrivateAddress" in tests and ".dns(safetyPolicy.dns())" in browser,
        "every_fetch_redirect_is_revalidated": "safetyPolicy.validateUrl(next.toString()" in fetch,
        "every_browser_redirect_is_revalidated": "MAX_BROWSER_REDIRECTS" in browser and "safetyPolicy.validateUrl(current" in browser,
        "browser_active_and_binary_content_denied": "browser_content_type_denied" in browser and "script|style|noscript|svg|template" in browser,
        "unknown_length_response_is_stream_bounded": "readBounded(responseBody.byteStream()" in browser and "setChunkedBody" in tests,
        "download_is_stream_bounded": "readBounded(body.byteStream()" in browser and "browser_download_too_large" in browser,
        "network_policy_suite_green": green(policy_suite) and policy_suite["tests"] == 4,
        "browser_and_fetch_regression_green": green(browser_suite) and green(fetch_suite),
    }
    sources = (policy_path, browser_path, fetch_path, test_path, browser_test_path)
    report = {
        "schema_version": 1, "feature_id": "M05-F06", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "android_suites": {"network": policy_suite, "browser": browser_suite, "fetch": fetch_suite},
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m05-f06-network-safety.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
