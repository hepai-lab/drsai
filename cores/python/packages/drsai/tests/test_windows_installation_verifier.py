from __future__ import annotations

import base64
import hashlib
import json
import os
from dataclasses import replace
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from drsai.backend.runtime.security_boundary import (
    AuthenticodeEvidence,
    IsolatedWorkerArtifactResolver,
    NativeWindowsAclApi,
    NativeWindowsInstallationSecurityApi,
    NativeWindowsServiceConfigurationApi,
    SecurityObservabilityReleaseTool,
    SignedWindowsSecurityPackageCatalogLoader,
    WindowsAccessControlEntry,
    WindowsFileSecurityEvidence,
    WindowsInstallationVerificationError,
    WindowsServiceConfigurationEvidence,
    WindowsSecurityInstallationVerifier,
    WindowsSecurityPackageCatalogError,
    WindowsSecurityPackageCatalogTool,
    canonical_digest,
)


SERVICE_SID = "S-1-5-80-123456"
INSTALLER_SID = "S-1-5-18"


class FakeSecurityApi:
    def __init__(self):
        self.overrides: dict[str, WindowsFileSecurityEvidence] = {}

    def inspect(self, path: Path) -> WindowsFileSecurityEvidence:
        return self.overrides.get(str(path), WindowsFileSecurityEvidence(
            owner_sid=INSTALLER_SID, dacl_protected=True, null_dacl=False,
            reparse_point=False, object_kind="directory" if path.is_dir() else "file",
            device_id=str(path.stat().st_dev), file_id=str(path.stat().st_ino),
            entries=(WindowsAccessControlEntry("allow", INSTALLER_SID, 0x10000000, False),),
        ))


class FakeServiceApi:
    def __init__(self, evidence: WindowsServiceConfigurationEvidence | None = None):
        self.evidence = evidence

    def inspect(self, service_name: str) -> WindowsServiceConfigurationEvidence:
        assert service_name == "OpenDrSaiSecurityRuntime"
        assert self.evidence is not None
        return self.evidence


def _release_input(runtime_build_digest: str) -> dict[str, object]:
    return {
        "schema_version": "security-observability-release-input/1",
        "manifest_filename": "security-observability.json",
        "release_key_id": "release-key",
        "slo_policy_filename": "approval-slo.json",
        "slo_policy_key_id": "slo-key",
        "policy_payload": {
            "schema_version": "approval-security-slo-policy/1", "policy_id": "production-slo",
            "version": 3, "not_before": 50, "expires_at": 250,
            "thresholds": {
                "window_seconds": 300, "minimum_decisions": 10, "minimum_effects": 10,
                "max_timeout_ratio_basis_points": 500,
                "max_expired_grant_ratio_basis_points": 1000,
                "max_outcome_unknown_ratio_basis_points": 100, "max_adapter_failures": 1,
            },
        },
        "deployment_payload": {
            "manifest_id": "opendrsai-security-observability", "version": 4,
            "product": "OpenDrSai", "channel": "stable",
            "runtime_build_digest": runtime_build_digest,
            "enabled": True, "service_sid": SERVICE_SID,
            "pipe_instance_id": "0123456789abcdef0123456789abcdef",
            "not_before": 50, "expires_at": 250,
        },
    }


def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _raw_public(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )


def _write_signed_catalog(path: Path, payload, key: Ed25519PrivateKey, key_id: str) -> None:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    path.write_text(json.dumps({
        "payload": payload, "key_id": key_id,
        "signature": base64.b64encode(key.sign(canonical)).decode("ascii"),
    }), encoding="utf-8")


