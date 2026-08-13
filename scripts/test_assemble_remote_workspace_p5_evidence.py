from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest

import assemble_remote_workspace_p5_evidence as assembler
import finalize_remote_workspace_p5 as finalizer
from assemble_remote_workspace_p5_evidence import assemble
from test_finalize_remote_workspace_p5 import LONG_SESSION_FEATURE_SET, valid, valid_long_session_report
from p5_legacy_rollback import build_rollback_artifact


@pytest.fixture(autouse=True)
def fake_apk_inspection(monkeypatch: pytest.MonkeyPatch) -> None:
    def inspect(_path: Path, *, expected_package: str,
                expected_target_package: str | None = None) -> dict:
        return {
            "package_name": expected_package, "version_code": 20000,
            "version_name": "2.0.0", "signing_cert_sha256": "3" * 64,
            "signer_dn": "CN=OpenDrSai Test Release",
            "target_package": expected_target_package,
        }
    monkeypatch.setattr(assembler, "inspect_android_apk", inspect)
    monkeypatch.setattr(finalizer, "inspect_android_apk", inspect)
    monkeypatch.setattr(finalizer, "release_signer_is_trusted", lambda _cert, _dn: True)


def materialize(tmp_path: Path) -> dict:
    value = valid()

    def write(relative: str, raw: bytes) -> None:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)

    build_raw = b"release-apk"
    write(value["build"]["artifact"], build_raw)
    value["secret_scan"]["boundary_reports"][0]["artifact_sha256"] = hashlib.sha256(build_raw).hexdigest()

    openapi_raw = b'{"openapi":"3.1.0"}'
    write(value["contract_report"]["openapi_artifact"], openapi_raw)
    value["contract_report"]["openapi_bytes"] = len(openapi_raw)
    value["contract_report"]["openapi_sha256"] = hashlib.sha256(openapi_raw).hexdigest()
    contract_artifact = "reports/contract.json"
    contract = deepcopy(value["contract_report"])
    for key in ("artifact", "artifact_bytes", "artifact_sha256", "openapi_artifact"):
        contract.pop(key)
    write(contract_artifact, json.dumps(contract).encode())

    device_digests = []
    for index, device in enumerate(value["devices"]):
        raw = f"physical-device-{index}".encode()
        write(device["proof_artifact"], raw)
        device_digests.append(hashlib.sha256(raw).hexdigest())
        device.pop("proof_bytes")
        device.pop("proof_sha256")

    experience_artifact = value["experience_report"]["artifact"]
    experience = deepcopy(value["experience_report"])
    experience["device_proof_sha256s"] = device_digests
    for key in ("artifact", "artifact_bytes", "artifact_sha256"):
        experience.pop(key)
    write(experience_artifact, json.dumps(experience).encode())

    stability_artifact = value["stability_report"]["artifact"]
    stability = deepcopy(value["stability_report"])
    for key in ("artifact", "artifact_bytes", "artifact_sha256"):
        stability.pop(key)
    write(stability_artifact, json.dumps(stability).encode())

    secret_artifact = value["secret_scan"]["artifact"]
    secret = deepcopy(value["secret_scan"])
    for key in ("artifact", "artifact_bytes", "artifact_sha256"):
        secret.pop(key)
    write(secret_artifact, json.dumps(secret).encode())

    legacy = value["legacy_removal"]
    rollback_path = tmp_path / legacy["rollback_artifact"]
    build_rollback_artifact(Path(__file__).parents[1], rollback_path, source_revision="1" * 40)
    rollback_raw = rollback_path.read_bytes()
    rollback_digest = hashlib.sha256(rollback_raw).hexdigest()
    legacy["migration"]["rollback_artifact_sha256"] = rollback_digest
    write(legacy["decision_artifact"], json.dumps(legacy["decision"]).encode())
    write(legacy["migration_artifact"], json.dumps(legacy["migration"]).encode())
    for key in (
        "decision", "decision_bytes", "decision_sha256", "rollback_bytes", "rollback_sha256",
        "migration", "migration_bytes", "migration_sha256",
    ):
        legacy.pop(key)

    build_digest = hashlib.sha256(build_raw).hexdigest()
    for row in value["evidence"]:
        if set(row["feature_ids"]) == LONG_SESSION_FEATURE_SET:
            test_raw = b"release-test-apk"
            write("artifacts/p5-long-session-test.apk", test_raw)
            raw = json.dumps(valid_long_session_report(
                build_digest, test_apk_sha256=hashlib.sha256(test_raw).hexdigest(),
                test_apk_bytes=len(test_raw),
            ), sort_keys=True).encode()
        else:
            raw = (row["category"] + "-evidence").encode()
        write(row["artifact"], raw)
        row.pop("bytes")
        row.pop("sha256")
    for feature in value["features"]:
        feature.pop("evidence_sha256")
    value["build"].pop("bytes")
    value["build"].pop("sha256")
    value.pop("contract_report")
    value.pop("stability_report")
    value.pop("secret_scan")
    value.pop("experience_report")
    value["schema_version"] = "p5-manifest/1"
    value["contract_report_artifact"] = contract_artifact
    value["openapi_artifact"] = "contract/openapi.json"
    value["stability_report_artifact"] = stability_artifact
    value["secret_scan_artifact"] = secret_artifact
    value["experience_report_artifact"] = experience_artifact
    return value


