"""Proposal/Grant-bound execution adapter for workspace file writes."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .audit import SecurityEventJournal
from .effects import EffectExecutionStore
from .filesystem import WindowsWorkspaceFilesystem, normalize_workspace_relative_path
from .grants import AuthorizationGrantStore
from .models import ActionProposal, ResolvedCapabilityProfile, canonical_digest
from .sandbox import SandboxError
from .tombstones import TombstoneError, TombstoneStore


class WorkspaceWriteApi(Protocol):
    root: Path
    def read_bytes(self, relative: str, *, max_bytes: int = 16 * 1024 * 1024) -> bytes: ...
    def atomic_write(self, relative: str, content: bytes) -> None: ...
    def compare_and_swap(self, relative: str, expected_content_digest: str, content: bytes) -> None: ...
    def atomic_rename(self, source_relative: str, destination_relative: str) -> None: ...
    def move_to_tombstone(self, relative: str, tombstone_id: str) -> str: ...
    def restore_tombstone(self, tombstone_id: str, destination_relative: str) -> None: ...
    def purge_tombstone(self, tombstone_id: str) -> None: ...
    def tombstone_exists(self, tombstone_id: str) -> bool: ...


@dataclass(frozen=True)
class FilesystemExecutionReceipt:
    execution_id: str
    operation: str
    relative_path_digest: str
    content_digest: str
    size_bytes: int
    status: str
    completed_at: float
    receipt_digest: str


@dataclass(frozen=True)
class FilesystemMutationReceipt:
    execution_id: str
    operation: str
    resource_digest: str
    status: str
    completed_at: float
    receipt_digest: str
    recovery_reference_digest: str | None = None


@dataclass(frozen=True)
class FilesystemReadReceipt:
    execution_id: str
    operation: str
    relative_path_digest: str
    content_digest: str
    size_bytes: int
    max_bytes: int
    status: str
    completed_at: float
    receipt_digest: str
    audit_event_digest: str


@dataclass(frozen=True)
class FilesystemReadResult:
    content: bytes
    receipt: FilesystemReadReceipt


class AuthorizedFilesystemExecutionService:
    """Consumes one Grant and produces one Effect for an exact atomic write."""

    backend_id = "windows-workspace-filesystem"
    backend_version = "1"

    def __init__(
        self,
        filesystem: WorkspaceWriteApi,
        grants: AuthorizationGrantStore,
        *,
        clock: Callable[[], float] = time.time,
        protected_prefixes: tuple[str, ...] = (".git", ".agents", ".codex", ".opendrsai-trash"),
        human_grant_verifier: Callable[[str], bool] | None = None,
    ):
        self.filesystem = filesystem
        self.grants = grants
        self.effects = EffectExecutionStore(grants.database)
        self.tombstones = TombstoneStore(grants.database, clock=clock)
        self.audit = SecurityEventJournal(grants.database)
        self.clock = clock
        self.protected_prefixes = tuple(prefix.casefold() for prefix in protected_prefixes)
        self.human_grant_verifier = human_grant_verifier or self._database_human_grant

    def _database_human_grant(self, grant_id: str) -> bool:
        try:
            with sqlite3.connect(self.grants.database, timeout=30) as database:
                row = database.execute(
                    "SELECT r.reviewer_kind,d.reviewer_kind,d.decision "
                    "FROM runtime_approval_grants g "
                    "JOIN runtime_approval_requests r ON r.request_id=g.request_id "
                    "JOIN runtime_approval_decisions d ON d.decision_id=g.decision_id "
                    "WHERE g.grant_id=?", (grant_id,),
                ).fetchone()
        except sqlite3.Error:
            return False
        return row == ("human", "human", "approved")

    @classmethod
    def for_windows(
        cls, workspace_root: Path, grants: AuthorizationGrantStore, **kwargs,
    ) -> "AuthorizedFilesystemExecutionService":
        return cls(WindowsWorkspaceFilesystem(workspace_root), grants, **kwargs)

    @staticmethod
    def write_payload(relative_path: str, content: bytes) -> dict[str, object]:
        if not isinstance(content, bytes):
            raise TypeError("content must be bytes.")
        parts = normalize_workspace_relative_path(relative_path)
        canonical_path = "/".join(parts)
        return {
            "relative_path": canonical_path,
            "content_digest": "sha256:" + hashlib.sha256(content).hexdigest(),
            "size_bytes": len(content),
        }

    @staticmethod
    def edit_payload(
        relative_path: str, source_content: bytes, old_text: str, new_text: str,
    ) -> dict[str, object]:
        if not isinstance(source_content, bytes):
            raise TypeError("source_content must be bytes.")
        if not isinstance(old_text, str) or not old_text:
            raise SandboxError("filesystem_edit_match_invalid", "Edit match text must be non-empty.")
        if not isinstance(new_text, str):
            raise SandboxError("filesystem_edit_replacement_invalid", "Edit replacement must be text.")
        try:
            source_text = source_content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise SandboxError("filesystem_edit_encoding_invalid", "Edit source must be valid UTF-8.") from error
        match_count = source_text.count(old_text)
        if match_count != 1:
            raise SandboxError(
                "filesystem_edit_match_not_unique",
                "Edit match must occur exactly once in the approved source version.",
            )
        result = source_text.replace(old_text, new_text, 1).encode("utf-8")
        return {
            "relative_path": "/".join(normalize_workspace_relative_path(relative_path)),
            "source_content_digest": "sha256:" + hashlib.sha256(source_content).hexdigest(),
            "old_text_digest": "sha256:" + hashlib.sha256(old_text.encode("utf-8")).hexdigest(),
            "new_text_digest": "sha256:" + hashlib.sha256(new_text.encode("utf-8")).hexdigest(),
            "match_count": 1,
            "result_content_digest": "sha256:" + hashlib.sha256(result).hexdigest(),
            "result_size_bytes": len(result),
        }

    @staticmethod
    def read_payload(relative_path: str, max_bytes: int) -> dict[str, object]:
        if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes <= 0:
            raise SandboxError("filesystem_read_limit_invalid", "Read limit must be a positive integer.")
        if max_bytes > 16 * 1024 * 1024:
            raise SandboxError("filesystem_read_limit_excessive", "Read limit exceeds the Runtime maximum.")
        return {
            "relative_path": "/".join(normalize_workspace_relative_path(relative_path)),
            "max_bytes": max_bytes,
        }

    @staticmethod
    def rename_payload(source_relative: str, destination_relative: str) -> dict[str, object]:
        return {
            "source_relative_path": "/".join(normalize_workspace_relative_path(source_relative)),
            "destination_relative_path": "/".join(normalize_workspace_relative_path(destination_relative)),
        }

    @staticmethod
    def delete_payload(relative_path: str) -> dict[str, object]:
        return {"relative_path": "/".join(normalize_workspace_relative_path(relative_path))}

    @staticmethod
    def restore_payload(deletion_execution_id: str, destination_relative: str) -> dict[str, object]:
        if not deletion_execution_id:
            raise SandboxError("filesystem_deletion_identity_missing", "Deletion execution identity is required.")
        return {
            "deletion_execution_id": deletion_execution_id,
            "destination_relative_path": "/".join(normalize_workspace_relative_path(destination_relative)),
        }

    @staticmethod
    def purge_payload(deletion_execution_id: str) -> dict[str, object]:
        if not deletion_execution_id:
            raise SandboxError("filesystem_deletion_identity_missing", "Deletion execution identity is required.")
        return {"deletion_execution_id": deletion_execution_id}

    def _authorize_path(self, relative_path: str, profile: ResolvedCapabilityProfile) -> str:
        parts = normalize_workspace_relative_path(relative_path)
        canonical_relative = "/".join(parts)
        if parts[0].casefold() in self.protected_prefixes:
            raise SandboxError("filesystem_control_path_denied", "Agent control paths cannot be modified.")
        filesystem_root = os.path.normcase(os.path.abspath(self.filesystem.root))
        profile_root = os.path.normcase(os.path.abspath(profile.workspace_root))
        if filesystem_root != profile_root:
            raise SandboxError("filesystem_profile_root_mismatch", "Filesystem broker root differs from the active profile.")
        target = os.path.normcase(os.path.abspath(Path(filesystem_root).joinpath(*parts)))
        permitted = False
        for configured in profile.writable_roots:
            allowed = Path(configured)
            if not allowed.is_absolute():
                allowed = Path(filesystem_root) / allowed
            allowed_value = os.path.normcase(os.path.abspath(allowed))
            try:
                allowed_in_workspace = os.path.commonpath((filesystem_root, allowed_value)) == filesystem_root
                target_in_allowed = os.path.commonpath((allowed_value, target)) == allowed_value
            except ValueError:
                continue
            if allowed_in_workspace and target_in_allowed:
                permitted = True
                break
        if not permitted:
            raise SandboxError("filesystem_write_root_denied", "Path is outside the profile writable roots.")
        return canonical_relative

    def _authorize_read_path(self, relative_path: str, profile: ResolvedCapabilityProfile) -> str:
        parts = normalize_workspace_relative_path(relative_path)
        if parts[0].casefold() in self.protected_prefixes:
            raise SandboxError("filesystem_control_path_denied", "Agent control paths cannot be read.")
        filesystem_root = os.path.normcase(os.path.abspath(self.filesystem.root))
        profile_root = os.path.normcase(os.path.abspath(profile.workspace_root))
        if filesystem_root != profile_root:
            raise SandboxError("filesystem_profile_root_mismatch", "Filesystem broker root differs from the active profile.")
        return "/".join(parts)

    def read(
        self, *, proposal: ActionProposal, profile: ResolvedCapabilityProfile,
        relative_path: str, max_bytes: int, execution_id: str | None = None,
        now: float | None = None,
    ) -> FilesystemReadResult:
        """Execute an exact capability-bound read without creating an Approval Grant."""

        if proposal.operation != "file.read":
            raise SandboxError("filesystem_operation_mismatch", "Filesystem adapter only accepts file.read proposals.")
        if "filesystem.read" not in proposal.required_capabilities:
            raise SandboxError("filesystem_capability_declaration_missing", "Proposal does not declare filesystem.read.")
        canonical_relative = self._authorize_read_path(relative_path, profile)
        payload = self.read_payload(canonical_relative, max_bytes)
        if not proposal.matches_payload(payload):
            raise SandboxError("proposal_payload_mismatch", "Read differs from the authorized Proposal.")
        if not profile.permits(proposal):
            raise SandboxError("filesystem_read_profile_denied", "Active Profile does not permit this read.")
        identity = execution_id or f"filesystem-read-{uuid.uuid4()}"
        content = self.filesystem.read_bytes(canonical_relative, max_bytes=max_bytes)
        completed_at = self.clock() if now is None else now
        content_digest = "sha256:" + hashlib.sha256(content).hexdigest()
        path_digest = canonical_digest(canonical_relative)
        receipt_payload = {
            "execution_id": identity, "operation": proposal.operation,
            "relative_path_digest": path_digest, "content_digest": content_digest,
            "size_bytes": len(content), "max_bytes": max_bytes,
            "status": "succeeded", "completed_at": completed_at,
            "profile_digest": profile.digest, "backend_id": self.backend_id,
        }
        receipt_digest = canonical_digest(receipt_payload)
        event = self.audit.append(
            "filesystem.read_succeeded", proposal.run_id,
            {**receipt_payload, "proposal_id": proposal.proposal_id, "receipt_digest": receipt_digest},
            now=completed_at,
        )
        return FilesystemReadResult(
            content=content,
            receipt=FilesystemReadReceipt(
                execution_id=identity, operation=proposal.operation,
                relative_path_digest=path_digest, content_digest=content_digest,
                size_bytes=len(content), max_bytes=max_bytes, status="succeeded",
                completed_at=completed_at, receipt_digest=receipt_digest,
                audit_event_digest=event.event_digest,
            ),
        )

    def write(
        self,
        *,
        grant_id: str,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        relative_path: str,
        content: bytes,
        execution_id: str | None = None,
        now: float | None = None,
    ) -> FilesystemExecutionReceipt:
        if proposal.operation != "file.write":
            raise SandboxError("filesystem_operation_mismatch", "Filesystem adapter only accepts file.write proposals.")
        if "filesystem.write" not in proposal.required_capabilities:
            raise SandboxError("filesystem_capability_declaration_missing", "Proposal does not declare filesystem.write.")
        canonical_relative = self._authorize_path(relative_path, profile)
        payload = self.write_payload(canonical_relative, content)
        identity = execution_id or f"filesystem-execution-{uuid.uuid4()}"
        attestation_digest = canonical_digest({
            "backend_id": self.backend_id,
            "backend_version": self.backend_version,
            "workspace_root": os.path.normcase(os.path.abspath(self.filesystem.root)),
            "profile_digest": profile.digest,
        })
        self.effects.claim(
            execution_id=identity,
            grant_id=grant_id,
            proposal=proposal,
            profile=profile,
            actual_payload=payload,
            attestation_digest=attestation_digest,
            now=now,
        )
        try:
            self.filesystem.atomic_write(canonical_relative, content)
        except BaseException as error:
            # Once the OS operation starts, a generic error is not sufficient
            # evidence that replacement did not happen.  Never make the Grant
            # replayable; require reconciliation/new authorization.
            try:
                self.effects.mark_outcome_unknown(
                    identity,
                    receipt_digest="filesystem:no-trusted-terminal-receipt",
                    error_code=type(error).__name__[:128],
                    now=now,
                )
            except Exception:
                pass
            try:
                self.audit.append(
                    "filesystem.mutation_outcome_unknown", identity,
                    {
                        "run_id": proposal.run_id, "proposal_id": proposal.proposal_id,
                        "operation": proposal.operation,
                        "error_code": type(error).__name__[:128],
                        "receipt_digest": "filesystem:no-trusted-terminal-receipt",
                    },
                    now=self.clock() if now is None else now,
                )
            except Exception:
                pass
            raise
        completed_at = self.clock() if now is None else now
        receipt_payload = {
            "execution_id": identity,
            "operation": proposal.operation,
            "relative_path_digest": canonical_digest(canonical_relative),
            "content_digest": payload["content_digest"],
            "size_bytes": payload["size_bytes"],
            "status": "succeeded",
            "completed_at": completed_at,
            "attestation_digest": attestation_digest,
        }
        receipt_digest = canonical_digest(receipt_payload)
        self.effects.complete(
            identity, status="succeeded", receipt_digest=receipt_digest, now=completed_at,
        )
        self.audit.append(
            "filesystem.mutation_succeeded", identity,
            {
                "run_id": proposal.run_id, "proposal_id": proposal.proposal_id,
                "operation": proposal.operation,
                "relative_path_digest": receipt_payload["relative_path_digest"],
                "content_digest": payload["content_digest"],
                "size_bytes": payload["size_bytes"], "receipt_digest": receipt_digest,
                "profile_digest": profile.digest, "backend_id": self.backend_id,
            },
            now=completed_at,
        )
        return FilesystemExecutionReceipt(
            execution_id=identity,
            operation=proposal.operation,
            relative_path_digest=str(receipt_payload["relative_path_digest"]),
            content_digest=str(payload["content_digest"]),
            size_bytes=len(content),
            status="succeeded",
            completed_at=completed_at,
            receipt_digest=receipt_digest,
        )

    def edit(
        self,
        *,
        grant_id: str,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        relative_path: str,
        old_text: str,
        new_text: str,
        execution_id: str | None = None,
        now: float | None = None,
    ) -> FilesystemExecutionReceipt:
        if proposal.operation != "file.edit":
            raise SandboxError("filesystem_operation_mismatch", "Filesystem adapter only accepts file.edit proposals.")
        if "filesystem.write" not in proposal.required_capabilities:
            raise SandboxError("filesystem_capability_declaration_missing", "Proposal does not declare filesystem.write.")
        canonical_relative = self._authorize_path(relative_path, profile)
        source = self.filesystem.read_bytes(canonical_relative)
        payload = self.edit_payload(canonical_relative, source, old_text, new_text)
        if not proposal.matches_payload(payload):
            raise SandboxError("proposal_payload_mismatch", "Edit differs from the authorized Proposal.")
        result = source.decode("utf-8").replace(old_text, new_text, 1).encode("utf-8")
        identity = execution_id or f"filesystem-edit-{uuid.uuid4()}"
        attestation_digest = canonical_digest({
            "backend_id": self.backend_id,
            "backend_version": self.backend_version,
            "workspace_root": os.path.normcase(os.path.abspath(self.filesystem.root)),
            "profile_digest": profile.digest,
            "operation": proposal.operation,
            "cas": "source-content-digest",
        })
        self.effects.claim(
            execution_id=identity, grant_id=grant_id, proposal=proposal,
            profile=profile, actual_payload=payload,
            attestation_digest=attestation_digest, now=now,
        )
        try:
            self.filesystem.compare_and_swap(
                canonical_relative, str(payload["source_content_digest"]), result,
            )
        except SandboxError as error:
            if error.code == "filesystem_edit_conflict":
                completed_at = self.clock() if now is None else now
                receipt_digest = canonical_digest({
                    "execution_id": identity, "operation": proposal.operation,
                    "status": "failed", "error_code": error.code,
                    "source_content_digest": payload["source_content_digest"],
                    "completed_at": completed_at,
                })
                self.effects.complete(
                    identity, status="failed", receipt_digest=receipt_digest,
                    error_code=error.code, now=completed_at,
                )
                self.audit.append(
                    "filesystem.mutation_failed", identity,
                    {
                        "run_id": proposal.run_id, "proposal_id": proposal.proposal_id,
                        "operation": proposal.operation, "error_code": error.code,
                        "receipt_digest": receipt_digest,
                    },
                    now=completed_at,
                )
                raise
            self._mark_unknown(
                identity, error, now, run_id=proposal.run_id,
                proposal_id=proposal.proposal_id, operation=proposal.operation,
            )
            raise
        except BaseException as error:
            self._mark_unknown(
                identity, error, now, run_id=proposal.run_id,
                proposal_id=proposal.proposal_id, operation=proposal.operation,
            )
            raise
        completed_at = self.clock() if now is None else now
        receipt_payload = {
            "execution_id": identity, "operation": proposal.operation,
            "relative_path_digest": canonical_digest(canonical_relative),
            "content_digest": payload["result_content_digest"],
            "size_bytes": payload["result_size_bytes"], "status": "succeeded",
            "completed_at": completed_at, "attestation_digest": attestation_digest,
            "source_content_digest": payload["source_content_digest"],
        }
        receipt_digest = canonical_digest(receipt_payload)
        self.effects.complete(identity, status="succeeded", receipt_digest=receipt_digest, now=completed_at)
        self.audit.append(
            "filesystem.mutation_succeeded", identity,
            {
                "run_id": proposal.run_id, "proposal_id": proposal.proposal_id,
                "operation": proposal.operation,
                "relative_path_digest": receipt_payload["relative_path_digest"],
                "source_content_digest": payload["source_content_digest"],
                "content_digest": payload["result_content_digest"],
                "size_bytes": payload["result_size_bytes"],
                "receipt_digest": receipt_digest, "profile_digest": profile.digest,
                "backend_id": self.backend_id,
            },
            now=completed_at,
        )
        return FilesystemExecutionReceipt(
            execution_id=identity, operation=proposal.operation,
            relative_path_digest=str(receipt_payload["relative_path_digest"]),
            content_digest=str(payload["result_content_digest"]),
            size_bytes=len(result), status="succeeded", completed_at=completed_at,
            receipt_digest=receipt_digest,
        )

    def _claim_mutation(
        self, *, operation: str, capability: str, grant_id: str,
        proposal: ActionProposal, profile: ResolvedCapabilityProfile,
        payload: dict[str, object], execution_id: str, now: float | None,
    ) -> str:
        if proposal.operation != operation:
            raise SandboxError("filesystem_operation_mismatch", f"Filesystem adapter requires {operation}.")
        if capability not in proposal.required_capabilities:
            raise SandboxError("filesystem_capability_declaration_missing", f"Proposal does not declare {capability}.")
        attestation_digest = canonical_digest({
            "backend_id": self.backend_id,
            "backend_version": self.backend_version,
            "workspace_root": os.path.normcase(os.path.abspath(self.filesystem.root)),
            "profile_digest": profile.digest,
            "operation": operation,
        })
        self.effects.claim(
            execution_id=execution_id, grant_id=grant_id, proposal=proposal,
            profile=profile, actual_payload=payload,
            attestation_digest=attestation_digest, now=now,
        )
        return attestation_digest

    def _mark_unknown(
        self, execution_id: str, error: BaseException, now: float | None,
        *, run_id: str, proposal_id: str, operation: str,
    ) -> None:
        try:
            self.effects.mark_outcome_unknown(
                execution_id, receipt_digest="filesystem:no-trusted-terminal-receipt",
                error_code=type(error).__name__[:128], now=now,
            )
        except Exception:
            pass
        try:
            self.audit.append(
                "filesystem.mutation_outcome_unknown", execution_id,
                {
                    "run_id": run_id, "proposal_id": proposal_id,
                    "operation": operation, "error_code": type(error).__name__[:128],
                    "receipt_digest": "filesystem:no-trusted-terminal-receipt",
                },
                now=self.clock() if now is None else now,
            )
        except Exception:
            pass

    def _complete_mutation(
        self, *, execution_id: str, operation: str, payload: dict[str, object],
        attestation_digest: str, now: float | None,
        recovery_reference: str | None = None,
        run_id: str, proposal_id: str, profile_digest: str,
    ) -> FilesystemMutationReceipt:
        completed_at = self.clock() if now is None else now
        resource_digest = canonical_digest(payload)
        recovery_digest = canonical_digest(recovery_reference) if recovery_reference else None
        receipt_payload = {
            "execution_id": execution_id, "operation": operation,
            "resource_digest": resource_digest, "status": "succeeded",
            "completed_at": completed_at, "attestation_digest": attestation_digest,
            "recovery_reference_digest": recovery_digest,
        }
        receipt_digest = canonical_digest(receipt_payload)
        self.effects.complete(
            execution_id, status="succeeded", receipt_digest=receipt_digest, now=completed_at,
        )
        self.audit.append(
            "filesystem.mutation_succeeded", execution_id,
            {
                "run_id": run_id, "proposal_id": proposal_id, "operation": operation,
                "resource_digest": resource_digest, "receipt_digest": receipt_digest,
                "recovery_reference_digest": recovery_digest,
                "profile_digest": profile_digest, "backend_id": self.backend_id,
            },
            now=completed_at,
        )
        return FilesystemMutationReceipt(
            execution_id=execution_id, operation=operation,
            resource_digest=resource_digest, status="succeeded",
            completed_at=completed_at, receipt_digest=receipt_digest,
            recovery_reference_digest=recovery_digest,
        )

    def rename(
        self, *, grant_id: str, proposal: ActionProposal,
        profile: ResolvedCapabilityProfile, source_relative: str,
        destination_relative: str, execution_id: str | None = None,
        now: float | None = None,
    ) -> FilesystemMutationReceipt:
        source = self._authorize_path(source_relative, profile)
        destination = self._authorize_path(destination_relative, profile)
        if source == destination:
            raise SandboxError("filesystem_rename_identity", "Rename source and destination must differ.")
        payload = self.rename_payload(source, destination)
        identity = execution_id or f"filesystem-execution-{uuid.uuid4()}"
        attestation = self._claim_mutation(
            operation="file.rename", capability="filesystem.rename",
            grant_id=grant_id, proposal=proposal, profile=profile,
            payload=payload, execution_id=identity, now=now,
        )
        try:
            self.filesystem.atomic_rename(source, destination)
        except BaseException as error:
            self._mark_unknown(
                identity, error, now, run_id=proposal.run_id,
                proposal_id=proposal.proposal_id, operation="file.rename",
            )
            raise
        return self._complete_mutation(
            execution_id=identity, operation="file.rename", payload=payload,
            attestation_digest=attestation, now=now,
            run_id=proposal.run_id, proposal_id=proposal.proposal_id,
            profile_digest=profile.digest,
        )

    def delete(
        self, *, grant_id: str, proposal: ActionProposal,
        profile: ResolvedCapabilityProfile, relative_path: str,
        execution_id: str | None = None, now: float | None = None,
    ) -> FilesystemMutationReceipt:
        relative = self._authorize_path(relative_path, profile)
        payload = self.delete_payload(relative)
        identity = execution_id or f"filesystem-execution-{uuid.uuid4()}"
        if proposal.operation != "file.delete" or "filesystem.delete" not in proposal.required_capabilities:
            raise SandboxError("filesystem_operation_mismatch", "Filesystem adapter requires declared file.delete.")
        if not proposal.matches_payload(payload) or not profile.permits(proposal):
            raise SandboxError("filesystem_delete_scope_mismatch", "Delete differs from Proposal or Profile.")
        tombstone_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]
        self.tombstones.prepare(
            tombstone_id=tombstone_id, deletion_execution_id=identity,
            run_id=proposal.run_id, profile_digest=profile.digest,
            source_payload_digest=canonical_digest(payload),
        )
        attestation = self._claim_mutation(
            operation="file.delete", capability="filesystem.delete",
            grant_id=grant_id, proposal=proposal, profile=profile,
            payload=payload, execution_id=identity, now=now,
        )
        try:
            tombstone = self.filesystem.move_to_tombstone(relative, tombstone_id)
            self.tombstones.mark_moved(tombstone_id)
        except BaseException as error:
            try:
                self.tombstones.mark_delete_unknown(tombstone_id, type(error).__name__[:128])
            except Exception:
                pass
            self._mark_unknown(
                identity, error, now, run_id=proposal.run_id,
                proposal_id=proposal.proposal_id, operation="file.delete",
            )
            raise
        return self._complete_mutation(
            execution_id=identity, operation="file.delete", payload=payload,
            attestation_digest=attestation, now=now,
            recovery_reference=tombstone,
            run_id=proposal.run_id, proposal_id=proposal.proposal_id,
            profile_digest=profile.digest,
        )

    def restore(
        self, *, grant_id: str, proposal: ActionProposal,
        profile: ResolvedCapabilityProfile, deletion_execution_id: str,
        destination_relative: str, execution_id: str | None = None,
        now: float | None = None,
    ) -> FilesystemMutationReceipt:
        destination = self._authorize_path(destination_relative, profile)
        payload = self.restore_payload(deletion_execution_id, destination)
        identity = execution_id or f"filesystem-execution-{uuid.uuid4()}"
        record = self.tombstones.get_by_deletion_execution(deletion_execution_id)
        if record.run_id != proposal.run_id:
            raise TombstoneError("tombstone_run_mismatch", "Tombstone belongs to another Run.")
        self.tombstones.claim_restore(record.tombstone_id, identity, canonical_digest(payload))
        try:
            attestation = self._claim_mutation(
                operation="file.restore", capability="filesystem.restore",
                grant_id=grant_id, proposal=proposal, profile=profile,
                payload=payload, execution_id=identity, now=now,
            )
        except BaseException:
            self.tombstones.release_restore(record.tombstone_id, identity)
            raise
        try:
            self.filesystem.restore_tombstone(record.tombstone_id, destination)
            self.tombstones.mark_restored(record.tombstone_id, identity)
        except BaseException as error:
            self._mark_unknown(
                identity, error, now, run_id=proposal.run_id,
                proposal_id=proposal.proposal_id, operation="file.restore",
            )
            raise
        return self._complete_mutation(
            execution_id=identity, operation="file.restore", payload=payload,
            attestation_digest=attestation, now=now,
            run_id=proposal.run_id, proposal_id=proposal.proposal_id,
            profile_digest=profile.digest,
        )

    def purge(
        self, *, grant_id: str, proposal: ActionProposal,
        profile: ResolvedCapabilityProfile, deletion_execution_id: str,
        execution_id: str | None = None, now: float | None = None,
    ) -> FilesystemMutationReceipt:
        payload = self.purge_payload(deletion_execution_id)
        identity = execution_id or f"filesystem-execution-{uuid.uuid4()}"
        record = self.tombstones.get_by_deletion_execution(deletion_execution_id)
        if record.run_id != proposal.run_id:
            raise TombstoneError("tombstone_run_mismatch", "Tombstone belongs to another Run.")
        if proposal.risk != "irreversible" or "irreversible_external_write" not in proposal.effect_categories:
            raise SandboxError(
                "filesystem_purge_human_review_missing",
                "Purge must be declared irreversible and routed to mandatory human review.",
            )
        if not self.human_grant_verifier(grant_id):
            raise SandboxError(
                "filesystem_purge_human_grant_required",
                "Purge Grant must derive from an approved human Decision.",
            )
        self.tombstones.claim_purge(record.tombstone_id, identity)
        try:
            attestation = self._claim_mutation(
                operation="file.purge", capability="filesystem.purge",
                grant_id=grant_id, proposal=proposal, profile=profile,
                payload=payload, execution_id=identity, now=now,
            )
        except BaseException:
            self.tombstones.release_purge(record.tombstone_id, identity)
            raise
        try:
            self.filesystem.purge_tombstone(record.tombstone_id)
            self.tombstones.mark_purged(record.tombstone_id, identity)
        except BaseException as error:
            self._mark_unknown(
                identity, error, now, run_id=proposal.run_id,
                proposal_id=proposal.proposal_id, operation="file.purge",
            )
            raise
        return self._complete_mutation(
            execution_id=identity, operation="file.purge", payload=payload,
            attestation_digest=attestation, now=now,
            run_id=proposal.run_id, proposal_id=proposal.proposal_id,
            profile_digest=profile.digest,
        )

    def reconcile_tombstone(self, deletion_execution_id: str):
        """Converge only from observable state; never replay a mutation."""

        record = self.tombstones.get_by_deletion_execution(deletion_execution_id)
        exists = self.filesystem.tombstone_exists(record.tombstone_id)
        if record.state in {"prepared", "delete_unknown"} and exists:
            return self.tombstones.mark_moved(record.tombstone_id)
        if record.state == "restoring" and exists and record.restore_execution_id:
            # Atomic handle rename did not occur if the exact tombstone still exists.
            return self.tombstones.release_restore(record.tombstone_id, record.restore_execution_id)
        if record.state == "purging" and record.purge_execution_id:
            if exists:
                return self.tombstones.release_purge(record.tombstone_id, record.purge_execution_id)
            # Handle disposition has one possible target: absence proves purge.
            return self.tombstones.mark_purged(record.tombstone_id, record.purge_execution_id)
        return record
