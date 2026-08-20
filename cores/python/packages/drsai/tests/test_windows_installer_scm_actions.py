from __future__ import annotations

import os
import sqlite3
import uuid
from dataclasses import replace
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    NativeWindowsInstallerScmApi,
    VerifiedWindowsSecurityInstallation,
    VerifiedWindowsSecurityPackageCatalog,
    WindowsInstallerOperationJournal,
    WindowsInstallerScmActionError,
    WindowsInstallerScmActionJournal,
    WindowsInstallerScmConfiguration,
    WindowsInstallerServiceSafetyEvidence,
    WindowsServiceConfigurationEvidence,
)


SERVICE_NAME = "OpenDrSaiSecurityRuntime"
SERVICE_SID = "S-1-5-80-123456"
ARTIFACT_DIGEST = "sha256:" + "4" * 64


class FakeSafetyController:
    def __init__(self, *, registered: bool, previous_start_type: str | None):
        self.registered = registered
        self.previous_start_type = previous_start_type

    def ensure_disabled_and_stopped(self, service_name: str):
        return WindowsInstallerServiceSafetyEvidence(
            service_name, True, True, 0, self.registered, self.previous_start_type,
        )


class FakeScmApi:
    def __init__(self, current=None):
        self.current = current
        self.register_calls = 0
        self.restore_calls = 0
        self.delete_calls = 0
        self.safe_calls = 0

    def inspect_optional(self, service_name: str):
        if self.current is not None:
            assert self.current.service_name == service_name
        return self.current

    def register_disabled(self, desired, ownership_marker, *, create):
        assert create == (self.current is None)
        self.register_calls += 1
        self.current = replace(desired, description=ownership_marker)
        return self.current

    def restore(self, snapshot, ownership_marker):
        assert (
            self.current.description == ownership_marker
            or self.current == replace(snapshot, start_type="disabled")
        )
        self.restore_calls += 1
        self.current = snapshot
        return self.current

    def delete_owned(self, service_name, ownership_marker):
        assert self.current.service_name == service_name
        assert self.current.description == ownership_marker
        self.delete_calls += 1
        self.current = None
        return True

    def fail_safe_disable_and_stop(self, service_name):
        self.safe_calls += 1
        if self.current is not None:
            self.current = replace(self.current, start_type="disabled")


class CrashAfterRegister(FakeScmApi):
    def __init__(self, current=None):
        super().__init__(current)
        self.crashed = False

    def register_disabled(self, desired, ownership_marker, *, create):
        result = super().register_disabled(desired, ownership_marker, create=create)
        if not self.crashed:
            self.crashed = True
            raise SimulatedCrash()
        return result


class SimulatedCrash(BaseException):
    pass


def catalog(tmp_path: Path):
    install = tmp_path / "installed"
    install.mkdir()
    binary = install / "service.exe"
    binary.write_bytes(b"promoted-service")
    value = VerifiedWindowsSecurityPackageCatalog(
        catalog_path=install / "catalog.json", install_root=install,
        catalog_id="opendrsai-windows-security-package", version=2,
        digest="sha256:" + "1" * 64, key_id="release-key",
        product="OpenDrSai", channel="stable", runtime_build_digest="sha256:" + "2" * 64,
        installation_metadata_filename="installation.json",
        installation_metadata_id="opendrsai-installation",
        installation_metadata_digest="sha256:" + "3" * 64,
        installation_metadata_minimum_version=1,
        release_pins_filename="pins.json", release_pins_file_digest="sha256:" + "5" * 64,
        service_name=SERVICE_NAME, service_sid=SERVICE_SID,
        service_start_account="LocalSystem", service_start_type="automatic",
        service_sid_type="unrestricted", service_delayed_auto_start=False,
        trusted_writer_sids=("S-1-5-18",), not_before=50, expires_at=250,
    )
    return value, binary


def prior(binary: Path):
    return WindowsInstallerScmConfiguration(
        SERVICE_NAME, SERVICE_SID, str(binary.with_name("old-service.exe")),
        "LocalSystem", "disabled", "own_process", "unrestricted", False,
        "OpenDrSai stable service",
    )


def prepared(tmp_path: Path, *, existing=True, api=None):
    package, binary = catalog(tmp_path)
    database = tmp_path / "security.sqlite3"
    safety = FakeSafetyController(
        registered=existing, previous_start_type="automatic" if existing else None,
    )
    installer = WindowsInstallerOperationJournal(database, safety, clock=lambda: 100)
    operation = installer.begin("upgrade" if existing else "install", package)
    installer.mark_artifacts_staged(operation.operation_id, ARTIFACT_DIGEST)
    current = prior(binary) if existing else None
    scm_api = api or FakeScmApi(current)
    actions = WindowsInstallerScmActionJournal(
        database, installer, scm_api, clock=lambda: 100,
    )
    action = actions.prepare(installer.get(operation.operation_id), package, binary)
    assert actions.get_for_operation(operation.operation_id) == action
    return (
        database, installer, installer.get(operation.operation_id), actions, action,
        scm_api, package,
    )


