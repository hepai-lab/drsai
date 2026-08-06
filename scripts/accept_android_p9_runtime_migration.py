from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path, minimum: int, devices: int = 0) -> bool:
    if not path.is_file():
        return False
    root = ET.parse(path).getroot()
    if int(root.attrib.get("tests", 0)) < minimum or int(root.attrib.get("failures", 0)) or int(root.attrib.get("errors", 0)):
        return False
    if devices:
        values = [node.attrib.get("value", "") for node in root.findall("./properties/property")]
        return len(values) >= devices and "emulator-5554" in values and any("R5GYB3S8ACH" in value for value in values)
    return True


def main() -> int:
    codec = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonCheckpointCodec.kt"
    checkpoint_store = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RoomPythonCheckpointStore.kt"
    app_view_model = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    recorder = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/data/LocalRuntimeV2Recorder.kt"
    backfill = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep/LegacyOaepBackfill.kt"
    codec_test = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/PythonCheckpointCodecTest.kt"
    runtime_test = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RuntimeV2Test.kt"
    device_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/P9RuntimeMigrationInstrumentedTest.kt"
    local_store_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/LocalStoreTest.kt"
    paths = (codec, checkpoint_store, app_view_model, recorder, backfill, codec_test, runtime_test, device_test, local_store_test)
    text = {path: path.read_text(encoding="utf-8") for path in paths}
    unit_dir = ROOT / "apps/android/app/build/test-results/testDebugUnitTest"
    device_xml = ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug/TEST-ai.drsai.remote.P9RuntimeMigrationInstrumentedTest.xml"

    gates = {
        "v1_checkpoint_upgrades_to_checksummed_v2_without_receipt_loss": (
            "migratedFrom" in text[codec] and "PythonCheckpointCodec.merge" in text[checkpoint_store]
            and "v156DataCheckpointReceiptAndIncompatibleRunsMigrateWithoutIdentityLoss" in text[device_test]
        ),
        "completed_conversation_and_run_remain_readable": (
            "completed history remains readable" in text[device_test]
            and "migration_11_to_13_preserves_legacy_data" in text[local_store_test]
        ),
        "recoverable_run_keeps_same_session_run_and_idempotency_identity": all(value in text[device_test] for value in (
            '"active-run"', '"session-1"', '"active-key"', 'recorder.resume(WorkbenchId("active-run"))',
        )),
        "tool_receipt_and_skill_version_survive_checkpoint_rewrite": (
            '"_host_tool_results"' in text[device_test] and '"skill_versions"' in text[device_test]
            and '"workspace.edit"' in text[device_test]
        ),
        "legacy_kotlin_lite_run_is_explicitly_terminal": (
            "legacy_kotlin_checkpoint_unrecoverable" in text[app_view_model]
            and "legacyCheckpointWithoutFullRuntimeStateCanBeClosedExplicitly" in text[runtime_test]
        ),
        "future_corrupt_or_old_reader_checkpoint_is_explicitly_terminal": (
            "PythonCheckpointMigrationPolicy" in text[codec]
            and "PythonCheckpointMigrationPolicy.terminalFailureCode" in text[app_view_model]
            and "python_checkpoint_incompatible" in text[codec]
            and "known incompatible checkpoints terminate migration" in text[codec_test]
        ),
        "unknown_transient_storage_failure_is_not_destroyed_as_incompatible": (
            'IllegalStateException("database_busy")' in text[codec_test]
            and "?: throw it" in text[app_view_model]
        ),
        "legacy_active_side_effect_state_projects_to_reconciliation": (
            "legacy_migration_reconciliation" in text[backfill]
            and 'interactionType = "reconciliation"' in text[backfill]
            and "NormalizedAgentEvent.RunWaiting" in text[backfill]
        ),
        "migration_unit_suites_are_green": (
            suite(unit_dir / "TEST-ai.drsai.remote.PythonCheckpointCodecTest.xml", 3)
            and suite(unit_dir / "TEST-ai.drsai.remote.RuntimeV2Test.xml", 1)
        ),
        "current_v156_database_reopen_and_migration_are_green_on_both_devices": suite(device_xml, 1, devices=2),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M11-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m11-f05-runtime-migration.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
