from pathlib import Path
from types import SimpleNamespace
import multiprocessing
import os
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from drsai.backend.runtime.security_boundary import (
    VerifiedWindowsSecurityPackageCatalog,
    WindowsInstallerCoordinator,
    WindowsInstallerCoordinatorError,
    WindowsInstallerOperation,
    WindowsInstallerJournalError,
    WindowsInstallerServiceSafetyEvidence,
    WindowsInstallerServiceStartEvidence,
    WindowsServiceBootstrapAuthorization,
    PublishedWindowsServiceBootstrapEnvelope,
)


DIGESTS = tuple("sha256:" + value * 64 for value in "12345")


def catalog(tmp_path: Path):
    root = (tmp_path / "installed").resolve()
    return VerifiedWindowsSecurityPackageCatalog(
        root / "catalog.json", root, "catalog", 1, DIGESTS[0], "key", "OpenDrSai",
        "stable", DIGESTS[1], "installation.json", "installation", DIGESTS[2], 1,
        "pins.json", DIGESTS[3], "OpenDrSaiSecurityRuntime", "S-1-5-80-123",
        "LocalSystem", "automatic", "unrestricted", False, ("S-1-5-18",), 1, 999,
    )


class FakeInstaller:
    _INCOMPLETE = frozenset({"safe_disabled"})

    def __init__(self):
        self.operations = {}
        self.rollbacks = []
        self.authorization_status = None
        self.safety_controller = SimpleNamespace(
            ensure_disabled_and_stopped=lambda service_name:
            WindowsInstallerServiceSafetyEvidence(service_name, True, True, 0),
        )

    def begin(self, operation_type, value):
        number = len(self.operations) + 1
        operation = WindowsInstallerOperation(
            f"windows-installer-{number}", operation_type, "safe_disabled",
            str(value.install_root), value.service_name, value.service_sid, value.catalog_id,
            value.version, value.digest, value.runtime_build_digest,
            value.installation_metadata_digest, None, None, False, None, 1.0, 1.0,
        )
        self.operations[operation.operation_id] = operation
        return operation

    def get(self, operation_id):
        return self.operations[operation_id]

    def rollback(self, operation_id, handler, *, reason):
        del handler
        self.rollbacks.append((operation_id, reason))
        self.operations[operation_id] = self.operations[operation_id].__class__(
            **{**self.operations[operation_id].__dict__, "state": "rolled_back"}
        )
        return self.operations[operation_id]

    def bootstrap_authorization_status_by_identity(self, operation_id, authorization_id):
        assert operation_id in self.operations and authorization_id == "auth-1"
        return self.authorization_status

    def bootstrap_authorization_status(self, authorization, catalog, installation):
        del catalog, installation
        assert authorization.authorization_id == "auth-1"
        return self.authorization_status

    def record_bootstrap_authorization(self, authorization, catalog, installation):
        del catalog, installation
        self.authorization_status = "issued"
        return authorization


class FakeActivationApi:
    def __init__(self, *, running: bool):
        self.running = running
        self.fail_safe_calls = []

    def inspect_running(self, service_name):
        return WindowsInstallerServiceStartEvidence(
            service_name, self.running, 9001 if self.running else 0,
        )

    def fail_safe_disable_and_stop(self, service_name):
        self.fail_safe_calls.append(service_name)


class FakeActivation:
    def __init__(self, api):
        self.api = api


class FakeEnvelope:
    def __init__(self, authorization, published):
        self.authorization, self.published = authorization, published

    def inspect(self, catalog, installation):
        del catalog, installation
        return self.authorization, self.published


class MissingEnvelope:
    def inspect(self, catalog, installation):
        del catalog, installation
        raise WindowsInstallerJournalError("missing", "missing")


class FakeFilesystem:
    def __init__(self, action=None):
        self.action = action
        self.prepare_calls = 0
        self.stage_calls = 0

    def get_for_operation(self, operation_id):
        if self.action is not None:
            assert self.action.operation_id == operation_id
        return self.action

    def get(self, action_id):
        assert self.action.action_id == action_id
        return self.action

    def validated_artifact_set_digest(self, artifacts):
        del artifacts
        return DIGESTS[4]

    def prepare(self, operation, package_root, artifacts):
        del operation, package_root, artifacts
        self.prepare_calls += 1
        return self.action

    def stage(self, action_id):
        del action_id
        self.stage_calls += 1
        return self.action