def test_existing_service_snapshot_register_and_exact_restore(tmp_path: Path) -> None:
    _, installer, operation, actions, action, api, _ = prepared(tmp_path)
    assert action.prior_registered and action.snapshot.start_type == "automatic"
    assert action.snapshot.description == "OpenDrSai stable service"
    registered = actions.register(action.action_id)
    assert registered.state == "registered"
    assert api.current.start_type == "disabled"
    assert api.current.description == action.ownership_marker

    rolled = installer.rollback(operation.operation_id, actions.rollback, reason="upgrade_failure")
    assert rolled.state == "rolled_back"
    assert actions.get(action.action_id).state == "rolled_back"
    assert api.current == action.snapshot
    assert api.restore_calls == 1


def test_new_owned_service_is_deleted_but_unowned_collision_is_preserved(tmp_path: Path) -> None:
    _, installer, operation, actions, action, api, _ = prepared(tmp_path, existing=False)
    actions.register(action.action_id)
    installer.rollback(operation.operation_id, actions.rollback, reason="install_failure")
    assert api.current is None and api.delete_calls == 1

    other = tmp_path / "other"
    other.mkdir()
    _, installer2, operation2, actions2, action2, api2, _ = prepared(other, existing=False)
    actions2.register(action2.action_id)
    api2.current = replace(api2.current, description="attacker-owned")
    rolled = installer2.rollback(
        operation2.operation_id, actions2.rollback, reason="ownership_lost",
    )
    assert rolled.state == "rollback_failed"
    assert api2.current is not None and api2.delete_calls == 0
    assert api2.safe_calls == 1


def test_crash_after_create_is_adopted_only_with_exact_marker_and_configuration(
    tmp_path: Path,
) -> None:
    api = CrashAfterRegister()
    database, installer, _, actions, action, _, _ = prepared(
        tmp_path, existing=False, api=api,
    )
    with pytest.raises(SimulatedCrash):
        actions.register(action.action_id)
    recovered = WindowsInstallerScmActionJournal(
        database, installer, api, clock=lambda: 101,
    )
    assert recovered.register(action.action_id).state == "registered"
    assert api.register_calls == 1


def test_snapshot_uses_pre_disable_start_type_and_rejects_service_drift(tmp_path: Path) -> None:
    _, _, operation, actions, action, api, _ = prepared(tmp_path)
    assert operation.prior_service_registered
    assert operation.prior_service_start_type == "automatic"
    assert action.snapshot.start_type == "automatic"
    api.current = replace(api.current, service_sid="S-1-5-80-999")
    with pytest.raises(WindowsInstallerScmActionError) as drift:
        actions.register(action.action_id)
    assert drift.value.code == "windows_installer_scm_prechange_identity_drift"
    assert api.safe_calls == 1


def test_scm_events_are_append_only(tmp_path: Path) -> None:
    database, _, _, actions, action, _, _ = prepared(tmp_path)
    actions.register(action.action_id)
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.DatabaseError):
            connection.execute("DELETE FROM runtime_windows_installer_scm_events")
        with pytest.raises(sqlite3.DatabaseError):
            connection.execute(
                "UPDATE runtime_windows_installer_scm_actions SET desired_json='{}'",
            )


def test_restore_retry_accepts_only_exact_prior_snapshot_disabled_by_recovery(
    tmp_path: Path,
) -> None:
    _, installer, operation, actions, action, api, _ = prepared(tmp_path)
    actions.register(action.action_id)
    api.current = replace(action.snapshot, start_type="disabled")
    rolled = installer.rollback(
        operation.operation_id, actions.rollback, reason="restore_commit_crash",
    )
    assert rolled.state == "rolled_back"
    assert api.current == action.snapshot
    assert api.restore_calls == 1


def test_scm_action_commits_only_after_installer_verified_commit(tmp_path: Path) -> None:
    _, installer, operation, actions, action, api, package = prepared(tmp_path)
    actions.register(action.action_id)
    with pytest.raises(WindowsInstallerScmActionError) as early:
        actions.mark_committed(action.action_id)
    assert early.value.code == "windows_installer_scm_commit_not_authorized"

    installer.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
    )
    service = WindowsServiceConfigurationEvidence(
        SERVICE_NAME, SERVICE_SID, api.current.binary_path, "LocalSystem", "disabled",
        "own_process", "unrestricted", False,
    )
    installation = VerifiedWindowsSecurityInstallation(
        "opendrsai-installation", 1, package.installation_metadata_digest,
        package.install_root, SERVICE_NAME, SERVICE_SID, service, (), "installer_safe",
    )
    installer.mark_package_verified(operation.operation_id, package, installation)
    installer.commit(operation.operation_id, package, installation)
    assert actions.mark_committed(action.action_id).state == "committed"


@pytest.mark.skipif(os.name != "nt", reason="native SCM adapter requires Windows")
def test_native_scm_action_inspects_missing_service_without_creating_it() -> None:
    api = NativeWindowsInstallerScmApi(delete_timeout_seconds=0.1)
    assert api.inspect_optional(f"OpenDrSaiMissing-{uuid.uuid4()}") is None


@pytest.mark.skipif(os.name != "nt", reason="Windows binary path normalization")
def test_native_binary_path_normalization_rejects_arguments_and_expansion() -> None:
    path = r"C:\Program Files\OpenDrSai\service.exe"
    assert NativeWindowsInstallerScmApi._binary_path(f'"{path}"') == f'"{path}"'
    with pytest.raises(WindowsInstallerScmActionError):
        NativeWindowsInstallerScmApi._binary_path(f'"{path}" --attacker')
    with pytest.raises(WindowsInstallerScmActionError):
        NativeWindowsInstallerScmApi._binary_path(r"%TEMP%\service.exe")
