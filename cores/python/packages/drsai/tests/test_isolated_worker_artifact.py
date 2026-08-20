from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    AuthenticodeEvidence,
    IsolatedWorkerArtifactError,
    IsolatedWorkerArtifactResolver,
    canonical_digest,
)


def artifact(tmp_path: Path) -> tuple[Path, Path, dict[str, object]]:
    worker = tmp_path / "opendrsai-isolated-effect-worker.exe"
    worker.write_bytes(b"isolated-effect-worker-release-v1")
    manifest: dict[str, object] = {
        "schema_version": "isolated-effect-worker-manifest/1",
        "protocol_version": "isolated-effect/1",
        "receipt_version": "isolated-effect-receipt/1",
        "platform": "windows-x64",
        "worker_version": "1.0.0",
        "executable": worker.name,
        "sha256": "sha256:" + hashlib.sha256(worker.read_bytes()).hexdigest(),
    }
    manifest_path = tmp_path / "isolated-effect-worker.manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest_path, worker, manifest


def resolver(manifest: dict[str, object], **changes) -> IsolatedWorkerArtifactResolver:
    values = {
        "expected_manifest_digest": canonical_digest(manifest),
        "trusted_publisher_subjects": ("CN=OpenDrSai Security Publisher",),
        "signature_verifier": lambda _path: AuthenticodeEvidence(
            "Valid", "CN=OpenDrSai Security Publisher", "A1" * 20,
        ),
    }
    values.update(changes)
    return IsolatedWorkerArtifactResolver(**values)


def test_pinned_manifest_binary_hash_and_authenticode_identity_are_all_required(tmp_path: Path) -> None:
    manifest_path, worker, manifest = artifact(tmp_path)
    resolved = resolver(manifest).resolve(manifest_path)
    assert resolved.executable_path == worker.resolve()
    assert resolved.manifest_digest == canonical_digest(manifest)
    assert resolved.executable_digest == manifest["sha256"]
    assert resolved.worker_version == "1.0.0"
    assert resolved.signer_thumbprint == "A1" * 20


def test_manifest_change_is_rejected_even_if_attacker_rehashes_binary(tmp_path: Path) -> None:
    manifest_path, worker, manifest = artifact(tmp_path)
    pinned = canonical_digest(manifest)
    worker.write_bytes(b"attacker-replacement")
    manifest["sha256"] = "sha256:" + hashlib.sha256(worker.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(IsolatedWorkerArtifactError) as changed:
        IsolatedWorkerArtifactResolver(
            expected_manifest_digest=pinned,
            trusted_publisher_subjects=("CN=OpenDrSai Security Publisher",),
            signature_verifier=lambda _path: AuthenticodeEvidence(
                "Valid", "CN=OpenDrSai Security Publisher", "A1" * 20,
            ),
        ).resolve(manifest_path)
    assert changed.value.code == "isolated_worker_manifest_digest_mismatch"


def test_binary_change_is_rejected_before_signature_is_consulted(tmp_path: Path) -> None:
    manifest_path, worker, manifest = artifact(tmp_path)
    worker.write_bytes(b"changed-after-manifest")
    calls: list[Path] = []
    with pytest.raises(IsolatedWorkerArtifactError) as changed:
        resolver(
            manifest,
            signature_verifier=lambda path: calls.append(path) or AuthenticodeEvidence(
                "Valid", "CN=OpenDrSai Security Publisher", "A1" * 20,
            ),
        ).resolve(manifest_path)
    assert changed.value.code == "isolated_worker_binary_digest_mismatch"
    assert calls == []


@pytest.mark.parametrize(
    ("evidence", "code"),
    [
        (AuthenticodeEvidence("NotSigned", "", ""), "isolated_worker_signature_invalid"),
        (
            AuthenticodeEvidence("Valid", "CN=Unrelated Publisher", "B2" * 20),
            "isolated_worker_signature_invalid",
        ),
    ],
)
def test_unsigned_or_wrong_publisher_worker_is_rejected(
    tmp_path: Path, evidence: AuthenticodeEvidence, code: str,
) -> None:
    manifest_path, _worker, manifest = artifact(tmp_path)
    with pytest.raises(IsolatedWorkerArtifactError) as rejected:
        resolver(manifest, signature_verifier=lambda _path: evidence).resolve(manifest_path)
    assert rejected.value.code == code


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", "isolated-effect-worker-manifest/2"),
        ("protocol_version", "isolated-effect/2"),
        ("receipt_version", "isolated-effect-receipt/2"),
        ("platform", "windows-arm64"),
    ],
)
def test_incompatible_worker_contract_is_rejected(
    tmp_path: Path, field: str, value: str,
) -> None:
    manifest_path, _worker, manifest = artifact(tmp_path)
    manifest[field] = value
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(IsolatedWorkerArtifactError) as incompatible:
        resolver(manifest).resolve(manifest_path)
    assert incompatible.value.code == "isolated_worker_manifest_contract_mismatch"


@pytest.mark.parametrize("executable", ["../worker.exe", "subdir/worker.exe", "worker.cmd", "C:/worker.exe"])
def test_manifest_cannot_redirect_execution_outside_artifact_directory(
    tmp_path: Path, executable: str,
) -> None:
    manifest_path, _worker, manifest = artifact(tmp_path)
    manifest["executable"] = executable
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(IsolatedWorkerArtifactError) as escaped:
        resolver(manifest).resolve(manifest_path)
    assert escaped.value.code == "isolated_worker_executable_path_invalid"