def _race_coordinator_phase(database, operation_data, coordinator_id, ready, release, results):
    installer = FakeInstaller()
    operation = WindowsInstallerOperation(**operation_data)
    installer.operations[operation.operation_id] = operation
    inert = object()
    owner = WindowsInstallerCoordinator(
        Path(database), installer, inert, inert, inert, inert,
        installer_safe_verifier=lambda _catalog: None,
        final_verifier=lambda _catalog: None, clock=lambda: 20,
    )
    ready.put(True)
    release.wait(10)
    try:
        owner._transition(owner.get(coordinator_id), "filesystem_prepared")
    except WindowsInstallerCoordinatorError as error:
        results.put(error.code)
    else:
        results.put("committed")


def _kill_after_filesystem_prepare(
    database, operation_data, coordinator_id, value, package_root, action,
):
    installer = FakeInstaller()
    operation = WindowsInstallerOperation(**operation_data)
    installer.operations[operation.operation_id] = operation
    inert = object()

    def kill(phase):
        if phase == "after_filesystem_prepare":
            os._exit(77)

    owner = WindowsInstallerCoordinator(
        Path(database), installer, FakeFilesystem(action), inert, inert, inert,
        installer_safe_verifier=lambda _catalog: None,
        final_verifier=lambda _catalog: None, clock=lambda: 20, fault_hook=kill,
    )
    owner.advance(coordinator_id, value, package_root=Path(package_root), artifacts=())


def _claim_recovery_and_die(database, operation_data, coordinator_id, claimed):
    installer = FakeInstaller()
    operation = WindowsInstallerOperation(**operation_data)
    installer.operations[operation.operation_id] = operation
    inert = object()
    owner = WindowsInstallerCoordinator(
        Path(database), installer, inert, inert, inert, inert,
        installer_safe_verifier=lambda _catalog: None,
        final_verifier=lambda _catalog: None, clock=lambda: 100,
        recovery_lease_seconds=5,
    )
    leased = owner._acquire_recovery_lease(owner.get(coordinator_id))
    assert leased.recovery_owner and leased.recovery_expires_at == 105
    claimed.set()
    os._exit(79)

def coordinator(
    tmp_path: Path, installer: FakeInstaller, activation=None, envelope=None, filesystem=None,
    safe_verifier=None, final_verifier=None, clock=None, recovery_lease_seconds=300,
):
    inert = object()
    return WindowsInstallerCoordinator(
        tmp_path / "journal.sqlite3", installer, filesystem or inert, inert, envelope or inert,
        activation or inert,
        installer_safe_verifier=safe_verifier or (lambda _catalog: None),
        final_verifier=final_verifier or (lambda _catalog: None),
        clock=clock or (lambda: 10), recovery_lease_seconds=recovery_lease_seconds,
    )


def test_coordinator_identity_is_durable_and_stale_writer_is_rejected(tmp_path: Path) -> None:
    installer = FakeInstaller()
    owner = coordinator(tmp_path, installer)
    value = catalog(tmp_path)
    run = owner.start("install", value, binary_filename="service.exe")

    assert run.state == "safe_disabled"
    assert run.catalog_digest == value.digest
    assert owner.get(run.coordinator_id) == run
    moved = owner._transition(run, "filesystem_prepared", filesystem_action_id="fs-1")
    assert moved.filesystem_action_id == "fs-1"
    with pytest.raises(WindowsInstallerCoordinatorError) as raced:
        owner._transition(run, "filesystem_prepared")
    assert raced.value.code == "windows_installer_coordinator_raced"


def test_only_one_active_coordinator_may_own_install_root(tmp_path: Path) -> None:
    installer = FakeInstaller()
    owner = coordinator(tmp_path, installer)
    value = catalog(tmp_path)
    owner.start("install", value, binary_filename="service.exe")

    with pytest.raises(WindowsInstallerCoordinatorError) as conflict:
        owner.start("repair", value, binary_filename="service.exe")

    assert conflict.value.code == "windows_installer_coordinator_conflict"
    assert installer.rollbacks == []
    assert len(installer.operations) == 1