def test_assembles_and_physically_verifies_complete_ledger(tmp_path: Path) -> None:
    ledger = assemble(materialize(tmp_path), tmp_path)
    assert ledger["schema_version"] == "p5/1"
    assert len(ledger["features"]) == 48
    assert all(len(row["evidence_sha256"]) == 64 for row in ledger["features"])
    assert ledger["build"]["bytes"] > 0
    assert ledger["legacy_removal"]["decision"]["status"] == "eligible"


def test_declared_digest_feature_overlap_and_path_escape_fail_closed(tmp_path: Path) -> None:
    mismatch = materialize(tmp_path)
    mismatch["evidence"][0]["sha256"] = "f" * 64
    with pytest.raises(RuntimeError, match="declared_sha256_mismatch"):
        assemble(mismatch, tmp_path)

    overlap = materialize(tmp_path)
    overlap["evidence"][1]["feature_ids"].append(overlap["evidence"][0]["feature_ids"][0])
    with pytest.raises(RuntimeError, match="feature_mapped_twice"):
        assemble(overlap, tmp_path)

    traversal = materialize(tmp_path)
    traversal["build"]["artifact"] = "../outside.apk"
    with pytest.raises(RuntimeError, match="artifact_path_invalid"):
        assemble(traversal, tmp_path)


def test_legacy_removal_artifact_content_is_authoritative(tmp_path: Path) -> None:
    manifest = materialize(tmp_path)
    decision_path = tmp_path / manifest["legacy_removal"]["decision_artifact"]
    decision = json.loads(decision_path.read_text())
    decision.update({"status": "insufficient_window", "eligible": False})
    decision_path.write_text(json.dumps(decision))
    with pytest.raises(RuntimeError, match="p5_legacy_deletion"):
        assemble(manifest, tmp_path)


def test_long_session_artifact_content_is_authoritative(tmp_path: Path) -> None:
    manifest = materialize(tmp_path)
    row = next(item for item in manifest["evidence"]
               if set(item["feature_ids"]) == LONG_SESSION_FEATURE_SET)
    path = tmp_path / row["artifact"]
    report = json.loads(path.read_text())
    report["metrics"]["history"]["cold_start_ms"] = 3001
    path.write_text(json.dumps(report))
    with pytest.raises(RuntimeError, match="p5_long_session_gate_failed"):
        assemble(manifest, tmp_path)


def test_manifest_cannot_override_identity_extracted_from_release_apk(tmp_path: Path) -> None:
    manifest = materialize(tmp_path)
    manifest["build"]["version_code"] = 1
    with pytest.raises(RuntimeError, match="p5_manifest_build_version_code_mismatch"):
        assemble(manifest, tmp_path)