def _fixture(tmp_path: Path):
    root = tmp_path / "installed"
    root.mkdir()
    service_executable = root / "opendrsai-security-service.exe"
    service_executable.write_bytes(b"signed-runtime-service-fixture")
    runtime_build_digest = _sha256(service_executable)
    release_key, slo_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    pins = SecurityObservabilityReleaseTool.build(
        _release_input(runtime_build_digest), root,
        release_private_key=release_key, slo_private_key=slo_key,
    )
    deployment = SecurityObservabilityReleaseTool.verify(
        root, pins, release_public_key=release_key.public_key(),
        slo_public_key=slo_key.public_key(), clock=lambda: 100,
    ).deployment
    executable = root / "isolated-worker.exe"
    executable.write_bytes(b"signed-worker-fixture")
    worker_manifest = {
        "schema_version": "isolated-effect-worker-manifest/1",
        "protocol_version": "isolated-effect/1", "receipt_version": "isolated-effect-receipt/1",
        "platform": "windows-x64", "worker_version": "1.2.3",
        "executable": executable.name, "sha256": _sha256(executable),
    }
    worker_manifest_path = root / "isolated-worker.json"
    worker_manifest_path.write_text(json.dumps(worker_manifest), encoding="utf-8")
    worker = IsolatedWorkerArtifactResolver(
        expected_manifest_digest=canonical_digest(worker_manifest),
        trusted_publisher_subjects=("CN=OpenDrSai Release",),
        signature_verifier=lambda _path: AuthenticodeEvidence(
            "Valid", "CN=OpenDrSai Release", "AA" * 20,
        ),
    ).resolve(worker_manifest_path)
    metadata = {
        "schema_version": "windows-security-installation/1",
        "metadata_id": "opendrsai-windows-security-installation", "version": 2,
        "product": "OpenDrSai", "channel": "stable",
        "runtime_build_digest": runtime_build_digest,
        "service_name": "OpenDrSaiSecurityRuntime", "service_sid": SERVICE_SID,
        "service_start_account": "LocalSystem", "service_start_type": "automatic",
        "service_sid_type": "unrestricted", "service_delayed_auto_start": False,
        "artifacts": [
            {"role": "deployment_manifest", "filename": pins.manifest_filename,
             "sha256": pins.manifest_file_digest},
            {"role": "slo_policy", "filename": pins.slo_policy_filename,
             "sha256": pins.slo_policy_file_digest},
            {"role": "isolated_worker_manifest", "filename": worker_manifest_path.name,
             "sha256": _sha256(worker_manifest_path)},
            {"role": "isolated_worker_executable", "filename": executable.name,
             "sha256": worker.executable_digest},
            {"role": "runtime_service_executable", "filename": service_executable.name,
             "sha256": _sha256(service_executable)},
        ],
    }
    metadata_path = root / "windows-security-installation.json"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    return root, pins, deployment, worker, metadata, metadata_path, service_executable


def _verifier(
    root: Path, metadata, api, *, writers=(INSTALLER_SID,), service_evidence=None,
    installer_safe_mode=False,
):
    service_executable = root / "opendrsai-security-service.exe"
    service_evidence = service_evidence or WindowsServiceConfigurationEvidence(
        "OpenDrSaiSecurityRuntime", SERVICE_SID, f'"{service_executable}"', "LocalSystem",
        "automatic", "own_process", "unrestricted", False,
    )
    return WindowsSecurityInstallationVerifier(
        root, expected_metadata_digest=canonical_digest(metadata),
        expected_metadata_id="opendrsai-windows-security-installation", minimum_metadata_version=2,
        expected_product="OpenDrSai", expected_channel="stable",
        expected_runtime_build_digest=metadata["runtime_build_digest"],
        expected_service_name="OpenDrSaiSecurityRuntime", expected_service_sid=SERVICE_SID,
        expected_service_start_account="LocalSystem", expected_service_start_type="automatic",
        expected_service_sid_type="unrestricted", expected_service_delayed_auto_start=False,
        trusted_writer_sids=writers, security_api=api,
        service_api=FakeServiceApi(service_evidence),
        installer_safe_mode=installer_safe_mode,
    )


