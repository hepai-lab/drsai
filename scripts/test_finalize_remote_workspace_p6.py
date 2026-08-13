from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

import assemble_remote_workspace_p6_evidence as assembler
import finalize_remote_workspace_p6 as finalizer
import finalize_remote_workspace_p6_product_acceptance as product_finalizer
import finalize_remote_workspace_stability_p6 as stability_finalizer


def _ref(root: Path, relative: str) -> dict:
    raw = (root / relative).read_bytes()
    return {"artifact": relative, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def _fixture(tmp_path: Path) -> tuple[dict, dict]:
    root = tmp_path
    (root / "builds").mkdir(parents=True)
    build_specs = [
        ("android", "ai.drsai.remote", "builds/android-release.apk"),
        ("windows", "OpenDrSaiDesktop", "builds/windows-release.msi"),
        ("relay", "opendrsai-runtime-relay", "builds/relay-release.oci"),
    ]
    builds = []
    source_revision = "4" * 40
    relay_revision = "1" * 40
    for platform, identity, relative in build_specs:
        (root / relative).write_bytes(f"p6 {platform} release artifact".encode())
        builds.append({"build_id": platform, "platform": platform, "type": "release",
                       "version": "2.0.0",
                       "revision": relay_revision if platform == "relay" else source_revision,
                       "identity": identity, "artifact": relative})
    build_sha256s = [hashlib.sha256((root / row["artifact"]).read_bytes()).hexdigest() for row in builds]
    environment = {
        "environment_id": "p6-test-environment",
        "relay_origin": "https://relay.example",
        "runtime_release": "2.0.0",
        "relay_revision": relay_revision,
        "relay_contract_sha256": "2" * 64,
        "oaep_schema_sha256": "3" * 64,
    }
    requirements = json.loads(finalizer.REQUIREMENTS.read_text(encoding="utf-8"))["features"]
    required_by_kind = {
        kind: sorted(row["id"] for row in requirements if kind in row["required_kinds"])
        for kind in sorted(finalizer.EVIDENCE_KINDS)
    }
    device_proofs = ["a" * 64, "b" * 64]
    (root / "raw").mkdir()
    (root / "reports").mkdir()

    def report(name: str, *, report_type: str, evidence_id: str, kind: str,
               features: list[str], proofs: list[str],
               raw_refs: list[dict] | None = None) -> str:
        if raw_refs is None:
            raw_relative = f"raw/{name}.bin"
            (root / raw_relative).write_bytes(f"authoritative raw evidence {name}".encode())
            raw_refs = [_ref(root, raw_relative)]
        value = {
            "schema_version": "p6-evidence-report/1",
            "report_type": report_type,
            "evidence_id": evidence_id,
            "kind": kind,
            "environment_id": environment["environment_id"],
            "source_revision": source_revision,
            "feature_ids": features,
            "build_sha256s": build_sha256s,
            "physical_device_proof_sha256s": proofs,
            "checks": [{"id": f"{name}_authoritative_check", "passed": True}],
            "raw_artifacts": raw_refs,
            "passed": True,
        }
        relative = f"reports/{name}.json"
        (root / relative).write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        return relative

    device_reports = [
        report("device-a", report_type="physical_device", evidence_id="ev_device_a",
               kind="physical", features=["P6-M08-F04"], proofs=[device_proofs[0]]),
        report("device-b", report_type="physical_device", evidence_id="ev_device_b",
               kind="physical", features=["P6-M08-F04"], proofs=[device_proofs[1]]),
    ]
    endpoint_reports = {
        "windows": report("windows", report_type="windows", evidence_id="ev_windows_endpoint",
                          kind="release", features=["P6-M08-F04"], proofs=[]),
        "relay": report("relay", report_type="relay", evidence_id="ev_relay_endpoint",
                        kind="production", features=["P6-M08-F04"], proofs=[]),
    }
    product_journeys = []
    product_start = datetime(2026, 8, 12, 8, tzinfo=timezone.utc)
    for index, (name, invariants) in enumerate(product_finalizer.JOURNEY_INVARIANTS.items()):
        proof_relative = f"raw/product-{index:02d}.bin"
        (root / proof_relative).write_bytes(f"product journey proof {index}".encode())
        sequenced = name in product_finalizer.SEQUENCED
        product_journeys.append({
            "name": name, "status": "passed",
            "started_at": (product_start + timedelta(seconds=index * 2)).isoformat(),
            "completed_at": (product_start + timedelta(seconds=index * 2 + 1)).isoformat(),
            "elapsed_ms": 1000,
            "threshold_ms": 30000 if name == "runtime_relay_restart_recovery" else 2000,
            "device_proof_sha256s": device_proofs if name == "targeted_device_revoke"
            else [device_proofs[index % 2]],
            "windows_observed": True, "android_observed": True, "relay_observed": True,
            "sequence_start": index * 10 if sequenced else None,
            "sequence_end": index * 10 + 2 if sequenced else None,
            "invariants": sorted(invariants),
            "proof_artifacts": [_ref(root, proof_relative)],
        })
    product = {
        "schema_version": "p6-product-acceptance/1",
        "environment_id": environment["environment_id"], "source_revision": source_revision,
        "build_sha256s": build_sha256s, "device_proof_sha256s": device_proofs,
        "test_variant": "release", "app_package": "ai.drsai.remote",
        "desktop_product": "OpenDrSaiDesktop", "relay_service": "opendrsai-runtime-relay",
        "journeys": product_journeys,
        "accessibility_checks": sorted(product_finalizer.ACCESSIBILITY),
        "accessibility_violations": 0, "open_p0_count": 0, "open_p1_count": 0,
        "raw_sensitive_content_exported": False, "human_confirmed": True, "passed": True,
    }
    product_relative = "reports/product-acceptance.json"
    (root / product_relative).write_text(json.dumps(product, sort_keys=True), encoding="utf-8")
    product_ref = _ref(root, product_relative)
    stability_boundaries = []
    for name in sorted(stability_finalizer.BOUNDARIES):
        proof_relative = f"raw/stability-boundary-{name}.bin"
        (root / proof_relative).write_bytes(f"stability boundary proof {name}".encode())
        device = device_proofs[0] if name == "android_a" else device_proofs[1] if name == "android_b" else None
        stability_boundaries.append({
            "name": name, "device_proof_sha256": device, "transcript_sha256": "f" * 64,
            "first_sequence": 10, "last_sequence": 110, "sample_count": 360,
            "proof": _ref(root, proof_relative),
        })
    stability_faults = []
    for name in sorted(stability_finalizer.FAULTS):
        proof_relative = f"raw/stability-fault-{name}.bin"
        (root / proof_relative).write_bytes(f"stability fault proof {name}".encode())
        stability_faults.append({
            "name": name, "status": "passed", "recovery_seconds": 10,
            "sequence_preserved": True, "transcript_preserved": True,
            "duplicate_sequence_count": 0, "missing_sequence_count": 0,
            "reexecuted_side_effect_count": 0,
            "affected_boundaries": sorted(stability_finalizer.FAULT_BOUNDARIES[name]),
            "proof": _ref(root, proof_relative),
        })
    stability = {
        "schema_version": "p6-stability/1", "environment_id": environment["environment_id"],
        "source_revision": source_revision, "build_sha256s": build_sha256s,
        "device_proof_sha256s": device_proofs, "test_variant": "release",
        "required_duration_seconds": 3600, "observed_duration_seconds": 3601,
        "sample_count": 360, "probe_error_count": 0, "duplicate_sequence_count": 0,
        "missing_sequence_count": 0, "reexecuted_side_effect_count": 0,
        "relay_latency_p95_ms": 500, "windows_memory_slope_bytes_per_second": 100,
        "windows_handle_slope_per_second": 0.001, "transcript_sha256": "f" * 64,
        "boundaries": stability_boundaries, "faults": stability_faults, "passed": True,
    }
    stability_relative = "reports/stability.json"
    (root / stability_relative).write_text(json.dumps(stability, sort_keys=True), encoding="utf-8")
    stability_ref = _ref(root, stability_relative)
    evidence_reports = []
    evidence_id_by_kind = {}
    for kind in sorted(finalizer.EVIDENCE_KINDS):
        evidence_id = f"ev_{kind}_complete"
        evidence_id_by_kind[kind] = evidence_id
        evidence_reports.append(report(
            f"feature-{kind}", report_type="feature", evidence_id=evidence_id,
            kind=kind, features=required_by_kind[kind],
            proofs=device_proofs if kind in {"physical", "human"} else [],
            raw_refs=[product_ref] if kind == "human" else [stability_ref] if kind == "physical" else None,
        ))
    transition_relative = "reports/p5-transition.json"
    (root / transition_relative).write_bytes(finalizer.TRANSITION.read_bytes())
    feature_evidence = {
        row["id"]: [evidence_id_by_kind[kind] for kind in row["required_kinds"]]
        for row in requirements
    }
    manifest = {
        "schema_version": "p6-evidence-manifest/1",
        "source_revision": source_revision,
        "environment": environment,
        "builds": builds,
        "device_reports": device_reports,
        "endpoint_reports": endpoint_reports,
        "evidence_reports": evidence_reports,
        "feature_evidence": feature_evidence,
        "p5_transition_artifact": transition_relative,
    }
    ledger = assembler.assemble(manifest, root)
    return manifest, ledger


def test_assembler_and_finalizer_accept_exactly_40_current_p6_features(tmp_path: Path) -> None:
    _, ledger = _fixture(tmp_path)
    assert finalizer.finalize(ledger, tmp_path) == {
        "schema_version": "p6-finalization/1", "status": "passed",
        "features": 40, "errors": [],
    }


def test_cli_assembler_and_finalizer_round_trip(tmp_path: Path) -> None:
    manifest, _ = _fixture(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    ledger_path = tmp_path / "ledger.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    assembled = subprocess.run([
        sys.executable, str(Path(__file__).with_name("assemble_remote_workspace_p6_evidence.py")),
        str(manifest_path), str(ledger_path), "--artifact-root", str(tmp_path),
    ], capture_output=True, text=True, check=False)
    assert assembled.returncode == 0, assembled.stderr
    finalized = subprocess.run([
        sys.executable, str(Path(__file__).with_name("finalize_remote_workspace_p6.py")),
        str(ledger_path), "--artifact-root", str(tmp_path),
    ], capture_output=True, text=True, check=False)
    assert finalized.returncode == 0, finalized.stderr
    assert json.loads(finalized.stdout)["features"] == 40


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda value: value["features"].pop(), "p6_schema_validation_failed"),
        (lambda value: value["builds"][0].__setitem__("type", "debug"), "p6_schema_validation_failed"),
        (lambda value: value["devices"][1].__setitem__(
            "device_proof_sha256", value["devices"][0]["device_proof_sha256"]
        ), "p6_distinct_physical_devices_required"),
        (lambda value: value["devices"][0].__setitem__("emulator", True), "p6_schema_validation_failed"),
        (lambda value: value.__setitem__("completion_inherited", True), "p6_schema_validation_failed"),
        (lambda value: value["features"][0].__setitem__("id", "P5-M01-F01"), "p6_schema_validation_failed"),
        (lambda value: value["builds"][0].__setitem__("revision", "9" * 40), "p6_build_revision_mismatch"),
    ],
)
def test_old_debug_emulator_duplicate_or_incomplete_ledgers_fail_closed(
    tmp_path: Path, mutate, code: str,
) -> None:
    _, ledger = _fixture(tmp_path)
    mutate(ledger)
    assert code in finalizer.finalize(ledger, tmp_path)["errors"]


