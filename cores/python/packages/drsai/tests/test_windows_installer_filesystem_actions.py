from __future__ import annotations

import hashlib
import os
import sqlite3
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pytest

from drsai.backend.runtime.security_boundary import (
    VerifiedWindowsSecurityInstallation,
    VerifiedWindowsSecurityPackageCatalog,
    WindowsInstallerArtifactInput,
    WindowsInstallerFilesystemActionError,
    WindowsInstallerFilesystemActionJournal,
    NativeWindowsInstallerFilesystemApi,
    NativeWindowsInstallerTreeAclApi,
    NativeWindowsAclApi,
    WindowsInstallerOperationJournal,
    WindowsInstallerServiceSafetyEvidence,
    WindowsServiceConfigurationEvidence,
    current_process_sid,
)


SERVICE_NAME = "OpenDrSaiSecurityRuntime"
SERVICE_SID = "S-1-5-80-123456"


class SimulatedCrash(BaseException):
    pass


class FakeSafetyController:
    def ensure_disabled_and_stopped(self, service_name: str):
        return WindowsInstallerServiceSafetyEvidence(service_name, True, True, 0)


class FakeAclApi:
    def __init__(self):
        self.policies: dict[tuple[int, int], tuple[bool, bool]] = {}

    @staticmethod
    def _key(path: Path) -> tuple[int, int]:
        information = path.stat(follow_symlinks=False)
        return information.st_dev, information.st_ino

    def apply(self, path: Path, *, directory: bool, service_read: bool) -> None:
        self.policies[self._key(path)] = (directory, service_read)

    def verify(self, path: Path, *, directory: bool, service_read: bool) -> None:
        if self.policies.get(self._key(path)) != (directory, service_read):
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_invalid", "fake ACL mismatch",
            )

    def verify_parent(self, path: Path) -> None:
        assert path.is_dir()

    def seed_release(self, root: Path) -> None:
        self.apply(root, directory=True, service_read=True)
        for item in root.iterdir():
            self.apply(item, directory=False, service_read=True)


def digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def fixture(tmp_path: Path, *, existing=True):
    package = tmp_path / "package"
    package.mkdir()
    payloads = {
        "catalog.json": b"signed-catalog-v2",
        "service.exe": b"signed-service-v2",
        "worker.exe": b"signed-worker-v2",
    }
    for filename, content in payloads.items():
        (package / filename).write_bytes(content)
    install = tmp_path / "installed"
    if existing:
        install.mkdir()
        (install / "old-service.exe").write_bytes(b"signed-service-v1")
    catalog = VerifiedWindowsSecurityPackageCatalog(
        catalog_path=package / "catalog.json", install_root=install,
        catalog_id="opendrsai-windows-security-package", version=2,
        digest="sha256:" + "1" * 64, key_id="release-key",
        product="OpenDrSai", channel="stable", runtime_build_digest="sha256:" + "2" * 64,
        installation_metadata_filename="installation.json",
        installation_metadata_id="opendrsai-installation",
        installation_metadata_digest="sha256:" + "3" * 64,
        installation_metadata_minimum_version=1,
        release_pins_filename="pins.json", release_pins_file_digest="sha256:" + "4" * 64,
        service_name=SERVICE_NAME, service_sid=SERVICE_SID,
        service_start_account="LocalSystem", service_start_type="automatic",
        service_sid_type="unrestricted", service_delayed_auto_start=False,
        trusted_writer_sids=("S-1-5-18",), not_before=50, expires_at=250,
    )
    artifacts = tuple(
        WindowsInstallerArtifactInput(filename, digest(content))
        for filename, content in payloads.items()
    )
    database = tmp_path / "security.sqlite3"
    installer = WindowsInstallerOperationJournal(
        database, FakeSafetyController(), clock=lambda: 100,
    )
    operation = installer.begin("upgrade" if existing else "install", catalog)
    return package, install, catalog, artifacts, database, installer, operation


