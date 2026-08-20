from __future__ import annotations

import dataclasses
import os
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    VerifiedWindowsSecurityInstallation,
    VerifiedWindowsSecurityPackageCatalog,
    NativeWindowsInstallerSafetyController,
    WindowsInstallerJournalError,
    WindowsInstallerOperationJournal,
    WindowsInstallerServiceSafetyEvidence,
    WindowsServiceBootstrapAuthorization,
    WindowsServiceConfigurationEvidence,
)


SERVICE_NAME = "OpenDrSaiSecurityRuntime"
SERVICE_SID = "S-1-5-80-123456"
CATALOG_DIGEST = "sha256:" + "1" * 64
BUILD_DIGEST = "sha256:" + "2" * 64
METADATA_DIGEST = "sha256:" + "3" * 64
STAGED_DIGEST = "sha256:" + "4" * 64


class FakeSafetyController:
    def __init__(self):
        self.safe = True
        self.calls: list[str] = []

    def ensure_disabled_and_stopped(self, service_name: str):
        self.calls.append(service_name)
        return WindowsInstallerServiceSafetyEvidence(
            service_name, self.safe, self.safe, 0 if self.safe else 1,
        )


def _identities(tmp_path: Path):
    root = (tmp_path / "installed").resolve()
    root.mkdir(exist_ok=True)
    catalog = VerifiedWindowsSecurityPackageCatalog(
        catalog_path=root / "catalog.json", install_root=root,
        catalog_id="opendrsai-windows-security-package", version=7,
        digest=CATALOG_DIGEST, key_id="catalog-key", product="OpenDrSai", channel="stable",
        runtime_build_digest=BUILD_DIGEST,
        installation_metadata_filename="windows-security-installation.json",
        installation_metadata_id="opendrsai-windows-security-installation",
        installation_metadata_digest=METADATA_DIGEST,
        installation_metadata_minimum_version=2,
        release_pins_filename="security-observability-release-pins.json",
        release_pins_file_digest="sha256:" + "5" * 64,
        service_name=SERVICE_NAME, service_sid=SERVICE_SID,
        service_start_account="LocalSystem", service_start_type="automatic",
        service_sid_type="unrestricted", service_delayed_auto_start=False,
        trusted_writer_sids=("S-1-5-18",), not_before=50, expires_at=250,
    )
    service = WindowsServiceConfigurationEvidence(
        SERVICE_NAME, SERVICE_SID, str(root / "service.exe"), "LocalSystem",
        "disabled", "own_process", "unrestricted", False,
    )
    installation = VerifiedWindowsSecurityInstallation(
        metadata_id="opendrsai-windows-security-installation", version=2,
        metadata_digest=METADATA_DIGEST, install_root=root,
        service_name=SERVICE_NAME, service_sid=SERVICE_SID,
        service_configuration=service, artifacts=(),
        service_configuration_phase="installer_safe",
    )
    return catalog, installation


def _advance_to_registered(journal, catalog, installation):
    operation = journal.begin("install", catalog)
    journal.mark_artifacts_staged(operation.operation_id, STAGED_DIGEST)
    journal.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
    )
    journal.mark_package_verified(operation.operation_id, catalog, installation)
    return journal.get(operation.operation_id)


def test_verified_install_commit_and_single_use_bootstrap_authorization(tmp_path: Path) -> None:
    catalog, installation = _identities(tmp_path)
    controller, now = FakeSafetyController(), {"value": 100.0}
    journal = WindowsInstallerOperationJournal(
        tmp_path / "installer.sqlite3", controller,
        clock=lambda: now["value"], bootstrap_ttl_seconds=30,
    )
    operation = _advance_to_registered(journal, catalog, installation)
    committed = journal.commit(operation.operation_id, catalog, installation)
    assert committed.state == "committed"
    authorization = journal.issue_bootstrap_authorization(
        operation.operation_id, catalog, installation,
    )
    assert authorization.token not in (tmp_path / "installer.sqlite3").read_bytes().decode(
        "latin-1", errors="ignore",
    )
    receipt = journal.consume_bootstrap_authorization(authorization, catalog, installation)
    with pytest.raises(WindowsInstallerJournalError) as replay:
        journal.consume_bootstrap_authorization(authorization, catalog, installation)
    assert replay.value.code == "windows_installer_bootstrap_invalid"
    with pytest.raises(WindowsInstallerJournalError) as duplicate:
        journal.issue_bootstrap_authorization(operation.operation_id, catalog, installation)
    assert duplicate.value.code == "windows_installer_bootstrap_already_issued"
    WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
        tmp_path / "installer.sqlite3", receipt, clock=lambda: 101,
    )
    with pytest.raises(WindowsInstallerJournalError) as claimed_twice:
        WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
            tmp_path / "installer.sqlite3", receipt, clock=lambda: 101,
        )
    assert claimed_twice.value.code == "windows_installer_bootstrap_receipt_invalid"


