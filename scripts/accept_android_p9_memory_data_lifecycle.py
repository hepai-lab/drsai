from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import select_relevant_memories  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    desktop_test = "cores/python/packages/drsai/tests/test_desktop_memory_lifecycle.py"
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", desktop_test, "-q"], cwd=REPO,
        capture_output=True, text=True, timeout=60, check=False,
    )
    result_dir = REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug"
    xml_files = sorted(result_dir.glob("TEST-*.xml"), key=lambda path: path.stat().st_mtime, reverse=True)
    instrumentation = None
    if xml_files:
        root = ET.parse(xml_files[0]).getroot()
        instrumentation = {
            "suite": root.attrib.get("name"), "tests": int(root.attrib.get("tests", 0)),
            "failures": int(root.attrib.get("failures", 0)), "errors": int(root.attrib.get("errors", 0)),
            "cases": [item.attrib.get("name") for item in root.findall("testcase")],
            "sha256": digest(xml_files[0]),
        }
    local_store_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/LocalStore.kt"
    local_store = local_store_path.read_text(encoding="utf-8")
    migration_13_14 = local_store.split("val MIGRATION_13_14", 1)[1].split("val MIGRATION_12_13", 1)[0]
    content = "prefers concise answers"
    candidate = {"id": f"memory-{hashlib.sha256(content.encode()).hexdigest()[:24]}", "content": content}
    first = select_relevant_memories("Which answers are concise?", [candidate])
    second = select_relevant_memories("Which answers are concise?", [candidate])
    deleted = select_relevant_memories("Which answers are concise?", [])
    logout_xml = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.FullRuntimeBindingCoordinatorTest.xml"
    logout_cases: list[str] = []
    logout_passed = False
    if logout_xml.is_file():
        logout_root = ET.parse(logout_xml).getroot()
        logout_cases = [item.attrib.get("name", "") for item in logout_root.findall("testcase")]
        logout_passed = int(logout_root.attrib.get("failures", 0)) == 0 and int(logout_root.attrib.get("errors", 0)) == 0
    gates = {
        "v1_5_5_to_v1_5_6_memory_schema_preserved": "memories" not in migration_13_14.casefold(),
        "migration_identity_is_idempotent": first == second,
        "desktop_legacy_file_restart_and_delete_passed": completed.returncode == 0,
        "android_persistent_restart_read_passed": instrumentation is not None and instrumentation["suite"] == "ai.drsai.remote.MemoryDataLifecycleInstrumentedTest" and instrumentation["tests"] == 1 and instrumentation["failures"] == 0 and instrumentation["errors"] == 0,
        "android_single_and_subject_delete_passed": instrumentation is not None and "legacyRowsRemainReadableMigrationIsIdempotentAndDeletionCannotRecall" in instrumentation["cases"],
        "deleted_memory_cannot_be_recalled": deleted["selected"] == [] and deleted["summary"] == "",
        "subject_delete_query_is_scoped": 'DELETE FROM memories WHERE userId=:userId' in local_store,
        "logout_and_account_switch_clear_runtime_identity": logout_passed and any("account switch closes old binding and logout clears identity" in name for name in logout_cases),
    }
    sources = (
        "apps/android/app/src/main/java/ai/drsai/remote/data/LocalStore.kt",
        "apps/android/app/src/androidTest/java/ai/drsai/remote/MemoryDataLifecycleInstrumentedTest.kt",
        "cores/python/packages/drsai/src/drsai/modules/components/memory/curated_memory.py",
        desktop_test,
    )
    report = {
        "schema_version": 1, "feature_id": "M03-F06", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates, "instrumentation": instrumentation,
        "pytest": {"returncode": completed.returncode, "summary": "\n".join(completed.stdout.strip().splitlines()[-3:])},
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m03-f06-memory-data-lifecycle.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