def _catalog_payload(root: Path, metadata, *, version=2, key_writers=None):
    return {
        "schema_version": "windows-security-package-catalog/1",
        "catalog_id": "opendrsai-windows-security-package", "version": version,
        "product": "OpenDrSai", "channel": "stable",
        "runtime_build_digest": metadata["runtime_build_digest"],
        "installation_metadata_filename": "windows-security-installation.json",
        "installation_metadata_id": "opendrsai-windows-security-installation",
        "installation_metadata_digest": canonical_digest(metadata),
        "installation_metadata_minimum_version": 2,
        "release_pins_filename": "security-observability-release-pins.json",
        "release_pins_file_digest": _sha256(root / "security-observability-release-pins.json"),
        "service_name": "OpenDrSaiSecurityRuntime", "service_sid": SERVICE_SID,
        "service_start_account": "LocalSystem", "service_start_type": "automatic",
        "service_sid_type": "unrestricted", "service_delayed_auto_start": False,
        "trusted_writer_sids": key_writers or [INSTALLER_SID],
        "not_before": 50, "expires_at": 250,
    }


def _catalog_input(*, version=2, writers=None):
    return {
        "schema_version": "windows-security-package-catalog-input/1",
        "catalog_id": "opendrsai-windows-security-package", "version": version,
        "installation_metadata_filename": "windows-security-installation.json",
        "release_pins_filename": "security-observability-release-pins.json",
        "trusted_writer_sids": writers or [INSTALLER_SID],
        "not_before": 50, "expires_at": 250,
    }


def _catalog_loader(database: Path, root: Path, metadata, keys, *, minimum=2):
    return SignedWindowsSecurityPackageCatalogLoader(
        database, root, trusted_release_keys=keys,
        expected_catalog_id="opendrsai-windows-security-package",
        expected_product="OpenDrSai", expected_channel="stable",
        expected_runtime_build_digest=metadata["runtime_build_digest"],
        minimum_catalog_version=minimum, clock=lambda: 100,
    )