def test_publish_first_authorization_is_not_consumable_until_durable_record(
    tmp_path: Path,
) -> None:
    catalog, installation = _identities(tmp_path)
    journal = WindowsInstallerOperationJournal(
        tmp_path / "installer.sqlite3", FakeSafetyController(), clock=lambda: 100,
    )
    operation = _advance_to_registered(journal, catalog, installation)
    journal.commit(operation.operation_id, catalog, installation)

    prepared = journal.prepare_bootstrap_authorization(
        operation.operation_id, catalog, installation,
    )
    assert journal.bootstrap_authorization_status_by_identity(
        operation.operation_id, prepared.authorization_id,
    ) is None
    with pytest.raises(WindowsInstallerJournalError) as premature:
        journal.consume_bootstrap_authorization(prepared, catalog, installation)
    assert premature.value.code == "windows_installer_bootstrap_invalid"

    assert journal.record_bootstrap_authorization(
        prepared, catalog, installation,
    ) == prepared
    assert journal.bootstrap_authorization_status_by_identity(
        operation.operation_id, prepared.authorization_id,
    ) == "issued"
    assert journal.consume_bootstrap_authorization(
        prepared, catalog, installation,
    ).authorization_id == prepared.authorization_id


def test_install_verification_and_token_issue_require_installer_safe_scm_phase(
    tmp_path: Path,
) -> None:
    catalog, staged = _identities(tmp_path)
    final = dataclasses.replace(
        staged,
        service_configuration=dataclasses.replace(
            staged.service_configuration, start_type="automatic",
        ),
        service_configuration_phase="final",
    )
    journal = WindowsInstallerOperationJournal(
        tmp_path / "installer.sqlite3", FakeSafetyController(), clock=lambda: 100,
    )
    operation = journal.begin("install", catalog)
    journal.mark_artifacts_staged(operation.operation_id, STAGED_DIGEST)
    journal.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
    )
    with pytest.raises(WindowsInstallerJournalError) as unsafe_verify:
        journal.mark_package_verified(operation.operation_id, catalog, final)
    assert unsafe_verify.value.code == "windows_installer_verified_identity_mismatch"

    journal.mark_package_verified(operation.operation_id, catalog, staged)
    journal.commit(operation.operation_id, catalog, staged)
    with pytest.raises(WindowsInstallerJournalError) as unsafe_issue:
        journal.issue_bootstrap_authorization(operation.operation_id, catalog, final)
    assert unsafe_issue.value.code == "windows_installer_bootstrap_not_authorized"
    assert journal.issue_bootstrap_authorization(
        operation.operation_id, catalog, staged,
    ).service_name == SERVICE_NAME


def test_bootstrap_tamper_expiry_and_identity_mismatch_fail_closed(tmp_path: Path) -> None:
    catalog, installation = _identities(tmp_path)
    controller, now = FakeSafetyController(), {"value": 100.0}
    journal = WindowsInstallerOperationJournal(
        tmp_path / "installer.sqlite3", controller,
        clock=lambda: now["value"], bootstrap_ttl_seconds=10,
    )
    operation = _advance_to_registered(journal, catalog, installation)
    journal.commit(operation.operation_id, catalog, installation)
    authorization = journal.issue_bootstrap_authorization(
        operation.operation_id, catalog, installation,
    )
    tampered = dataclasses.replace(authorization, token="attacker-token")
    with pytest.raises(WindowsInstallerJournalError) as token:
        journal.consume_bootstrap_authorization(tampered, catalog, installation)
    assert token.value.code == "windows_installer_bootstrap_invalid"
    now["value"] = 111
    with pytest.raises(WindowsInstallerJournalError) as expired:
        journal.consume_bootstrap_authorization(authorization, catalog, installation)
    assert expired.value.code == "windows_installer_bootstrap_invalid"

    other = dataclasses.replace(catalog, digest="sha256:" + "9" * 64)
    with pytest.raises(WindowsInstallerJournalError) as mismatch:
        journal.issue_bootstrap_authorization(operation.operation_id, other, installation)
    assert mismatch.value.code == "windows_installer_bootstrap_not_authorized"