def staged_installation(catalog):
    return VerifiedWindowsSecurityInstallation(
        "opendrsai-installation", 1, catalog.installation_metadata_digest,
        catalog.install_root, catalog.service_name, catalog.service_sid,
        WindowsServiceConfigurationEvidence(
            catalog.service_name, catalog.service_sid,
            str(catalog.install_root / "service.exe"), "LocalSystem", "disabled",
            "own_process", "unrestricted", False,
        ),
        (), "installer_safe",
    )


def action_journal(database, installer, operation, *, clock=lambda: 100, fault_hook=None):
    acl = FakeAclApi()
    install = Path(operation.install_root)
    if install.exists():
        acl.seed_release(install)
    api = NativeWindowsInstallerFilesystemApi(
        ("S-1-5-18",), SERVICE_SID, acl_api=acl,
    )
    return WindowsInstallerFilesystemActionJournal(
        database, installer, api,
        trusted_writer_sids=("S-1-5-18",), service_sid=SERVICE_SID,
        clock=clock, fault_hook=fault_hook,
    )


def stage_action(tmp_path: Path, *, existing=True, fault_hook=None):
    package, install, catalog, artifacts, database, installer, operation = fixture(
        tmp_path, existing=existing,
    )
    actions = action_journal(
        database, installer, operation, fault_hook=fault_hook,
    )
    action = actions.prepare(operation, package, artifacts)
    assert actions.get_for_operation(operation.operation_id) == action
    action = actions.stage(action.action_id)
    installer.mark_artifacts_staged(operation.operation_id, action.artifact_set_digest)
    return package, install, catalog, database, installer, operation, actions, action


def test_native_stage_promote_and_commit_preserve_old_quarantine(tmp_path: Path) -> None:
    _, install, catalog, _, installer, operation, actions, action = stage_action(tmp_path)
    staged_identity = (
        action.staged_device_id,
        action.staged_file_id,
    )
    promoted = actions.promote(action.action_id)
    assert promoted.state == "promoted"
    assert {item.name for item in install.iterdir()} == {
        "catalog.json", "service.exe", "worker.exe",
    }
    assert (Path(action.quarantine_root) / "old-service.exe").read_bytes() == b"signed-service-v1"
    identity = actions.api.identity(install)
    assert (identity.device_id, identity.file_id) == staged_identity

    installer.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
    )
    installation = staged_installation(catalog)
    installer.mark_package_verified(operation.operation_id, catalog, installation)
    installer.commit(operation.operation_id, catalog, installation)
    assert actions.mark_committed(action.action_id).state == "committed"
    assert Path(action.quarantine_root).exists()


@pytest.mark.parametrize("crash_point", ["after_quarantine", "after_promote"])
def test_crash_after_atomic_rename_rolls_back_by_directory_identity(
    tmp_path: Path, crash_point: str,
) -> None:
    def fault(stage: str) -> None:
        if stage == crash_point:
            raise SimulatedCrash()

    _, install, _, database, installer, operation, actions, action = stage_action(
        tmp_path, fault_hook=fault,
    )
    with pytest.raises(SimulatedCrash):
        actions.promote(action.action_id)

    recovered = WindowsInstallerFilesystemActionJournal(
        database, installer, actions.api,
        trusted_writer_sids=("S-1-5-18",), service_sid=SERVICE_SID,
        clock=lambda: 101,
    )
    installer.rollback(operation.operation_id, recovered.rollback, reason="simulated_crash")
    assert (install / "old-service.exe").read_bytes() == b"signed-service-v1"
    assert recovered.get(action.action_id).state == "rolled_back"
    recovered.rollback(operation)
    assert (install / "old-service.exe").exists()


