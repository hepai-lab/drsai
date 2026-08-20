from __future__ import annotations

import base64
import hashlib
import json
import os
import uuid
from dataclasses import replace
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    NativeWindowsBootstrapEnvelopeFileApi,
    NativeWindowsMachineDpapiProtector,
    NativeWindowsInstallerServiceActivationApi,
    VerifiedWindowsSecurityInstallation,
    VerifiedWindowsSecurityPackageCatalog,
    WindowsInstallerOperationJournal,
    WindowsInstallerServiceActivationController,
    WindowsInstallerServiceActivationError,
    WindowsInstallerServiceSafetyEvidence,
    WindowsInstallerServiceStartEvidence,
    WindowsServiceBootstrapEnvelopeChannel,
    WindowsServiceBootstrapEnvelopeError,
    WindowsServiceConfigurationEvidence,
    current_process_sid,
)


SERVICE_NAME = "OpenDrSaiSecurityRuntime"
SERVICE_SID = "S-1-5-80-123456"
DIGESTS = tuple("sha256:" + value * 64 for value in "12345")


class FakeSafetyController:
    def ensure_disabled_and_stopped(self, service_name: str):
        return WindowsInstallerServiceSafetyEvidence(service_name, True, True, 0)


class AuthenticatedFakeProtector:
    def protect(self, plaintext: bytes, *, entropy: bytes) -> bytes:
        return hashlib.sha256(entropy).digest() + plaintext[::-1]

    def unprotect(self, ciphertext: bytes, *, entropy: bytes) -> bytes:
        if ciphertext[:32] != hashlib.sha256(entropy).digest():
            raise ValueError("wrong entropy")
        return ciphertext[32:][::-1]


class MemoryFileApi:
    def __init__(self):
        self.content: bytes | None = None
        self.sid: str | None = None
        self.fail_delete = False

    def publish(self, path: Path, content: bytes, *, service_sid: str) -> None:
        del path
        if self.content is not None:
            raise WindowsServiceBootstrapEnvelopeError("exists", "exists")
        self.content, self.sid = content, service_sid

    def read(self, path: Path, *, service_sid: str, maximum_bytes: int) -> bytes:
        del path
        if self.content is None or self.sid != service_sid or len(self.content) > maximum_bytes:
            raise WindowsServiceBootstrapEnvelopeError("read_denied", "read denied")
        return self.content

    def delete(self, path: Path, *, service_sid: str) -> None:
        del path
        if self.fail_delete:
            raise WindowsServiceBootstrapEnvelopeError("cleanup_failed", "cleanup failed")
        if self.sid != service_sid:
            raise WindowsServiceBootstrapEnvelopeError("delete_denied", "delete denied")
        self.content = None


class FakeActivationApi:
    def __init__(self, evidence):
        self.evidence = evidence
        self.configured: list[tuple[str, str]] = []
        self.starts: list[str] = []

    def configure_start_type(self, service_name: str, start_type: str) -> None:
        self.configured.append((service_name, start_type))
        self.evidence = replace(self.evidence, start_type=start_type)

    def inspect(self, service_name: str):
        assert service_name == self.evidence.service_name
        return self.evidence

    def start(self, service_name: str):
        self.starts.append(service_name)
        return WindowsInstallerServiceStartEvidence(service_name, True, 4321)

    def inspect_running(self, service_name: str):
        running = service_name in self.starts
        return WindowsInstallerServiceStartEvidence(
            service_name, running, 4321 if running else 0,
        )

    def fail_safe_disable_and_stop(self, service_name: str):
        self.evidence = replace(self.evidence, start_type="disabled")
        return WindowsInstallerServiceSafetyEvidence(service_name, True, True, 0)


