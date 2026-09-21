"""Durable, fail-closed composition of privileged Windows installer actions."""

from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Sequence

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .windows_installation_verifier import VerifiedWindowsSecurityInstallation
from .windows_installer_filesystem_actions import (
    WindowsInstallerArtifactInput,
    WindowsInstallerFilesystemActionJournal,
)
from .windows_installer_journal import (
    WindowsInstallerJournalError,
    WindowsInstallerOperation,
    WindowsInstallerOperationJournal,
)
from .windows_installer_scm_actions import WindowsInstallerScmActionJournal
from .windows_installer_service_activation import WindowsInstallerServiceActivationController
from .windows_package_catalog import VerifiedWindowsSecurityPackageCatalog
from .windows_service_bootstrap_envelope import WindowsServiceBootstrapEnvelopeChannel


class WindowsInstallerCoordinatorError(WindowsInstallerJournalError):
    pass


@dataclass(frozen=True)
class WindowsInstallerCoordinatorRun:
    coordinator_id: str
    operation_id: str
    state: str
    catalog_digest: str
    install_root: str
    binary_filename: str
    filesystem_action_id: str | None
    scm_action_id: str | None
    authorization_id: str | None
    error_code: str | None
    recovery_owner: str | None
    recovery_expires_at: float | None
    created_at: float
    updated_at: float


class _CompositeRollback:
    def __init__(self, scm: WindowsInstallerScmActionJournal,
                 filesystem: WindowsInstallerFilesystemActionJournal):
        self.scm, self.filesystem = scm, filesystem

    def rollback_in_transaction(self, connection, operation) -> None:
        # SCM first: no process may retain a binary that is about to be replaced.
        self.scm.rollback_in_transaction(connection, operation)
        self.filesystem.rollback_in_transaction(connection, operation)

    def rollback(self, operation) -> None:
        raise AssertionError("installer journal must select transactional rollback")