@pytest.mark.parametrize("running,expected", [(True, "completed"), (False, "recovery_required")])
def test_starting_intent_reconciles_consumed_authority_without_restarting(
    tmp_path: Path, running: bool, expected: str,
) -> None:
    installer = FakeInstaller()
    installer.authorization_status = "consumed"
    api = FakeActivationApi(running=running)
    owner = coordinator(tmp_path, installer, FakeActivation(api))
    value = catalog(tmp_path)
    run = owner.start("install", value, binary_filename="service.exe")
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    run = owner._transition(run, "starting", authorization_id="auth-1")

    result = owner.advance(run.coordinator_id, value)

    assert result.state == expected
    assert api.fail_safe_calls == ([] if running else [value.service_name])


def test_crash_after_envelope_publish_recovers_same_authority_before_issue(
    tmp_path: Path,
) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    authorization = WindowsServiceBootstrapAuthorization(
        "auth-1", "pending", "secret-token-material-that-is-long-enough", value.digest,
        value.installation_metadata_digest, value.service_name, 200,
    )
    published = PublishedWindowsServiceBootstrapEnvelope(
        str((tmp_path / "bootstrap.bin").resolve()), "auth-1", "pending", value.digest,
        value.runtime_build_digest, value.installation_metadata_digest,
        value.service_name, value.service_sid, 200,
    )
    envelope = FakeEnvelope(authorization, published)
    owner = coordinator(tmp_path, installer, FakeActivation(FakeActivationApi(running=False)), envelope)
    run = owner.start("install", value, binary_filename="service.exe")
    authorization = authorization.__class__(
        **{**authorization.__dict__, "operation_id": run.operation_id}
    )
    published = published.__class__(**{**published.__dict__, "operation_id": run.operation_id})
    envelope.authorization, envelope.published = authorization, published
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    run = owner._transition(run, "committed")

    recovered = owner.advance(run.coordinator_id, value)

    assert recovered.state == "envelope_published"
    assert recovered.authorization_id == "auth-1"
    assert installer.authorization_status == "issued"


def test_restart_adopts_existing_filesystem_action_and_completed_stage(
    tmp_path: Path,
) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    package = (tmp_path / "package").resolve()
    package.mkdir()
    action = SimpleNamespace(
        action_id="fs-1", operation_id="pending", state="staged",
        package_root=str(package), artifact_set_digest=DIGESTS[4],
    )
    filesystem = FakeFilesystem(action)
    owner = coordinator(tmp_path, installer, filesystem=filesystem)
    run = owner.start("install", value, binary_filename="service.exe")
    action.operation_id = run.operation_id

    prepared = owner.advance(run.coordinator_id, value, package_root=package, artifacts=())
    assert prepared.state == "filesystem_prepared"
    assert filesystem.prepare_calls == 0

    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__,
           "state": "artifacts_staged", "staged_artifact_set_digest": DIGESTS[4]}
    )
    staged = owner.advance(run.coordinator_id, value)
    assert staged.state == "artifacts_staged"
    assert filesystem.stage_calls == 0


def test_spawned_processes_allow_only_one_phase_commit(tmp_path: Path) -> None:
    installer = FakeInstaller()
    owner = coordinator(tmp_path, installer)
    value = catalog(tmp_path)
    run = owner.start("install", value, binary_filename="service.exe")
    operation = installer.operations[run.operation_id]
    context = multiprocessing.get_context("spawn")
    ready, results, release = context.Queue(), context.Queue(), context.Event()
    processes = [
        context.Process(
            target=_race_coordinator_phase,
            args=(str(tmp_path / "journal.sqlite3"), operation.__dict__,
                  run.coordinator_id, ready, release, results),
        )
        for _ in range(2)
    ]
    for process in processes:
        process.start()
    assert ready.get(timeout=15) and ready.get(timeout=15)
    release.set()
    outcomes = sorted(results.get(timeout=15) for _ in processes)
    for process in processes:
        process.join(15)
        assert process.exitcode == 0

    assert outcomes == ["committed", "windows_installer_coordinator_raced"]
    assert owner.get(run.coordinator_id).state == "filesystem_prepared"


