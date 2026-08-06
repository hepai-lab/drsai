from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path | None):
    if path is None or not path.is_file():
        return None
    root = ET.parse(path).getroot()
    value = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}
    value.update(name=root.attrib.get("name", ""), sha256=digest(path))
    return value


def green(value, minimum: int) -> bool:
    return bool(value and value["tests"] >= minimum and value["failures"] == value["errors"] == 0)


def main() -> int:
    service_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/device/LocalRunNotifications.kt"
    worker_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/reliability/RunRecoveryWorker.kt"
    recovery_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRunRecovery.kt"
    viewmodel_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    activity_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/MainActivity.kt"
    manifest_path = REPO / "apps/android/app/src/main/AndroidManifest.xml"
    strings_path = REPO / "apps/android/app/src/main/res/values/strings.xml"
    recovery_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PythonRunRecoveryTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/runtime/device/OaepRunNotificationIntentTest.kt"
    capability_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/AndroidLocalCapabilitiesInstrumentedTest.kt"
    long_run_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/runtime/device/LongRunDozeInstrumentedTest.kt"
    doze_evidence_path = REPO / "docs/android/reports/evidence/p9/m08-f05-doze-system-check.json"
    source_paths = (
        service_path, worker_path, recovery_path, viewmodel_path, activity_path,
        manifest_path, strings_path, recovery_test_path, device_test_path,
        capability_test_path, long_run_test_path,
    )
    texts = {path: path.read_text(encoding="utf-8") for path in source_paths}

    unit_report = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PythonRunRecoveryTest.xml"
    unit = subprocess.run(
        [
            sys.executable,
            "-c",
            "import xml.etree.ElementTree as E,sys; r=E.parse(sys.argv[1]).getroot(); assert int(r.attrib.get('failures',0))==0 and int(r.attrib.get('errors',0))==0",
            str(unit_report),
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
    )

    connected = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    required_classes = ("OaepRunNotificationIntentTest", "AndroidLocalCapabilitiesInstrumentedTest", "LongRunDozeInstrumentedTest")
    device_paths = [
        path for path in connected
        if all(name in path.read_text(encoding="utf-8") for name in required_classes)
    ]
    device_suites = [suite(path) for path in device_paths]
    connected_suite = {
        "tests": sum(int(value["tests"]) for value in device_suites if value),
        "failures": sum(int(value["failures"]) for value in device_suites if value),
        "errors": sum(int(value["errors"]) for value in device_suites if value),
        "skipped": sum(int(value["skipped"]) for value in device_suites if value),
        "names": [value["name"] for value in device_suites if value],
    } if device_suites else None
    durable = REPO / "docs/android/reports/evidence/p9/m08-f05-long-run-background-instrumentation.xml"
    if device_paths:
        durable.parent.mkdir(parents=True, exist_ok=True)
        durable.write_text("\n".join(path.read_text(encoding="utf-8") for path in reversed(device_paths)), encoding="utf-8")

    service, worker, recovery = texts[service_path], texts[worker_path], texts[recovery_path]
    viewmodel, activity, manifest = texts[viewmodel_path], texts[activity_path], texts[manifest_path]
    doze_evidence = json.loads(doze_evidence_path.read_text(encoding="utf-8")) if doze_evidence_path.is_file() else {}
    gates = {
        "foreground_service_obeys_android_data_sync_contract": all(value in manifest for value in ("FOREGROUND_SERVICE_DATA_SYNC", 'android:foregroundServiceType="dataSync"')) and "startForeground(" in service,
        "lockscreen_notification_always_has_continue_and_cancel": all(value in service for value in ("ACTION_CONTINUE_LOCAL_RUN", "ACTION_STOP_LOCAL_RUN", '.addAction(0, "继续"', '.addAction(0, "取消"')),
        "background_execution_uses_redelivered_foreground_ownership": "START_REDELIVER_INTENT" in service and "START_FLAG_REDELIVERY" in service,
        "task_removal_and_android15_timeout_schedule_recovery": "override fun onTaskRemoved" in service and "override fun onTimeout" in service and service.count("scheduleRecovery(") >= 3,
        "reclaim_keeps_visible_control_before_worker_runs": "STOP_FOREGROUND_DETACH" in service and "任务已暂停，可继续或取消" in service,
        "recovery_is_unique_per_account_and_run": "enqueueUniqueWork" in worker and "ExistingWorkPolicy.KEEP" in worker and "recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun" in texts[capability_test_path],
        "continue_recovers_the_identical_run_and_checkpoint": all(value in viewmodel for value in ("continueRunFromNotification", "runtimeV2Recorder.resume(checkpoint.command.runId)", "sendMessage(checkpoint.command.input, checkpoint, attachments)")) and "messageType = PythonRuntimeMessageType.RESUME_RUN" in recovery,
        "cancel_is_scoped_to_the_notified_run": "cancelRunFromNotification" in viewmodel and "runtimeV2Recorder.cancel(checkpoint.command.runId)" in viewmodel and "notification-cancel" in viewmodel,
        "notification_actions_are_routed_and_fail_closed": "ACTION_CONTINUE_LOCAL_RUN" in activity and "invalid_or_unscoped_notification_actions_fail_closed" in texts[device_test_path],
        "api35_notification_service_and_recovery_suite_is_green": unit.returncode == 0 and green(connected_suite, 8),
        "api35_forced_doze_keeps_run_notification_visible": all(doze_evidence.get(key) is True for key in ("instrumentation_test_passed", "notification_visible_before_doze", "device_entered_idle", "notification_visible_during_doze")),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M08-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "python_recovery_suite": suite(unit_report),
        "connected_suite": connected_suite,
        "connected_report": str(durable.relative_to(REPO)).replace("\\", "/") if device_paths else None,
        "doze_system_check": doze_evidence,
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in source_paths},
    }
    output = REPO / "docs/android/reports/evidence/p9/m08-f05-long-run-background.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
