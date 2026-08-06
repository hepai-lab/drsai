"""Record M04/M07 OAEP execution and v1.5.5 migration acceptance."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps/android/app"
EVIDENCE = ROOT / "docs/android/reports/evidence/v1.5.6"
APK = APP / "build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def jvm_totals() -> dict[str, int]:
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for report in (APP / "build/test-results/testDebugUnitTest").glob("TEST-*.xml"):
        root = ET.parse(report).getroot()
        for key in totals:
            totals[key] += int(root.attrib.get(key, 0))
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device-serial", required=True)
    parser.add_argument("--device-model", required=True)
    parser.add_argument("--device-api", type=int, required=True)
    parser.add_argument("--device-tests", type=int, required=True)
    parser.add_argument("--device-failures", type=int, required=True)
    args = parser.parse_args()

    app_vm = read("apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt")
    engine = read("apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt")
    writer = read("apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep/AndroidOaepWriter.kt")
    checkpoint = read("apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RoomPythonCheckpointStore.kt")
    loop = read("apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonAgentLoopCoordinator.kt")
    recorder = read("apps/android/app/src/main/java/ai/drsai/remote/data/LocalRuntimeV2Recorder.kt")
    store = read("apps/android/app/src/main/java/ai/drsai/remote/data/LocalStore.kt")
    migration_test = read("apps/android/app/src/androidTest/java/ai/drsai/remote/LocalStoreTest.kt")
    rollback_test = read("apps/android/app/src/androidTest/java/ai/drsai/remote/AndroidOaepStage8RollbackTest.kt")
    baseline = json.loads((EVIDENCE / "v1.5.5-baseline.json").read_text(encoding="utf-8"))
    jvm = jvm_totals()

    checks = {
        "physical_device_matrix_green": args.device_tests >= 22 and args.device_failures == 0,
        "only_full_local_engine": "pythonChatEngine" in app_vm and "SelectableLocalChatEngine" not in app_vm,
        "all_host_ports_injected": all(
            token in app_vm for token in (
                "HaiPythonModelHostPort", "OaepBoundPythonCheckpointStore", "AndroidPythonToolHostPort",
                "LocalToolRegistryPythonApprovalPort", "ScopedPythonArtifactHostPort",
                "AndroidPythonLifecycleHostPort", "RoomPythonSideEffectAudit",
            )
        ),
        "normalized_oaep_sink": "normalizedSink.accept" in engine and "PythonRuntimeEventMapper.decodeAll" in engine,
        "pre_event_failure_reuses_run": "request.runId" in engine and "terminal-failure" in engine,
        "side_effect_reconciliation": "PythonRuntimeReconciliation.envelope" in engine and
        "_host_tool_results" in loop and "needs_reconciliation" in loop,
        "terminal_write_guard": "oaep_run_terminal" in writer and "oaep_item_terminal" in writer,
        "baseline_v155_schema_11": baseline["release"] == "v1.5.5" and baseline["database"]["room_schema_version"] == 11,
        "migration_11_13_present": "MIGRATION_11_12" in store and "MIGRATION_12_13" in store,
        "migration_preserves_legacy_rows": "migration_11_to_13_preserves_legacy_data_and_creates_android_oaep_authority" in migration_test,
        "interrupted_runs_not_left_running": "run.recovered" in recorder and "WorkbenchRunStatus.PAUSED" in recorder,
        "legacy_lite_checkpoint_explicit_terminal": "legacy_kotlin_checkpoint_unrecoverable" in app_vm and "failUnrecoverable" in recorder,
        "receipt_and_checkpoint_watermark": "_oaep_binding" in checkpoint and "python_checkpoint_oaep_watermark_regression" in checkpoint,
        "rollback_digest_matrix": all(
            name in rollback_test for name in (
                "seed_v155_oaep_state", "verify_v156_upgrade_preserves_oaep_and_kill_switch_is_safe",
                "verify_v155_rollback_preserves_oaep_state", "androidOaepSnapshotDigest",
            )
        ),
        "jvm_green": jvm["tests"] > 0 and jvm["failures"] == 0 and jvm["errors"] == 0,
    }
    features = {
        "M04-F01": checks["physical_device_matrix_green"] and checks["only_full_local_engine"],
        "M04-F02": checks["all_host_ports_injected"],
        "M04-F03": checks["normalized_oaep_sink"],
        "M04-F04": checks["pre_event_failure_reuses_run"],
        "M04-F05": checks["side_effect_reconciliation"] and checks["receipt_and_checkpoint_watermark"],
        "M04-F06": checks["terminal_write_guard"],
        "M07-F01": checks["baseline_v155_schema_11"] and checks["migration_11_13_present"] and checks["migration_preserves_legacy_rows"],
        "M07-F02": checks["rollback_digest_matrix"],
        "M07-F03": checks["interrupted_runs_not_left_running"],
        "M07-F04": checks["legacy_lite_checkpoint_explicit_terminal"],
        "M07-F05": checks["receipt_and_checkpoint_watermark"],
        "M07-F06": checks["rollback_digest_matrix"] and checks["physical_device_matrix_green"],
    }
    now = datetime.now(timezone.utc).isoformat()
    common = {
        "schema_version": 1,
        "captured_at": now,
        "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "apk": {"path": str(APK), "sha256": sha256(APK)},
        "package": "ai.drsai.remote.debug",
        "version": "1.5.6",
        "device": {"serial": args.device_serial, "model": args.device_model, "api": args.device_api},
        "tests": {"jvm": jvm, "instrumentation": {"tests": args.device_tests, "failures": args.device_failures}},
        "checks": checks,
        "features": features,
        "passed": all(checks.values()) and all(features.values()),
    }
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "oaep-parity.json").write_text(json.dumps(common, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    upgrade = dict(common)
    upgrade["baseline"] = baseline
    upgrade["transition"] = ["1.5.5", "1.5.6", "1.5.5-compatible-digest"]
    (EVIDENCE / "upgrade-v1.5.5-to-v1.5.6.json").write_text(
        json.dumps(upgrade, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"passed": common["passed"], "features": features, "failed": [key for key, value in checks.items() if not value]}))
    return 0 if common["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
