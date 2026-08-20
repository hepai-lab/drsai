from __future__ import annotations

import base64
import json
from dataclasses import replace
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.security_boundary import (
    ApprovalSloPolicyError,
    SecurityEventJournal,
    SecurityObservabilityDeploymentError,
    SecurityObservabilityRuntimeFactory,
    SecurityMetricsTransportError,
    SignedSecurityObservabilityDeploymentLoader,
    VerifiedWindowsSecurityInstallation,
    VerifiedWindowsSecurityPackageCatalog,
    WindowsInstallerOperationJournal,
    WindowsInstallerJournalError,
    WindowsInstallerServiceSafetyEvidence,
    WindowsServiceBootstrapEnvelopeChannel,
    WindowsServiceConfigurationEvidence,
    canonical_digest,
)


BUILD_DIGEST = "sha256:" + "b" * 64


class _NativeApi:
    backend_id = "windows-authenticated-named-pipe"
    backend_version = "1"


class _SafetyController:
    def ensure_disabled_and_stopped(self, service_name: str):
        return WindowsInstallerServiceSafetyEvidence(service_name, True, True, 0)


def _raw_public(private_key) -> bytes:
    return private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )


def _write_signed(path: Path, payload, private_key, key_id: str) -> None:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    path.write_text(json.dumps({
        "payload": payload, "key_id": key_id,
        "signature": base64.b64encode(private_key.sign(canonical)).decode(),
    }), encoding="utf-8")


def _policy_payload():
    return {
        "schema_version": "approval-security-slo-policy/1",
        "policy_id": "production-approval-slo",
        "version": 4,
        "not_before": 50,
        "expires_at": 200,
        "thresholds": {
            "window_seconds": 300,
            "minimum_decisions": 10,
            "minimum_effects": 10,
            "max_timeout_ratio_basis_points": 500,
            "max_expired_grant_ratio_basis_points": 1000,
            "max_outcome_unknown_ratio_basis_points": 100,
            "max_adapter_failures": 1,
        },
    }


def _manifest_payload(policy_digest: str, *, version=2, enabled=False):
    return {
        "schema_version": "security-observability-deployment/1",
        "manifest_id": "opendrsai-security-observability",
        "version": version,
        "product": "OpenDrSai",
        "channel": "stable",
        "runtime_build_digest": BUILD_DIGEST,
        "enabled": enabled,
        "service_sid": "S-1-5-80-12345" if enabled else "",
        "pipe_instance_id": "0123456789abcdef0123456789abcdef" if enabled else "",
        "slo_policy_filename": "approval-slo.json",
        "slo_policy_id": "production-approval-slo",
        "slo_policy_digest": policy_digest,
        "slo_policy_key_id": "slo-key",
        "slo_policy_minimum_version": 4,
        "not_before": 50,
        "expires_at": 200,
    }


def _fixture(tmp_path: Path, *, enabled=False, manifest_version=2):
    root = tmp_path / "installed-release"
    root.mkdir()
    slo_private = Ed25519PrivateKey.generate()
    release_private = Ed25519PrivateKey.generate()
    policy = _policy_payload()
    _write_signed(root / "approval-slo.json", policy, slo_private, "slo-key")
    manifest = _manifest_payload(canonical_digest(policy), version=manifest_version, enabled=enabled)
    _write_signed(root / "security-observability.json", manifest, release_private, "release-key")
    return root, slo_private, release_private, manifest


def _loader(database: Path, root: Path, release_private, **kwargs):
    return SignedSecurityObservabilityDeploymentLoader(
        database, root,
        trusted_release_keys={"release-key": _raw_public(release_private)},
        expected_manifest_id="opendrsai-security-observability",
        expected_product="OpenDrSai", expected_channel="stable",
        expected_runtime_build_digest=BUILD_DIGEST,
        minimum_manifest_version=kwargs.pop("minimum_manifest_version", 2),
        clock=lambda: 100, **kwargs,
    )


