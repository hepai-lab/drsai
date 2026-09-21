"""Grant-bound effects executed only by an OS-isolated worker."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .effects import EffectExecutionStore
from .isolation_leases import IsolationAttestationLeaseStore
from .models import ActionProposal, ResolvedCapabilityProfile, canonical_digest
from .sandbox import SandboxError
from .filesystem import normalize_workspace_relative_path
from drsai.backend.runtime.sqlite_connection import ClosingConnection


class IsolatedEffectExecutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SimulatedIsolatedEffectCrash(BaseException):
    """Test-only crash signal that bypasses terminalization and cleanup."""


class IsolatedSessionRunner(Protocol):
    def execute(
        self, *, execution_id: str, run_id: str, argv: Sequence[str], cwd: Path,
        environment: Mapping[str, str], timeout_seconds: float, writable: bool,
    ): ...


@dataclass(frozen=True)
class IsolatedEffectReceipt:
    execution_id: str
    operation: str
    status: str
    receipt_digest: str
    error_code: str | None


@dataclass(frozen=True)
class IsolatedEffectReconciliation:
    committed: int
    failed: int
    outcome_unknown: int
    pending: int


@dataclass(frozen=True)
class IsolatedEffectRecoveryMetrics:
    nonterminal_attempts: int
    actively_leased_attempts: int
    deferred_attempts: int
    total_recovery_failures: int
    oldest_pending_seconds: float


def _canonical_bytes(value: Mapping[str, object]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class IsolatedEffectExecutionService:
    """Claims a Grant, then delegates the only mutation to an isolated worker."""

    backend_id = "windows-appcontainer-effect-worker"
    backend_version = "1"
    _CONTROL_PREFIX = ".opendrsai-isolated-"
    _PROTECTED_PREFIXES = frozenset({".git", ".agents", ".codex", ".opendrsai-trash"})

    def __init__(
        self,
        database: Path,
        leases: IsolationAttestationLeaseStore,
        sessions: IsolatedSessionRunner,
        *,
        worker_argv_prefix: Sequence[str],
        expected_worker_sha256: str,
        clock=time.time,
        recovery_owner_id: str | None = None,
        recovery_lease_seconds: float = 30,
        database_timeout_seconds: float = 30,
    ):
        if not worker_argv_prefix or not str(worker_argv_prefix[0]).strip():
            raise IsolatedEffectExecutionError(
                "isolated_effect_worker_unconfigured",
                "A trusted packaged isolated-effect worker is required.",
            )
        self.database = Path(database)
        self.leases = leases
        self.sessions = sessions
        self._worker_argv_prefix = tuple(str(value) for value in worker_argv_prefix)
        if not expected_worker_sha256.startswith("sha256:") or len(expected_worker_sha256) != 71:
            raise IsolatedEffectExecutionError(
                "isolated_effect_worker_digest_invalid", "A packaged worker SHA-256 digest is required.",
            )
        self._expected_worker_sha256 = expected_worker_sha256
        self.effects = EffectExecutionStore(self.database)
        self.clock = clock
        if recovery_lease_seconds <= 0:
            raise ValueError("recovery_lease_seconds must be positive")
        self.recovery_owner_id = recovery_owner_id or f"isolated-recovery-owner-{uuid.uuid4()}"
        self.recovery_lease_seconds = float(recovery_lease_seconds)
        if database_timeout_seconds < 0:
            raise ValueError("database_timeout_seconds cannot be negative")
        self.database_timeout_seconds = float(database_timeout_seconds)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_isolated_effect_attempts(
                    execution_id TEXT PRIMARY KEY REFERENCES runtime_effect_executions(execution_id),
                    run_id TEXT NOT NULL,
                    session_execution_id TEXT NOT NULL UNIQUE,
                    workspace_root TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    attestation_digest TEXT NOT NULL,
                    worker_digest TEXT NOT NULL,
                    request_name TEXT NOT NULL,
                    response_name TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN (
                        'claimed','dispatching','session_terminal','receipt_verified',
                        'committed','failed','outcome_unknown'
                    )),
                    terminal_status TEXT,
                    receipt_digest TEXT,
                    error_code TEXT,
                    recovery_owner_id TEXT,
                    recovery_token TEXT,
                    recovery_lease_expires_at REAL,
                    recovery_failures INTEGER NOT NULL DEFAULT 0,
                    recovery_error_code TEXT,
                    last_recovery_error_at REAL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_isolated_effect_attempt_identity_immutable
                BEFORE UPDATE OF execution_id,run_id,session_execution_id,workspace_root,
                                 profile_digest,attestation_digest,worker_digest,request_name,
                                 response_name,created_at
                ON runtime_isolated_effect_attempts
                BEGIN SELECT RAISE(ABORT, 'isolated effect attempt identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolated_effect_attempt_status_terminal
                BEFORE UPDATE OF status ON runtime_isolated_effect_attempts
                WHEN OLD.status IN ('committed','failed','outcome_unknown')
                BEGIN SELECT RAISE(ABORT, 'isolated effect attempt is terminal'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolated_effect_attempt_status_transition
                BEFORE UPDATE OF status ON runtime_isolated_effect_attempts
                WHEN NOT (
                    (OLD.status='claimed' AND NEW.status IN ('dispatching','failed','outcome_unknown')) OR
                    (OLD.status='dispatching' AND NEW.status IN ('session_terminal','failed','outcome_unknown')) OR
                    (OLD.status='session_terminal' AND NEW.status IN ('receipt_verified','outcome_unknown')) OR
                    (OLD.status='receipt_verified' AND NEW.status IN ('committed','outcome_unknown'))
                )
                BEGIN SELECT RAISE(ABORT, 'isolated effect attempt transition is invalid'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolated_effect_attempts_no_delete
                BEFORE DELETE ON runtime_isolated_effect_attempts
                BEGIN SELECT RAISE(ABORT, 'isolated effect attempt is durable'); END;
                CREATE TABLE IF NOT EXISTS runtime_isolated_effect_attempt_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    execution_id TEXT NOT NULL REFERENCES runtime_isolated_effect_attempts(execution_id),
                    status TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_isolated_effect_attempt_events_no_update
                BEFORE UPDATE ON runtime_isolated_effect_attempt_events
                BEGIN SELECT RAISE(ABORT, 'isolated effect attempt events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolated_effect_attempt_events_no_delete
                BEFORE DELETE ON runtime_isolated_effect_attempt_events
                BEGIN SELECT RAISE(ABORT, 'isolated effect attempt events are append-only'); END;
            """)
            columns = {
                str(row[1]) for row in db.execute("PRAGMA table_info(runtime_isolated_effect_attempts)")
            }
            for name, declaration in {
                "recovery_owner_id": "TEXT",
                "recovery_token": "TEXT",
                "recovery_lease_expires_at": "REAL",
                "recovery_failures": "INTEGER NOT NULL DEFAULT 0",
                "recovery_error_code": "TEXT",
                "last_recovery_error_at": "REAL",
            }.items():
                if name not in columns:
                    db.execute(
                        f"ALTER TABLE runtime_isolated_effect_attempts ADD COLUMN {name} {declaration}"
                    )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=self.database_timeout_seconds,
            isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _advance_attempt(
        self, execution_id: str, status: str, *, terminal_status: str | None = None,
        receipt_digest: str | None = None, error_code: str | None = None,
    ) -> None:
        changed_at = float(self.clock())
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_isolated_effect_attempts SET status=?,terminal_status=COALESCE(?,terminal_status),"
                "receipt_digest=COALESCE(?,receipt_digest),error_code=COALESCE(?,error_code),updated_at=? "
                "WHERE execution_id=?",
                (status, terminal_status, receipt_digest, error_code, changed_at, execution_id),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise IsolatedEffectExecutionError(
                    "isolated_effect_attempt_missing", "Durable isolated Effect attempt is missing.",
                )
            db.execute(
                "INSERT INTO runtime_isolated_effect_attempt_events(event_id,execution_id,status,created_at) "
                "VALUES(?,?,?,?)",
                (f"isolated-effect-attempt-event-{uuid.uuid4()}", execution_id, status, changed_at),
            )
            db.commit()

    @staticmethod
    def _inject(fault_after: str | None, stage: str) -> None:
        if fault_after == stage:
            raise SimulatedIsolatedEffectCrash(stage)

    @property
    def worker_argv_prefix(self) -> tuple[str, ...]:
        return self._worker_argv_prefix

    @property
    def expected_worker_sha256(self) -> str:
        return self._expected_worker_sha256

    def _verify_worker_binary(self, workspace_root: Path) -> str:
        worker = Path(self._worker_argv_prefix[0])
        if not worker.is_absolute() or not worker.is_file():
            raise IsolatedEffectExecutionError(
                "isolated_effect_worker_missing", "The packaged isolated-effect worker is unavailable.",
            )
        try:
            if os.path.commonpath((
                os.path.normcase(os.path.abspath(workspace_root)),
                os.path.normcase(os.path.abspath(worker)),
            )) == os.path.normcase(os.path.abspath(workspace_root)):
                raise IsolatedEffectExecutionError(
                    "isolated_effect_worker_in_workspace",
                    "The trusted worker cannot be loaded from an agent-writable Workspace.",
                )
        except ValueError:
            pass
        try:
            digest = "sha256:" + hashlib.sha256(worker.read_bytes()).hexdigest()
        except OSError as error:
            raise IsolatedEffectExecutionError(
                "isolated_effect_worker_unreadable", "The packaged worker identity cannot be verified.",
            ) from error
        if not hmac.compare_digest(digest, self._expected_worker_sha256):
            raise IsolatedEffectExecutionError(
                "isolated_effect_worker_identity_mismatch", "The packaged worker binary was replaced.",
            )
        return digest

    @classmethod
    def _authorize_relative_path(
        cls, workspace_root: Path, profile: ResolvedCapabilityProfile, relative_path: str,
    ) -> str:
        parts = normalize_workspace_relative_path(relative_path)
        if parts[0].casefold() in cls._PROTECTED_PREFIXES or parts[0].casefold().startswith(
            cls._CONTROL_PREFIX.casefold()
        ):
            raise SandboxError("filesystem_control_path_denied", "Agent control paths cannot be modified.")
        root = os.path.normcase(os.path.abspath(workspace_root))
        if root != os.path.normcase(os.path.abspath(profile.workspace_root)):
            raise SandboxError("filesystem_profile_root_mismatch", "Workspace differs from the active Profile.")
        target = os.path.normcase(os.path.abspath(Path(root).joinpath(*parts)))
        for configured in profile.writable_roots:
            allowed = Path(configured)
            if not allowed.is_absolute():
                allowed = Path(root) / allowed
            allowed_value = os.path.normcase(os.path.abspath(allowed))
            try:
                if os.path.commonpath((root, allowed_value)) == root and os.path.commonpath(
                    (allowed_value, target)
                ) == allowed_value:
                    return "/".join(parts)
            except ValueError:
                continue
        raise SandboxError("filesystem_write_root_denied", "Path is outside Profile writable roots.")

    @staticmethod
    def _write_payload(relative_path: str, content: bytes) -> dict[str, object]:
        return {
            "relative_path": relative_path,
            "content_digest": "sha256:" + hashlib.sha256(content).hexdigest(),
            "size_bytes": len(content),
        }

    def execute_write(
        self, *, grant_id: str, proposal: ActionProposal, profile: ResolvedCapabilityProfile,
        workspace_root: Path, attestation_digest: str, relative_path: str, content: bytes,
        execution_id: str | None = None, timeout_seconds: float = 30,
        fault_after: str | None = None,
    ) -> IsolatedEffectReceipt:
        if proposal.operation != "file.write" or "filesystem.write" not in proposal.required_capabilities:
            raise IsolatedEffectExecutionError(
                "isolated_effect_operation_denied", "The isolated executor only accepts declared file.write.",
            )
        relative = self._authorize_relative_path(workspace_root, profile, relative_path)
        payload = self._write_payload(relative, content)
        request = {
            "operation": "file.write",
            "relative_path": relative,
            "content_b64": base64.b64encode(content).decode("ascii"),
        }
        return self._execute(
            grant_id=grant_id, proposal=proposal, profile=profile,
            workspace_root=workspace_root, attestation_digest=attestation_digest,
            actual_payload=payload, worker_request=request,
            execution_id=execution_id, timeout_seconds=timeout_seconds, fault_after=fault_after,
        )

    def execute_edit(
        self, *, grant_id: str, proposal: ActionProposal, profile: ResolvedCapabilityProfile,
        workspace_root: Path, attestation_digest: str, relative_path: str,
        source_content_digest: str, result_content: bytes, actual_payload: dict[str, object],
        execution_id: str | None = None, timeout_seconds: float = 30,
        fault_after: str | None = None,
    ) -> IsolatedEffectReceipt:
        if proposal.operation != "file.edit" or "filesystem.write" not in proposal.required_capabilities:
            raise IsolatedEffectExecutionError(
                "isolated_effect_operation_denied", "The isolated executor only accepts declared file.edit.",
            )
        relative = self._authorize_relative_path(workspace_root, profile, relative_path)
        payload = dict(actual_payload)
        expected = {
            "relative_path": relative,
            "source_content_digest": source_content_digest,
            "result_content_digest": "sha256:" + hashlib.sha256(result_content).hexdigest(),
            "result_size_bytes": len(result_content),
        }
        if any(payload.get(key) != value for key, value in expected.items()):
            raise IsolatedEffectExecutionError(
                "isolated_effect_edit_scope_mismatch", "Edit content differs from the approved Proposal.",
            )
        request = {
            "operation": "file.edit", "relative_path": relative,
            "source_content_digest": source_content_digest,
            "result_content_b64": base64.b64encode(result_content).decode("ascii"),
        }
        return self._execute(
            grant_id=grant_id, proposal=proposal, profile=profile,
            workspace_root=workspace_root, attestation_digest=attestation_digest,
            actual_payload=payload, worker_request=request,
            execution_id=execution_id, timeout_seconds=timeout_seconds, fault_after=fault_after,
        )

    def _execute(
        self, *, grant_id: str, proposal: ActionProposal, profile: ResolvedCapabilityProfile,
        workspace_root: Path, attestation_digest: str, actual_payload: dict[str, object],
        worker_request: dict[str, object], execution_id: str | None, timeout_seconds: float,
        fault_after: str | None,
    ) -> IsolatedEffectReceipt:
        if timeout_seconds <= 0:
            raise IsolatedEffectExecutionError("isolated_effect_timeout_invalid", "Timeout must be positive.")
        identity = execution_id or f"isolated-effect-{uuid.uuid4()}"
        lease = self.leases.assert_active(
            proposal.run_id, workspace_root=str(workspace_root),
            profile_digest=profile.digest, attestation_digest=attestation_digest,
        )
        if lease.backend_id not in {"windows-appcontainer-session", self.backend_id}:
            raise IsolatedEffectExecutionError(
                "isolated_effect_backend_mismatch", "Isolation lease is not for the AppContainer effect worker.",
            )
        worker_digest = self._verify_worker_binary(workspace_root)
        token = uuid.uuid4().hex
        request_name = f"{self._CONTROL_PREFIX}{token}.request"
        response_name = f"{self._CONTROL_PREFIX}{token}.response"
        session_execution_id = f"isolated-session:{identity}"
        claimed_at = float(self.clock())

        def stage_attempt(db: sqlite3.Connection) -> None:
            db.execute(
                "INSERT INTO runtime_isolated_effect_attempts("
                "execution_id,run_id,session_execution_id,workspace_root,profile_digest,"
                "attestation_digest,worker_digest,request_name,response_name,status,terminal_status,"
                "receipt_digest,error_code,created_at,updated_at"
                ") VALUES(?,?,?,?,?,?,?,?,?,'claimed',NULL,NULL,NULL,?,?)",
                (
                    identity, proposal.run_id, session_execution_id,
                    os.path.normcase(os.path.abspath(workspace_root)),
                    profile.digest, attestation_digest, worker_digest,
                    request_name, response_name, claimed_at, claimed_at,
                ),
            )
            db.execute(
                "INSERT INTO runtime_isolated_effect_attempt_events(event_id,execution_id,status,created_at) "
                "VALUES(?,?,'claimed',?)",
                (f"isolated-effect-attempt-event-{uuid.uuid4()}", identity, claimed_at),
            )

        self.effects.claim(
            execution_id=identity, grant_id=grant_id, proposal=proposal, profile=profile,
            actual_payload=actual_payload, attestation_digest=attestation_digest,
            now=claimed_at, commit_hook=stage_attempt,
        )
        self._inject(fault_after, "effect_claimed")
        key, nonce = secrets.token_bytes(32), secrets.token_bytes(12)
        request_body = {
            "schema_version": "isolated-effect/1", "execution_id": identity,
            "run_id": proposal.run_id, "proposal_digest": proposal.payload_digest,
            "profile_digest": profile.digest, "attestation_digest": attestation_digest,
            "worker_binary_digest": worker_digest,
            "actual_payload_digest": canonical_digest(actual_payload),
            **worker_request,
        }
        ciphertext = nonce + AESGCM(key).encrypt(nonce, _canonical_bytes(request_body), identity.encode("utf-8"))
        request_path, response_path = workspace_root / request_name, workspace_root / response_name
        crashed = False
        try:
            with request_path.open("xb") as stream:
                stream.write(ciphertext)
            self._advance_attempt(identity, "dispatching")
            self._inject(fault_after, "envelope_staged")
            session = self.sessions.execute(
                execution_id=session_execution_id, run_id=proposal.run_id,
                argv=(*self._worker_argv_prefix, "--request", request_name, "--response", response_name,
                      "--execution-id", identity),
                cwd=workspace_root,
                environment={"OPENDRSAI_ISOLATED_EFFECT_KEY": base64.b64encode(key).decode("ascii")},
                timeout_seconds=timeout_seconds, writable=True,
            )
            self._advance_attempt(identity, "session_terminal")
            self._inject(fault_after, "session_terminal")
            response = self._read_response(
                response_path, key, identity,
                expected_operation=proposal.operation,
                expected_request_digest=canonical_digest(request_body),
            )
            worker_status = str(getattr(session, "worker_status", ""))
            if response["status"] == "succeeded" and worker_status != "succeeded":
                raise IsolatedEffectExecutionError(
                    "isolated_effect_worker_terminal_mismatch",
                    "Worker receipt and OS process status disagree.",
                )
            response_status = str(response["status"])
            response_receipt = str(response["receipt_digest"])
            response_error = str(response["error_code"]) if response.get("error_code") else None
            self._advance_attempt(
                identity, "receipt_verified", terminal_status=response_status,
                receipt_digest=response_receipt, error_code=response_error,
            )
            self._inject(fault_after, "receipt_verified")
            terminal = self.effects.complete(
                identity, status=response_status, receipt_digest=response_receipt,
                error_code=response_error,
            )
            self._inject(fault_after, "effect_committed")
            self._advance_attempt(
                identity,
                "outcome_unknown" if terminal.status == "outcome_unknown" else "committed",
            )
            return IsolatedEffectReceipt(
                identity, proposal.operation, terminal.status,
                str(terminal.receipt_digest), terminal.error_code,
            )
        except SimulatedIsolatedEffectCrash:
            crashed = True
            raise
        except BaseException as error:
            try:
                if self.effects.get(identity).status == "executing":
                    self.effects.mark_outcome_unknown(
                        identity, receipt_digest="isolated-effect:no-trusted-terminal-receipt",
                        error_code=type(error).__name__[:128],
                    )
                    self._advance_attempt(
                        identity, "outcome_unknown", terminal_status="outcome_unknown",
                        receipt_digest="isolated-effect:no-trusted-terminal-receipt",
                        error_code=type(error).__name__[:128],
                    )
            except Exception:
                pass
            raise
        finally:
            if not crashed:
                self._cleanup_control_files(workspace_root, request_name, response_name)

    @staticmethod
    def _read_response(
        path: Path, key: bytes, execution_id: str, *,
        expected_operation: str, expected_request_digest: str,
    ) -> dict[str, object]:
        try:
            response = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise IsolatedEffectExecutionError(
                "isolated_effect_receipt_missing", "Worker did not return a trusted receipt.",
            ) from error
        if not isinstance(response, dict):
            raise IsolatedEffectExecutionError("isolated_effect_receipt_invalid", "Worker receipt is invalid.")
        mac = response.pop("mac", None)
        expected = hmac.new(key, _canonical_bytes(response), hashlib.sha256).hexdigest()
        if not isinstance(mac, str) or not hmac.compare_digest(mac, expected):
            raise IsolatedEffectExecutionError("isolated_effect_receipt_untrusted", "Worker receipt MAC is invalid.")
        receipt_digest = response.get("receipt_digest")
        digest_body = dict(response)
        digest_body.pop("receipt_digest", None)
        if not isinstance(receipt_digest, str) or canonical_digest(digest_body) != receipt_digest:
            raise IsolatedEffectExecutionError(
                "isolated_effect_receipt_digest_mismatch", "Worker receipt digest is invalid.",
            )
        if (
            response.get("schema_version") != "isolated-effect-receipt/1"
            or response.get("execution_id") != execution_id
            or response.get("operation") != expected_operation
            or response.get("request_digest") != expected_request_digest
            or response.get("status") not in {
            "succeeded", "failed", "timed_out", "outcome_unknown",
            }
        ):
            raise IsolatedEffectExecutionError("isolated_effect_receipt_scope_mismatch", "Worker receipt scope is invalid.")
        return response

    def _cleanup_control_files(self, workspace_root: Path, request_name: str, response_name: str) -> None:
        for name in (request_name, response_name):
            if Path(name).name != name or not name.startswith(self._CONTROL_PREFIX):
                continue
            try:
                (workspace_root / name).unlink(missing_ok=True)
            except OSError:
                pass

    def _claim_recovery(self, execution_id: str) -> sqlite3.Row | None:
        now = float(self.clock())
        token = f"isolated-recovery-{uuid.uuid4()}"
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_isolated_effect_attempts SET recovery_owner_id=?,recovery_token=?,"
                "recovery_lease_expires_at=?,updated_at=? WHERE execution_id=? "
                "AND status NOT IN ('committed','failed','outcome_unknown') "
                "AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at<=? "
                "OR recovery_owner_id=?)",
                (
                    self.recovery_owner_id, token, now + self.recovery_lease_seconds,
                    now, execution_id, now, self.recovery_owner_id,
                ),
            ).rowcount
            if changed != 1:
                db.rollback()
                return None
            row = db.execute(
                "SELECT * FROM runtime_isolated_effect_attempts WHERE execution_id=?",
                (execution_id,),
            ).fetchone()
            db.commit()
        return row

    def heartbeat_recovery(self, execution_id: str, token: str) -> float:
        """Extend an active recovery lease without weakening its fencing token."""

        now = float(self.clock())
        expires_at = now + self.recovery_lease_seconds
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_isolated_effect_attempts SET recovery_lease_expires_at=?,updated_at=? "
                "WHERE execution_id=? AND recovery_owner_id=? AND recovery_token=? "
                "AND recovery_lease_expires_at>? "
                "AND status NOT IN ('committed','failed','outcome_unknown')",
                (expires_at, now, execution_id, self.recovery_owner_id, token, now),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise IsolatedEffectExecutionError(
                    "isolated_effect_recovery_fenced",
                    "Recovery ownership expired or was taken over.",
                )
            db.commit()
        return expires_at

    def _owned_terminal_hook(
        self, execution_id: str, token: str, status: str, *,
        terminal_status: str | None = None, receipt_digest: str | None = None,
        error_code: str | None = None,
    ):
        def hook(db: sqlite3.Connection) -> None:
            now = float(self.clock())
            changed = db.execute(
                "UPDATE runtime_isolated_effect_attempts SET status=?,"
                "terminal_status=COALESCE(?,terminal_status),"
                "receipt_digest=COALESCE(?,receipt_digest),error_code=COALESCE(?,error_code),"
                "updated_at=? WHERE execution_id=? AND recovery_owner_id=? AND recovery_token=? "
                "AND recovery_lease_expires_at>?",
                (
                    status, terminal_status, receipt_digest, error_code, now,
                    execution_id, self.recovery_owner_id, token, now,
                ),
            ).rowcount
            if changed != 1:
                raise IsolatedEffectExecutionError(
                    "isolated_effect_recovery_fenced",
                    "Recovery ownership expired or was taken over.",
                )
            db.execute(
                "INSERT INTO runtime_isolated_effect_attempt_events(event_id,execution_id,status,created_at) "
                "VALUES(?,?,?,?)",
                (f"isolated-effect-attempt-event-{uuid.uuid4()}", execution_id, status, now),
            )
        return hook

    def _finish_owned_attempt(
        self, execution_id: str, token: str, status: str, *,
        terminal_status: str | None = None, receipt_digest: str | None = None,
        error_code: str | None = None,
    ) -> None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._owned_terminal_hook(
                execution_id, token, status, terminal_status=terminal_status,
                receipt_digest=receipt_digest, error_code=error_code,
            )(db)
            db.commit()

    def _record_recovery_failure(self, execution_id: str, token: str, error: Exception) -> None:
        """Best-effort diagnostics; failure must never weaken durable Effect facts."""

        now = float(self.clock())
        if isinstance(error, IsolatedEffectExecutionError):
            error_code = error.code
        elif isinstance(error, sqlite3.Error):
            error_code = f"sqlite:{type(error).__name__}"
        else:
            error_code = f"recovery:{type(error).__name__}"
        try:
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                changed = db.execute(
                    "UPDATE runtime_isolated_effect_attempts SET "
                    "recovery_failures=recovery_failures+1,recovery_error_code=?,"
                    "last_recovery_error_at=?,updated_at=? WHERE execution_id=? "
                    "AND recovery_owner_id=? AND recovery_token=? "
                    "AND status NOT IN ('committed','failed','outcome_unknown')",
                    (error_code, now, now, execution_id, self.recovery_owner_id, token),
                ).rowcount
                if changed == 1:
                    db.execute(
                        "INSERT INTO runtime_isolated_effect_attempt_events"
                        "(event_id,execution_id,status,created_at) VALUES(?,?,?,?)",
                        (f"isolated-effect-attempt-event-{uuid.uuid4()}", execution_id,
                         f"recovery_deferred:{error_code}", now),
                    )
                db.commit()
        except sqlite3.Error:
            # A full, locked, or damaged database may also reject diagnostics. The
            # original authority lease remains the only source of ownership truth.
            pass

    def recovery_metrics(self) -> IsolatedEffectRecoveryMetrics:
        """Return aggregate recovery health without exposing authority controls."""

        now = float(self.clock())
        with self._connect() as db:
            row = db.execute(
                "SELECT COUNT(*) AS nonterminal_attempts,"
                "COALESCE(SUM(CASE WHEN recovery_lease_expires_at>? THEN 1 ELSE 0 END),0) "
                "AS actively_leased_attempts,"
                "COALESCE(SUM(CASE WHEN recovery_failures>0 THEN 1 ELSE 0 END),0) "
                "AS deferred_attempts,"
                "COALESCE(SUM(recovery_failures),0) AS total_recovery_failures,"
                "MIN(created_at) AS oldest_created_at "
                "FROM runtime_isolated_effect_attempts "
                "WHERE status NOT IN ('committed','failed','outcome_unknown')",
                (now,),
            ).fetchone()
        oldest = row["oldest_created_at"]
        return IsolatedEffectRecoveryMetrics(
            nonterminal_attempts=int(row["nonterminal_attempts"]),
            actively_leased_attempts=int(row["actively_leased_attempts"]),
            deferred_attempts=int(row["deferred_attempts"]),
            total_recovery_failures=int(row["total_recovery_failures"]),
            oldest_pending_seconds=max(0.0, now - float(oldest)) if oldest is not None else 0.0,
        )

    def _reconcile_owned_attempt(self, attempt: sqlite3.Row) -> str:
        execution_id = str(attempt["execution_id"])
        recovery_token = str(attempt["recovery_token"])
        effect = self.effects.get(execution_id)
        workspace_root = Path(str(attempt["workspace_root"]))
        request_name = str(attempt["request_name"])
        response_name = str(attempt["response_name"])

        if effect.status != "executing":
            stage = "outcome_unknown" if effect.status == "outcome_unknown" else "committed"
            self._finish_owned_attempt(execution_id, recovery_token, stage)
        elif str(attempt["status"]) == "receipt_verified":
            terminal_status = str(attempt["terminal_status"] or "")
            receipt_digest = str(attempt["receipt_digest"] or "")
            if terminal_status not in self.effects.TERMINAL or not receipt_digest:
                terminal_status = "outcome_unknown"
                receipt_digest = "isolated-effect:invalid-durable-receipt"
                error_code = "durable_receipt_invalid"
                self.effects.mark_outcome_unknown(
                    execution_id, receipt_digest=receipt_digest, error_code=error_code,
                    commit_hook=self._owned_terminal_hook(
                        execution_id, recovery_token, "outcome_unknown",
                        terminal_status=terminal_status, receipt_digest=receipt_digest,
                        error_code=error_code,
                    ),
                )
                stage = "outcome_unknown"
            else:
                error_code = str(attempt["error_code"]) if attempt["error_code"] else None
                self.effects.complete(
                    execution_id, status=terminal_status, receipt_digest=receipt_digest,
                    error_code=error_code,
                    commit_hook=self._owned_terminal_hook(
                        execution_id, recovery_token,
                        "outcome_unknown" if terminal_status == "outcome_unknown" else "committed",
                        terminal_status=terminal_status, receipt_digest=receipt_digest,
                        error_code=error_code,
                    ),
                )
                stage = "outcome_unknown" if terminal_status == "outcome_unknown" else "committed"
        else:
            by_execution = getattr(self.sessions, "by_execution", None)
            if not callable(by_execution):
                return "pending"
            session = by_execution(str(attempt["session_execution_id"]))
            if session is None:
                status, error_code = "failed", "isolated_dispatch_not_started"
                receipt_digest = canonical_digest({
                    "execution_id": execution_id, "status": status, "error_code": error_code,
                })
                self.effects.complete(
                    execution_id, status=status, receipt_digest=receipt_digest,
                    error_code=error_code,
                    commit_hook=self._owned_terminal_hook(
                        execution_id, recovery_token, "failed", terminal_status=status,
                        receipt_digest=receipt_digest, error_code=error_code,
                    ),
                )
                stage = "failed"
            else:
                terminal_states = frozenset({"completed", "failed_cleaned", "recovered", "quarantined"})
                if str(session.state) not in terminal_states:
                    recover = getattr(self.sessions, "recover_incomplete", None)
                    if callable(recover):
                        recover()
                        session = by_execution(str(attempt["session_execution_id"]))
                if session is None or str(session.state) not in terminal_states:
                    return "pending"
                reached = getattr(self.sessions, "reached_state", None)
                worker_may_have_started = bool(
                    callable(reached) and reached(str(session.session_id), "worker_starting")
                )
                if not worker_may_have_started:
                    status, error_code = "failed", "isolated_dispatch_not_started"
                    receipt_digest = canonical_digest({
                        "execution_id": execution_id, "status": status, "error_code": error_code,
                    })
                    self.effects.complete(
                        execution_id, status=status, receipt_digest=receipt_digest,
                        error_code=error_code,
                        commit_hook=self._owned_terminal_hook(
                            execution_id, recovery_token, "failed", terminal_status=status,
                            receipt_digest=receipt_digest, error_code=error_code,
                        ),
                    )
                    stage = "failed"
                else:
                    self.effects.mark_outcome_unknown(
                        execution_id, receipt_digest="isolated-effect:recovery-no-key",
                        error_code="isolated_worker_result_unrecoverable",
                        commit_hook=self._owned_terminal_hook(
                            execution_id, recovery_token, "outcome_unknown",
                            terminal_status="outcome_unknown",
                            receipt_digest="isolated-effect:recovery-no-key",
                            error_code="isolated_worker_result_unrecoverable",
                        ),
                    )
                    stage = "outcome_unknown"

        self._cleanup_control_files(workspace_root, request_name, response_name)
        return stage

    def reconcile_interrupted(self) -> IsolatedEffectReconciliation:
        """Join durable Effect and Session state after a Runtime restart."""

        counts = {"committed": 0, "failed": 0, "outcome_unknown": 0, "pending": 0}
        with self._connect() as db:
            attempts = db.execute(
                "SELECT * FROM runtime_isolated_effect_attempts "
                "WHERE status NOT IN ('committed','failed','outcome_unknown') "
                "ORDER BY created_at,execution_id",
            ).fetchall()
        for attempt in attempts:
            execution_id = str(attempt["execution_id"])
            try:
                owned = self._claim_recovery(execution_id)
            except sqlite3.Error:
                counts["pending"] += 1
                continue
            if owned is None:
                counts["pending"] += 1
                continue
            recovery_token = str(owned["recovery_token"])
            try:
                stage = self._reconcile_owned_attempt(owned)
            except Exception as error:
                self._record_recovery_failure(execution_id, recovery_token, error)
                counts["pending"] += 1
                continue
            counts[stage] += 1
        return IsolatedEffectReconciliation(**counts)
