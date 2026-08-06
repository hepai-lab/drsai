"""Generate the 48-point matrix from source hashes, JUnit results, and required runtime reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

P = "apps/android/app/src/main/java/ai/drsai/remote/"
S = "apps/android/scripts/"


def feature(source: str, test: str, *reports: str) -> tuple[list[str], list[str], list[str]]:
    return ([source], [test], list(reports))


# Each feature has an explicit proof contract. Sharing a report is permitted;
# silently promoting all six features from one module-level test is not.
FEATURES = {
    "M01-F01": feature(P + "runtime/python/PythonSharedCoreChatEngine.kt", "builds versioned resume command from latest nonterminal checkpoint", "recovery-matrix.json"),
    "M01-F02": feature(P + "runtime/reliability/RunRecoveryWorker.kt", "recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun", "recovery-matrix.json"),
    "M01-F03": feature(P + "runtime/reliability/RunRecoveryWorker.kt", "runtimeRecoversAfterUnexpectedProcessDeath", "recovery-matrix.json", "ui-critical-journey.json"),
    "M01-F04": feature(P + "runtime/python/PythonRuntimeClient.kt", "runtimeRecoversAfterUnexpectedProcessDeath", "recovery-matrix.json"),
    "M01-F05": feature(P + "runtime/python/PythonRunRecovery.kt", "recovery phase selects deterministic host action", "recovery-matrix.json"),
    "M01-F06": feature(P + "runtime/python/PythonRunRecovery.kt", "terminal checkpoint cannot be resumed", "recovery-matrix.json", "ui-critical-journey.json"),
    "M02-F01": feature(P + "runtime/python/PythonAgentLoopCoordinator.kt", "tool execution emits queryable side effect audit phases in order", "side-effect-consistency.json"),
    "M02-F02": feature(P + "runtime/python/PythonAgentLoopCoordinator.kt", "durable host receipt prevents tool side effect from executing twice after recovery", "side-effect-consistency.json"),
    "M02-F03": feature(P + "runtime/python/PythonAgentLoopCoordinator.kt", "approval_is_exactly_bound_first_decision_wins_and_audit_is_appended", "side-effect-consistency.json"),
    "M02-F04": feature(P + "runtime/python/PythonAgentLoopCoordinator.kt", "durable artifact operation receipt prevents duplicate external mutation", "side-effect-consistency.json"),
    "M02-F05": feature(P + "runtime/python/PythonAgentLoopCoordinator.kt", "uncertain executing tool enters reconciliation without reexecution", "side-effect-consistency.json"),
    "M02-F06": feature(P + "runtime/python/RoomPythonSideEffectAudit.kt", "side_effect_audit_is_idempotent_and_queryable_by_run", "side-effect-consistency.json"),
    "M03-F01": feature(P + "runtime/reliability/RunRecoveryWorker.kt", "applicationBackupIsDisabledSoTokensAndDatabaseCannotEnterCloudBackup", "ui-critical-journey.json"),
    "M03-F02": feature(P + "AppViewModel.kt", "everyTerminalFailureClassHasARecoveryActionAndCorrelatableDiagnostic", "ui-critical-journey.json"),
    "M03-F03": feature(P + "ui/OpenDrSaiApp.kt", "recoveringDisablesComposerConflictsButKeepsCancelAvailable", "ui-critical-journey.json"),
    "M03-F04": feature(P + "runtime/python/PythonSharedCoreChatEngine.kt", "recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun", "ui-critical-journey.json"),
    "M03-F05": feature(P + "MainActivity.kt", "runtimeRecoversAfterUnexpectedProcessDeath", "ui-critical-journey.json"),
    "M03-F06": feature(P + "AppViewModel.kt", "logout registry cancels every subject subscription", "ui-critical-journey.json", "security-scan.json"),
    "M04-F01": feature(P + "runtime/python/PythonRuntimeRolloutPolicy.kt", "signed policy can only allow or block the full runtime", "rollout-drill.json"),
    "M04-F02": feature(P + "runtime/python/RuntimeRolloutPolicyClient.kt", "tampered or expired policy cannot enable Python", "rollout-drill.json"),
    "M04-F03": feature(P + "runtime/coordinator/HybridRuntimeCoordinator.kt", "deterministicRequirementsAndRouteCanBeExplicitlyOverridden", "rollout-drill.json"),
    "M04-F04": feature(P + "runtime/python/PythonSharedCoreChatEngine.kt", "host rejects a retry policy that attempts to replay side effects", "rollout-drill.json"),
    "M04-F05": feature(P + "runtime/python/PythonRuntimeRolloutPolicy.kt", "rolloutVersionPercentAndReasonRemainAvailableForDiagnostics", "rollout-drill.json"),
    "M04-F06": feature(P + "runtime/python/PythonCheckpointCodec.kt", "future old-reader and corrupted checkpoints fail without rewrite", "upgrade-rollback.json"),
    "M05-F01": feature(S + "initialize-stage7-python-runtime-evidence.py", "test_stage7_initializer_is_honest_and_identity_consistent", "trusted-build-audit.json"),
    "M05-F02": feature(S + "stamp-stage7-report-provenance.py", "test_stage7_provenance_stamper_rejects_raw_or_mismatched_evidence", "trusted-build-audit.json"),
    "M05-F03": feature(S + "verify-stage7-python-runtime.py", "test_stage7_verifier_binds_48_features_reports_and_apk", "trusted-build-audit.json"),
    "M05-F04": feature(S + "build-stage7-runtime-candidate.ps1", "test_stage7_candidate_builder_is_fail_closed", "trusted-build-audit.json"),
    "M05-F05": feature("cores/protocol/android-runtime/stage7-evidence.schema.json", "test_stage7_evidence_schema_covers_identity_and_provenance", "trusted-build-audit.json"),
    "M05-F06": feature(S + "finalize-stage7-release-manifest.py", "test_stage7_manifest_finalizer_hashes_final_reports_and_sbom", "trusted-build-audit.json"),
    "M06-F01": feature(S + "collect-stage7-security-evidence.py", "test_stage7_security_collector_requires_all_three_clean_sources", "security-scan.json"),
    "M06-F02": feature(S + "aggregate-stage7-device-matrix.py", "test_stage7_device_matrix_requires_api_abi_coverage_and_one_physical_device", "security-scan.json"),
    "M06-F03": feature(P + "runtime/python/PythonRuntimeMetrics.kt", "recordsOnlyAggregateProductionMetrics", "device-performance.json"),
    "M06-F04": feature(P + "runtime/reliability/RuntimeReliability.kt", "everyTerminalFailureClassHasARecoveryActionAndCorrelatableDiagnostic", "security-scan.json"),
    "M06-F05": feature(P + "runtime/reliability/RuntimeReliability.kt", "diagnosticsAreBoundedAndRedactedAndWorkNamesAreRunScoped", "security-scan.json"),
    "M06-F06": feature(S + "verify-stage7-android-security-boundaries.py", "test_stage7_android_security_boundaries_are_fail_closed", "android-security-boundaries.json"),
    "M07-F01": feature(S + "aggregate-stage7-device-matrix.py", "test_stage7_device_matrix_requires_api_abi_coverage_and_one_physical_device", "device-matrix.json"),
    "M07-F02": feature(S + "aggregate-stage7-device-matrix.py", "test_stage7_device_matrix_requires_api_abi_coverage_and_one_physical_device", "device-matrix.json"),
    "M07-F03": feature(P + "runtime/reliability/RuntimeReliability.kt", "deviceConstraintsPauseOrOfferRemoteHandoffInsteadOfForcingBackgroundExecution", "device-matrix.json"),
    "M07-F04": feature(P + "runtime/python/PythonRuntimeClient.kt", "runtimeAutomaticallyReleasesAfterIdleTimeout", "device-performance.json"),
    "M07-F05": feature(S + "run-python-runtime-stress.py", "recordsColdStartMemoryStorageAndReleaseMetrics", "side-effect-consistency.json", "device-performance.json"),
    "M07-F06": feature(P + "runtime/reliability/RuntimeReliability.kt", "resourcePressureBlocksOrOffersExplicitRemoteWithoutAnyLiteRoute", "device-performance.json", "android-security-boundaries.json"),
    "M08-F01": feature(P + "runtime/python/RuntimeBetaOperations.kt", "rates pause while sample and observation gates hold expansion", "rollout-drill.json"),
    "M08-F02": feature(P + "runtime/python/RuntimeBetaOperations.kt", "rates pause while sample and observation gates hold expansion", "rollout-drill.json"),
    "M08-F03": feature(P + "runtime/python/RuntimeBetaOperations.kt", "hard integrity event immediately activates kill switch", "rollout-drill.json"),
    "M08-F04": feature(S + "evaluate-stage7-beta-rollout.py", "test_stage7_rollout_report_requires_all_rollback_drills", "rollout-drill.json", "upgrade-rollback.json"),
    "M08-F05": feature(P + "runtime/python/RuntimeBetaOperations.kt", "feedback incident requires owner severity diagnostic and fix version", "rollout-drill.json"),
    "M08-F06": feature(S + "verify-stage7-python-runtime.py", "test_stage7_verifier_binds_48_features_reports_and_apk", "rollout-drill.json"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit_cases(paths: list[Path], evidence: Path) -> dict[str, dict]:
    cases: dict[str, dict] = {}
    junit_dir = evidence / "junit"
    junit_dir.mkdir(parents=True, exist_ok=True)
    for path in paths:
        if not path.is_file():
            continue
        report_hash = digest(path)
        copied = junit_dir / f"{report_hash[:12]}-{path.name}"
        if not copied.is_file() or digest(copied) != report_hash:
            shutil.copyfile(path, copied)
        root = ET.parse(path).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
        report_passed = bool(suites) and all(
            int(suite.get("failures", "0")) == 0 and int(suite.get("errors", "0")) == 0
            for suite in suites
        ) and next(root.iter("failure"), None) is None and next(root.iter("error"), None) is None
        for case in root.iter("testcase"):
            key = f"{case.get('classname', '')}.{case.get('name', '')}"
            cases[key] = {
                "passed": report_passed and case.find("skipped") is None,
                "report": copied.relative_to(evidence).as_posix(), "sha256": report_hash,
            }
    return cases


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--android-junit", type=Path, action="append", default=[])
    parser.add_argument("--python-junit", type=Path, action="append", default=[])
    parser.add_argument("--junit-index", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo, evidence = args.repo.resolve(), args.evidence.resolve()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    junit_paths = [*args.android_junit, *args.python_junit]
    allowed_junit_hashes: set[str] = set()
    for path in args.junit_index:
        index = json.loads(path.read_text(encoding="utf-8"))
        provenance = index.get("provenance", {})
        if (index.get("schema_version") != 2 or index.get("identity") != identity or
                index.get("result") != "passed" or not provenance.get("runner") or
                provenance.get("acceptance_run_id") != identity.get("acceptance_run_id") or
                not provenance.get("started_at") or not provenance.get("completed_at") or
                (identity.get("apk_sha256") and provenance.get("apk_sha256") != identity["apk_sha256"])):
            raise RuntimeError(f"junit_index_invalid:{path.name}")
        for item in [*index.get("junit", []), *index.get("reports", [])]:
            value = item.get("sha256") or item.get("junit_sha256")
            if isinstance(value, str) and len(value) == 64:
                allowed_junit_hashes.add(value)
    unbound = [path.name for path in junit_paths if digest(path) not in allowed_junit_hashes]
    if unbound:
        raise RuntimeError("junit_not_bound_to_acceptance_run:" + ",".join(sorted(unbound)))
    cases = junit_cases(junit_paths, evidence)
    rows = []
    if set(FEATURES) != {f"M{module:02d}-F{feature_no:02d}" for module in range(1, 9) for feature_no in range(1, 7)}:
        raise RuntimeError("stage7_feature_contract_not_48")
    for feature_id, (source_names, test_tokens, report_names) in sorted(FEATURES.items()):
        sources = [{"path": name, "sha256": digest(repo / name)} for name in source_names if (repo / name).is_file()]
        matching = {name: passed for name, passed in cases.items() if any(name.endswith("." + token) for token in test_tokens)}
        reports = []
        for name in report_names:
            path = evidence / name
            value = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
            reports.append({"path": name, "result": value.get("result", "missing"), "identity_match": value.get("identity") == identity})
        feature_passed = (
            len(sources) == len(source_names) and bool(matching) and all(item["passed"] for item in matching.values()) and
            all(item["result"] == "passed" and item["identity_match"] for item in reports)
        )
        rows.append({
            "feature_id": feature_id, "requirement_id": feature_id, "mapping_version": 2,
            "status": "passed" if feature_passed else "pending",
            "evidence": {"sources": sources, "tests": matching, "reports": reports},
        })
    passed = sum(item["status"] == "passed" for item in rows)
    value = {
        "schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(), "identity": identity,
        "summary": {"total": 48, "passed": passed, "pending": 48 - passed}, "features": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if passed == 48 else 2


if __name__ == "__main__":
    raise SystemExit(main())
