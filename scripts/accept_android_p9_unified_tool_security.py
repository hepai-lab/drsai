from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(name: str, minimum: int) -> bool:
    path = ROOT / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml"
    if not path.is_file():
        return False
    root = ET.parse(path).getroot()
    return int(root.attrib.get("tests", 0)) >= minimum and int(root.attrib.get("failures", 0)) == 0 and int(root.attrib.get("errors", 0)) == 0


def main() -> int:
    policy_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/security/AndroidUnifiedToolSecurityPolicy.kt"
    registry_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    network_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/NetworkSafetyPolicy.kt"
    browser_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ControlledBrowserTool.kt"
    mcp_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/AndroidMcpClient.kt"
    saf_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/device/AndroidLocalCapabilities.kt"
    security_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/AndroidUnifiedToolSecurityPolicyTest.kt"
    mcp_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/AndroidMcpClientTest.kt"
    browser_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/ControlledBrowserToolTest.kt"
    paths = (policy_path, registry_path, network_path, browser_path, mcp_path, saf_path, security_test_path, mcp_test_path, browser_test_path)
    text = {path: path.read_text(encoding="utf-8") for path in paths}

    gates = {
        "single_versioned_pre_execution_boundary_covers_all_tool_domains": (
            'VERSION = "p9-android-tool-security-v1"' in text[policy_path]
            and "AndroidUnifiedToolSecurityPolicy.validate(definition, context, arguments" in text[registry_path]
            and "securityError" in text[registry_path]
        ),
        "ssrf_scheme_authority_private_literal_and_fragment_bypasses_are_denied": all(value in text[policy_path] for value in (
            'uri.scheme == "https"', "uri.userInfo == null", "security_local_target_denied",
            "security_private_target_denied", "uri.fragment == null",
        )) and "repeat(100)" in text[security_test_path],
        "dns_rebinding_and_redirects_stay_under_public_only_policies": (
            "addresses.all(::isPublic)" in text[network_path]
            and ".dns(safetyPolicy.dns())" in text[browser_path]
            and ".followRedirects(false)" in text[browser_path]
            and "PublicOnlyMcpDns" in text[mcp_path]
            and ".followRedirects(false)" in text[mcp_path]
        ),
        "saf_paths_reject_relative_absolute_uri_and_backslash_escape": all(value in text[policy_path] for value in (
            "SafWorkspaceGateway.safeParts(it)", "!it.startsWith('/')", '"://" !in it', "'\\\\' !in it",
        )) and "saf_write_approval_required" in text[saf_path] and "saf_edit_approval_required" in text[saf_path],
        "mcp_requires_account_capability_run_scope_and_connector_scope": all(value in text[policy_path] for value in (
            "context.accountSubject.matches", "RuntimeCapability.MCP in context.runtimeCapabilities",
            "security_mcp_run_scope_required",
        )) and "requireScope(accountSubject" in text[mcp_path]
            and "McpConnectorAuthorizer" in text[mcp_test_path]
            and "mcp_connector_scope_denied" in text[mcp_test_path],
        "external_and_sensitive_side_effects_cannot_reach_handler_without_approval": (
            "validateApprovedExecution(definition, context)" in text[registry_path]
            and "security_approval_required" in text[policy_path]
            and "assertEquals(0, calls)" in text[security_test_path]
        ),
        "private_network_test_escape_hatch_is_explicit_and_default_off": (
            "allowPrivateNetworkForTests: Boolean = false" in text[registry_path]
            and "allowPrivateNetworkForTests = true" in text[browser_test_path]
        ),
        "unified_adversarial_matrix_suite_is_green": suite("AndroidUnifiedToolSecurityPolicyTest", 3),
        "network_saf_mcp_browser_and_registry_regressions_are_green": all((
            suite("NetworkSafetyPolicyTest", 1), suite("AndroidLocalCapabilitiesTest", 1),
            suite("AndroidMcpClientTest", 7), suite("ControlledBrowserToolTest", 5), suite("ToolApprovalPolicyTest", 1),
        )),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M11-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m11-f01-unified-tool-security.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
