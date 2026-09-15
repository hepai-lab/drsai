"""Fail-closed broker contract for host-enforced execution backends."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol

from .grants import AuthorizationGrantStore
from .effects import EffectExecutionStore
from .models import ActionProposal, ResolvedCapabilityProfile


class SandboxError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


REQUIRED_GUARANTEES = frozenset({
    "non_admin_identity",
    "process_tree_controlled",
    "filesystem_enforced",
    "environment_sanitized",
})


@dataclass(frozen=True)
class IsolationAttestation:
    backend_id: str
    backend_version: str
    platform: str
    verified_at: float
    expires_at: float
    guarantees: frozenset[str] = field(default_factory=frozenset)
    evidence_digest: str = ""

    def validate(self, *, now: float | None = None) -> None:
        checked_at = time.time() if now is None else now
        if not self.backend_id or not self.backend_version or not self.platform or not self.evidence_digest:
            raise SandboxError("isolation_attestation_incomplete", "Isolation attestation is incomplete.")
        if self.verified_at > checked_at or self.expires_at <= checked_at:
            raise SandboxError("isolation_attestation_expired", "Isolation attestation is not currently valid.")
        missing = REQUIRED_GUARANTEES - self.guarantees
        if missing:
            raise SandboxError(
                "isolation_guarantees_missing",
                "Isolation backend lacks required guarantees: " + ", ".join(sorted(missing)),
            )


@dataclass(frozen=True)
class SandboxExecutionRequest:
    execution_id: str
    run_id: str
    operation: str
    proposal_digest: str
    profile_digest: str
    argv: tuple[str, ...]
    cwd: str
    environment: Mapping[str, str] = field(default_factory=dict)
    timeout_seconds: float = 300

    @classmethod
    def create(cls, **values: Any) -> "SandboxExecutionRequest":
        return cls(execution_id=f"execution-{uuid.uuid4()}", **values)

    def validate(self) -> None:
        if not self.execution_id or not self.run_id or not self.operation or not self.proposal_digest or not self.profile_digest:
            raise SandboxError("sandbox_request_identity_missing", "Sandbox request identity is incomplete.")
        if not self.argv or not self.argv[0]:
            raise SandboxError("sandbox_argv_missing", "Sandbox execution requires an executable argv.")
        if self.timeout_seconds <= 0:
            raise SandboxError("sandbox_timeout_invalid", "Sandbox timeout must be positive.")
        forbidden = {key for key in self.environment if key.upper() in {"PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT"}}
        if forbidden:
            raise SandboxError(
                "sandbox_environment_forbidden", "System execution environment must be supplied by the backend.",
            )


@dataclass(frozen=True)
class SandboxExecutionReceipt:
    execution_id: str
    backend_id: str
    attestation_digest: str
    exit_code: int | None
    status: str
    started_at: float
    completed_at: float | None
    output_digest: str


class SandboxBackend(Protocol):
    def attest(self) -> IsolationAttestation: ...

    def execute(
        self,
        request: SandboxExecutionRequest,
        profile: ResolvedCapabilityProfile,
    ) -> SandboxExecutionReceipt: ...


class SandboxBroker:
    """The only Runtime entrypoint allowed to launch side-effect processes."""

    def __init__(self, backend: SandboxBackend | None, grants: AuthorizationGrantStore):
        self.backend = backend
        self.grants = grants
        self.effects = EffectExecutionStore(grants.database)

    def execute(
        self,
        *,
        grant_id: str,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        actual_payload: dict[str, object],
        request: SandboxExecutionRequest,
        now: float | None = None,
    ) -> SandboxExecutionReceipt:
        request.validate()
        expected = (proposal.run_id, proposal.operation, proposal.payload_digest, profile.digest)
        actual = (request.run_id, request.operation, request.proposal_digest, request.profile_digest)
        if actual != expected:
            raise SandboxError("sandbox_request_scope_mismatch", "Sandbox request is not bound to the proposal/profile.")
        if self.backend is None:
            raise SandboxError("sandbox_backend_unavailable", "No sandbox backend is available; execution is denied.")
        attestation = self.backend.attest()
        attestation.validate(now=now)
        self.effects.claim(
            execution_id=request.execution_id,
            grant_id=grant_id,
            proposal=proposal,
            profile=profile,
            actual_payload=actual_payload,
            attestation_digest=attestation.evidence_digest,
            now=now,
        )
        try:
            receipt = self.backend.execute(request, profile)
            if (
                receipt.execution_id != request.execution_id
                or receipt.backend_id != attestation.backend_id
                or receipt.attestation_digest != attestation.evidence_digest
            ):
                raise SandboxError("sandbox_receipt_untrusted", "Execution receipt is not bound to the active claim/attestation.")
            if receipt.status not in {"succeeded", "failed", "timed_out", "outcome_unknown"}:
                raise SandboxError("sandbox_receipt_invalid", "Sandbox backend returned an invalid status.")
            self.effects.complete(
                request.execution_id,
                status=receipt.status,
                receipt_digest=receipt.output_digest,
                now=receipt.completed_at if receipt.completed_at is not None else now,
            )
        except BaseException as error:
            try:
                self.effects.mark_outcome_unknown(
                    request.execution_id,
                    receipt_digest="broker:no-trusted-terminal-receipt",
                    error_code=type(error).__name__[:128],
                    now=now,
                )
            except Exception:
                pass
            raise
        return receipt