def test_spawned_process_kill_between_child_action_and_phase_commit_is_recoverable(
    tmp_path: Path,
) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    package = (tmp_path / "package").resolve()
    package.mkdir()
    action = SimpleNamespace(
        action_id="fs-1", operation_id="pending", state="prepared",
        package_root=str(package), artifact_set_digest=DIGESTS[4],
    )
    filesystem = FakeFilesystem(action)
    owner = coordinator(tmp_path, installer, filesystem=filesystem)
    run = owner.start("install", value, binary_filename="service.exe")
    action.operation_id = run.operation_id
    context = multiprocessing.get_context("spawn")
    process = context.Process(
        target=_kill_after_filesystem_prepare,
        args=(str(tmp_path / "journal.sqlite3"),
              installer.operations[run.operation_id].__dict__, run.coordinator_id,
              value, str(package), action),
    )
    process.start()
    process.join(15)

    assert process.exitcode == 77
    assert owner.get(run.coordinator_id).state == "safe_disabled"
    recovered = owner.advance(
        run.coordinator_id, value, package_root=package, artifacts=(),
    )
    assert recovered.state == "filesystem_prepared"
    assert filesystem.prepare_calls == 0


def test_privileged_recovery_records_published_candidate_and_resumes_same_identity(
    tmp_path: Path,
) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    staged = object()
    authorization = WindowsServiceBootstrapAuthorization(
        "auth-1", "pending", "secret-token-material-that-is-long-enough", value.digest,
        value.installation_metadata_digest, value.service_name, 200,
    )
    published = PublishedWindowsServiceBootstrapEnvelope(
        str((tmp_path / "bootstrap.bin").resolve()), "auth-1", "pending", value.digest,
        value.runtime_build_digest, value.installation_metadata_digest,
        value.service_name, value.service_sid, 200,
    )
    envelope = FakeEnvelope(authorization, published)
    activation = FakeActivation(FakeActivationApi(running=False))
    owner = coordinator(
        tmp_path, installer, activation, envelope, safe_verifier=lambda _catalog: staged,
    )
    run = owner.start("install", value, binary_filename="service.exe")
    authorization = authorization.__class__(
        **{**authorization.__dict__, "operation_id": run.operation_id}
    )
    published = published.__class__(**{**published.__dict__, "operation_id": run.operation_id})
    envelope.authorization, envelope.published = authorization, published
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    failed = owner._transition(run, "recovery_required", error_code="simulated")

    recovered = owner.reconcile_recovery(failed.coordinator_id, value)

    assert recovered.state == "envelope_published"
    assert recovered.authorization_id == "auth-1"
    assert installer.authorization_status == "issued"


def test_recovery_owner_blocks_new_operation_before_authority_revocation(tmp_path: Path) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    owner = coordinator(tmp_path, installer)
    run = owner.start("install", value, binary_filename="service.exe")
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    owner._transition(run, "recovery_required", error_code="simulated")

    with pytest.raises(WindowsInstallerCoordinatorError) as conflict:
        owner.start("repair", value, binary_filename="service.exe")

    assert conflict.value.code == "windows_installer_coordinator_conflict"
    assert len(installer.operations) == 1


def test_missing_uncommitted_envelope_returns_to_publish_phase_but_consumed_does_not(
    tmp_path: Path,
) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    activation_api = FakeActivationApi(running=False)
    owner = coordinator(
        tmp_path, installer, FakeActivation(activation_api), MissingEnvelope(),
        safe_verifier=lambda _catalog: object(),
    )
    run = owner.start("install", value, binary_filename="service.exe")
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    failed = owner._transition(run, "recovery_required", error_code="publish_failed")
    assert owner.reconcile_recovery(failed.coordinator_id, value).state == "committed"

    # Once an authority identity was durably consumed, repair cannot mint or infer a replacement.
    committed = owner.get(run.coordinator_id)
    failed = owner._transition(
        committed, "recovery_required", authorization_id="auth-1", error_code="stopped",
    )
    installer.authorization_status = "consumed"
    result = owner.reconcile_recovery(failed.coordinator_id, value)
    assert result.state == "recovery_required"
    assert activation_api.fail_safe_calls == [value.service_name]