def test_mixed_environment_forged_summary_and_bad_raw_digest_fail_closed(tmp_path: Path) -> None:
    _, ledger = _fixture(tmp_path)
    report_ref = next(row["report"] for row in ledger["evidence"] if row["kind"] == "local")
    report_path = tmp_path / report_ref["artifact"]
    report = json.loads(report_path.read_text())
    report["environment_id"] = "different-environment"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    report_ref.update(_ref(tmp_path, report_ref["artifact"]))
    assert "p6_evidence_report_binding_invalid" in finalizer.finalize(ledger, tmp_path)["errors"]

    _, ledger = _fixture(tmp_path / "forged")
    root = tmp_path / "forged"
    report_ref = ledger["evidence"][0]["report"]
    report_path = root / report_ref["artifact"]
    report = json.loads(report_path.read_text())
    report["raw_artifacts"] = []
    report_path.write_text(json.dumps(report), encoding="utf-8")
    report_ref.update(_ref(root, report_ref["artifact"]))
    assert "p6_report_raw_evidence_missing" in finalizer.finalize(ledger, root)["errors"]

    _, ledger = _fixture(tmp_path / "digest")
    root = tmp_path / "digest"
    report_ref = ledger["evidence"][0]["report"]
    report_path = root / report_ref["artifact"]
    report = json.loads(report_path.read_text())
    report["raw_artifacts"][0]["sha256"] = "0" * 64
    report_path.write_text(json.dumps(report), encoding="utf-8")
    report_ref.update(_ref(root, report_ref["artifact"]))
    assert "p6_raw_artifact_attestation_invalid" in finalizer.finalize(ledger, root)["errors"]


