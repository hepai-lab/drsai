import hashlib
import json
import os
import runpy
import subprocess
import sys
import zipfile
from pathlib import Path


def write_junit_index(path: Path, identity: dict, junit: Path) -> None:
    path.write_text(json.dumps({
        "schema_version": 2, "identity": identity, "result": "passed",
        "provenance": {"runner": "test", "acceptance_run_id": identity["acceptance_run_id"],
                       "apk_sha256": identity.get("apk_sha256"),
                       "started_at": "2026-08-02T00:00:00+00:00",
                       "completed_at": "2026-08-02T00:01:00+00:00"},
        "junit": [{"name": junit.name, "sha256": hashlib.sha256(junit.read_bytes()).hexdigest()}],
    }))


def test_stage7_isolated_device_runner_parses_only_complete_green_runs() -> None:
    repo = Path(__file__).parents[5]
    parse = runpy.run_path(str(repo / "apps/android/scripts/run-stage7-device-tests.py"))["parse_instrumentation"]
    green = """INSTRUMENTATION_STATUS: class=ai.drsai.remote.RuntimeTest
INSTRUMENTATION_STATUS: test=releases
INSTRUMENTATION_STATUS_CODE: 1
INSTRUMENTATION_STATUS: class=ai.drsai.remote.RuntimeTest
INSTRUMENTATION_STATUS: test=releases
INSTRUMENTATION_STATUS_CODE: 0
OK (1 test)
INSTRUMENTATION_CODE: -1
"""
    assert parse(green) == [{"classname": "ai.drsai.remote.RuntimeTest", "name": "releases"}]

    for invalid in (
        green.replace("INSTRUMENTATION_STATUS_CODE: 0", "INSTRUMENTATION_STATUS_CODE: -2"),
        green.replace("INSTRUMENTATION_CODE: -1", ""),
        green.replace("OK (1 test)", "FAILURES!!!"),
    ):
        try:
            parse(invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError("isolated runner accepted incomplete or failed instrumentation")


def test_stage7_local_junit_index_rejects_stale_reports(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity = {"acceptance_run_id": "run", "version_code": 1, "version_name": "1", "apk_sha256": "a" * 64}
    identity_file = tmp_path / "identity.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    junit = tmp_path / "junit.xml"
    junit.write_text('<testsuite tests="1" failures="0" errors="0"><testcase name="green"/></testsuite>')
    output = tmp_path / "index.json"
    command = [sys.executable, str(repo / "apps/android/scripts/index-stage7-junit.py"),
               "--identity-from", str(identity_file), "--junit", str(junit), "--runner", "test",
               "--output", str(output)]
    assert subprocess.run(command, check=False).returncode == 0
    os.utime(junit, (1, 1))
    assert subprocess.run(command, check=False).returncode == 2
    assert "junit_outside_freshness_window:junit.xml" in json.loads(output.read_text())["errors"]


def test_stage7_feature_contract_names_real_test_methods_exactly() -> None:
    repo = Path(__file__).parents[5]
    features = runpy.run_path(str(repo / "apps/android/scripts/generate-stage7-feature-evidence.py"))["FEATURES"]
    roots = [repo / "apps/android/app/src/test", repo / "apps/android/app/src/androidTest",
             repo / "cores/python/packages/drsai/tests"]
    test_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for root in roots for path in root.rglob("*") if path.suffix in {".kt", ".py"}
    )
    missing = sorted({token for _, tokens, _ in features.values() for token in tokens if token not in test_sources})
    assert missing == []


def test_stage7_android_security_boundaries_are_fail_closed(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    output = tmp_path / "boundaries.json"
    command = [
        sys.executable, str(repo / "apps/android/scripts/verify-stage7-android-security-boundaries.py"),
        "--repo", str(repo), "--output", str(output),
    ]
    assert subprocess.run(command, check=False).returncode == 0
    value = json.loads(output.read_text())
    assert value["result"] == "passed"
    assert value["checks"]["single_exported_entry"] is True
    assert value["checks"]["pending_intents_immutable"] is True


def test_stage7_candidate_builder_is_fail_closed() -> None:
    repo = Path(__file__).parents[5]
    script = (repo / "apps/android/scripts/build-stage7-runtime-candidate.ps1").read_text(encoding="utf-8")
    for contract in ("trusted_build_requires_clean_checkout", "testDebugUnitTest", "lintAcceptance",
                     "assembleAcceptance", "initialize-stage7-python-runtime-evidence.py",
                     "verify-stage7-android-security-boundaries.py", "verify-stage7-trusted-build.py",
                     "verify-stage7-python-runtime.py", "packageAcceptanceAndroidTest",
                     "opendrsai.android.testBuildType=acceptance", "run-stage7-device-tests.py",
                     "opendrsai.android.acceptanceVersion=$VersionName", "candidate_version_metadata_mismatch",
                     "PythonExecutable", "AndroidSdk", "android_sdk_missing",
                     "OPENDRSAI_ANDROID_BUILD_PYTHON",
                     "index-stage7-junit.py", "local-junit-index.json"):
        assert contract in script
    finalizer = (repo / "apps/android/scripts/finalize-stage7-acceptance.py").read_text(encoding="utf-8")
    assert finalizer.index("generate-stage7-feature-evidence.py") < finalizer.index("finalize-stage7-release-manifest.py")
    assert finalizer.index("finalize-stage7-release-manifest.py") < finalizer.index("verify-stage7-python-runtime.py")
    assert "aggregate-stage7-runtime-acceptance.py" in script


def test_stage7_evidence_schema_covers_identity_and_provenance() -> None:
    repo = Path(__file__).parents[5]
    schema = json.loads((repo / "cores/protocol/android-runtime/stage7-evidence.schema.json").read_text())
    assert schema["properties"]["identity"]["additionalProperties"] is False
    provenance = schema["properties"]["provenance"]
    assert provenance["additionalProperties"] is False
    assert {"runner", "started_at", "completed_at", "device_ids_sha256"} <= set(provenance["required"])


def test_stage7_verifier_binds_48_features_reports_and_apk(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"stage7-apk")
    identity = {
        "acceptance_run_id": "accept-1", "git_commit": "a" * 40, "git_dirty": False,
        "build_id": "build-1", "variant": "acceptance", "version_code": 200,
        "version_name": "2.0.0", "apk_sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
    }
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    provenance = {
        "runner": "androidx.test.runner.AndroidJUnitRunner", "acceptance_run_id": "accept-1",
        "package_version_code": 200, "package_version_name": "2.0.0",
        "apk_sha256": identity["apk_sha256"], "started_at": now, "completed_at": now,
        "device_ids_sha256": ["1" * 64],
    }
    junit_dir = evidence / "junit"
    junit_dir.mkdir()
    junit_report = junit_dir / "results.xml"
    junit_report.write_text('<testsuite><testcase classname="suite" name="test"/></testsuite>')
    junit_hash = hashlib.sha256(junit_report.read_bytes()).hexdigest()
    base = {"schema_version": 2, "identity": identity, "result": "passed", "provenance": provenance}
    upgrade = {
        **base,
        "report_schema_version": 3,
        "baseline": {"git_commit": "b" * 40, "version_code": 198, "version_name": "1.9.8"},
        "candidate": {"version_code": 200, "version_name": "2.0.0"},
        "rolled_back": {"version_code": 198, "version_name": "1.9.8"},
        "journey": [{"step": step, "status": "passed"} for step in (
            "seed_room_7_with_historical_code", "migrate_room_7_to_11_and_read_with_candidate",
            "platform_rollback_restore_snapshot", "read_restored_room_7_with_historical_code",
        )],
        "artifacts": {
            "baseline_apk": "1" * 64, "baseline_test_apk": "2" * 64,
            "candidate_apk": identity["apk_sha256"], "candidate_test_apk": "3" * 64,
        },
        "preserved": {key: True for key in (
            "encrypted_login_state", "local_session", "remote_association", "remote_session", "conversation_history"
        )},
        "migration": {"from_room_schema": 7, "to_room_schema": 11},
        "rollback_data_policy": "restore",
    }
    recovery = {**base, "scenarios": sorted({
        "waiting_model_process_death", "waiting_tool_before_execution", "tool_success_before_receipt",
        "waiting_approval", "approval_success_before_resume", "running_process_death", "paused_resume",
        "terminal_rejected", "cold_start_notification_reentry",
    }), "missing": []}
    side_effect = {**base, "scenarios": sorted({
        "tool_intent_receipt", "durable_receipt_replay", "approval_first_decision_wins",
        "artifact_operation_id", "needs_reconciliation", "audit_chain_query",
    }), "missing": [], "duplicate_user_visible_side_effects": 0,
        "audit_chain": ["intent", "approval", "execution", "receipt", "replay", "terminal", "reconciliation"]}
    ui = {**base, "journeys": sorted({"recovery_statuses", "cancel_idempotent", "activity_recreation",
                                      "notification_scope", "logout_cleanup", "fallback_status"}), "missing": []}
    device = {**base, "devices": [{"api": 35}], "checks": {key: True for key in (
        "api_26_30_35_36", "arm64", "x86_64", "physical_device",
        "all_reports_passed", "public_device_ids_hashed")}}
    security = {**base, "scans": [{"source": source, "status": "passed", "files_scanned": 1}
                                    for source in ("apk", "logcat", "app_data")],
                "findings": [], "checkpoint_receipt_scan": True}
    rollout = {**base, "drills": [{"id": item, "status": "passed"} for item in (
        "remote_kill_switch", "kotlin_lite_fallback", "apk_rollback", "data_readable_after_rollback")],
        "decision": {"action": "expand", "reason": "stage_gates_passed"},
        "incident_register": {"shape_valid": True, "critical_closed": True, "closed_loop_exercised": True}}
    source_path = "apps/android/scripts/verify-stage7-python-runtime.py"
    source_hash = hashlib.sha256((repo / source_path).read_bytes()).hexdigest()
    values = {
        "feature-evidence.json": {**base, "features": [
            {"feature_id": f"M{module:02d}-F{feature:02d}", "requirement_id": f"M{module:02d}-F{feature:02d}",
             "mapping_version": 2, "status": "passed", "evidence": {
                "sources": [{"path": source_path, "sha256": source_hash}],
                "tests": {"suite.test": {"passed": True, "report": "junit/results.xml", "sha256": junit_hash}},
                "reports": [{"path": "recovery-matrix.json", "result": "passed", "identity_match": True}],
            }}
            for module in range(1, 9) for feature in range(1, 7)
        ]},
        "recovery-matrix.json": recovery,
        "side-effect-consistency.json": side_effect,
        "ui-critical-journey.json": ui,
        "device-matrix.json": device,
        "device-performance.json": {**base, "metrics": {
            "cold_start_p95_ms": 3000, "recovery_interactive_p95_ms": 5000,
            "foreground_pss_p95_mb": 220, "peak_pss_mb": 320,
        }},
        "security-scan.json": security,
        "android-security-boundaries.json": {**base, "checks": {"all": True}},
        "trusted-build-audit.json": {**base, "checks": {"all": True}},
        "upgrade-rollback.json": upgrade,
        "rollout-drill.json": rollout,
    }
    for name, value in values.items():
        (evidence / name).write_text(json.dumps(value), encoding="utf-8")
    sbom = tmp_path / "sbom.json"
    sbom.write_text("{}")
    manifest = {
        **base, "immutable": True, "source": {"git_commit": identity["git_commit"], "git_dirty": False},
        "apk": {"path": str(apk), "sha256": identity["apk_sha256"]},
        "artifacts": [{"path": name, "sha256": hashlib.sha256((evidence / name).read_bytes()).hexdigest()}
                      for name in values],
        "external_artifacts": [{"kind": "sbom", "path": str(sbom),
                                "sha256": hashlib.sha256(sbom.read_bytes()).hexdigest()}],
        "mapping": {"status": "not_applicable", "reason": "acceptance_variant_not_minified"},
        "rollback_version": "1.9.0",
    }
    manifest["artifacts"].append({"path": "junit/results.xml", "sha256": junit_hash})
    values["release-manifest.json"] = manifest
    (evidence / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    output = evidence / "acceptance-verification.json"
    command = [
        sys.executable, str(repo / "apps/android/scripts/verify-stage7-python-runtime.py"),
        "--evidence", str(evidence), "--apk", str(apk), "--output", str(output),
    ]
    assert subprocess.run(command, check=False).returncode == 0
    assert json.loads(output.read_text())["decision"] == "GO"

    valid_recovery = json.loads(json.dumps(values["recovery-matrix.json"]))
    values["recovery-matrix.json"]["scenarios"] = []
    (evidence / "recovery-matrix.json").write_text(json.dumps(values["recovery-matrix.json"]), encoding="utf-8")
    assert subprocess.run(command, check=False).returncode == 2
    assert "scenario_coverage_invalid:recovery-matrix.json" in json.loads(output.read_text())["errors"]
    values["recovery-matrix.json"] = valid_recovery
    (evidence / "recovery-matrix.json").write_text(json.dumps(valid_recovery), encoding="utf-8")

    values["security-scan.json"]["identity"] = {**identity, "acceptance_run_id": "stale-run"}
    (evidence / "security-scan.json").write_text(json.dumps(values["security-scan.json"]), encoding="utf-8")
    assert subprocess.run(command, check=False).returncode == 2
    result = json.loads(output.read_text())
    assert result["decision"] == "NO_GO"
    assert "identity_mismatch:security-scan.json" in result["errors"]

    values["security-scan.json"]["identity"] = identity
    del values["security-scan.json"]["provenance"]
    (evidence / "security-scan.json").write_text(json.dumps(values["security-scan.json"]), encoding="utf-8")
    assert subprocess.run(command, check=False).returncode == 2
    assert "provenance_missing:security-scan.json" in json.loads(output.read_text())["errors"]

    values["security-scan.json"] = {**base, "schema_version": 1}
    (evidence / "security-scan.json").write_text(json.dumps(values["security-scan.json"]), encoding="utf-8")
    assert subprocess.run(command, check=False).returncode == 2
    assert "schema_version_invalid:security-scan.json" in json.loads(output.read_text())["errors"]

    values["security-scan.json"] = base
    (evidence / "security-scan.json").write_text(json.dumps(base), encoding="utf-8")
    values["feature-evidence.json"]["features"][0]["evidence"]["sources"][0]["sha256"] = "0" * 64
    (evidence / "feature-evidence.json").write_text(json.dumps(values["feature-evidence.json"]), encoding="utf-8")
    assert subprocess.run(command, check=False).returncode == 2
    assert "feature_evidence_invalid:M01-F01" in json.loads(output.read_text())["errors"]


def test_stage7_feature_generator_cannot_promote_a_whole_module_from_one_class(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    identity = {"acceptance_run_id": "run"}
    identity_file = evidence / "release-manifest.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    for name in ("recovery-matrix.json", "side-effect-consistency.json", "ui-critical-journey.json",
                 "device-matrix.json", "device-performance.json", "security-scan.json",
                 "android-security-boundaries.json", "trusted-build-audit.json",
                 "upgrade-rollback.json", "rollout-drill.json"):
        (evidence / name).write_text(json.dumps({"identity": identity, "result": "passed"}))
    junit = tmp_path / "junit.xml"
    junit.write_text('<testsuite><testcase classname="PythonRunRecoveryTest" name="generic module test"/></testsuite>')
    index = tmp_path / "junit-index.json"
    write_junit_index(index, identity, junit)
    output = evidence / "features.json"
    command = [sys.executable, str(repo / "apps/android/scripts/generate-stage7-feature-evidence.py"),
               "--repo", str(repo), "--evidence", str(evidence), "--identity-from", str(identity_file),
               "--android-junit", str(junit), "--junit-index", str(index), "--output", str(output)]
    assert subprocess.run(command, check=False).returncode == 2
    value = json.loads(output.read_text())
    assert value["summary"] == {"total": 48, "passed": 0, "pending": 48}
    assert all(row["requirement_id"] == row["feature_id"] and row["mapping_version"] == 2 for row in value["features"])
    junit.write_text('<testsuite><testcase classname="Tampered" name="replacement"/></testsuite>')
    rejected = subprocess.run(command, check=False, capture_output=True, text=True)
    assert rejected.returncode == 1
    assert "junit_not_bound_to_acceptance_run" in rejected.stderr


def test_stage7_feature_generator_rejects_green_case_from_failed_suite(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    identity = {"acceptance_run_id": "run"}
    identity_file = evidence / "release-manifest.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    for name in ("recovery-matrix.json", "ui-critical-journey.json"):
        (evidence / name).write_text(json.dumps({"identity": identity, "result": "passed"}))
    junit = tmp_path / "failed-suite.xml"
    junit.write_text(
        '<testsuite tests="2" failures="1" errors="0">'
        '<testcase classname="PythonRunRecoveryTest" '
        'name="builds versioned resume command from latest nonterminal checkpoint"/>'
        '<testcase classname="OtherTest" name="fails"><failure>boom</failure></testcase>'
        '</testsuite>'
    )
    index = tmp_path / "junit-index.json"
    write_junit_index(index, identity, junit)
    output = evidence / "features.json"
    command = [sys.executable, str(repo / "apps/android/scripts/generate-stage7-feature-evidence.py"),
               "--repo", str(repo), "--evidence", str(evidence), "--identity-from", str(identity_file),
               "--android-junit", str(junit), "--junit-index", str(index), "--output", str(output)]
    assert subprocess.run(command, check=False).returncode == 2
    feature = next(row for row in json.loads(output.read_text())["features"] if row["feature_id"] == "M01-F01")
    assert feature["status"] == "pending"
    assert not next(iter(feature["evidence"]["tests"].values()))["passed"]


def test_stage7_initializer_is_honest_and_identity_consistent(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"candidate")
    evidence = tmp_path / "evidence"
    command = [
        sys.executable, str(repo / "apps/android/scripts/initialize-stage7-python-runtime-evidence.py"),
        "--repo", str(repo), "--apk", str(apk), "--output", str(evidence),
        "--variant", "acceptance", "--version-code", "200", "--version-name", "2.0.0",
        "--acceptance-run-id", "accept-1", "--build-id", "build-1",
    ]
    subprocess.run(command, check=True)
    feature = json.loads((evidence / "feature-evidence.json").read_text())
    manifest = json.loads((evidence / "release-manifest.json").read_text())
    recovery = json.loads((evidence / "recovery-matrix.json").read_text())
    assert feature["summary"] == {"total": 48, "passed": 0, "pending": 48}
    assert recovery["result"] == "pending"
    assert feature["identity"] == recovery["identity"] == manifest["identity"]
    assert manifest["immutable"] is True
    assert all(item["sha256"] == hashlib.sha256((evidence / item["path"]).read_bytes()).hexdigest()
               for item in manifest["artifacts"])


def test_stage7_provenance_stamper_rejects_raw_or_mismatched_evidence(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity = {"acceptance_run_id": "run", "version_code": 1, "version_name": "1", "apk_sha256": "a" * 64}
    source = tmp_path / "identity.json"
    report = tmp_path / "report.json"
    source.write_text(json.dumps({"identity": identity}))
    report.write_text(json.dumps({"identity": identity, "result": "passed"}))
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    command = [sys.executable, str(repo / "apps/android/scripts/stamp-stage7-report-provenance.py"),
               "--report", str(report), "--identity-from", str(source), "--runner", "runner",
               "--started-at", now, "--completed-at", now, "--device-id-sha256", "b" * 64]
    assert subprocess.run(command, check=False).returncode == 0
    assert json.loads(report.read_text())["provenance"]["device_ids_sha256"] == ["b" * 64]
    command[-1] = "raw-serial"
    assert subprocess.run(command, check=False).returncode != 0


def test_stage7_security_collector_requires_all_three_clean_sources(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity_file = tmp_path / "feature.json"
    identity_file.write_text(json.dumps({"identity": {"acceptance_run_id": "run"}}))
    apk, logcat, app_data = tmp_path / "app.apk", tmp_path / "logcat.txt", tmp_path / "data"
    with zipfile.ZipFile(apk, "w") as archive:
        archive.writestr("classes.dex", b"clean apk")
    logcat.write_text("safe log")
    app_data.mkdir()
    (app_data / "checkpoint.json").write_text('{"checkpoint":{"phase":"running"}}')
    output = tmp_path / "security.json"
    device_run = tmp_path / "device-run.json"
    device_run.write_text(json.dumps({
        "schema_version": 2, "identity": {"acceptance_run_id": "run"}, "result": "passed",
        "provenance": {"runner": "device", "started_at": "2026-08-02T00:00:00+00:00",
                       "completed_at": "2026-08-02T00:01:00+00:00", "device_ids_sha256": ["d" * 64]},
    }))
    command = [
        sys.executable, str(repo / "apps/android/scripts/collect-stage7-security-evidence.py"),
        "--identity-from", str(identity_file), "--apk", str(apk), "--logcat", str(logcat),
        "--app-data", str(app_data), "--device-run", str(device_run), "--output", str(output),
    ]
    assert subprocess.run(command, check=False).returncode == 0
    assert json.loads(output.read_text())["result"] == "passed"
    assert json.loads(output.read_text())["scans"][0]["files_scanned"] == 1

    logcat.write_text("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")
    assert subprocess.run(command, check=False).returncode == 2
    report = json.loads(output.read_text())
    assert report["result"] == "failed"
    assert any(item["rule"] == "bearer" for item in report["findings"])


def test_stage7_runtime_scenario_generator_has_complete_fail_closed_mapping() -> None:
    repo = Path(__file__).parents[5]
    module = runpy.run_path(str(repo / "apps/android/scripts/generate-stage7-runtime-scenarios.py"), run_name="stage7_scenarios")
    mapping = module["MAPPING"]
    assert {key: len(value) for key, value in mapping.items()} == {"recovery": 9, "side_effect": 6, "ui": 6}
    mapped = {test_id for scenarios in mapping.values() for test_id in scenarios.values()}
    assert module["DEVICE_TESTS"] <= mapped
    assert set(module["AUDIT_PHASES"]) <= set(mapping["side_effect"])


def test_stage7_device_matrix_requires_api_abi_coverage_and_one_physical_device(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity = {"acceptance_run_id": "run-1", "version_code": 1, "version_name": "1", "apk_sha256": "a" * 64}
    identity_file = tmp_path / "feature.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    specs = [
        (26, "x86_64", "AOSP", "emulator", 2048),
        (30, "arm64-v8a", "Samsung", "physical_device", 4096),
        (35, "arm64-v8a", "Google", "physical_device", 4096),
        (36, "x86_64", "AOSP", "emulator", 4096),
    ]
    reports = []
    for index, (api, abi, manufacturer, kind, memory) in enumerate(specs):
        path = tmp_path / f"device-{index}.json"
        path.write_text(json.dumps({
            "schema_version": 2, "identity": identity, "result": "passed",
            "provenance": {"runner": "runner", "started_at": "2026-08-02T00:00:00+00:00",
                           "completed_at": "2026-08-02T01:00:00+00:00", "device_ids_sha256": [str(index) * 64]},
            "environment": {
                "device_id_sha256": str(index) * 64, "device_id_scheme": "stage7-device-v1", "api": api, "abi": abi,
                "manufacturer": manufacturer, "model": f"model-{index}", "kind": kind,
                "memory_mb": memory,
            },
        }))
        reports.append(path)
    output = tmp_path / "matrix.json"
    command = [
        sys.executable, str(repo / "apps/android/scripts/aggregate-stage7-device-matrix.py"),
        "--identity-from", str(identity_file), "--output", str(output),
        *sum((["--report", str(path)] for path in reports), []),
    ]
    assert subprocess.run(command, check=False).returncode == 0
    matrix = json.loads(output.read_text())
    assert matrix["result"] == "passed"
    assert matrix["checks"]["physical_device"] is True
    for path in reports:
        value = json.loads(path.read_text())
        value["environment"]["kind"] = "emulator"
        path.write_text(json.dumps(value))
    assert subprocess.run(command, check=False).returncode == 2
    assert json.loads(output.read_text())["checks"]["physical_device"] is False
    value = json.loads(reports[2].read_text())
    value["environment"]["kind"] = "physical_device"
    reports[2].write_text(json.dumps(value))
    value = json.loads(reports[0].read_text())
    value["environment"]["serial"] = "private"
    reports[0].write_text(json.dumps(value))
    assert subprocess.run(command, check=False).returncode == 2
    assert "raw_device_serial_forbidden:device-0.json" in json.loads(output.read_text())["errors"]


def test_stage7_device_performance_aggregator_enforces_production_thresholds(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity = {"acceptance_run_id": "run", "version_code": 1, "version_name": "1", "apk_sha256": "a" * 64}
    identity_file = tmp_path / "identity.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    report = tmp_path / "performance-run.json"
    provenance = {"runner": "runner", "started_at": "2026-08-02T00:00:00+00:00",
                  "completed_at": "2026-08-02T01:00:00+00:00", "apk_sha256": "a" * 64,
                  "device_ids_sha256": ["b" * 64]}
    metrics = {"cold_start_p95_ms": 500, "foreground_pss_p95_mb": 120,
               "peak_pss_mb": 140, "runtime_release_verified": True}
    value = {"schema_version": 2, "identity": identity, "provenance": provenance, "result": "passed",
             "environment": {"device_id_sha256": "b" * 64, "kind": "physical_device"},
             "reports": [{"performance": metrics}]}
    report.write_text(json.dumps(value))
    output = tmp_path / "device-performance.json"
    command = [sys.executable, str(repo / "apps/android/scripts/aggregate-stage7-device-performance.py"),
               "--identity-from", str(identity_file), "--report", str(report), "--output", str(output)]
    assert subprocess.run(command, check=False).returncode == 0
    assert json.loads(output.read_text())["result"] == "passed"
    value["reports"][0]["performance"]["peak_pss_mb"] = 321
    report.write_text(json.dumps(value))
    assert subprocess.run(command, check=False).returncode == 2
    assert json.loads(output.read_text())["checks"]["peak_pss_le_320_mb"] is False


def test_stage7_samsung_collector_binds_identity_and_forbids_stale_log_reuse() -> None:
    repo = Path(__file__).parents[5]
    source = (repo / "apps/android/scripts/collect-python-runtime-samsung-evidence.py").read_text(encoding="utf-8")
    assert '"schema_version": 2' in source
    assert "samsung_candidate_apk_identity_mismatch" in source
    assert "reused_logcat_acceptance_run_id_mismatch" in source
    assert '"device_id_sha256"' in source
    generic = (repo / "apps/android/scripts/collect-stage7-device-profile.py").read_text(encoding="utf-8")
    assert "device_run_report_not_passed_or_identity_mismatch" in generic
    assert "device_run_provenance_hash_mismatch" in generic
    assert 'choices=("physical_device", "emulator")' in generic


def test_stage7_runtime_acceptance_aggregator_requires_every_scenario(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity = {"acceptance_run_id": "run", "version_code": 1, "version_name": "1", "apk_sha256": "a" * 64}
    identity_file = tmp_path / "identity.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    provenance = {"runner": "runner", "started_at": "2026-08-02T00:00:00+00:00",
                  "completed_at": "2026-08-02T01:00:00+00:00", "device_ids_sha256": ["b" * 64]}
    scenario_ids = {
        "recovery": ["waiting_model_process_death", "waiting_tool_before_execution", "tool_success_before_receipt",
                     "waiting_approval", "approval_success_before_resume", "running_process_death", "paused_resume",
                     "terminal_rejected", "cold_start_notification_reentry"],
        "side_effect": ["tool_intent_receipt", "durable_receipt_replay", "approval_first_decision_wins",
                        "artifact_operation_id", "needs_reconciliation", "audit_chain_query"],
        "ui": ["recovery_statuses", "cancel_idempotent", "activity_recreation", "notification_scope",
               "logout_cleanup", "fallback_status"],
    }
    paths = []
    for category, ids in scenario_ids.items():
        for scenario_id in ids:
            path = tmp_path / f"{category}-{scenario_id}.json"
            value = {"schema_version": 2, "identity": identity, "provenance": provenance, "result": "passed",
                     "category": category, "scenario_id": scenario_id}
            if category == "recovery": value["interactive_ms"] = 1000
            if category == "side_effect":
                value["duplicate_user_visible_side_effects"] = 0
                value["audit_phases"] = ["intent", "approval", "execution", "receipt", "replay", "terminal", "reconciliation"]
            path.write_text(json.dumps(value))
            paths.append(path)
    performance = tmp_path / "performance.json"
    performance.write_text(json.dumps({"schema_version": 2, "identity": identity, "provenance": provenance,
        "result": "passed", "metrics": {"cold_start_p95_ms": 2000, "foreground_pss_p95_mb": 200, "peak_pss_mb": 250}}))
    output = tmp_path / "evidence"
    command = [sys.executable, str(repo / "apps/android/scripts/aggregate-stage7-runtime-acceptance.py"),
               "--identity-from", str(identity_file), "--performance-report", str(performance), "--output", str(output)]
    for path in paths: command += ["--scenario-report", str(path)]
    assert subprocess.run(command, check=False).returncode == 0
    assert json.loads((output / "side-effect-consistency.json").read_text())["result"] == "passed"
    assert json.loads((output / "device-performance.json").read_text())["metrics"]["recovery_interactive_p95_ms"] == 1000
    device_performance = tmp_path / "device-performance.json"
    device_performance.write_text(json.dumps({
        "schema_version": 2, "identity": identity, "provenance": provenance, "result": "passed",
        "reports": [{"performance": {"cold_start_p95_ms": 1900,
                                      "foreground_pss_p95_mb": 190, "peak_pss_mb": 240}}],
    }))
    device_command = [device_performance if item == str(performance) else item for item in command]
    assert subprocess.run([str(item) for item in device_command], check=False).returncode == 0
    assert json.loads((output / "device-performance.json").read_text())["metrics"]["cold_start_p95_ms"] == 1900
    assert subprocess.run(command[:-2], check=False).returncode == 2
    assert json.loads((output / "ui-critical-journey.json").read_text())["missing"] == ["fallback_status"]


def test_stage7_upgrade_runner_fails_closed_before_migration_when_platform_snapshot_fails() -> None:
    repo = Path(__file__).parents[5]
    source = (repo / "apps/android/scripts/run-python-runtime-upgrade-rollback.py").read_text(encoding="utf-8")
    marker = source.index("STAGE7_ROLLBACK_SNAPSHOT_")
    snapshot_check = source.index("platform_snapshot_creation_failed")
    candidate_verification = source.index('CANDIDATE_TEST_CLASS, "verifyLegacyUpgradeState"')
    assert marker < snapshot_check < candidate_verification
    assert "rollback_snapshot_log_boundary_missing" in source
    assert '"result": "failed"' in source
    assert 'encoding="utf-8", errors="replace"' in source


def test_stage7_candidate_builder_forces_fresh_android_junit() -> None:
    repo = Path(__file__).parents[5]
    source = (repo / "apps/android/scripts/build-stage7-runtime-candidate.ps1").read_text(encoding="utf-8")
    assert "testDebugUnitTest --rerun-tasks --no-daemon" in source
    assert "android_jvm_verification_failed" in source


def test_stage7_log_boundaries_select_the_latest_retry_marker() -> None:
    repo = Path(__file__).parents[5]
    device = (repo / "apps/android/scripts/run-stage7-device-tests.py").read_text(encoding="utf-8")
    upgrade = (repo / "apps/android/scripts/run-python-runtime-upgrade-rollback.py").read_text(encoding="utf-8")
    assert "full_logcat.rfind(log_marker)" in device
    assert "rollback_log.rfind(snapshot_marker)" in upgrade


def test_stage7_compatible_rollback_is_oem_independent_and_fail_closed() -> None:
    repo = Path(__file__).parents[5]
    source = (repo / "apps/android/scripts/run-stage7-compatible-rollback.py").read_text(encoding="utf-8")
    assert '"install", "-r", "-d", "-t"' in source
    assert "compatible_rollback_candidate_identity_mismatch" in source
    assert "read_current_schema_after_compatible_rollback" in source
    assert "python_checkpoint" in source


def test_stage7_manifest_finalizer_hashes_final_reports_and_sbom(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"candidate")
    identity = {
        "acceptance_run_id": "run", "git_commit": "a" * 40, "git_dirty": False,
        "build_id": "build", "variant": "acceptance", "version_code": 1,
        "version_name": "1.0", "apk_sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
    }
    identity_file = evidence / "feature-evidence.json"
    identity_file.write_text(json.dumps({"identity": identity, "features": []}))
    report = evidence / "security-scan.json"
    report.write_text(json.dumps({"identity": identity, "result": "pending"}))
    sbom = tmp_path / "sbom.json"
    sbom.write_text("{}")
    manifest = evidence / "release-manifest.json"
    command = [
        sys.executable, str(repo / "apps/android/scripts/finalize-stage7-release-manifest.py"),
        "--evidence", str(evidence), "--identity-from", str(identity_file), "--apk", str(apk),
        "--source-sbom", str(sbom), "--rollback-version", "0.9", "--output", str(manifest),
    ]
    subprocess.run(command, check=True)
    value = json.loads(manifest.read_text())
    assert value["rollback_version"] == "0.9"
    hashes = {item["path"]: item["sha256"] for item in value["artifacts"]}
    assert hashes["security-scan.json"] == hashlib.sha256(report.read_bytes()).hexdigest()
    assert value["external_artifacts"][0]["sha256"] == hashlib.sha256(sbom.read_bytes()).hexdigest()
    assert value["external_artifacts"][0]["kind"] == "sbom"
    assert value["mapping"] == {"status": "not_applicable", "reason": "acceptance_variant_not_minified"}


def test_stage7_rollout_report_requires_all_rollback_drills(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    identity = {"acceptance_run_id": "run"}
    identity_file = tmp_path / "feature.json"
    identity_file.write_text(json.dumps({"identity": identity}))
    metrics = tmp_path / "metrics.json"
    metrics.write_text(json.dumps({
        "identity": identity, "samples": 100,
        "started_at": "2026-07-30T00:00:00+00:00", "completed_at": "2026-08-02T00:00:00+00:00",
        "recovery_attempts": 100, "recovery_failures": 0,
        "provenance": {"runner": "beta-observer", "acceptance_run_id": "run",
                       "started_at": "2026-07-30T00:00:00+00:00", "completed_at": "2026-08-02T00:00:00+00:00",
                       "device_ids_sha256": ["e" * 64]},
    }))
    drills = tmp_path / "drills.json"
    drills.write_text(json.dumps({"identity": identity, "drills": [
        {"id": item, "status": "passed"} for item in (
            "remote_kill_switch", "kotlin_lite_fallback", "apk_rollback", "data_readable_after_rollback"
        )
    ]}))
    incidents = tmp_path / "incidents.json"
    incidents.write_text(json.dumps({"identity": identity, "incidents": [{
        "diagnostic_id": "diag-1", "severity": "critical", "owner": "runtime-oncall",
        "target_fix_version": "2.0.1", "state": "verified", "source": "exercise",
    }]}))
    output = tmp_path / "rollout.json"
    command = [
        sys.executable, str(repo / "apps/android/scripts/evaluate-stage7-beta-rollout.py"),
        "--identity-from", str(identity_file), "--metrics", str(metrics), "--drills", str(drills),
        "--incidents", str(incidents),
        "--stage", "beta_1", "--policy-version", "policy-7", "--output", str(output),
    ]
    assert subprocess.run(command, check=False).returncode == 0
    assert json.loads(output.read_text())["decision"] == {"action": "expand", "reason": "stage_gates_passed"}
    value = json.loads(drills.read_text())
    value["drills"].pop()
    drills.write_text(json.dumps(value))
    assert subprocess.run(command, check=False).returncode == 2
    assert json.loads(output.read_text())["result"] == "pending"

    value["drills"].append({"id": "data_readable_after_rollback", "status": "passed"})
    drills.write_text(json.dumps(value))
    incident_value = json.loads(incidents.read_text())
    incident_value["incidents"][0]["state"] = "investigating"
    incidents.write_text(json.dumps(incident_value))
    assert subprocess.run(command, check=False).returncode == 2
    assert json.loads(output.read_text())["incident_register"]["critical_closed"] is False


def test_stage7_internal_acceptance_has_no_elapsed_time_or_sample_gate() -> None:
    repo = Path(__file__).parents[5]
    module = runpy.run_path(str(repo / "apps/android/scripts/evaluate-stage7-beta-rollout.py"), run_name="rollout")
    assert module["STAGES"]["internal"] == (0, 0)
    assert module["decide"]("internal", {"samples": 0, "observation_hours": 0}) == (
        "expand", "stage_gates_passed"
    )