@pytest.mark.parametrize("crash_state", [
    "safe_disabled", "artifacts_staged", "package_verified", "service_registered",
])
def test_restart_recovery_disables_service_before_rolling_back_each_stage(
    tmp_path: Path, crash_state: str,
) -> None:
    catalog, installation = _identities(tmp_path)
    controller = FakeSafetyController()
    database = tmp_path / "installer.sqlite3"
    journal = WindowsInstallerOperationJournal(database, controller, clock=lambda: 100)
    operation = journal.begin("upgrade", catalog)
    if crash_state in {"artifacts_staged", "package_verified", "service_registered"}:
        journal.mark_artifacts_staged(operation.operation_id, STAGED_DIGEST)
    if crash_state in {"service_registered", "package_verified"}:
        journal.mark_service_registered(
            operation.operation_id,
            WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
        )
    if crash_state == "package_verified":
        journal.mark_package_verified(operation.operation_id, catalog, installation)
    calls_before = len(controller.calls)
    observed: list[tuple[str, int]] = []
    recovered = WindowsInstallerOperationJournal(
        database, controller, clock=lambda: 101,
    ).recover_incomplete(
        lambda item: observed.append((item.state, len(controller.calls))),
    )
    assert recovered[0].state == "rolled_back"
    assert observed == [("rolling_back", calls_before + 1)]


def test_rollback_failure_is_durable_safe_and_retryable(tmp_path: Path) -> None:
    catalog, _ = _identities(tmp_path)
    controller = FakeSafetyController()
    database = tmp_path / "installer.sqlite3"
    journal = WindowsInstallerOperationJournal(database, controller)
    operation = journal.begin("repair", catalog)

    def fail(_operation):
        raise OSError("injected rollback failure")

    failed = journal.rollback(operation.operation_id, fail, reason="startup_recovery")
    assert failed.state == "rollback_failed"
    assert failed.error_code == "OSError"
    recovered = WindowsInstallerOperationJournal(database, controller).recover_incomplete(lambda _item: None)
    assert recovered[0].state == "rolled_back"


def test_unsafe_service_conflict_invalid_transition_and_event_mutation_fail_closed(tmp_path: Path) -> None:
    catalog, installation = _identities(tmp_path)
    controller = FakeSafetyController()
    database = tmp_path / "installer.sqlite3"
    journal = WindowsInstallerOperationJournal(database, controller)
    operation = journal.begin("install", catalog)
    with pytest.raises(WindowsInstallerJournalError) as conflict:
        journal.begin("upgrade", catalog)
    assert conflict.value.code == "windows_installer_operation_conflict"
    with pytest.raises(WindowsInstallerJournalError) as order:
        journal.mark_package_verified(operation.operation_id, catalog, installation)
    assert order.value.code == "windows_installer_transition_invalid"
    with pytest.raises(WindowsInstallerJournalError) as reason:
        journal.rollback(operation.operation_id, lambda _item: None, reason="secret\nvalue")
    assert reason.value.code == "windows_installer_reason_invalid"

    controller.safe = False
    with pytest.raises(WindowsInstallerJournalError) as unsafe:
        journal.mark_artifacts_staged(operation.operation_id, STAGED_DIGEST)
    assert unsafe.value.code == "windows_installer_service_not_safe"
    assert journal.get(operation.operation_id).state == "safe_disabled"

    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.DatabaseError):
            connection.execute("DELETE FROM runtime_windows_installer_events")


def test_verified_identity_substitution_is_rejected_before_state_change(tmp_path: Path) -> None:
    catalog, installation = _identities(tmp_path)
    journal = WindowsInstallerOperationJournal(tmp_path / "installer.sqlite3", FakeSafetyController())
    operation = journal.begin("install", catalog)
    journal.mark_artifacts_staged(operation.operation_id, STAGED_DIGEST)
    journal.mark_service_registered(
        operation.operation_id,
        WindowsInstallerServiceSafetyEvidence(SERVICE_NAME, True, True, 0),
    )
    other_installation = dataclasses.replace(
        installation, metadata_digest="sha256:" + "8" * 64,
    )
    with pytest.raises(WindowsInstallerJournalError) as rejected:
        journal.mark_package_verified(operation.operation_id, catalog, other_installation)
    assert rejected.value.code == "windows_installer_verified_identity_mismatch"
    assert journal.get(operation.operation_id).state == "service_registered"