class WindowsInstallerCoordinator:
    """Moves one installation through durable, retryable privilege phases."""

    _ACTIVE = frozenset({
        "safe_disabled", "filesystem_prepared", "artifacts_staged", "files_promoted",
        "service_registered", "committed", "envelope_published", "service_finalized",
        "starting", "recovery_required",
    })

    def __init__(self, database: Path, installer: WindowsInstallerOperationJournal,
                 filesystem: WindowsInstallerFilesystemActionJournal,
                 scm: WindowsInstallerScmActionJournal,
                 envelope: WindowsServiceBootstrapEnvelopeChannel,
                 activation: WindowsInstallerServiceActivationController,
                 *, installer_safe_verifier: Callable[[VerifiedWindowsSecurityPackageCatalog], VerifiedWindowsSecurityInstallation],
                 final_verifier: Callable[[VerifiedWindowsSecurityPackageCatalog], VerifiedWindowsSecurityInstallation],
                 clock=time.time, fault_hook: Callable[[str], None] | None = None,
                 recovery_lease_seconds: float = 300.0):
        if recovery_lease_seconds <= 0:
            raise ValueError("Recovery lease duration must be positive.")
        self.database, self.installer = Path(database), installer
        self.filesystem, self.scm = filesystem, scm
        self.envelope, self.activation = envelope, activation
        self.installer_safe_verifier, self.final_verifier = installer_safe_verifier, final_verifier
        self.clock = clock
        self.fault_hook = fault_hook or (lambda _phase: None)
        self.recovery_lease_seconds = recovery_lease_seconds
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_coordinators(
                    coordinator_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL, catalog_digest TEXT NOT NULL,
                    install_root TEXT NOT NULL, binary_filename TEXT NOT NULL,
                    filesystem_action_id TEXT, scm_action_id TEXT,
                    authorization_id TEXT, error_code TEXT,
                    recovery_owner TEXT, recovery_expires_at REAL,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS runtime_windows_installer_one_coordinator_root
                ON runtime_windows_installer_coordinators(install_root)
                WHERE state IN ('safe_disabled','filesystem_prepared','artifacts_staged',
                  'files_promoted','service_registered','committed','envelope_published',
                  'service_finalized','starting','recovery_required');
            """)
            columns = {
                str(row[1]) for row in connection.execute(
                    "PRAGMA table_info(runtime_windows_installer_coordinators)",
                ).fetchall()
            }
            if "recovery_owner" not in columns:
                connection.execute(
                    "ALTER TABLE runtime_windows_installer_coordinators "
                    "ADD COLUMN recovery_owner TEXT",
                )
            if "recovery_expires_at" not in columns:
                connection.execute(
                    "ALTER TABLE runtime_windows_installer_coordinators "
                    "ADD COLUMN recovery_expires_at REAL",
                )
            index_sql = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' "
                "AND name='runtime_windows_installer_one_coordinator_root'",
            ).fetchone()
            if (index_sql is None or "'starting'" not in str(index_sql[0])
                    or "'recovery_required'" not in str(index_sql[0])):
                connection.execute(
                    "DROP INDEX IF EXISTS runtime_windows_installer_one_coordinator_root",
                )
                connection.execute("""
                    CREATE UNIQUE INDEX runtime_windows_installer_one_coordinator_root
                    ON runtime_windows_installer_coordinators(install_root)
                    WHERE state IN ('safe_disabled','filesystem_prepared','artifacts_staged',
                      'files_promoted','service_registered','committed','envelope_published',
                      'service_finalized','starting','recovery_required')
                """)

    def _connect(self):
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None,
                                     factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _row(row) -> WindowsInstallerCoordinatorRun:
        return WindowsInstallerCoordinatorRun(**dict(row))

    def get(self, coordinator_id: str) -> WindowsInstallerCoordinatorRun:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_coordinators WHERE coordinator_id=?",
                (coordinator_id,),
            ).fetchone()
        if row is None:
            raise WindowsInstallerCoordinatorError(
                "windows_installer_coordinator_missing", "Installer coordinator does not exist.",
            )
        return self._row(row)

    def start(self, operation_type: str, catalog: VerifiedWindowsSecurityPackageCatalog,
              *, binary_filename: str) -> WindowsInstallerCoordinatorRun:
        if not binary_filename or Path(binary_filename).name != binary_filename:
            raise WindowsInstallerCoordinatorError(
                "windows_installer_binary_filename_invalid", "Service binary filename is invalid.",
            )
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT coordinator_id FROM runtime_windows_installer_coordinators "
                "WHERE install_root=? AND state IN "
                "('safe_disabled','filesystem_prepared','artifacts_staged','files_promoted',"
                "'service_registered','committed','envelope_published','service_finalized',"
                "'starting','recovery_required') LIMIT 1",
                (str(catalog.install_root),),
            ).fetchone()
        if existing is not None:
            raise WindowsInstallerCoordinatorError(
                "windows_installer_coordinator_conflict",
                "An active or recovery-required coordinator owns this installation root.",
            )
        operation = self.installer.begin(operation_type, catalog)
        coordinator_id, now = f"windows-coordinator-{uuid.uuid4()}", float(self.clock())
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "INSERT INTO runtime_windows_installer_coordinators("
                    "coordinator_id,operation_id,state,catalog_digest,install_root,"
                    "binary_filename,filesystem_action_id,scm_action_id,authorization_id,"
                    "error_code,recovery_owner,recovery_expires_at,created_at,updated_at) "
                    "VALUES(?,?,'safe_disabled',?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?,?)",
                    (coordinator_id, operation.operation_id, catalog.digest,
                     str(catalog.install_root), binary_filename, now, now),
                )
                connection.commit()
        except sqlite3.IntegrityError as error:
            self.installer.rollback(operation.operation_id, _CompositeRollback(
                self.scm, self.filesystem).rollback, reason="coordinator_conflict")
            raise WindowsInstallerCoordinatorError(
                "windows_installer_coordinator_conflict",
                "Another coordinator owns this installation root.",
            ) from error
        return self.get(coordinator_id)

    def _identity(self, run, catalog) -> None:
        operation = self.installer.get(run.operation_id)
        if (run.catalog_digest != catalog.digest or run.install_root != str(catalog.install_root)
                or operation.catalog_digest != catalog.digest
                or operation.install_root != str(catalog.install_root)):
            raise WindowsInstallerCoordinatorError(
                "windows_installer_coordinator_identity_mismatch",
                "Coordinator identity differs from the verified catalog.",
            )

    def _transition(self, run, target, **updates):
        now = float(self.clock())
        fields = {"filesystem_action_id": run.filesystem_action_id,
                  "scm_action_id": run.scm_action_id,
                  "authorization_id": run.authorization_id,
                  "error_code": None, **updates}
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            sql = (
                "UPDATE runtime_windows_installer_coordinators SET state=?,"
                "filesystem_action_id=?,scm_action_id=?,authorization_id=?,error_code=?,"
                "recovery_owner=NULL,recovery_expires_at=NULL,updated_at=? "
                "WHERE coordinator_id=? AND state=?"
            )
            parameters = [
                target, fields["filesystem_action_id"], fields["scm_action_id"],
                fields["authorization_id"], fields["error_code"], now,
                run.coordinator_id, run.state,
            ]
            if run.recovery_owner is not None:
                sql += " AND recovery_owner=? AND recovery_expires_at>?"
                parameters.extend([run.recovery_owner, now])
            changed = connection.execute(sql, parameters).rowcount
            if changed != 1:
                connection.rollback()
                raise WindowsInstallerCoordinatorError(
                    "windows_installer_coordinator_raced", "Coordinator phase changed concurrently.",
                )
            self.journal.append_in_transaction(
                connection, f"windows_installer_coordinator.{target}", run.operation_id,
                {"coordinator_id": run.coordinator_id, "catalog_digest": run.catalog_digest}, now=now,
            )
            connection.commit()
        return self.get(run.coordinator_id)

    def _acquire_recovery_lease(
        self, run: WindowsInstallerCoordinatorRun,
    ) -> WindowsInstallerCoordinatorRun:
        owner, now = f"windows-recovery-{uuid.uuid4()}", float(self.clock())
        expires_at = now + self.recovery_lease_seconds
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            changed = connection.execute(
                "UPDATE runtime_windows_installer_coordinators "
                "SET recovery_owner=?,recovery_expires_at=?,updated_at=? "
                "WHERE coordinator_id=? AND state='recovery_required' AND "
                "(recovery_owner IS NULL OR recovery_expires_at<=?)",
                (owner, expires_at, now, run.coordinator_id, now),
            ).rowcount
            if changed != 1:
                connection.rollback()
                raise WindowsInstallerCoordinatorError(
                    "windows_installer_recovery_busy",
                    "Another privileged recovery reconciler owns the active lease.",
                )
            self.journal.append_in_transaction(
                connection, "windows_installer_coordinator.recovery_claimed",
                run.operation_id, {"coordinator_id": run.coordinator_id}, now=now,
            )
            connection.commit()
        return self.get(run.coordinator_id)

    def advance(self, coordinator_id: str, catalog: VerifiedWindowsSecurityPackageCatalog,
                *, package_root: Path | None = None,
                artifacts: Sequence[WindowsInstallerArtifactInput] = ()) -> WindowsInstallerCoordinatorRun:
        run = self.get(coordinator_id)
        self._identity(run, catalog)
        operation = self.installer.get(run.operation_id)
        try:
            if run.state == "safe_disabled":
                if package_root is None:
                    raise WindowsInstallerCoordinatorError(
                        "windows_installer_package_required", "Initial advance requires package artifacts.",
                    )
                action = self.filesystem.get_for_operation(run.operation_id)
                if action is None:
                    action = self.filesystem.prepare(operation, package_root, artifacts)
                elif (
                    action.package_root != str(Path(package_root).resolve(strict=True))
                    or action.artifact_set_digest
                    != self.filesystem.validated_artifact_set_digest(artifacts)
                ):
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_filesystem_identity_mismatch",
                        "Recovered filesystem action differs from the requested package.",
                    )
                self.fault_hook("after_filesystem_prepare")
                return self._transition(run, "filesystem_prepared", filesystem_action_id=action.action_id)
            if run.state == "filesystem_prepared":
                action = self.filesystem.get(run.filesystem_action_id)
                if action.state in {"prepared", "staging"}:
                    action = self.filesystem.stage(run.filesystem_action_id)
                if action.state != "staged":
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_filesystem_state_invalid",
                        "Filesystem action is not durably staged.",
                    )
                operation = self.installer.get(run.operation_id)
                if operation.state == "safe_disabled":
                    operation = self.installer.mark_artifacts_staged(
                        run.operation_id, action.artifact_set_digest,
                    )
                if (operation.state != "artifacts_staged"
                        or operation.staged_artifact_set_digest != action.artifact_set_digest):
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_artifact_state_mismatch",
                        "Installer journal differs from the staged artifact action.",
                    )
                self.fault_hook("after_artifacts_staged")
                return self._transition(run, "artifacts_staged")
            if run.state == "artifacts_staged":
                action = self.filesystem.get(run.filesystem_action_id)
                if action.state in {"staged", "promoting"}:
                    action = self.filesystem.promote(run.filesystem_action_id)
                if action.state != "promoted":
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_filesystem_state_invalid",
                        "Filesystem action is not durably promoted.",
                    )
                self.fault_hook("after_files_promoted")
                return self._transition(run, "files_promoted")
            if run.state == "files_promoted":
                operation = self.installer.get(run.operation_id)
                action = self.scm.get_for_operation(run.operation_id)
                if action is None:
                    action = self.scm.prepare(
                        operation, catalog, Path(run.install_root) / run.binary_filename,
                    )
                if action.state in {"prepared", "registering"}:
                    action = self.scm.register(action.action_id)
                if action.state != "registered":
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_scm_state_invalid",
                        "SCM action is not durably registered.",
                    )
                operation = self.installer.get(run.operation_id)
                if operation.state == "artifacts_staged":
                    evidence = self.installer.safety_controller.ensure_disabled_and_stopped(
                        catalog.service_name,
                    )
                    operation = self.installer.mark_service_registered(
                        run.operation_id, evidence,
                    )
                if operation.state != "service_registered":
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_scm_state_mismatch",
                        "Installer journal differs from the registered SCM action.",
                    )
                self.fault_hook("after_service_registered")
                return self._transition(run, "service_registered", scm_action_id=action.action_id)
            if run.state == "service_registered":
                staged = self.installer_safe_verifier(catalog)
                operation = self.installer.get(run.operation_id)
                if operation.state == "service_registered":
                    operation = self.installer.mark_package_verified(
                        run.operation_id, catalog, staged,
                    )
                if operation.state == "package_verified":
                    operation = self.installer.commit(run.operation_id, catalog, staged)
                if operation.state != "committed":
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_commit_state_mismatch",
                        "Installer journal did not reach committed state.",
                    )
                filesystem = self.filesystem.get(run.filesystem_action_id)
                if filesystem.state == "promoted":
                    filesystem = self.filesystem.mark_committed(run.filesystem_action_id)
                scm = self.scm.get(run.scm_action_id)
                if scm.state == "registered":
                    scm = self.scm.mark_committed(run.scm_action_id)
                if filesystem.state != "committed" or scm.state != "committed":
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_action_commit_mismatch",
                        "Privileged child actions did not reach committed state.",
                    )
                self.fault_hook("after_actions_committed")
                return self._transition(run, "committed")
            if run.state == "committed":
                staged = self.installer_safe_verifier(catalog)
                try:
                    authorization, published = self.envelope.inspect(catalog, staged)
                except WindowsInstallerJournalError:
                    authorization = self.installer.prepare_bootstrap_authorization(
                        run.operation_id, catalog, staged,
                    )
                    published = self.envelope.publish(authorization, catalog, staged)
                    self.installer.record_bootstrap_authorization(
                        authorization, catalog, staged,
                    )
                else:
                    status = self.installer.bootstrap_authorization_status(
                        authorization, catalog, staged,
                    )
                    if status is None:
                        self.installer.record_bootstrap_authorization(
                            authorization, catalog, staged,
                        )
                    elif status != "issued":
                        raise WindowsInstallerJournalError(
                            "windows_installer_coordinator_authority_state_invalid",
                            "Recovered bootstrap authority is not issuable.",
                        )
                if published.operation_id != run.operation_id:
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_authority_mismatch",
                        "Published bootstrap belongs to another installer operation.",
                    )
                self.fault_hook("after_envelope_recorded")
                return self._transition(run, "envelope_published",
                                        authorization_id=authorization.authorization_id)
            if run.state == "envelope_published":
                try:
                    staged = self.installer_safe_verifier(catalog)
                except BaseException:
                    # A crash may happen after SCM finalization but before its phase commit.
                    # Exact final verification is sufficient evidence to resume forward.
                    final = self.final_verifier(catalog)
                    authorization, _published = self.envelope.inspect(catalog, final)
                    if authorization.authorization_id != run.authorization_id:
                        raise WindowsInstallerJournalError(
                            "windows_installer_coordinator_authority_mismatch",
                            "Bootstrap authorization changed after publication.",
                        )
                    return self._transition(run, "service_finalized")
                authorization, published = self.envelope.inspect(catalog, staged)
                if authorization.authorization_id != run.authorization_id:
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_authority_mismatch",
                        "Bootstrap authorization changed after publication.",
                    )
                self.activation.finalize_configuration(published, authorization, catalog, staged)
                self.fault_hook("after_service_finalized")
                return self._transition(run, "service_finalized")
            if run.state == "service_finalized":
                self.final_verifier(catalog)
                starting = self._transition(run, "starting")
                self.fault_hook("after_start_intent")
                return starting
            if run.state == "starting":
                final = self.final_verifier(catalog)
                status = self.installer.bootstrap_authorization_status_by_identity(
                    run.operation_id, run.authorization_id,
                )
                if status == "issued":
                    authorization, published = self.envelope.inspect(catalog, final)
                    self.activation.start_verified_service(
                        published, authorization, catalog, final,
                    )
                elif status in {"consumed", "activated"}:
                    evidence = self.activation.api.inspect_running(catalog.service_name)
                    if not (evidence.running and evidence.process_id > 0
                            and evidence.service_name == catalog.service_name):
                        raise WindowsInstallerJournalError(
                            "windows_installer_coordinator_started_service_unproven",
                            "Consumed bootstrap exists but the pinned service is not running.",
                        )
                else:
                    raise WindowsInstallerJournalError(
                        "windows_installer_coordinator_authority_state_invalid",
                        "Starting requires an issued, consumed, or activated authority.",
                    )
                self.fault_hook("after_service_started")
                return self._transition(run, "completed")
            return run
        except WindowsInstallerCoordinatorError:
            raise
        except BaseException as error:
            if operation.state in self.installer._INCOMPLETE:
                self.installer.rollback(
                    run.operation_id, _CompositeRollback(self.scm, self.filesystem).rollback,
                    reason="coordinator_phase_failed",
                )
                return self._transition(run, "rolled_back", error_code=type(error).__name__)
            self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
            return self._transition(run, "recovery_required", error_code=type(error).__name__)

    def reconcile_recovery(
        self,
        coordinator_id: str,
        catalog: VerifiedWindowsSecurityPackageCatalog,
    ) -> WindowsInstallerCoordinatorRun:
        """Resume only the same durable identity; never mint replacement authority silently."""
        run = self.get(coordinator_id)
        self._identity(run, catalog)
        operation = self.installer.get(run.operation_id)
        if run.state != "recovery_required" or operation.state != "committed":
            raise WindowsInstallerCoordinatorError(
                "windows_installer_recovery_not_authorized",
                "Recovery reconciliation requires the exact committed failed coordinator.",
            )
        run = self._acquire_recovery_lease(run)
        safety = self.installer.safety_controller.ensure_disabled_and_stopped(
            catalog.service_name,
        )
        if not (safety.disabled and safety.stopped and safety.process_count == 0):
            raise WindowsInstallerCoordinatorError(
                "windows_installer_recovery_not_safe",
                "Recovery reconciliation could not establish disabled and stopped service state.",
            )

        staged = final = None
        try:
            staged = self.installer_safe_verifier(catalog)
        except BaseException:
            try:
                final = self.final_verifier(catalog)
            except BaseException as error:
                self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
                return self._transition(
                    run, "recovery_required", error_code=type(error).__name__,
                )
        installation = staged or final

        if run.authorization_id is None:
            try:
                authorization, _published = self.envelope.inspect(catalog, installation)
            except WindowsInstallerJournalError as error:
                if staged is not None:
                    # No durable authority identity was committed to this coordinator;
                    # retry the publish-first protocol from its committed phase.
                    return self._transition(run, "committed", error_code=type(error).__name__)
                self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
                return self._transition(
                    run, "recovery_required", error_code=type(error).__name__,
                )
        else:
            status = self.installer.bootstrap_authorization_status_by_identity(
                run.operation_id, run.authorization_id,
            )
            if status in {"consumed", "activated"}:
                if final is not None:
                    evidence = self.activation.api.inspect_running(catalog.service_name)
                    if (evidence.service_name == catalog.service_name and evidence.running
                            and evidence.process_id > 0):
                        return self._transition(run, "completed")
                self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
                return self._transition(
                    run, "recovery_required",
                    error_code="windows_installer_recovery_running_unproven",
                )
            try:
                authorization, _published = self.envelope.inspect(catalog, installation)
            except WindowsInstallerJournalError as error:
                self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
                return self._transition(
                    run, "recovery_required", error_code=type(error).__name__,
                )
            if authorization.authorization_id != run.authorization_id:
                self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
                return self._transition(
                    run, "recovery_required",
                    error_code="windows_installer_recovery_authority_mismatch",
                )

        status = self.installer.bootstrap_authorization_status(
            authorization, catalog, installation,
        )
        if status is None:
            self.installer.record_bootstrap_authorization(
                authorization, catalog, installation,
            )
            status = "issued"
        if status != "issued":
            self.activation.api.fail_safe_disable_and_stop(catalog.service_name)
            return self._transition(
                run, "recovery_required",
                error_code="windows_installer_recovery_authority_state_invalid",
            )
        target = "envelope_published" if staged is not None else "service_finalized"
        return self._transition(
            run, target, authorization_id=authorization.authorization_id,
        )