def test_promotion_retry_after_quarantine_crash_is_idempotent(tmp_path: Path) -> None:
    crashed = {"done": False}

    def fault(stage: str) -> None:
        if stage == "after_quarantine" and not crashed["done"]:
            crashed["done"] = True
            raise SimulatedCrash()

    _, install, _, database, installer, _, actions, action = stage_action(
        tmp_path, fault_hook=fault,
    )
    with pytest.raises(SimulatedCrash):
        actions.promote(action.action_id)
    retried = WindowsInstallerFilesystemActionJournal(
        database, installer, actions.api,
        trusted_writer_sids=("S-1-5-18",), service_sid=SERVICE_SID,
        clock=lambda: 101,
    )
    assert retried.promote(action.action_id).state == "promoted"
    assert (install / "service.exe").read_bytes() == b"signed-service-v2"


def test_staging_identity_replacement_and_quarantine_collision_fail_closed(tmp_path: Path) -> None:
    _, install, _, _, _, _, actions, action = stage_action(tmp_path)
    staging = Path(action.staging_root)
    replaced = staging.with_name("replaced-staging")
    os.rename(staging, replaced)
    staging.mkdir()
    (staging / "service.exe").write_bytes(b"attacker")
    with pytest.raises(WindowsInstallerFilesystemActionError) as replacement:
        actions.promote(action.action_id)
    assert replacement.value.code == "windows_installer_action_staged_identity_invalid"
    assert (install / "old-service.exe").exists()

    # A fresh transaction proves an attacker-controlled quarantine destination
    # blocks promotion before the original installation is moved.
    other = tmp_path / "other"
    other.mkdir()
    _, other_install, _, _, _, _, other_actions, other_action = stage_action(other)
    Path(other_action.quarantine_root).mkdir()
    with pytest.raises(WindowsInstallerFilesystemActionError) as collision:
        other_actions.promote(other_action.action_id)
    assert collision.value.code == "windows_installer_action_original_identity_lost"
    assert (other_install / "old-service.exe").exists()


def test_new_install_rollback_removes_promoted_root_without_deletion(tmp_path: Path) -> None:
    _, install, _, _, installer, operation, actions, action = stage_action(
        tmp_path, existing=False,
    )
    actions.promote(action.action_id)
    assert (install / "service.exe").exists()
    installer.rollback(operation.operation_id, actions.rollback, reason="new_install_failure")
    assert not install.exists()
    assert (Path(action.staging_root) / "service.exe").exists()


def test_stage_digest_mismatch_and_event_mutation_are_rejected(tmp_path: Path) -> None:
    package, _, _, artifacts, database, installer, operation = fixture(tmp_path)
    bad = list(artifacts)
    bad[0] = WindowsInstallerArtifactInput(bad[0].filename, "sha256:" + "0" * 64)
    actions = action_journal(database, installer, operation)
    action = actions.prepare(operation, package, bad)
    with pytest.raises(WindowsInstallerFilesystemActionError) as mismatch:
        actions.stage(action.action_id)
    assert mismatch.value.code == "windows_installer_action_artifact_changed"
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.DatabaseError):
            connection.execute(
                "UPDATE runtime_windows_installer_filesystem_events SET event='forged'",
            )


def test_partial_stage_retry_is_idempotent_and_concurrent_promote_is_single_winner(
    tmp_path: Path,
) -> None:
    package, _, _, artifacts, database, installer, operation = fixture(tmp_path)
    actions = action_journal(database, installer, operation)
    action = actions.prepare(operation, package, artifacts)
    staging = Path(action.staging_root)
    staging.mkdir()
    first = artifacts[0]
    (staging / first.filename).write_bytes((package / first.filename).read_bytes())
    actions.api.acl.apply(staging, directory=True, service_read=True)
    actions.api.acl.apply(staging / first.filename, directory=False, service_read=True)
    staged = actions.stage(action.action_id)
    assert len(tuple(staging.iterdir())) == len(artifacts)
    installer.mark_artifacts_staged(operation.operation_id, staged.artifact_set_digest)

    def promote_once():
        local = WindowsInstallerFilesystemActionJournal(
            database, installer, actions.api,
            trusted_writer_sids=("S-1-5-18",), service_sid=SERVICE_SID,
            clock=lambda: 101,
        )
        try:
            return local.promote(action.action_id).state
        except WindowsInstallerFilesystemActionError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _index: promote_once(), range(2)))
    assert outcomes.count("promoted") == 1
    assert outcomes.count("windows_installer_action_promotion_not_authorized") == 1