def test_missing_required_evidence_kind_and_stale_transition_fail_closed(tmp_path: Path) -> None:
    _, ledger = _fixture(tmp_path)
    target = next(row for row in ledger["features"] if row["id"] == "P6-M08-F05")
    release_id = next(row["evidence_id"] for row in ledger["evidence"] if row["kind"] == "release")
    target["evidence_ids"].remove(release_id)
    assert "p6_feature_required_evidence_missing" in finalizer.finalize(ledger, tmp_path)["errors"]

    _, ledger = _fixture(tmp_path / "stale")
    root = tmp_path / "stale"
    transition = root / ledger["p5_transition"]["artifact"]
    transition.write_text('{"schema_version":"p5-to-p6-migration/0"}', encoding="utf-8")
    ledger["p5_transition"].update(_ref(root, ledger["p5_transition"]["artifact"]))
    assert "p6_p5_transition_not_current" in finalizer.finalize(ledger, root)["errors"]


def test_report_revision_and_cross_report_raw_evidence_reuse_fail_closed(tmp_path: Path) -> None:
    _, ledger = _fixture(tmp_path)
    first_ref = ledger["evidence"][0]["report"]
    first_path = tmp_path / first_ref["artifact"]
    first = json.loads(first_path.read_text())
    first["source_revision"] = "9" * 40
    first_path.write_text(json.dumps(first), encoding="utf-8")
    first_ref.update(_ref(tmp_path, first_ref["artifact"]))
    assert "p6_report_revision_mismatch" in finalizer.finalize(ledger, tmp_path)["errors"]

    _, ledger = _fixture(tmp_path / "reuse")
    root = tmp_path / "reuse"
    first_ref = ledger["evidence"][0]["report"]
    second_ref = ledger["evidence"][1]["report"]
    first = json.loads((root / first_ref["artifact"]).read_text())
    second_path = root / second_ref["artifact"]
    second = json.loads(second_path.read_text())
    second["raw_artifacts"] = first["raw_artifacts"]
    second_path.write_text(json.dumps(second), encoding="utf-8")
    second_ref.update(_ref(root, second_ref["artifact"]))
    assert "p6_raw_evidence_reused_across_reports" in finalizer.finalize(ledger, root)["errors"]


def test_duplicate_json_key_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "duplicate.json"
    path.write_text('{"schema_version":"p6-evidence-ledger/1","schema_version":"x"}', encoding="utf-8")
    with pytest.raises(finalizer.P6EvidenceError, match="duplicate_json_key"):
        finalizer.load_json(path)
