from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path | None) -> dict[str, int | str] | None:
    if path is None or not path.is_file():
        return None
    root = ET.parse(path).getroot()
    value: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    value["name"] = root.attrib.get("name", "")
    value["sha256"] = digest(path)
    return value


def green(value: dict[str, int | str] | None, minimum: int = 1) -> bool:
    return (
        value is not None
        and int(value["tests"]) >= minimum
        and int(value["failures"]) == 0
        and int(value["errors"]) == 0
    )


def main() -> int:
    client_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/AndroidMcpClient.kt"
    secure_store_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/McpSecureConfigStore.kt"
    registry_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    ui_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    mapper_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt"
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    unit_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/AndroidMcpClientTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/AndroidMcpInstrumentedTest.kt"

    client = client_path.read_text(encoding="utf-8")
    secure_store = secure_store_path.read_text(encoding="utf-8")
    registry = registry_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    mapper = mapper_path.read_text(encoding="utf-8")
    kernel = kernel_path.read_text(encoding="utf-8")
    unit_test = unit_test_path.read_text(encoding="utf-8")
    device_test = device_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "cores/python/packages/drsai/tests/test_agent_kernel_context.py",
            "cores/python/packages/drsai/tests/test_agent_kernel_production_parity.py",
            "cores/python/packages/drsai/tests/test_mobile_cross_runtime_parity.py",
            "-q",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    unit_suite = suite(
        REPO
        / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidMcpClientTest.xml"
    )
    reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda value: value.stat().st_mtime,
        reverse=True,
    )
    device_path = next(
        (path for path in reports if "AndroidMcpInstrumentedTest" in path.read_text(encoding="utf-8")),
        None,
    )
    device_suite = suite(device_path)
    durable_device_path = (
        REPO / "docs/android/reports/evidence/p9/m07-f04-streamable-http-mcp-instrumentation.xml"
    )
    if device_path is not None:
        durable_device_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable_device_path)

    gates = {
        "official_protocol_initialize_and_notification": (
            'ANDROID_MCP_PROTOCOL_VERSION = "2025-11-25"' in client
            and 'put("method", "initialize")' in client
            and 'notification("notifications/initialized")' in client
        ),
        "streamable_http_accepts_json_and_sse": (
            'MCP_ACCEPT = "application/json, text/event-stream"' in client
            and '"application/json" ->' in client
            and '"text/event-stream" ->' in client
        ),
        "session_headers_expiry_and_cursor_resume": all(
            value in client
            for value in (
                'header("MCP-Session-Id"',
                'header("MCP-Protocol-Version"',
                'header("Last-Event-ID"',
                "McpSessionExpired",
                "resumeSse",
            )
        ),
        "tools_are_discovered_namespaced_and_called": all(
            value in client for value in ('put("method", "tools/list")', 'put("method", "tools/call")', 'return "mcp.$serverId.$normalized"')
        ),
        "network_auth_version_and_bounds_fail_closed": (
            "PublicOnlyMcpDns" in client
            and "mcp_endpoint_https_required" in client
            and "mcp_authentication_failed" in client
            and "mcp_protocol_version_unsupported" in client
            and "MAX_MCP_RESPONSE_BYTES" in client
            and "MAX_MCP_TOOLS" in client
        ),
        "token_is_account_scoped_encrypted_and_kotlin_only": (
            "EncryptedSharedPreferences.create" in secure_store
            and "MasterKey.KeyScheme.AES256_GCM" in secure_store
            and "tokenKey(accountSubject, endpoint.id)" in secure_store
            and "never cross the Kotlin Host Port boundary" in secure_store
            and "bearerToken" not in kernel
        ),
        "registry_exposes_real_mcp_source_capability_and_approval": (
            'source = "mcp"' in client
            and "setOf(RuntimeCapability.MCP)" in client
            and "risk = ToolRisk.SENSITIVE" in client
            and "requires_approval" in registry
            and "mcp_account_scope_denied" in client
        ),
        "production_ui_connects_mcp_without_exposing_token": (
            "connectMcpServer" in app
            and "mcpSecureConfigStore.save" in app
            and "AndroidMcpToolManager" in app
            and "MCP" in ui
            and "PasswordVisualTransformation" in ui
        ),
        "shared_kernel_classifies_http_mcp_local_equivalent": (
            '"id": "mcp.http"' in kernel
            and '"android": "local-equivalent"' in kernel
            and pytest.returncode == 0
        ),
        "mcp_result_uses_existing_oaep_tool_projection": (
            "OaepToolCallContent" in mapper
            and "mcpToolResultUsesExistingOaepToolTimelineProjection" in unit_test
            and "ProjectsMcpToolToOaep" in device_test
        ),
        "deterministic_protocol_suite_green": green(unit_suite, 6),
        "api35_encrypted_transport_and_oaep_suite_green": green(device_suite),
    }

    sources = (
        client_path,
        secure_store_path,
        registry_path,
        app_path,
        ui_path,
        mapper_path,
        kernel_path,
        unit_test_path,
        device_test_path,
        REPO / "cores/python/packages/drsai/tests/test_agent_kernel_context.py",
    )
    report = {
        "schema_version": 1,
        "feature_id": "M07-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {
            "returncode": pytest.returncode,
            "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:]),
        },
        "android_unit_suite": unit_suite,
        "connected_suite": device_suite,
        "connected_report": (
            None
            if device_path is None
            else str(durable_device_path.relative_to(REPO)).replace("\\", "/")
        ),
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m07-f04-streamable-http-mcp.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