def test_concurrent_recovery_executes_privileged_rollback_handler_once(tmp_path: Path) -> None:
    catalog, _ = _identities(tmp_path)
    database = tmp_path / "installer.sqlite3"
    first = WindowsInstallerOperationJournal(database, FakeSafetyController())
    operation = first.begin("upgrade", catalog)
    entered, release = threading.Event(), threading.Event()
    calls: list[str] = []

    def handler(item):
        calls.append(item.operation_id)
        entered.set()
        assert release.wait(timeout=5)

    second = WindowsInstallerOperationJournal(database, FakeSafetyController())
    with ThreadPoolExecutor(max_workers=2) as pool:
        first_future = pool.submit(first.rollback, operation.operation_id, handler, reason="startup_recovery")
        assert entered.wait(timeout=5)
        second_future = pool.submit(second.rollback, operation.operation_id, handler, reason="startup_recovery")
        release.set()
        assert first_future.result(timeout=10).state == "rolled_back"
        with pytest.raises(WindowsInstallerJournalError) as rejected:
            second_future.result(timeout=10)
    assert rejected.value.code == "windows_installer_transition_invalid"
    assert calls == [operation.operation_id]


def test_new_upgrade_revokes_unconsumed_bootstrap_from_prior_install(tmp_path: Path) -> None:
    catalog, installation = _identities(tmp_path)
    controller = FakeSafetyController()
    journal = WindowsInstallerOperationJournal(tmp_path / "installer.sqlite3", controller)
    first = _advance_to_registered(journal, catalog, installation)
    journal.commit(first.operation_id, catalog, installation)
    authorization = journal.issue_bootstrap_authorization(
        first.operation_id, catalog, installation,
    )
    second = journal.begin("upgrade", catalog)
    assert second.state == "safe_disabled"
    with pytest.raises(WindowsInstallerJournalError) as revoked:
        journal.consume_bootstrap_authorization(authorization, catalog, installation)
    assert revoked.value.code == "windows_installer_bootstrap_invalid"
    with pytest.raises(WindowsInstallerJournalError) as superseded:
        journal.issue_bootstrap_authorization(first.operation_id, catalog, installation)
    assert superseded.value.code == "windows_installer_bootstrap_superseded"


def test_consumed_receipt_is_expired_forgery_checked_and_superseded_by_upgrade(tmp_path: Path) -> None:
    catalog, installation = _identities(tmp_path)
    now, database = {"value": 100.0}, tmp_path / "installer.sqlite3"
    journal = WindowsInstallerOperationJournal(
        database, FakeSafetyController(), clock=lambda: now["value"], bootstrap_ttl_seconds=10,
    )
    operation = _advance_to_registered(journal, catalog, installation)
    journal.commit(operation.operation_id, catalog, installation)
    authorization = journal.issue_bootstrap_authorization(
        operation.operation_id, catalog, installation,
    )
    receipt = journal.consume_bootstrap_authorization(authorization, catalog, installation)
    forged = dataclasses.replace(receipt, runtime_build_digest="sha256:" + "8" * 64)
    with pytest.raises(WindowsInstallerJournalError) as invalid:
        WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
            database, forged, clock=lambda: now["value"],
        )
    assert invalid.value.code == "windows_installer_bootstrap_receipt_invalid"
    now["value"] = 111
    with pytest.raises(WindowsInstallerJournalError) as expired:
        WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
            database, receipt, clock=lambda: now["value"],
        )
    assert expired.value.code == "windows_installer_bootstrap_receipt_invalid"

    now["value"] = 100
    journal.begin("upgrade", catalog)
    with pytest.raises(WindowsInstallerJournalError) as superseded:
        WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
            database, receipt, clock=lambda: now["value"],
        )
    assert superseded.value.code == "windows_installer_bootstrap_receipt_invalid"


@pytest.mark.skipif(os.name != "nt", reason="native SCM safety controller requires Windows")
def test_native_scm_safety_controller_treats_absent_service_as_stopped_and_disabled() -> None:
    service_name = f"OpenDrSaiDefinitelyAbsent{uuid.uuid4().hex}"
    evidence = NativeWindowsInstallerSafetyController().ensure_disabled_and_stopped(service_name)
    assert evidence == WindowsInstallerServiceSafetyEvidence(
        service_name, disabled=True, stopped=True, process_count=0, registered=False,
        previous_start_type=None,
    )
