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


def green(value: dict[str, int | str] | None, minimum: int) -> bool:
    return bool(value and int(value["tests"]) >= minimum and int(value["failures"]) == 0 and int(value["errors"]) == 0)


def main() -> int:
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    factory_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel_factory.py"
    catalog_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/FullRuntimeToolCatalog.kt"
    parity_test_path = REPO / "cores/python/packages/drsai/tests/test_subagent_kernel_parity.py"
    mobile_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeCriticalJourneyTest.kt"
    schema_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ToolSchemaContractTest.kt"

    engine = engine_path.read_text(encoding="utf-8")
    factory = factory_path.read_text(encoding="utf-8")
    catalog = catalog_path.read_text(encoding="utf-8")
    tests = parity_test_path.read_text(encoding="utf-8")
    device_test = device_test_path.read_text(encoding="utf-8")
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(parity_test_path.relative_to(REPO)), str(mobile_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=120, check=False,
    )
    schema_suite = suite(
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.ToolSchemaContractTest.xml"
    )
    connected = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    device_path = next(
        (path for path in connected if "PythonRuntimeCriticalJourneyTest" in path.read_text(encoding="utf-8")), None,
    )
    device_suite = suite(device_path)
    durable = REPO / "docs/android/reports/evidence/p9/m08-f02-subagent-kernel-parity-instrumentation.xml"
    if device_path is not None:
        durable.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable)

    gates = {
        "subagent_uses_the_only_agent_kernel_factory": (
            "def _new_subagent_kernel" in engine
            and "create_agent_kernel(surface=self._runtime_surface())" in engine
            and "Only construction boundary" in factory
        ),
        "child_has_independent_run_state_and_checkpoint": all(value in engine for value in (
            'child_run_id = f"{state.run_id}:subagent:{task_id}"',
            '"child_state": child.snapshot(child_run_id)',
            "MessageType.RESUME_RUN",
            "subagent_kernel_did_not_complete",
        )),
        "kernel_identity_is_published_and_verified": all(value in engine for value in (
            '"kernel_id": identity["kernel_id"]', '"kernel_sha256": identity["kernel_sha256"]',
            '"subagent_kernel_sha256": task["kernel_sha256"]',
        )),
        "context_inheritance_is_controlled_and_content_is_not_copied": (
            "parent_context_sha256" in engine
            and '"input": prompt' in engine
            and '"parent private context" not in str(request.payload["messages"])' in tests
        ),
        "tool_whitelist_can_only_shrink_to_safe_read_tools": all(value in engine for value in (
            'tool.get("risk") == "read_only"', 'not bool(tool.get("requires_approval"))',
            'tool.get("name") not in {"delegate", "core.update_plan"}',
            "subagent_tool_whitelist_denied",
        )),
        "explore_and_general_are_the_only_declared_types": (
            'task_type not in {"explore", "general"}' in engine
            and 'listOf("explore", "general")' in catalog
        ),
        "android_and_desktop_child_kernel_digest_match": (
            "android_and_desktop_subagent_kernel_digest_match" in tests
            and 'pytest.mark.parametrize("surface", ["android", "desktop"])' in tests
        ),
        "python_subagent_and_mobile_regression_green": pytest.returncode == 0,
        "android_delegate_schema_suite_green": green(schema_suite, 1),
        "api35_real_runtime_subagent_identity_and_whitelist_green": (
            green(device_suite, 1)
            and "subagent_kernel_sha256" in device_test
            and 'put("allowed_tools", JSONArray())' in device_test
        ),
    }
    sources = (engine_path, factory_path, catalog_path, parity_test_path, mobile_test_path, device_test_path, schema_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M08-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_schema_suite": schema_suite,
        "connected_suite": device_suite,
        "connected_report": str(durable.relative_to(REPO)).replace("\\", "/") if device_path else None,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m08-f02-subagent-kernel-parity.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
