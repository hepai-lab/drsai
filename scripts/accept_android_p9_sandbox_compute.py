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
    policy_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/sandbox_compute.py"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    catalog_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/FullRuntimeToolCatalog.kt"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_sandbox_compute.py"
    core_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    android_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/SandboxComputeInstrumentedTest.kt"
    schema_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/ToolSchemaContractTest.kt"
    policy = policy_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    catalog = catalog_path.read_text(encoding="utf-8")
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(python_test_path.relative_to(REPO)), str(core_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=90, check=False,
    )
    schema_xml = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.ToolSchemaContractTest.xml"
    schema_suite = None
    if schema_xml.is_file():
        root = ET.parse(schema_xml).getroot()
        schema_suite = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}
        schema_suite["sha256"] = digest(schema_xml)
    reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda value: value.stat().st_mtime, reverse=True,
    )
    device_path = next((path for path in reports if "SandboxComputeInstrumentedTest" in path.read_text(encoding="utf-8")), None)
    device_suite = None
    if device_path:
        root = ET.parse(device_path).getroot()
        device_suite = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}
        device_suite["name"] = root.attrib.get("name")
        device_suite["sha256"] = digest(device_path)
    gates = {
        "model_receives_only_declarative_whitelisted_operations": "OPERATIONS = frozenset" in policy
            and 'set(arguments) - {"operation", "values", "bins"}' in policy,
        "no_dynamic_code_import_file_process_or_network_surface": all(
            token not in policy for token in ("eval(", "exec(", "open(", "__import__(", "socket.", "subprocess.", "importlib.")
        ),
        "cpu_memory_input_and_output_are_bounded": all(
            value in policy for value in ("MAX_VALUES = 10_000", "MAX_INPUT_BYTES", "MAX_BINS", "TIME_BUDGET_SECONDS", "compute_timeout")
        ),
        "invalid_nonfinite_and_escape_arguments_fail_closed": all(
            value in policy for value in ("compute_argument_forbidden", "compute_operation_invalid", "compute_value_invalid", "compute_values_limit")
        ),
        "shared_kernel_executes_compute_without_host_port": '"core.data_compute"' in engine
            and "execute_declarative_compute" in engine,
        "android_model_catalog_has_bounded_schema": '"core.data_compute"' in catalog
            and ".put(\"maxItems\", 10_000)" in catalog,
        "python_escape_resource_and_kernel_regression_green": pytest.returncode == 0,
        "android_schema_regression_green": schema_suite is not None
            and schema_suite["failures"] == 0 and schema_suite["errors"] == 0,
        "api35_bundled_chaquopy_compute_green": device_suite is not None
            and device_suite["name"] == "ai.drsai.remote.SandboxComputeInstrumentedTest"
            and device_suite["tests"] == 1 and device_suite["failures"] == 0 and device_suite["errors"] == 0,
    }
    sources = (policy_path, engine_path, catalog_path, python_test_path, core_test_path, android_test_path, schema_test_path)
    report = {
        "schema_version": 1, "feature_id": "M06-F04", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_schema_suite": schema_suite, "connected_suite": device_suite,
        "connected_report": None if device_path is None else str(device_path.relative_to(REPO)).replace("\\", "/"),
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m06-f04-sandbox-compute.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