def test_recovery_lease_rejects_concurrent_privileged_reconciler(tmp_path: Path) -> None:
    installer = FakeInstaller()
    value = catalog(tmp_path)
    entered, release = threading.Event(), threading.Event()

    def verifier(_catalog):
        entered.set()
        assert release.wait(10)
        return object()

    owner = coordinator(
        tmp_path, installer, FakeActivation(FakeActivationApi(running=False)),
        MissingEnvelope(), safe_verifier=verifier,
    )
    run = owner.start("install", value, binary_filename="service.exe")
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    owner._transition(run, "recovery_required", error_code="simulated")
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(owner.reconcile_recovery, run.coordinator_id, value)
        assert entered.wait(10)
        with pytest.raises(WindowsInstallerCoordinatorError) as busy:
            owner.reconcile_recovery(run.coordinator_id, value)
        assert busy.value.code == "windows_installer_recovery_busy"
        release.set()
        assert first.result(timeout=10).state == "committed"


def test_existing_coordinator_database_migrates_recovery_fence_and_lease_columns(
    tmp_path: Path,
) -> None:
    installer = FakeInstaller()
    owner = coordinator(tmp_path, installer)
    database = tmp_path / "journal.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute("DROP INDEX runtime_windows_installer_one_coordinator_root")
        connection.execute("""
            CREATE UNIQUE INDEX runtime_windows_installer_one_coordinator_root
            ON runtime_windows_installer_coordinators(install_root)
            WHERE state IN ('safe_disabled','filesystem_prepared','artifacts_staged',
              'files_promoted','service_registered','committed','envelope_published',
              'service_finalized','starting')
        """)
        connection.commit()

    coordinator(tmp_path, installer)

    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute(
            "PRAGMA table_info(runtime_windows_installer_coordinators)",
        )}
        sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE "
            "name='runtime_windows_installer_one_coordinator_root'",
        ).fetchone()[0]
    assert {"recovery_owner", "recovery_expires_at"} <= columns
    assert "'recovery_required'" in sql


def test_spawned_recovery_owner_death_blocks_until_exact_lease_expiry(
    tmp_path: Path,
) -> None:
    now = {"value": 100.0}
    installer = FakeInstaller()
    value = catalog(tmp_path)
    owner = coordinator(
        tmp_path, installer, FakeActivation(FakeActivationApi(running=False)),
        MissingEnvelope(), safe_verifier=lambda _catalog: object(),
        clock=lambda: now["value"], recovery_lease_seconds=5,
    )
    run = owner.start("install", value, binary_filename="service.exe")
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    owner._transition(run, "recovery_required", error_code="simulated")
    context = multiprocessing.get_context("spawn")
    claimed = context.Event()
    process = context.Process(
        target=_claim_recovery_and_die,
        args=(str(tmp_path / "journal.sqlite3"),
              installer.operations[run.operation_id].__dict__, run.coordinator_id, claimed),
    )
    process.start()
    assert claimed.wait(15)
    process.join(15)
    assert process.exitcode == 79
    leased = owner.get(run.coordinator_id)
    assert leased.recovery_owner is not None and leased.recovery_expires_at == 105

    now["value"] = 104.999
    with pytest.raises(WindowsInstallerCoordinatorError) as busy:
        owner.reconcile_recovery(run.coordinator_id, value)
    assert busy.value.code == "windows_installer_recovery_busy"

    now["value"] = 105.0
    assert owner.reconcile_recovery(run.coordinator_id, value).state == "committed"


def test_expired_recovery_owner_cannot_commit_after_successor_claim(tmp_path: Path) -> None:
    now = {"value": 100.0}
    installer = FakeInstaller()
    value = catalog(tmp_path)
    owner = coordinator(
        tmp_path, installer, clock=lambda: now["value"], recovery_lease_seconds=5,
    )
    run = owner.start("install", value, binary_filename="service.exe")
    installer.operations[run.operation_id] = installer.operations[run.operation_id].__class__(
        **{**installer.operations[run.operation_id].__dict__, "state": "committed"}
    )
    failed = owner._transition(run, "recovery_required", error_code="simulated")
    stale = owner._acquire_recovery_lease(failed)
    now["value"] = 105.0
    successor = owner._acquire_recovery_lease(owner.get(run.coordinator_id))

    with pytest.raises(WindowsInstallerCoordinatorError) as fenced:
        owner._transition(stale, "committed")
    assert fenced.value.code == "windows_installer_coordinator_raced"
    assert owner._transition(successor, "committed").state == "committed"