def test_quarantine_identity_replacement_makes_rollback_fail_closed(tmp_path: Path) -> None:
    _, install, _, _, installer, operation, actions, action = stage_action(tmp_path)
    actions.promote(action.action_id)
    quarantine = Path(action.quarantine_root)
    original_elsewhere = quarantine.with_name("original-preserved")
    os.rename(quarantine, original_elsewhere)
    quarantine.mkdir()
    (quarantine / "attacker").write_text("unknown", encoding="utf-8")
    rolled = installer.rollback(
        operation.operation_id, actions.rollback, reason="quarantine_replaced",
    )
    assert rolled.state == "rollback_failed"
    assert actions.get(action.action_id).state == "rollback_failed"
    assert not install.exists()
    assert (Path(action.staging_root) / "service.exe").exists()
    assert (original_elsewhere / "old-service.exe").exists()
    assert (quarantine / "attacker").exists()


def test_acl_policy_is_bound_and_tamper_is_rejected_before_old_tree_moves(tmp_path: Path) -> None:
    _, install, _, database, installer, operation, actions, action = stage_action(tmp_path)
    assert actions.api.acl.policies[actions.api.acl._key(Path(action.transaction_root))] == (
        True, False,
    )
    staging = Path(action.staging_root)
    assert actions.api.acl.policies[actions.api.acl._key(staging)] == (True, True)
    actions.api.acl.policies[actions.api.acl._key(staging)] = (True, False)
    with pytest.raises(WindowsInstallerFilesystemActionError) as acl_tamper:
        actions.promote(action.action_id)
    assert acl_tamper.value.code == "windows_installer_action_acl_invalid"
    assert (install / "old-service.exe").exists()
    assert not Path(action.quarantine_root).exists()

    mismatched = WindowsInstallerFilesystemActionJournal(
        database, installer, actions.api,
        trusted_writer_sids=("S-1-5-18", "S-1-5-32-544"),
        service_sid=SERVICE_SID, clock=lambda: 101,
    )
    with pytest.raises(WindowsInstallerFilesystemActionError) as policy:
        mismatched.stage(action.action_id)
    assert policy.value.code == "windows_installer_action_acl_policy_mismatch"


@pytest.mark.skipif(os.name != "nt", reason="native protected DACL evidence requires Windows")
def test_native_installer_tree_acl_rejects_added_writer(tmp_path: Path) -> None:
    writer = current_process_sid()
    root = tmp_path / "release"
    root.mkdir()
    artifact = root / "service.exe"
    artifact.write_bytes(b"service")
    acl = NativeWindowsInstallerTreeAclApi((writer,), SERVICE_SID)
    acl.apply(root, directory=True, service_read=True)
    acl.apply(artifact, directory=False, service_read=True)
    acl.verify(root, directory=True, service_read=True)
    acl.verify(artifact, directory=False, service_read=True)

    projection = NativeWindowsAclApi()
    projection.grant(artifact, "S-1-1-0", writable=True, directory=False)
    with pytest.raises(WindowsInstallerFilesystemActionError) as writer_added:
        acl.verify(artifact, directory=False, service_read=True)
    assert writer_added.value.code == "windows_installer_action_acl_invalid"

    parent = tmp_path / "transaction-parent"
    parent.mkdir()
    acl.apply(parent, directory=True, service_read=False)
    acl.verify_parent(parent)
    projection.grant(parent, "S-1-1-0", writable=True, directory=True)
    with pytest.raises(WindowsInstallerFilesystemActionError) as parent_writer:
        acl.verify_parent(parent)
    assert parent_writer.value.code == "windows_installer_action_parent_acl_invalid"