def test_verified_installation_binds_release_worker_service_and_acl(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, _, _ = _fixture(tmp_path)
    verified = _verifier(root, metadata, FakeSecurityApi()).verify(
        "windows-security-installation.json", deployment=deployment,
        release_pins=pins, worker=worker,
    )
    assert verified.service_sid == SERVICE_SID
    assert verified.metadata_digest == canonical_digest(metadata)
    assert {item.role for item in verified.artifacts} == {
        "deployment_manifest", "slo_policy", "isolated_worker_manifest",
        "isolated_worker_executable", "installation_metadata", "installation_root",
        "runtime_service_executable",
    }


def test_installation_rejects_unprotected_inherited_dacl(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, _ = _fixture(tmp_path)
    api = FakeSecurityApi()
    baseline = api.inspect(root)
    api.overrides[str(root)] = replace(baseline, dacl_protected=False)
    with pytest.raises(WindowsInstallationVerificationError) as rejected:
        _verifier(root, metadata, api).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert rejected.value.code == "windows_installation_inherited_dacl_denied"


def test_installer_safe_verification_requires_disabled_scm_then_final_reverify(
    tmp_path: Path,
) -> None:
    root, pins, deployment, worker, metadata, metadata_path, service_executable = _fixture(tmp_path)
    disabled = WindowsServiceConfigurationEvidence(
        "OpenDrSaiSecurityRuntime", SERVICE_SID, f'"{service_executable}"', "LocalSystem",
        "disabled", "own_process", "unrestricted", False,
    )
    staged = _verifier(
        root, metadata, FakeSecurityApi(), service_evidence=disabled,
        installer_safe_mode=True,
    ).verify(metadata_path.name, deployment=deployment, release_pins=pins, worker=worker)
    assert staged.service_configuration_phase == "installer_safe"
    assert staged.service_configuration.start_type == "disabled"

    with pytest.raises(WindowsInstallationVerificationError) as not_final:
        _verifier(
            root, metadata, FakeSecurityApi(), service_evidence=disabled,
        ).verify(metadata_path.name, deployment=deployment, release_pins=pins, worker=worker)
    assert not_final.value.code == "windows_service_identity_mismatch"

    final = _verifier(root, metadata, FakeSecurityApi()).verify(
        metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
    )
    assert final.service_configuration_phase == "final"
    assert final.service_configuration.start_type == "automatic"


def test_signed_catalog_is_the_non_circular_source_for_installation_verifier(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, service_executable = _fixture(tmp_path)
    release_key = Ed25519PrivateKey.generate()
    catalog_path = root / "windows-security-package-catalog.json"
    catalog = WindowsSecurityPackageCatalogTool.build(
        _catalog_input(), root, catalog_path.name,
        key_id="catalog-release-2026", private_key=release_key,
    )
    service_evidence = WindowsServiceConfigurationEvidence(
        "OpenDrSaiSecurityRuntime", SERVICE_SID, f'"{service_executable}"', "LocalSystem",
        "automatic", "own_process", "unrestricted", False,
    )
    verified = WindowsSecurityInstallationVerifier.from_verified_catalog(
        catalog, security_api=FakeSecurityApi(), service_api=FakeServiceApi(service_evidence),
    ).verify(metadata_path.name, deployment=deployment, release_pins=pins, worker=worker)
    assert verified.metadata_digest == catalog.installation_metadata_digest
    assert {item.role for item in verified.artifacts}.issuperset({"package_catalog", "release_pins"})


def test_catalog_builder_derives_inputs_refuses_overwrite_and_cleans_invalid_output(tmp_path: Path) -> None:
    root, _, _, _, metadata, _, _ = _fixture(tmp_path)
    key = Ed25519PrivateKey.generate()
    filename = "windows-security-package-catalog.json"
    built = WindowsSecurityPackageCatalogTool.build(
        _catalog_input(), root, filename, key_id="release-key", private_key=key,
    )
    assert built.runtime_build_digest == metadata["runtime_build_digest"]
    assert built.installation_metadata_digest == canonical_digest(metadata)
    before = (root / filename).read_bytes()
    with pytest.raises(WindowsSecurityPackageCatalogError) as exists:
        WindowsSecurityPackageCatalogTool.build(
            _catalog_input(), root, filename, key_id="release-key", private_key=key,
        )
    assert exists.value.code == "windows_package_catalog_output_exists"
    assert (root / filename).read_bytes() == before

    invalid_filename = "invalid-catalog.json"
    with pytest.raises(WindowsSecurityPackageCatalogError):
        WindowsSecurityPackageCatalogTool.build(
            _catalog_input(writers=[SERVICE_SID]), root, invalid_filename,
            key_id="release-key", private_key=key,
        )
    assert not (root / invalid_filename).exists()


def test_catalog_tamper_other_build_service_writer_and_release_pins_fail_closed(tmp_path: Path) -> None:
    root, _, _, _, metadata, _, _ = _fixture(tmp_path)
    key = Ed25519PrivateKey.generate()
    path = root / "windows-security-package-catalog.json"
    payload = _catalog_payload(root, metadata)
    _write_signed_catalog(path, payload, key, "release-key")
    envelope = json.loads(path.read_text(encoding="utf-8"))
    envelope["payload"]["channel"] = "attacker"
    path.write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(WindowsSecurityPackageCatalogError) as tamper:
        _catalog_loader(
            tmp_path / "tamper.sqlite3", root, metadata, {"release-key": _raw_public(key)},
        ).load(path.name)
    assert tamper.value.code == "windows_package_catalog_signature_invalid"

    other_build = _catalog_payload(root, metadata)
    other_build["runtime_build_digest"] = "sha256:" + "6" * 64
    _write_signed_catalog(path, other_build, key, "release-key")
    with pytest.raises(WindowsSecurityPackageCatalogError) as build:
        _catalog_loader(
            tmp_path / "build.sqlite3", root, metadata, {"release-key": _raw_public(key)},
        ).load(path.name)
    assert build.value.code == "windows_package_catalog_identity_mismatch"

    service_writer = _catalog_payload(root, metadata, key_writers=[SERVICE_SID])
    _write_signed_catalog(path, service_writer, key, "release-key")
    with pytest.raises(WindowsSecurityPackageCatalogError) as writer:
        _catalog_loader(
            tmp_path / "writer.sqlite3", root, metadata, {"release-key": _raw_public(key)},
        ).load(path.name)
    assert writer.value.code == "windows_package_catalog_service_invalid"

    valid = _catalog_payload(root, metadata)
    _write_signed_catalog(path, valid, key, "release-key")
    pins_path = root / "security-observability-release-pins.json"
    pins_path.write_text(pins_path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(WindowsSecurityPackageCatalogError) as pins:
        _catalog_loader(
            tmp_path / "pins.sqlite3", root, metadata, {"release-key": _raw_public(key)},
        ).load(path.name)
    assert pins.value.code == "windows_package_catalog_release_pins_mismatch"


def test_catalog_key_rotation_rollback_and_same_version_redefinition_are_persistent(tmp_path: Path) -> None:
    root, _, _, _, metadata, _, _ = _fixture(tmp_path)
    old_key, new_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    keys = {"old": _raw_public(old_key), "new": _raw_public(new_key)}
    path = root / "windows-security-package-catalog.json"
    database = tmp_path / "catalog.sqlite3"
    loader = _catalog_loader(database, root, metadata, keys)
    version_two = _catalog_payload(root, metadata, version=2)
    _write_signed_catalog(path, version_two, old_key, "old")
    assert loader.load(path.name).key_id == "old"
    version_three = _catalog_payload(root, metadata, version=3)
    _write_signed_catalog(path, version_three, new_key, "new")
    assert loader.load(path.name).key_id == "new"

    _write_signed_catalog(path, version_two, old_key, "old")
    with pytest.raises(WindowsSecurityPackageCatalogError) as rollback:
        loader.load(path.name)
    assert rollback.value.code == "windows_package_catalog_version_rollback"

    redefined = dict(version_three)
    redefined["expires_at"] = 240
    _write_signed_catalog(path, redefined, new_key, "new")
    with pytest.raises(WindowsSecurityPackageCatalogError) as same_version:
        loader.load(path.name)
    assert same_version.value.code == "windows_package_catalog_version_redefined"


@pytest.mark.parametrize(
    ("evidence", "code"),
    [
        (WindowsFileSecurityEvidence("S-1-5-21-1", True, False, False, "directory", "1", "1", ()),
         "windows_installation_owner_untrusted"),
        (WindowsFileSecurityEvidence(INSTALLER_SID, True, True, False, "directory", "1", "1", ()),
         "windows_installation_null_dacl_denied"),
        (WindowsFileSecurityEvidence(INSTALLER_SID, True, False, True, "directory", "1", "1", ()),
         "windows_installation_reparse_denied"),
        (WindowsFileSecurityEvidence(INSTALLER_SID, True, False, False, "directory", "1", "1",
         (WindowsAccessControlEntry("allow", "S-1-1-0", 0x2, False),)),
         "windows_installation_untrusted_writer"),
        (WindowsFileSecurityEvidence(INSTALLER_SID, True, False, False, "directory", "1", "1",
         (WindowsAccessControlEntry("allow", SERVICE_SID, 0x40000000, False),)),
         "windows_installation_service_writable"),
        (WindowsFileSecurityEvidence(INSTALLER_SID, True, False, False, "directory", "1", "1",
         (WindowsAccessControlEntry("unknown:17", INSTALLER_SID, 0, False),)),
         "windows_installation_acl_unsupported"),
    ],
)
def test_owner_null_dacl_reparse_untrusted_writer_and_unknown_ace_fail_closed(
    tmp_path: Path, evidence: WindowsFileSecurityEvidence, code: str,
) -> None:
    root, pins, deployment, worker, metadata, _, _ = _fixture(tmp_path)
    api = FakeSecurityApi()
    api.overrides[str(root)] = evidence
    with pytest.raises(WindowsInstallationVerificationError) as rejected:
        _verifier(root, metadata, api).verify(
            "windows-security-installation.json", deployment=deployment,
            release_pins=pins, worker=worker,
        )
    assert rejected.value.code == code


def test_metadata_artifact_and_verified_service_mismatch_fail_before_acceptance(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, _ = _fixture(tmp_path)
    tampered = dict(metadata)
    tampered["service_name"] = "AttackerService"
    metadata_path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(WindowsInstallationVerificationError) as digest:
        _verifier(root, metadata, FakeSecurityApi()).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert digest.value.code == "windows_installation_metadata_digest_mismatch"

    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    (root / pins.slo_policy_filename).write_text("tampered", encoding="utf-8")
    with pytest.raises(WindowsInstallationVerificationError) as artifact:
        _verifier(root, metadata, FakeSecurityApi()).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert artifact.value.code == "windows_installation_artifact_digest_mismatch"


def test_artifact_symlink_and_workspace_install_root_are_rejected(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, _ = _fixture(tmp_path)
    with pytest.raises(WindowsInstallationVerificationError) as workspace:
        WindowsSecurityInstallationVerifier(
            root, expected_metadata_digest=canonical_digest(metadata),
            expected_metadata_id="opendrsai-windows-security-installation",
            minimum_metadata_version=2, expected_product="OpenDrSai", expected_channel="stable",
            expected_runtime_build_digest=metadata["runtime_build_digest"],
            expected_service_name="OpenDrSaiSecurityRuntime", expected_service_sid=SERVICE_SID,
            expected_service_start_account="LocalSystem", expected_service_start_type="automatic",
            expected_service_sid_type="unrestricted", expected_service_delayed_auto_start=False,
            trusted_writer_sids=(INSTALLER_SID,), forbidden_roots=(tmp_path,),
            security_api=FakeSecurityApi(), service_api=FakeServiceApi(),
        )
    assert workspace.value.code == "windows_installation_root_untrusted"

    policy = root / pins.slo_policy_filename
    outside = tmp_path / "outside-policy.json"
    outside.write_bytes(policy.read_bytes())
    policy.unlink()
    try:
        policy.symlink_to(outside)
    except OSError:
        pytest.skip("file symlink creation is unavailable")
    with pytest.raises(WindowsInstallationVerificationError) as reparse:
        _verifier(root, metadata, FakeSecurityApi()).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert reparse.value.code == "windows_installation_reparse_denied"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"binary_path": "%TEMP%\\service.exe"}, "windows_service_binary_command_invalid"),
        ({"binary_path": "relative-service.exe"}, "windows_service_binary_command_invalid"),
        ({"binary_path": '"C:\\safe.exe" --argument'}, "windows_service_binary_command_invalid"),
        ({"service_sid": "S-1-5-80-999"}, "windows_service_identity_mismatch"),
        ({"start_account": "LocalService"}, "windows_service_identity_mismatch"),
        ({"start_type": "manual"}, "windows_service_identity_mismatch"),
        ({"service_type": "other:32"}, "windows_service_identity_mismatch"),
        ({"sid_type": "none"}, "windows_service_identity_mismatch"),
        ({"delayed_auto_start": True}, "windows_service_identity_mismatch"),
    ],
)
def test_scm_binary_sid_account_start_and_process_identity_fail_closed(
    tmp_path: Path, change: dict[str, object], code: str,
) -> None:
    root, pins, deployment, worker, metadata, metadata_path, service_executable = _fixture(tmp_path)
    baseline = WindowsServiceConfigurationEvidence(
        "OpenDrSaiSecurityRuntime", SERVICE_SID, f'"{service_executable}"', "LocalSystem",
        "automatic", "own_process", "unrestricted", False,
    )
    evidence = replace(baseline, **change)
    with pytest.raises(WindowsInstallationVerificationError) as rejected:
        _verifier(
            root, metadata, FakeSecurityApi(), service_evidence=evidence,
        ).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert rejected.value.code == code


def test_scm_cannot_point_to_another_valid_installed_executable(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, _ = _fixture(tmp_path)
    evidence = WindowsServiceConfigurationEvidence(
        "OpenDrSaiSecurityRuntime", SERVICE_SID, str(worker.executable_path), "LocalSystem",
        "automatic", "own_process", "unrestricted", False,
    )
    with pytest.raises(WindowsInstallationVerificationError) as rejected:
        _verifier(root, metadata, FakeSecurityApi(), service_evidence=evidence).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert rejected.value.code == "windows_service_binary_mismatch"


def test_service_build_digest_and_metadata_boolean_type_cannot_be_redefined(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, _ = _fixture(tmp_path)
    wrong_build = json.loads(json.dumps(metadata))
    for artifact in wrong_build["artifacts"]:
        if artifact["role"] == "runtime_service_executable":
            artifact["sha256"] = "sha256:" + "7" * 64
    metadata_path.write_text(json.dumps(wrong_build), encoding="utf-8")
    with pytest.raises(WindowsInstallationVerificationError) as build:
        _verifier(root, wrong_build, FakeSecurityApi()).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert build.value.code == "windows_service_build_digest_mismatch"

    wrong_type = json.loads(json.dumps(metadata))
    wrong_type["service_delayed_auto_start"] = 0
    metadata_path.write_text(json.dumps(wrong_type), encoding="utf-8")
    with pytest.raises(WindowsInstallationVerificationError) as value_type:
        _verifier(root, wrong_type, FakeSecurityApi()).verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        )
    assert value_type.value.code == "windows_installation_metadata_invalid"


@pytest.mark.skipif(os.name != "nt", reason="native installation ACL evidence requires Windows")
def test_native_acl_evidence_detects_new_everyone_write_ace(tmp_path: Path) -> None:
    root, pins, deployment, worker, metadata, metadata_path, service_executable = _fixture(tmp_path)
    native = NativeWindowsInstallationSecurityApi()
    paths = [
        root, metadata_path, root / pins.manifest_filename, root / pins.slo_policy_filename,
        worker.manifest_path, worker.executable_path,
        service_executable,
    ]
    projection_api = NativeWindowsAclApi()
    originals = {path: projection_api.snapshot(path) for path in paths}
    try:
        import win32security

        for path in paths:
            descriptor = win32security.GetFileSecurity(
                str(path), win32security.DACL_SECURITY_INFORMATION,
            )
            win32security.SetNamedSecurityInfo(
                str(path), win32security.SE_FILE_OBJECT,
                win32security.DACL_SECURITY_INFORMATION
                | win32security.PROTECTED_DACL_SECURITY_INFORMATION,
                None, None, descriptor.GetSecurityDescriptorDacl(), None,
            )
        writer_mask = WindowsSecurityInstallationVerifier._WRITE_MASK
        trusted = {native.inspect(path).owner_sid for path in paths}
        for path in paths:
            trusted.update(
                entry.sid for entry in native.inspect(path).entries
                if entry.ace_type == "allow" and entry.access_mask & writer_mask
            )
        trusted.discard(SERVICE_SID)
        verifier = _verifier(root, metadata, native, writers=tuple(trusted))
        assert verifier.verify(
            metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
        ).service_sid == SERVICE_SID

        projection_api.grant(root, "S-1-1-0", writable=True, directory=True)
        with pytest.raises(WindowsInstallationVerificationError) as rejected:
            verifier.verify(
                metadata_path.name, deployment=deployment, release_pins=pins, worker=worker,
            )
        assert rejected.value.code == "windows_installation_untrusted_writer"
    finally:
        for path in reversed(paths):
            projection_api.restore(path, originals[path])


@pytest.mark.skipif(os.name != "nt", reason="native SCM evidence requires Windows")
def test_native_scm_adapter_reads_existing_windows_service() -> None:
    evidence = NativeWindowsServiceConfigurationApi().inspect("EventLog")
    assert evidence.service_name == "EventLog"
    assert evidence.service_sid.startswith("S-1-5-80-")
    assert evidence.binary_path
    assert evidence.start_account
    assert evidence.start_type in {"automatic", "manual", "disabled"}
    assert evidence.sid_type in {"none", "unrestricted", "restricted"}
