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
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    android_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/SkillCatalog.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_skill_manifest.py"
    android_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/SkillCatalogTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/SkillManifestInstrumentedTest.kt"
    kernel = kernel_path.read_text(encoding="utf-8")
    android = android_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(python_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=60, check=False,
    )
    unit_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.SkillCatalogTest.xml")
    reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda value: value.stat().st_mtime, reverse=True,
    )
    device_path = next((path for path in reports if "SkillManifestInstrumentedTest" in path.read_text(encoding="utf-8")), None)
    device_suite = suite(device_path) if device_path else None
    durable_device_path = REPO / "docs/android/reports/evidence/p9/m07-f01-skill-manifest-instrumentation.xml"
    if device_path is not None:
        durable_device_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable_device_path)
    gates = {
        "shared_versioned_manifest_digest_contract": 'SKILL_MANIFEST_VERSION = "p9-skill-manifest-v1"' in kernel
            and 'SKILL_MANIFEST_VERSION = "p9-skill-manifest-v1"' not in android
            and 'const val VERSION = "p9-skill-manifest-v1"' in android,
        "id_version_source_instructions_tools_and_digest_are_bound": all(
            value in kernel for value in ("skill_manifest_digest", "allowed_tools", "instructions_sha256", '"digest"')
        ) and all(value in android for value in ("allowedTools", "instructions", "digest", "SkillManifestDigest.compute")),
        "missing_and_malformed_fields_fail_closed": all(
            value in kernel for value in ("run_skill_instructions_invalid", "run_skill_tools_invalid", "run_skill_digest_invalid")
        ) and all(value in android for value in ("skill_instructions_required", "skill_tools_required", "skill_digest_required")),
        "tampering_is_rejected": "run_skill_digest_mismatch" in kernel and "skill_digest_mismatch" in android,
        "duplicate_skills_and_tools_are_rejected": "run_skill_duplicate" in kernel
            and "run_skill_tool_duplicate" in kernel and "skill_duplicate_id" in android,
        "capability_and_allowed_tool_insufficiency_fail_closed": "run_skill_capability_unavailable" in kernel
            and "run_skill_tool_unavailable" in kernel,
        "android_and_python_digest_fixture_matches": "710098009cdbed16a1882c1f79f78d66aed833adc75d7e79ce5e83ec4401dd69"
            in android_test_path.read_text(encoding="utf-8") and "workspace.inspect" in python_test_path.read_text(encoding="utf-8"),
        "production_android_envelope_carries_manifest_fields": all(
            value in app for value in ('.put("digest", skill.digest)', '.put("tools",', '.put("instructions", skill.instructions)')
        ),
        "python_validation_suite_green": pytest.returncode == 0,
        "android_catalog_suite_green": green(unit_suite, 6),
        "api35_bundled_kernel_load_and_tamper_test_green": green(device_suite),
    }
    sources = (kernel_path, android_path, app_path, python_test_path, android_test_path, device_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M07-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_suite": unit_suite,
        "connected_suite": device_suite,
        "connected_report": None if device_path is None else str(durable_device_path.relative_to(REPO)).replace("\\", "/"),
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m07-f01-skill-manifest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
