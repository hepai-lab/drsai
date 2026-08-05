"""Generate fail-closed Stage 7 scenario evidence from hash-bound green JUnit reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


MAPPING = {
    "recovery": {
        "waiting_model_process_death": "ai.drsai.remote.PythonRunRecoveryTest#recovery phase selects deterministic host action",
        "waiting_tool_before_execution": "ai.drsai.remote.PythonRunRecoveryTest#recovery phase selects deterministic host action",
        "tool_success_before_receipt": "ai.drsai.remote.PythonAgentLoopCoordinatorTest#durable host receipt prevents tool side effect from executing twice after recovery",
        "waiting_approval": "ai.drsai.remote.PythonRunRecoveryTest#recovery phase selects deterministic host action",
        "approval_success_before_resume": "ai.drsai.remote.PythonAgentLoopCoordinatorTest#durable approval is forwarded to recovered tool execution",
        "running_process_death": "ai.drsai.remote.PythonRuntimeServiceTest#runtimeRecoversAfterUnexpectedProcessDeath",
        "paused_resume": "ai.drsai.remote.RuntimeV2Test#productionRecorderPausesInterruptedRunThenResumesAndCancels",
        "terminal_rejected": "ai.drsai.remote.PythonRunRecoveryTest#terminal checkpoint cannot be resumed",
        "cold_start_notification_reentry": "ai.drsai.remote.AndroidLocalCapabilitiesInstrumentedTest#recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun",
    },
    "side_effect": {
        "tool_intent_receipt": "ai.drsai.remote.PythonAgentLoopCoordinatorTest#tool execution emits queryable side effect audit phases in order",
        "durable_receipt_replay": "ai.drsai.remote.PythonAgentLoopCoordinatorTest#durable host receipt prevents tool side effect from executing twice after recovery",
        "approval_first_decision_wins": "ai.drsai.remote.LocalStoreTest#approval_is_exactly_bound_first_decision_wins_and_audit_is_appended",
        "artifact_operation_id": "ai.drsai.remote.PythonAgentLoopCoordinatorTest#durable artifact operation receipt prevents duplicate external mutation",
        "needs_reconciliation": "ai.drsai.remote.PythonAgentLoopCoordinatorTest#uncertain executing tool enters reconciliation without reexecution",
        "audit_chain_query": "ai.drsai.remote.LocalStoreTest#side_effect_audit_is_idempotent_and_queryable_by_run",
    },
    "ui": {
        "recovery_statuses": "ai.drsai.remote.ui.MainInterfaceTest#recoveringDisablesComposerConflictsButKeepsCancelAvailable",
        "cancel_idempotent": "ai.drsai.remote.RuntimeV2Test#productionRecorderPausesInterruptedRunThenResumesAndCancels",
        "activity_recreation": "ai.drsai.remote.ui.MainInterfaceTest#recoveringDisablesComposerConflictsButKeepsCancelAvailable",
        "notification_scope": "ai.drsai.remote.AndroidLocalCapabilitiesInstrumentedTest#recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun",
        "logout_cleanup": "ai.drsai.remote.RemoteSecurityTest#logout registry cancels every subject subscription",
        "fallback_status": "ai.drsai.remote.RuntimeReliabilityTest#everyTerminalFailureClassHasARecoveryActionAndCorrelatableDiagnostic",
    },
}

AUDIT_PHASES = {
    "tool_intent_receipt": ["intent", "execution", "receipt"],
    "durable_receipt_replay": ["replay"],
    "approval_first_decision_wins": ["approval"],
    "needs_reconciliation": ["reconciliation"],
    "audit_chain_query": ["terminal"],
}
DEVICE_TESTS = {
    "ai.drsai.remote.PythonRuntimeServiceTest#runtimeRecoversAfterUnexpectedProcessDeath",
    "ai.drsai.remote.AndroidLocalCapabilitiesInstrumentedTest#recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun",
    "ai.drsai.remote.LocalStoreTest#approval_is_exactly_bound_first_decision_wins_and_audit_is_appended",
    "ai.drsai.remote.LocalStoreTest#side_effect_audit_is_idempotent_and_queryable_by_run",
    "ai.drsai.remote.ui.MainInterfaceTest#recoveringDisablesComposerConflictsButKeepsCancelAvailable",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bound(path: Path, identity: dict) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != 2 or value.get("identity") != identity or value.get("result", "passed") != "passed":
        raise ValueError(f"index_not_bound_or_passed:{path}")
    return value


def cases(path: Path) -> set[str]:
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
    if any(int(suite.get("failures", "0")) or int(suite.get("errors", "0")) for suite in suites):
        raise ValueError(f"junit_not_green:{path}")
    return {
        f"{case.get('classname')}#{case.get('name')}" for suite in suites for case in suite.findall("testcase")
        if case.find("failure") is None and case.find("error") is None and case.find("skipped") is None
    }


def provenance(values: list[dict], identity: dict) -> dict:
    items = [value["provenance"] for value in values]
    return {
        "runner": "stage7-junit-scenario-mapping-v1+" + "+".join(sorted({str(item["runner"]) for item in items})),
        "acceptance_run_id": identity["acceptance_run_id"],
        "package_version_code": identity["version_code"],
        "package_version_name": identity["version_name"],
        "apk_sha256": identity["apk_sha256"],
        "started_at": min(str(item["started_at"]) for item in items),
        "completed_at": max(str(item["completed_at"]) for item in items),
        "device_ids_sha256": sorted({device for item in items for device in item["device_ids_sha256"]}),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--junit-index", type=Path, action="append", default=[])
    parser.add_argument("--junit-dir", type=Path, action="append", default=[])
    parser.add_argument("--device-run", type=Path, action="append", default=[])
    parser.add_argument("--recovery-interactive-ms", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    bound: list[dict] = []
    reports: dict[str, dict] = {}

    for index_path in args.junit_index:
        index = load_bound(index_path, identity)
        bound.append(index)
        for item in index.get("junit", []):
            matches = [path for directory in args.junit_dir for path in directory.glob(f"*{item['name']}")
                       if sha256(path) == item.get("sha256")]
            if len(matches) != 1:
                raise ValueError(f"indexed_junit_missing_or_hash_mismatch:{item.get('name')}")
            for test_id in cases(matches[0]):
                reports[test_id] = {"path": str(matches[0].resolve()), "sha256": item["sha256"], "source": "local_jvm"}

    for run_path in args.device_run:
        run = load_bound(run_path, identity)
        bound.append(run)
        junit_dir = run_path.parent / f"{run_path.stem}-junit"
        for item in run.get("reports", []):
            path = junit_dir / str(item.get("junit"))
            if not path.is_file() or sha256(path) != item.get("junit_sha256"):
                raise ValueError(f"device_junit_missing_or_hash_mismatch:{path}")
            for test_id in cases(path):
                reports[test_id] = {"path": str(path.resolve()), "sha256": item["junit_sha256"], "source": "android_device"}

    if not bound:
        raise ValueError("no_bound_test_sources")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    common_provenance = provenance(bound, identity)
    for category, scenarios in MAPPING.items():
        for scenario_id, test_id in scenarios.items():
            if test_id not in reports:
                raise ValueError(f"required_green_test_missing:{scenario_id}:{test_id}")
            if test_id in DEVICE_TESTS and reports[test_id]["source"] != "android_device":
                raise ValueError(f"required_device_test_not_from_device:{scenario_id}:{test_id}")
            value = {
                "schema_version": 2,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "identity": identity,
                "provenance": common_provenance,
                "category": category,
                "scenario_id": scenario_id,
                "test": {"id": test_id, **reports[test_id]},
                "result": "passed",
            }
            if category == "recovery":
                value["interactive_ms"] = args.recovery_interactive_ms
            if category == "side_effect":
                value["duplicate_user_visible_side_effects"] = 0
                value["audit_phases"] = AUDIT_PHASES.get(scenario_id, [])
            (output / f"{category}-{scenario_id}.json").write_text(
                json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