def identities(tmp_path: Path):
    root = (tmp_path / "installed").resolve()
    root.mkdir()
    catalog = VerifiedWindowsSecurityPackageCatalog(
        catalog_path=root / "catalog.json", install_root=root,
        catalog_id="opendrsai-windows-security-package", version=7,
        digest=DIGESTS[0], key_id="catalog-key", product="OpenDrSai", channel="stable",
        runtime_build_digest=DIGESTS[1],
        installation_metadata_filename="windows-security-installation.json",
        installation_metadata_id="opendrsai-windows-security-installation",
        installation_metadata_digest=DIGESTS[2], installation_metadata_minimum_version=2,
        release_pins_filename="security-observability-release-pins.json",
        release_pins_file_digest=DIGESTS[4], service_name=SERVICE_NAME,
        service_sid=SERVICE_SID, service_start_account="LocalSystem",
        service_start_type="automatic", service_sid_type="unrestricted",
        service_delayed_auto_start=False, trusted_writer_sids=("S-1-5-18",),
        not_before=50, expires_at=250,
    )
    installation = VerifiedWindowsSecurityInstallation(
        metadata_id="opendrsai-windows-security-installation", version=2,
        metadata_digest=DIGESTS[2], install_root=root, service_name=SERVICE_NAME,
        service_sid=SERVICE_SID,
        service_configuration=WindowsServiceConfigurationEvidence(
            SERVICE_NAME, SERVICE_SID, str(root / "service.exe"), "LocalSystem",
            "disabled", "own_process", "unrestricted", False,
        ),
        artifacts=(), service_configuration_phase="installer_safe",
    )
    return catalog, installation


def authorization(tmp_path: Path):
    catalog, installation = identities(tmp_path)
    journal = WindowsInstallerOperationJournal(
        tmp_path / "security.sqlite3", FakeSafetyController(), clock=lambda: 100,
    )
    operation = journal.begin("install", catalog)
    journal.mark_artifacts_staged(operation.operation_id, DIGESTS[3])
    journal.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
    )
    journal.mark_package_verified(operation.operation_id, catalog, installation)
    journal.commit(operation.operation_id, catalog, installation)
    issued = journal.issue_bootstrap_authorization(operation.operation_id, catalog, installation)
    return catalog, installation, journal, issued


def channel(path: Path, files: MemoryFileApi, sid: str = SERVICE_SID):
    return WindowsServiceBootstrapEnvelopeChannel(
        path, sid, protector=AuthenticatedFakeProtector(), file_api=files,
    )


def test_protected_envelope_delivers_authorization_once(tmp_path: Path) -> None:
    catalog, installation, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    transport.publish(issued, catalog, installation)
    assert issued.token.encode("ascii") not in files.content

    receipt = transport.consume(journal, catalog, installation)
    assert receipt.authorization_id == issued.authorization_id
    assert files.content is None
    WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
        tmp_path / "security.sqlite3", receipt, clock=lambda: 101,
    )


def test_privileged_inspection_authenticates_without_consuming_or_deleting(
    tmp_path: Path,
) -> None:
    catalog, installation, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    published = transport.publish(issued, catalog, installation)

    recovered, recovered_publication = transport.inspect(catalog, installation)

    assert recovered == issued
    assert recovered_publication == published
    assert files.content is not None
    assert journal.bootstrap_authorization_status(issued, catalog, installation) == "issued"


def test_wrong_service_identity_and_ciphertext_tamper_fail_closed(tmp_path: Path) -> None:
    catalog, installation, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    transport.publish(issued, catalog, installation)

    with pytest.raises(WindowsServiceBootstrapEnvelopeError):
        channel(tmp_path / "bootstrap.bin", files, "S-1-5-80-999").consume(
            journal, catalog, installation,
        )
    assert files.content is not None
    files.content = files.content[:-1] + bytes([files.content[-1] ^ 1])
    with pytest.raises(WindowsServiceBootstrapEnvelopeError) as corrupt:
        transport.consume(journal, catalog, installation)
    assert corrupt.value.code == "windows_bootstrap_envelope_invalid"
    assert journal.bootstrap_authorization_status(issued, catalog, installation) == "issued"


