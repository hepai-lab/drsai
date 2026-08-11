from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path | None) -> dict[str, int | str] | None:
    if path is None or not path.is_file():
        return None
    root = ET.parse(path).getroot()
    result: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    result["name"] = root.attrib.get("name", "")
    result["sha256"] = digest(path)
    return result


def green(value: dict[str, int | str] | None, minimum: int) -> bool:
    return bool(
        value
        and int(value["tests"]) >= minimum
        and int(value["failures"]) == 0
        and int(value["errors"]) == 0
    )


def main() -> int:
    store_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/McpSecureConfigStore.kt"
    client_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/AndroidMcpClient.kt"
    registry_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    models_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/Models.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    ui_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    unit_mcp_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/AndroidMcpClientTest.kt"
    unit_registry_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ToolApprovalPolicyTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/AndroidMcpInstrumentedTest.kt"

    store = store_path.read_text(encoding="utf-8")
    client = client_path.read_text(encoding="utf-8")
    registry = registry_path.read_text(encoding="utf-8")
    models = models_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    unit_mcp = unit_mcp_path.read_text(encoding="utf-8")
    unit_registry = unit_registry_path.read_text(encoding="utf-8")
    device_test = device_test_path.read_text(encoding="utf-8")

    unit_suites = {
        name: suite(REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml")
        for name in ("AndroidMcpClientTest", "ToolApprovalPolicyTest")
    }
    connected_reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    connected_path = next(
        (path for path in connected_reports if "AndroidMcpInstrumentedTest" in path.read_text(encoding="utf-8")),
        None,
    )
    connected_suite = suite(connected_path)
    durable_connected = REPO / "docs/android/reports/evidence/p9/m07-f06-connector-lifecycle-instrumentation.xml"
    if connected_path is not None:
        durable_connected.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(connected_path, durable_connected)

    gates = {
        "encrypted_account_scoped_credentials_stay_in_kotlin": all(value in store for value in (
            "EncryptedSharedPreferences.create",
            "subjectDigest(subject)",
            "never cross the Kotlin Host Port boundary",
        )),
        "minimum_scope_defaults_exclude_external_write": (
            'DISCOVER("tools:list")' in store
            and 'CALL_READ("tools:call:read")' in store
            and 'CALL_WRITE("tools:call:write")' in store
            and "val DEFAULT = setOf(DISCOVER.wireName, CALL_READ.wireName)" in store
        ),
        "expiry_and_revocation_disable_token_immediately": all(value in store for value in (
            "clock() < summary.expiresAtEpochMs",
            'check(summary.enabled) { "mcp_connector_revoked" }',
            'check(summary.expiresAtEpochMs == null || clock() < summary.expiresAtEpochMs) { "mcp_connector_expired" }',
            ".remove(tokenKey(accountSubject, serverId))",
            "if (isActive(accountSubject, serverId))",
        )),
        "tool_registry_is_account_scoped_and_dynamically_available": all(value in registry for value in (
            "RegistrationKey(val ownerSubject: String?, val toolId: String)",
            "it.ownerSubject == null || it.ownerSubject == context.accountSubject",
            "it.available(context)",
            "fun unregister(ownerSubject: String, toolIds: Set<String>)",
        )),
        "mcp_discovery_and_each_call_reauthorize_scope": all(value in client for value in (
            "authorizer?.requireScope(accountSubject, client.serverId, McpConnectorScope.DISCOVER.wireName)",
            "if (tool.readOnly) McpConnectorScope.CALL_READ.wireName else McpConnectorScope.CALL_WRITE.wireName",
            "readOnlyHint",
            "ownerSubject = accountSubject",
            "authorizer?.isActive(accountSubject, client.serverId)",
        )),
        "disconnect_unregisters_tools_and_closes_transport": all(value in client for value in (
            "fun disconnect(accountSubject: String, serverId: String)",
            "registry.unregister(accountSubject",
            "previous.first.close()",
            "fun disconnectAll(accountSubject: String)",
        )),
        "product_supports_restore_expiry_write_opt_in_and_revoke": (
            "ConnectorUiItem" in models
            and "restoreMcpConnectors(user.id)" in app
            and "fun revokeMcpServer" in app
            and "mcpToolManager::disconnectAll" in app
            and "mcpAllowWrite" in ui
            and "mcpExpiryHours" in ui
            and "撤销 Connector" in ui
        ),
        "credentials_absent_from_model_oaep_and_test_outputs": (
            'put("Authorization",' not in client
            and 'put("bearer_token",' not in client
            and "assertFalse(definition.toRuntimeSchema().toString().contains(\"device-secret\"))" in device_test
            and "assertFalse(output.output.contains(\"device-secret\"))" in device_test
        ),
        "cross_account_visibility_and_execution_are_zero": all(value in unit_registry for value in (
            "accountScopedToolsCanShareIdsAndRevokeWithoutCrossAccountVisibility",
            "registry.definitions(mallory).isEmpty()",
            'registry.unregister("alice", setOf("connector.read"))',
            'ToolExecutionOutcome.Success("bob")',
        )),
        "scope_expiry_revoke_and_encryption_tests_exist": (
            "connectorAuthorizerControlsDiscoveryReadScopeExpiryAndRevocation" in unit_mcp
            and "encryptedConnectorGrantEnforcesScopesExpiryRevocationAndAccountIsolation" in device_test
        ),
        "jvm_connector_suites_green": (
            green(unit_suites["AndroidMcpClientTest"], 7)
            and green(unit_suites["ToolApprovalPolicyTest"], 9)
        ),
        "api35_encrypted_lifecycle_suite_green": green(connected_suite, 2),
    }

    sources = (
        store_path,
        client_path,
        registry_path,
        models_path,
        app_path,
        ui_path,
        unit_mcp_path,
        unit_registry_path,
        device_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M07-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "unit_suites": unit_suites,
        "connected_suite": connected_suite,
        "connected_report": str(durable_connected.relative_to(REPO)).replace("\\", "/") if connected_path else None,
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m07-f06-connector-lifecycle.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
