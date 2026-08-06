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


def green(value: dict[str, int | str] | None, minimum: int = 1) -> bool:
    return value is not None and int(value["tests"]) >= minimum and value["failures"] == 0 and value["errors"] == 0


def main() -> int:
    catalog_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/SkillCatalog.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    engine_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    kernel_test_path = REPO / "cores/python/packages/drsai/tests/test_mobile_agent_core.py"
    catalog_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/SkillCatalogTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/SkillSelectionInstrumentedTest.kt"
    catalog = catalog_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    engine = engine_path.read_text(encoding="utf-8")
    kernel_test = kernel_test_path.read_text(encoding="utf-8")
    catalog_test = catalog_test_path.read_text(encoding="utf-8")
    device_test = device_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(kernel_test_path.relative_to(REPO)),
         "cores/python/packages/drsai/tests/test_skill_manifest.py", "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=90, check=False,
    )
    unit_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.SkillCatalogTest.xml")
    reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda value: value.stat().st_mtime, reverse=True,
    )
    device_path = next(
        (path for path in reports if "SkillSelectionInstrumentedTest" in path.read_text(encoding="utf-8")), None,
    )
    device_suite = suite(device_path) if device_path else None
    durable_device_path = REPO / "docs/android/reports/evidence/p9/m07-f02-skill-selection-instrumentation.xml"
    if device_path is not None:
        durable_device_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable_device_path)

    gates = {
        "production_selects_skills_from_task_input": app.count("skillCatalog.select(") >= 2
            and "request.input" in app and "messageText" in app,
        "selection_is_capability_filtered_and_run_pinned": "pinned.getOrPut(runId)" in catalog
            and "availableCapabilities.containsAll" in catalog,
        "explicit_and_domain_task_matching_are_supported": 'text.contains("@${skill.id}"' in catalog
            and all(value in catalog for value in ("workspace", "memory", "device", "attachment")),
        "irrelevant_tasks_keep_general_agent_semantics": "run-general" in catalog_test
            and "skills.isEmpty()" in catalog_test,
        "complete_manifest_is_validated_before_filtering": engine.count("build_run_capability_snapshot(") >= 3
            and "before deriving the active" in engine,
        "selected_skill_narrows_model_and_execution_registries": "active_local_skills" in engine
            and "allowed_tool_names" in engine and "state.model_tool_snapshot" in engine
            and "state.execution_tool_registry" in engine,
        "out_of_skill_tool_call_fails_closed": "model_tool_not_in_snapshot:web.search" in kernel_test
            and "model_tool_not_in_snapshot:web.search" in device_test,
        "system_and_safety_layers_precede_untrusted_skill": "workspace.untrusted" in kernel_test
            and 'prompt.index("[SYSTEM")' in kernel_test and "[SAFETY_TOOL_POLICY]" in device_test,
        "python_selection_suite_green": pytest.returncode == 0,
        "android_selection_suite_green": green(unit_suite, 8),
        "api35_bundled_kernel_selection_test_green": green(device_suite),
    }
    sources = (catalog_path, app_path, engine_path, kernel_test_path, catalog_test_path, device_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M07-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_suite": unit_suite,
        "connected_suite": device_suite,
        "connected_report": None if device_path is None else str(durable_device_path.relative_to(REPO)).replace("\\", "/"),
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m07-f02-skill-selection.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
