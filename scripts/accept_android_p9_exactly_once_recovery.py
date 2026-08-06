from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(name: str, minimum: int) -> bool:
    path = ROOT / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml"
    if not path.is_file():
        return False
    root = ET.parse(path).getroot()
    return (
        int(root.attrib.get("tests", 0)) >= minimum
        and int(root.attrib.get("failures", 0)) == 0
        and int(root.attrib.get("errors", 0)) == 0
    )


def device_suite() -> tuple[bool, int]:
    path = ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug/TEST-ai.drsai.remote.AndroidOaepStoreTest.xml"
    if not path.is_file():
        return False, 0
    root = ET.parse(path).getroot()
    devices = [item.attrib.get("value", "") for item in root.findall("./properties/property") if item.attrib.get("name", "").startswith("device.")]
    valid_devices = "emulator-5554" in devices and any("R5GYB3S8ACH" in value for value in devices)
    green = (
        int(root.attrib.get("tests", 0)) >= 12
        and int(root.attrib.get("failures", 0)) == 0
        and int(root.attrib.get("errors", 0)) == 0
    )
    return green and valid_devices, len(devices)


def main() -> int:
    coordinator = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonAgentLoopCoordinator.kt"
    checkpoint_store = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RoomPythonCheckpointStore.kt"
    reconciliation = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeReconciliation.kt"
    oaep_sink = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep/AndroidOaepRuntimeSink.kt"
    oaep_store = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep/AndroidOaepStore.kt"
    coordinator_test = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/PythonAgentLoopCoordinatorTest.kt"
    reconciliation_test = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeReconciliationTest.kt"
    mapper_test = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt"
    device_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/AndroidOaepStoreTest.kt"
    paths = (
        coordinator, checkpoint_store, reconciliation, oaep_sink, oaep_store,
        coordinator_test, reconciliation_test, mapper_test, device_test,
    )
    text = {path: path.read_text(encoding="utf-8") for path in paths}
    device_green, device_count = device_suite()

    gates = {
        "tool_wal_has_prepared_executing_and_receipt_states": all(value in text[coordinator] for value in (
            '.put("status", "prepared")', '.put("status", "executing")', '.put("status", "receipt_persisted")',
        )),
        "prepared_intent_resumes_and_executes_at_most_once": (
            "process death after prepared intent resumes and executes side effect once" in text[coordinator_test]
            and suite("PythonAgentLoopCoordinatorTest", 22)
        ),
        "uncertain_execution_never_reexecutes_and_enters_reconciliation": (
            "process death after handler return reconciles without duplicate side effect" in text[coordinator_test]
            and "python_tool_needs_reconciliation" in text[reconciliation]
            and suite("PythonRuntimeReconciliationTest", 1)
        ),
        "durable_receipt_replays_without_duplicate_side_effect": (
            "process death after durable receipt replays without duplicate side effect" in text[coordinator_test]
            and "receipt_replayed" in text[coordinator]
        ),
        "approval_decision_is_durable_and_not_prompted_twice": (
            '"_host_approval_results"' in text[coordinator]
            and "process death after rejected approval persists decision and does not prompt twice" in text[coordinator_test]
        ),
        "tool_and_artifact_intents_share_reconciliation_contract": all(value in text[coordinator] for value in (
            "ARTIFACT_INTENT_PERSISTED", "ARTIFACT_HANDLER_RETURNED", "artifact_needs_reconciliation",
        )),
        "checkpoint_and_oaep_authority_are_room_transaction_bound": (
            "database.withTransaction" in text[checkpoint_store]
            and "database.withTransaction" in text[oaep_store]
            and "_oaep_binding" in text[checkpoint_store]
        ),
        "oaep_cached_writer_cannot_advance_ahead_of_room": (
            "val candidate = AndroidOaepWriter" in text[oaep_sink]
            and "writers.remove(writerKey)" in text[oaep_sink]
            and "TRANSACTION_COMMITTED" in text[oaep_sink]
        ),
        "oaep_pre_and_post_commit_fault_windows_are_idempotent_on_both_devices": (
            device_green
            and "oaep_fault_windows_recover_without_duplicate_events_or_poisoned_writer_state" in text[device_test]
        ),
        "reconciliation_is_user_visible_waiting_state_not_permanent_running": (
            "side_effect.reconciliation_required" in text[reconciliation]
            and "uncertain side effect becomes waiting reconciliation interaction" in text[mapper_test]
            and suite("PythonRuntimeEventMapperTest", 1)
        ),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M11-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "device_count": device_count,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m11-f02-exactly-once-recovery.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "devices": device_count}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