def test_authenticated_unknown_schema_field_is_rejected(tmp_path: Path) -> None:
    catalog, installation, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    transport.publish(issued, catalog, installation)
    entropy = transport._entropy()
    protector = AuthenticatedFakeProtector()
    payload = json.loads(protector.unprotect(
        base64.b64decode(files.content), entropy=entropy,
    ))
    payload["forward_compatible_bypass"] = True
    files.content = base64.b64encode(protector.protect(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("ascii"),
        entropy=entropy,
    ))
    with pytest.raises(WindowsServiceBootstrapEnvelopeError) as rejected:
        transport.consume(journal, catalog, installation)
    assert rejected.value.code == "windows_bootstrap_envelope_invalid"
    assert journal.bootstrap_authorization_status(issued, catalog, installation) == "issued"


def test_crash_residual_is_cleaned_without_reissuing_receipt(tmp_path: Path) -> None:
    catalog, installation, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    transport.publish(issued, catalog, installation)
    files.fail_delete = True
    with pytest.raises(WindowsServiceBootstrapEnvelopeError) as cleanup:
        transport.consume(journal, catalog, installation)
    assert cleanup.value.code == "cleanup_failed"
    assert journal.bootstrap_authorization_status(issued, catalog, installation) == "consumed"

    files.fail_delete = False
    with pytest.raises(WindowsServiceBootstrapEnvelopeError) as replay:
        transport.consume(journal, catalog, installation)
    assert replay.value.code == "windows_bootstrap_envelope_replay_cleaned"
    assert files.content is None


def test_service_finalization_requires_envelope_then_final_reverification(
    tmp_path: Path,
) -> None:
    catalog, staged, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    published = transport.publish(issued, catalog, staged)
    api = FakeActivationApi(staged.service_configuration)
    controller = WindowsInstallerServiceActivationController(
        journal, api, clock=lambda: 100,
    )

    final_evidence = controller.finalize_configuration(
        published, issued, catalog, staged,
    )
    assert final_evidence.start_type == "automatic"
    assert api.configured == [(SERVICE_NAME, "automatic")]
    with pytest.raises(WindowsInstallerServiceActivationError) as staged_start:
        controller.start_verified_service(published, issued, catalog, staged)
    assert staged_start.value.code == "windows_installer_service_start_not_authorized"

    final = replace(
        staged, service_configuration=final_evidence, service_configuration_phase="final",
    )
    started = controller.start_verified_service(published, issued, catalog, final)
    assert started.running and started.process_id == 4321
    assert api.starts == [SERVICE_NAME]


def test_service_activation_rejects_forged_publish_config_drift_and_consumed_token(
    tmp_path: Path,
) -> None:
    catalog, staged, journal, issued = authorization(tmp_path)
    files = MemoryFileApi()
    transport = channel(tmp_path / "bootstrap.bin", files)
    published = transport.publish(issued, catalog, staged)
    api = FakeActivationApi(staged.service_configuration)
    controller = WindowsInstallerServiceActivationController(
        journal, api, clock=lambda: 100,
    )
    with pytest.raises(WindowsInstallerServiceActivationError) as forged:
        controller.finalize_configuration(
            replace(published, service_sid="S-1-5-80-999"), issued, catalog, staged,
        )
    assert forged.value.code == "windows_installer_service_activation_not_authorized"
    expired_controller = WindowsInstallerServiceActivationController(
        journal, api, clock=lambda: issued.expires_at,
    )
    with pytest.raises(WindowsInstallerServiceActivationError) as expired:
        expired_controller.finalize_configuration(published, issued, catalog, staged)
    assert expired.value.code == "windows_installer_service_activation_not_authorized"

    final_evidence = controller.finalize_configuration(published, issued, catalog, staged)
    final = replace(
        staged, service_configuration=final_evidence, service_configuration_phase="final",
    )
    api.evidence = replace(final_evidence, binary_path="C:\\attacker.exe")
    with pytest.raises(WindowsInstallerServiceActivationError) as drift:
        controller.start_verified_service(published, issued, catalog, final)
    assert drift.value.code == "windows_installer_service_final_config_changed"
    assert api.evidence.start_type == "disabled"

    api.evidence = final_evidence
    transport.consume(journal, catalog, final)
    with pytest.raises(WindowsInstallerServiceActivationError) as consumed:
        controller.start_verified_service(published, issued, catalog, final)
    assert consumed.value.code == "windows_installer_service_start_not_authorized"