def _bootstrap_material(database: Path, deployment):
    catalog_digest = "sha256:" + "c" * 64
    metadata_digest = "sha256:" + "d" * 64
    catalog = VerifiedWindowsSecurityPackageCatalog(
        catalog_path=deployment.install_root / "catalog.json",
        install_root=deployment.install_root, catalog_id="windows-package", version=1,
        digest=catalog_digest, key_id="catalog-key", product="OpenDrSai", channel="stable",
        runtime_build_digest=deployment.runtime_build_digest,
        installation_metadata_filename="installation.json", installation_metadata_id="installation",
        installation_metadata_digest=metadata_digest, installation_metadata_minimum_version=1,
        release_pins_filename="pins.json", release_pins_file_digest="sha256:" + "e" * 64,
        service_name="OpenDrSaiSecurityRuntime", service_sid=deployment.service_sid,
        service_start_account="LocalSystem", service_start_type="automatic",
        service_sid_type="unrestricted", service_delayed_auto_start=False,
        trusted_writer_sids=("S-1-5-18",), not_before=50, expires_at=200,
    )
    service = WindowsServiceConfigurationEvidence(
        catalog.service_name, catalog.service_sid, str(deployment.install_root / "service.exe"),
        "LocalSystem", "disabled", "own_process", "unrestricted", False,
    )
    installation = VerifiedWindowsSecurityInstallation(
        "installation", 1, metadata_digest, deployment.install_root,
        catalog.service_name, catalog.service_sid, service, (), "installer_safe",
    )
    journal = WindowsInstallerOperationJournal(database, _SafetyController(), clock=lambda: 100)
    operation = journal.begin("install", catalog)
    journal.mark_artifacts_staged(operation.operation_id, "sha256:" + "f" * 64)
    journal.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(catalog.service_name, True, True, 0),
    )
    journal.mark_package_verified(operation.operation_id, catalog, installation)
    journal.commit(operation.operation_id, catalog, installation)
    authorization = journal.issue_bootstrap_authorization(
        operation.operation_id, catalog, installation,
    )
    final_installation = replace(
        installation,
        service_configuration=replace(service, start_type="automatic"),
        service_configuration_phase="final",
    )
    return journal, catalog, installation, final_installation, authorization


def _consumed_bootstrap(database: Path, deployment):
    journal, catalog, _staged, final, authorization = _bootstrap_material(database, deployment)
    return journal.consume_bootstrap_authorization(authorization, catalog, final)


class _EnvelopeProtector:
    def protect(self, plaintext: bytes, *, entropy: bytes) -> bytes:
        return entropy + b"\0" + plaintext

    def unprotect(self, ciphertext: bytes, *, entropy: bytes) -> bytes:
        prefix = entropy + b"\0"
        if not ciphertext.startswith(prefix):
            raise ValueError("identity mismatch")
        return ciphertext[len(prefix):]


class _EnvelopeFiles:
    def __init__(self):
        self.content = None

    def publish(self, path, content, *, service_sid):
        del path, service_sid
        self.content = content

    def read(self, path, *, service_sid, maximum_bytes):
        del path, service_sid, maximum_bytes
        return self.content

    def delete(self, path, *, service_sid):
        del path, service_sid
        self.content = None


def test_signed_disabled_deployment_builds_runtime_without_transport(tmp_path: Path) -> None:
    root, slo_private, release_private, _ = _fixture(tmp_path)
    database = tmp_path / "security.sqlite3"
    deployment = _loader(database, root, release_private).load("security-observability.json")
    assert deployment.enabled is False
    runtime = SecurityObservabilityRuntimeFactory.from_verified_deployment(
        database, deployment,
        trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
        clock=lambda: 100,
    ).build()
    assert runtime.transport is None
    assert runtime.policy.digest == deployment.slo_policy_digest
    assert runtime.monitor.policy_digest == deployment.slo_policy_digest


def test_signed_enabled_deployment_binds_service_sid_and_pipe_identity(tmp_path: Path) -> None:
    root, slo_private, release_private, _ = _fixture(tmp_path, enabled=True)
    database = tmp_path / "security.sqlite3"
    deployment = _loader(database, root, release_private).load("security-observability.json")
    with pytest.raises(SecurityMetricsTransportError) as bypass:
        SecurityObservabilityRuntimeFactory.from_verified_deployment(
            database, deployment,
            trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
            native_pipe_api=_NativeApi(), clock=lambda: 100,
        )
    assert bypass.value.code == "security_observability_bootstrap_required"
    receipt = _consumed_bootstrap(database, deployment)
    factory = SecurityObservabilityRuntimeFactory.from_verified_service_bootstrap(
        database, deployment, receipt,
        trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
        native_pipe_api=_NativeApi(), clock=lambda: 100,
    )
    runtime = factory.build()
    assert runtime.transport is not None
    assert runtime.transport.pipe_name.endswith(deployment.pipe_instance_id)
    assert deployment.service_sid in runtime.transport.security_descriptor_sddl
    with pytest.raises(SecurityMetricsTransportError) as factory_replay:
        factory.build()
    assert factory_replay.value.code == "security_observability_bootstrap_replayed"
    with pytest.raises(WindowsInstallerJournalError) as replay:
        SecurityObservabilityRuntimeFactory.from_verified_service_bootstrap(
            database, deployment, receipt,
            trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
            native_pipe_api=_NativeApi(), clock=lambda: 100,
        )
    assert replay.value.code == "windows_installer_bootstrap_receipt_invalid"


def test_bootstrap_claim_does_not_allow_untrusted_pipe_backend(tmp_path: Path) -> None:
    root, slo_private, release_private, _ = _fixture(tmp_path, enabled=True)
    database = tmp_path / "security.sqlite3"
    deployment = _loader(database, root, release_private).load("security-observability.json")
    receipt = _consumed_bootstrap(database, deployment)
    untrusted = _NativeApi()
    untrusted.backend_version = "attacker-version"
    factory = SecurityObservabilityRuntimeFactory.from_verified_service_bootstrap(
        database, deployment, receipt,
        trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
        native_pipe_api=untrusted, clock=lambda: 100,
    )
    with pytest.raises(SecurityMetricsTransportError) as rejected:
        factory.build()
    assert rejected.value.code == "security_metrics_pipe_backend_untrusted"
    assert not any(
        event.event_type == "approval_slo.policy_accepted"
        for event in SecurityEventJournal(database).list()
    )


