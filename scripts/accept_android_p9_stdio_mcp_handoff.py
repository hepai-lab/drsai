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


def suite(path: Path) -> dict[str, int | str] | None:
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    value: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    value["name"] = root.attrib.get("name", "")
    value["sha256"] = digest(path)
    return value


def green(value: dict[str, int | str] | None, minimum: int) -> bool:
    return (
        value is not None
        and int(value["tests"]) >= minimum
        and int(value["failures"]) == 0
        and int(value["errors"]) == 0
    )


def main() -> int:
    coordinator_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/coordinator/HybridRuntimeCoordinator.kt"
    capability_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/workbench/model/WorkbenchModels.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    ui_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    mcp_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/AndroidMcpClient.kt"
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    runtime_client_path = REPO / "cores/python/packages/drsai/src/drsai/relay/runtime_client.py"
    gateway_path = REPO / "cores/python/packages/drsai/src/drsai/backend/gateway.py"
    relay_schema_path = REPO / "cores/protocol/relay/runtime-relay.schema.json"
    generated_python_path = REPO / "cores/python/packages/drsai/src/drsai/relay/generated_contract.py"
    generated_android_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt"
    android_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/DesktopStdioMcpHandoffTest.kt"
    relay_test_path = REPO / "cores/python/packages/drsai/tests/test_relay_runtime_client.py"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_android_p9_stdio_mcp_handoff.py"

    coordinator = coordinator_path.read_text(encoding="utf-8")
    capability = capability_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    mcp = mcp_path.read_text(encoding="utf-8")
    kernel = kernel_path.read_text(encoding="utf-8")
    runtime_client = runtime_client_path.read_text(encoding="utf-8")
    gateway = gateway_path.read_text(encoding="utf-8")
    relay_schema = json.loads(relay_schema_path.read_text(encoding="utf-8"))
    generated_python = generated_python_path.read_text(encoding="utf-8")
    generated_android = generated_android_path.read_text(encoding="utf-8")
    android_test = android_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "cores/python/packages/drsai/tests/test_android_p9_stdio_mcp_handoff.py",
            "cores/python/packages/drsai/tests/test_relay_runtime_client.py",
            "cores/python/packages/drsai/tests/test_relay_contract_codegen.py",
            "cores/python/packages/drsai/tests/test_relay_registry.py",
            "-q",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    suites = {
        name: suite(REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml")
        for name in (
            "DesktopStdioMcpHandoffTest",
            "HybridRuntimeCoordinatorTest",
            "DesktopHandoffContractTest",
            "AndroidMcpClientTest",
        )
    }

    gates = {
        "android_http_and_desktop_stdio_are_distinct_capabilities": (
            "MCP_STDIO" in capability
            and '"mcp.call" to RuntimeCapability.MCP' in coordinator
            and '"mcp.stdio.call" to RuntimeCapability.MCP_STDIO' in coordinator
            and 'return "mcp.$serverId.$normalized"' in mcp
        ),
        "plain_http_mcp_is_not_intercepted_as_stdio": (
            "localHttpMcpAndRemoteStdioMcpRemainDistinctEvenWithSameServerName" in android_test
            and "DesktopHandoffState.NOT_REQUIRED" in android_test
        ),
        "android_never_advertises_local_stdio": (
            '"id": "mcp.stdio"' in kernel
            and '"android": "remote-required"' in kernel
            and "RuntimeCapability.MCP_STDIO" not in app[app.index("fullLocalRuntimeCapabilities"):]
        ),
        "desktop_advertises_stdio_only_from_real_mcp_std_config": (
            '_OPTIONAL_EXECUTION_CAPABILITIES = frozenset({"mcp.stdio"})' in runtime_client
            and '_runtime_execution_capabilities(_read_tools_config())' in gateway
            and '== "mcp-std"' in gateway
        ),
        "legacy_and_hai_relay_publish_negotiated_capabilities": (
            '"capabilities": sorted(self.capabilities)' in runtime_client
            and '"capabilities": ",".join(sorted(self.capabilities))' in runtime_client
            and "execution_capabilities=frozenset({\"mcp.stdio\"})" in relay_test_path.read_text(encoding="utf-8")
        ),
        "relay_contract_and_generated_bindings_allow_stdio": (
            "mcp.stdio" in relay_schema["x-relay-capabilities"]
            and "mcp.stdio" in generated_python
            and '"mcp.stdio"' in generated_android
        ),
        "android_decodes_persisted_relay_array_and_execution_capability": (
            'JSONArray(trimmed)' in coordinator
            and '"mcp.stdio" -> add(RuntimeCapability.MCP_STDIO)' in coordinator
            and '"run.create" -> add(RuntimeCapability.CHAT)' in coordinator
        ),
        "offline_or_generic_mcp_remote_fails_honestly": (
            "当前没有声明 MCP_STDIO 的在线 Desktop Runtime" in coordinator
            and "同名 HTTP MCP，也不会冒充 stdio" in coordinator
            and "尚未调用任何工具" in coordinator
        ),
        "online_target_is_deterministic_and_explicit": (
            "sortedWith(" in coordinator
            and "执行位置为 Desktop Runtime" in coordinator
            and "远端调用仍需审批" in coordinator
        ),
        "handoff_package_requires_confirmation_and_binds_stdio_identity": all(
            value in coordinator
            for value in (
                "handoff_confirmation_required",
                'put("kind", kind.name.lowercase())',
                'put("execution_location", "desktop")',
                'putOpt("transport"',
                'putOpt("resource_id"',
                'put("remote_tool_approval_required", true)',
            )
        ),
        "product_preflight_and_ui_show_location_transport_and_approval": (
            "interceptDesktopExclusiveRequest(user.id, clean, drafts, handoffRequest)" in app
            and "decision.kind, decision.resourceId, oaepRequest" in app
            and "执行位置：${handoff.executionLocation}" in ui
            and "Android 本地不执行" in ui
            and "远端工具调用仍需审批" in ui
        ),
        "python_relay_and_android_product_suites_green": (
            pytest.returncode == 0
            and green(suites["DesktopStdioMcpHandoffTest"], 4)
            and green(suites["HybridRuntimeCoordinatorTest"], 6)
            and green(suites["DesktopHandoffContractTest"], 2)
            and green(suites["AndroidMcpClientTest"], 6)
        ),
    }

    sources = (
        coordinator_path,
        capability_path,
        app_path,
        ui_path,
        mcp_path,
        kernel_path,
        runtime_client_path,
        gateway_path,
        relay_schema_path,
        generated_python_path,
        generated_android_path,
        android_test_path,
        relay_test_path,
        python_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M07-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {
            "returncode": pytest.returncode,
            "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:]),
        },
        "android_suites": suites,
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m07-f05-stdio-mcp-handoff.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