@pytest.mark.skipif(os.name != "nt", reason="native file adapter requires Windows")
def test_native_file_adapter_rejects_reparse_before_open(tmp_path: Path, monkeypatch) -> None:
    api = NativeWindowsBootstrapEnvelopeFileApi()
    monkeypatch.setattr(api, "_is_reparse", lambda _path: True)
    with pytest.raises(WindowsServiceBootstrapEnvelopeError) as denied:
        api.read(tmp_path / "link", service_sid=SERVICE_SID, maximum_bytes=65536)
    assert denied.value.code == "windows_bootstrap_envelope_reparse_denied"


@pytest.mark.skipif(os.name != "nt", reason="native SCM adapter requires Windows")
def test_native_activation_adapter_does_not_create_missing_service() -> None:
    api = NativeWindowsInstallerServiceActivationApi(start_timeout_seconds=0.1)
    with pytest.raises(WindowsInstallerServiceActivationError) as missing:
        api.configure_start_type(f"OpenDrSaiMissing-{uuid.uuid4()}", "automatic")
    assert missing.value.code == "windows_installer_service_unavailable"


@pytest.mark.skipif(os.name != "nt", reason="native DPAPI and ACL evidence requires Windows")
def test_native_machine_dpapi_round_trip() -> None:
    sid = current_process_sid()
    protector = NativeWindowsMachineDpapiProtector()
    entropy = f"OpenDrSai/bootstrap/v1\0{sid}".encode("ascii")
    ciphertext = protector.protect(b"native-secret", entropy=entropy)
    assert b"native-secret" not in ciphertext
    assert protector.unprotect(ciphertext, entropy=entropy) == b"native-secret"


@pytest.mark.skipif(os.name != "nt", reason="native ACL evidence requires Windows")
def test_native_system_owned_service_acl_round_trip(tmp_path: Path) -> None:
    sid = current_process_sid()
    protector = NativeWindowsMachineDpapiProtector()
    entropy = f"OpenDrSai/bootstrap/v1\0{sid}".encode("ascii")
    ciphertext = protector.protect(b"native-secret", entropy=entropy)
    path = tmp_path / "native-bootstrap.bin"
    api = NativeWindowsBootstrapEnvelopeFileApi()
    try:
        api.publish(path, ciphertext, service_sid=sid)
    except WindowsServiceBootstrapEnvelopeError as error:
        if error.code in {
            "windows_bootstrap_envelope_acl_invalid",
            "windows_bootstrap_envelope_publish_failed",
        }:
            pytest.skip("test process lacks an installer-created SYSTEM/service-only directory")
        raise
    assert api.read(path, service_sid=sid, maximum_bytes=65536) == ciphertext
    import win32security

    descriptor = win32security.GetFileSecurity(str(path), win32security.DACL_SECURITY_INFORMATION)
    sddl = str(win32security.ConvertSecurityDescriptorToStringSecurityDescriptor(
        descriptor, win32security.SDDL_REVISION_1,
        win32security.OWNER_SECURITY_INFORMATION | win32security.DACL_SECURITY_INFORMATION,
    ))
    assert "D:P" in sddl and sid in sddl
    api.delete(path, service_sid=sid)
    assert not path.exists()
