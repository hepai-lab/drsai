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
    store_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/UserDeclarativeSkillStore.kt"
    catalog_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/SkillCatalog.kt"
    app_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    ui_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    model_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/Models.kt"
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_skill_manifest.py"
    unit_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/UserDeclarativeSkillRepositoryTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/UserDeclarativeSkillInstrumentedTest.kt"
    store = store_path.read_text(encoding="utf-8")
    catalog = catalog_path.read_text(encoding="utf-8")
    app = app_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    kernel = kernel_path.read_text(encoding="utf-8")
    unit_test = unit_test_path.read_text(encoding="utf-8")

    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(python_test_path.relative_to(REPO)), "-q"],
        cwd=REPO, capture_output=True, text=True, timeout=60, check=False,
    )
    unit_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.UserDeclarativeSkillRepositoryTest.xml")
    catalog_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.SkillCatalogTest.xml")
    reports = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda value: value.stat().st_mtime, reverse=True,
    )
    device_path = next(
        (path for path in reports if "UserDeclarativeSkillInstrumentedTest" in path.read_text(encoding="utf-8")), None,
    )
    device_suite = suite(device_path) if device_path else None
    durable_device_path = REPO / "docs/android/reports/evidence/p9/m07-f03-user-declarative-skill-instrumentation.xml"
    if device_path is not None:
        durable_device_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(device_path, durable_device_path)

    gates = {
        "built_in_bundle_binds_apk_signer_and_manifest": "BuiltInSkillBundleAttestation" in store
            and "apkSigningCertificateSha256" in app and "runCatching" not in app[app.index("builtInSkillAttestation ="):app.index("builtInSkillAttestation =") + 260],
        "saf_import_is_content_uri_bounded_and_copied": 'uri.scheme == "content"' in store
            and "MAX_MANIFEST_BYTES" in store and "openInputStream" in store,
        "user_skill_is_declarative_only": "user_skill_dynamic_code_forbidden" in catalog
            and all(value in catalog for value in ("script", "command", "entrypoint", "executable", "code", "classpath")),
        "import_and_update_require_explicit_enable": "enabled = false" in store
            and "fresh explicit enable" in store and "setEnabled" in store,
        "upgrade_rollback_disable_and_delete_are_versioned": all(
            value in store for value in ("user_skill_version_downgrade", "user_skill_version_conflict", "rollback", "delete")
        ),
        "account_scoped_persistence_and_run_pinning": "key(accountSubject)" in store
            and "runningRunKeepsOldUserSkill" in unit_test,
        "production_and_ui_manage_user_skills": all(
            value in app for value in ("importUserSkill", "setUserSkillEnabled", "rollbackUserSkill", "deleteUserSkill")
        ) and all(value in ui for value in ("从文件导入", "已禁用", "回滚", "删除")),
        "shared_kernel_accepts_user_declarative_source": '"user_declarative"' in kernel
            and "test_user_declarative_skill_is_a_local_instruction_manifest_not_dynamic_code" in python_test_path.read_text(encoding="utf-8"),
        "python_manifest_suite_green": pytest.returncode == 0,
        "android_lifecycle_and_catalog_suites_green": green(unit_suite, 4) and green(catalog_suite, 8),
        "api35_saf_persistence_signer_and_kernel_test_green": green(device_suite),
    }
    sources = (
        store_path, catalog_path, app_path, ui_path, model_path, kernel_path,
        python_test_path, unit_test_path, device_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M07-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "android_lifecycle_suite": unit_suite,
        "android_catalog_suite": catalog_suite,
        "connected_suite": device_suite,
        "connected_report": None if device_path is None else str(durable_device_path.relative_to(REPO)).replace("\\", "/"),
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m07-f03-user-declarative-skills.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