def test_enabled_factory_consumes_service_only_envelope_end_to_end(tmp_path: Path) -> None:
    root, slo_private, release_private, _ = _fixture(tmp_path, enabled=True)
    database = tmp_path / "security.sqlite3"
    deployment = _loader(database, root, release_private).load("security-observability.json")
    _journal, catalog, staged, final, authorization = _bootstrap_material(database, deployment)
    files = _EnvelopeFiles()
    channel = WindowsServiceBootstrapEnvelopeChannel(
        tmp_path / "bootstrap.bin", deployment.service_sid,
        protector=_EnvelopeProtector(), file_api=files,
    )
    channel.publish(authorization, catalog, staged)
    factory = SecurityObservabilityRuntimeFactory.from_verified_service_envelope(
        database, deployment, channel, catalog, final,
        trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
        native_pipe_api=_NativeApi(), clock=lambda: 100,
    )
    assert files.content is None
    assert factory.build().transport is not None


def test_manifest_tamper_release_mismatch_and_disabled_live_identity_fail_closed(tmp_path: Path) -> None:
    root, _, release_private, manifest = _fixture(tmp_path)
    database = tmp_path / "security.sqlite3"
    manifest["channel"] = "attacker"
    # Keep the old signature to prove payload tamper is rejected before identity handling.
    envelope = json.loads((root / "security-observability.json").read_text(encoding="utf-8"))
    envelope["payload"] = manifest
    (root / "security-observability.json").write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(SecurityObservabilityDeploymentError) as tampered:
        _loader(database, root, release_private).load("security-observability.json")
    assert tampered.value.code == "security_observability_manifest_signature_invalid"

    manifest = _manifest_payload(canonical_digest(_policy_payload()))
    manifest["runtime_build_digest"] = "sha256:" + "c" * 64
    _write_signed(root / "security-observability.json", manifest, release_private, "release-key")
    with pytest.raises(SecurityObservabilityDeploymentError) as wrong_build:
        _loader(database, root, release_private).load("security-observability.json")
    assert wrong_build.value.code == "security_observability_manifest_identity_invalid"

    manifest["runtime_build_digest"] = BUILD_DIGEST
    manifest["service_sid"] = "S-1-5-18"
    _write_signed(root / "security-observability.json", manifest, release_private, "release-key")
    with pytest.raises(SecurityObservabilityDeploymentError) as disabled_identity:
        _loader(database, root, release_private).load("security-observability.json")
    assert disabled_identity.value.code == "security_observability_manifest_disabled_identity"


def test_manifest_persistent_rollback_redefinition_and_workspace_root_are_rejected(tmp_path: Path) -> None:
    root, _, release_private, manifest = _fixture(tmp_path, manifest_version=3)
    database = tmp_path / "security.sqlite3"
    loader = _loader(database, root, release_private)
    loader.load("security-observability.json")
    old = dict(manifest)
    old["version"] = 2
    _write_signed(root / "security-observability.json", old, release_private, "release-key")
    with pytest.raises(SecurityObservabilityDeploymentError) as rollback:
        loader.load("security-observability.json")
    assert rollback.value.code == "security_observability_manifest_version_rollback"

    changed = dict(manifest)
    changed["slo_policy_minimum_version"] = 5
    _write_signed(root / "security-observability.json", changed, release_private, "release-key")
    with pytest.raises(SecurityObservabilityDeploymentError) as redefined:
        loader.load("security-observability.json")
    assert redefined.value.code == "security_observability_manifest_version_redefined"

    with pytest.raises(SecurityObservabilityDeploymentError) as workspace:
        _loader(
            tmp_path / "workspace.sqlite3", root, release_private,
            forbidden_roots=(tmp_path,),
        )
    assert workspace.value.code == "security_observability_install_root_untrusted"


def test_manifest_policy_digest_mismatch_is_rejected_before_policy_acceptance(tmp_path: Path) -> None:
    root, slo_private, release_private, manifest = _fixture(tmp_path)
    manifest["slo_policy_digest"] = "sha256:" + "d" * 64
    _write_signed(root / "security-observability.json", manifest, release_private, "release-key")
    database = tmp_path / "security.sqlite3"
    deployment = _loader(database, root, release_private).load("security-observability.json")
    with pytest.raises(ApprovalSloPolicyError) as mismatch:
        SecurityObservabilityRuntimeFactory.from_verified_deployment(
            database, deployment,
            trusted_slo_public_keys={"slo-key": _raw_public(slo_private)},
            clock=lambda: 100,
        ).build()
    assert mismatch.value.code == "approval_slo_policy_digest_mismatch"
    assert not any(
        event.event_type == "approval_slo.policy_accepted"
        for event in SecurityEventJournal(database).list()
    )
