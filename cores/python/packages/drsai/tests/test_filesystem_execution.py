from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
import hashlib
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    ActionProposal,
    AuthorizationGrantStore,
    AuthorizedFilesystemExecutionService,
    ResolvedCapabilityProfile,
    SandboxError,
)


class FakeFilesystem:
    def __init__(self, root: Path, *, fail_after_write: bool = False, cas_conflict: bool = False):
        self.root = root
        self.fail_after_write = fail_after_write
        self.cas_conflict = cas_conflict
        self.writes: list[tuple[str, bytes]] = []
        self.renames: list[tuple[str, str]] = []
        self.tombstones: list[tuple[str, str]] = []
        self.restores: list[tuple[str, str]] = []
        self.purges: list[str] = []
        self.existing_tombstones: set[str] = set()
        self.contents: dict[str, bytes] = {}
        self.reads: list[tuple[str, int]] = []

    def read_bytes(self, relative: str, *, max_bytes: int = 16 * 1024 * 1024) -> bytes:
        self.reads.append((relative, max_bytes))
        content = self.contents.get(relative, b"")
        if len(content) > max_bytes:
            raise SandboxError("filesystem_read_too_large", "File exceeds the authorized read limit.")
        return content

    def atomic_write(self, relative: str, content: bytes) -> None:
        self.writes.append((relative, content))
        if self.fail_after_write:
            raise OSError("injected post-write uncertainty")

    def compare_and_swap(self, relative: str, expected_content_digest: str, content: bytes) -> None:
        current = self.contents.get(relative, b"")
        actual = "sha256:" + hashlib.sha256(current).hexdigest()
        if self.cas_conflict or actual != expected_content_digest:
            raise SandboxError("filesystem_edit_conflict", "File changed after proposal.")
        self.writes.append((relative, content))
        self.contents[relative] = content
        if self.fail_after_write:
            raise OSError("injected post-write uncertainty")

    def atomic_rename(self, source_relative: str, destination_relative: str) -> None:
        self.renames.append((source_relative, destination_relative))
        if self.fail_after_write:
            raise OSError("injected post-rename uncertainty")

    def move_to_tombstone(self, relative: str, tombstone_id: str) -> str:
        self.tombstones.append((relative, tombstone_id))
        self.existing_tombstones.add(tombstone_id)
        if self.fail_after_write:
            raise OSError("injected post-delete uncertainty")
        return f".opendrsai-trash/{tombstone_id}.deleted"

    def restore_tombstone(self, tombstone_id: str, destination_relative: str) -> None:
        self.restores.append((tombstone_id, destination_relative))
        self.existing_tombstones.discard(tombstone_id)
        if self.fail_after_write:
            raise OSError("injected post-restore uncertainty")

    def purge_tombstone(self, tombstone_id: str) -> None:
        self.purges.append(tombstone_id)
        self.existing_tombstones.discard(tombstone_id)
        if self.fail_after_write:
            raise OSError("injected post-purge uncertainty")

    def tombstone_exists(self, tombstone_id: str) -> bool:
        return tombstone_id in self.existing_tombstones


def profile(root: Path, *, writable_roots: tuple[str, ...] | None = None) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id="profile-files", version=1, workspace_root=str(root),
        capabilities=frozenset({
            "filesystem.read",
            "filesystem.write", "filesystem.rename", "filesystem.delete",
            "filesystem.restore", "filesystem.purge",
        }),
        writable_roots=writable_roots if writable_roots is not None else (str(root),),
        trusted_workspace=True,
    )


def proposal(run_id: str, relative: str, content: bytes) -> ActionProposal:
    return ActionProposal.create(
        proposal_id="proposal-files", run_id=run_id, operation="file.write",
        payload=AuthorizedFilesystemExecutionService.write_payload(relative, content),
        risk="write", required_capabilities=("filesystem.write",),
    )


def mutation_proposal(
    run_id: str, operation: str, payload: dict[str, object], capability: str,
    *, risk: str = "write", effect_categories: tuple[str, ...] = (),
) -> ActionProposal:
    return ActionProposal.create(
        proposal_id=f"proposal-{operation}", run_id=run_id, operation=operation,
        payload=payload, risk=risk, required_capabilities=(capability,),
        effect_categories=effect_categories,
    )


def read_proposal(run_id: str, relative: str, max_bytes: int) -> ActionProposal:
    return ActionProposal.create(
        proposal_id="proposal-read", run_id=run_id, operation="file.read",
        payload=AuthorizedFilesystemExecutionService.read_payload(relative, max_bytes),
        risk="read", required_capabilities=("filesystem.read",),
    )


def edit_proposal(
    run_id: str, relative: str, source: bytes, old_text: str, new_text: str,
) -> ActionProposal:
    return ActionProposal.create(
        proposal_id="proposal-edit", run_id=run_id, operation="file.edit",
        payload=AuthorizedFilesystemExecutionService.edit_payload(
            relative, source, old_text, new_text,
        ),
        risk="write", required_capabilities=("filesystem.write",),
    )


def test_read_is_profile_and_payload_bound_without_approval_grant(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    secret = b"read-secret-canary"
    filesystem = FakeFilesystem(root)
    filesystem.contents["notes.txt"] = secret
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    service = AuthorizedFilesystemExecutionService(filesystem, grants, clock=lambda: 101)
    action = read_proposal("run-read", "notes.txt", 100)

    result = service.read(
        proposal=action, profile=profile(root), relative_path="notes.txt",
        max_bytes=100, execution_id="read-1", now=101,
    )

    assert result.content == secret
    assert result.receipt.status == "succeeded"
    assert result.receipt.content_digest == "sha256:" + hashlib.sha256(secret).hexdigest()
    assert secret not in database.read_bytes()
    assert "notes.txt" not in repr(result.receipt)
    service.audit.verify()


@pytest.mark.skipif(os.name != "nt", reason="real handle-backed adapter requires Windows")
def test_read_uses_real_handle_backed_boundary(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    (root / "nested").mkdir(parents=True)
    content = b"handle-backed-read"
    (root / "nested" / "input.txt").write_bytes(content)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    service = AuthorizedFilesystemExecutionService.for_windows(root, grants, clock=lambda: 101)
    action = read_proposal("run-real-read", "nested/input.txt", len(content))

    result = service.read(
        proposal=action, profile=profile(root), relative_path="nested\\input.txt",
        max_bytes=len(content), execution_id="real-read", now=101,
    )

    assert result.content == content
    assert result.receipt.size_bytes == len(content)
    service.audit.verify()


@pytest.mark.parametrize(
    "path,limit,code",
    [
        ("other.txt", 100, "proposal_payload_mismatch"),
        ("notes.txt", 99, "proposal_payload_mismatch"),
        (".git/config", 100, "filesystem_control_path_denied"),
    ],
)
def test_read_substitution_and_control_paths_fail_before_io(
    tmp_path: Path, path: str, limit: int, code: str,
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    action = read_proposal("run-read-denied", "notes.txt", 100)
    with pytest.raises(SandboxError) as rejected:
        service.read(
            proposal=action, profile=profile(root), relative_path=path, max_bytes=limit,
        )
    assert rejected.value.code == code
    assert filesystem.reads == []


def test_read_profile_root_and_capability_are_enforced(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    other = tmp_path / "other"
    root.mkdir()
    other.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    action = read_proposal("run-read-profile", "notes.txt", 100)
    with pytest.raises(SandboxError) as mismatch:
        service.read(proposal=action, profile=profile(other), relative_path="notes.txt", max_bytes=100)
    assert mismatch.value.code == "filesystem_profile_root_mismatch"
    denied_profile = ResolvedCapabilityProfile(
        profile_id="no-read", version=1, workspace_root=str(root),
        capabilities=frozenset(), trusted_workspace=True,
    )
    with pytest.raises(SandboxError) as denied:
        service.read(proposal=action, profile=denied_profile, relative_path="notes.txt", max_bytes=100)
    assert denied.value.code == "filesystem_read_profile_denied"
    assert filesystem.reads == []


def test_read_size_limit_is_enforced_and_secret_is_not_audited(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    secret = b"oversized-secret"
    filesystem.contents["large.txt"] = secret
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    action = read_proposal("run-read-large", "large.txt", 5)
    with pytest.raises(SandboxError) as rejected:
        service.read(proposal=action, profile=profile(root), relative_path="large.txt", max_bytes=5)
    assert rejected.value.code == "filesystem_read_too_large"
    assert secret not in database.read_bytes()


@pytest.mark.skipif(os.name != "nt", reason="real handle-backed adapter requires Windows")
def test_exact_grant_executes_one_real_handle_backed_atomic_write(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    (root / "nested").mkdir(parents=True)
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    active = profile(root)
    content = b"approved-content"
    action = proposal("run-files", "nested/output.txt", content)
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService.for_windows(
        root, grants, clock=lambda: 101, human_grant_verifier=lambda _grant_id: True,
    )

    receipt = service.write(
        grant_id=grant.grant_id, proposal=action, profile=active,
        relative_path="nested\\output.txt", content=content,
        execution_id="filesystem-execution-1", now=101,
    )
    assert (root / "nested" / "output.txt").read_bytes() == content
    assert receipt.status == "succeeded" and receipt.content_digest.startswith("sha256:")
    assert "nested/output.txt" not in repr(receipt)
    effect = service.effects.get(receipt.execution_id)
    assert effect.status == "succeeded" and effect.receipt_digest == receipt.receipt_digest
    assert grants.get(grant.grant_id).consumed_at == 101
    events = service.audit.list()
    assert events[-1].event_type == "filesystem.mutation_succeeded"
    assert events[-1].payload["receipt_digest"] == receipt.receipt_digest
    assert "nested/output.txt" not in repr(events[-1].payload)
    service.audit.verify()


@pytest.mark.parametrize("changed_path,changed_content", [("other.txt", b"approved"), ("file.txt", b"changed")])
def test_path_or_content_substitution_fails_before_filesystem_write(
    tmp_path: Path, changed_path: str, changed_content: bytes,
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    action = proposal("run-substitution", "file.txt", b"approved")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    with pytest.raises(Exception) as rejected:
        service.write(
            grant_id=grant.grant_id, proposal=action, profile=active,
            relative_path=changed_path, content=changed_content, now=101,
        )
    assert getattr(rejected.value, "code", "") == "proposal_payload_mismatch"
    assert filesystem.writes == []
    assert grants.get(grant.grant_id).consumed_at is None


@pytest.mark.parametrize(
    "relative,writable,code",
    [
        (".git/config", (".",), "filesystem_control_path_denied"),
        (".codex/policy.toml", (".",), "filesystem_control_path_denied"),
        (".opendrsai-trash/fake.deleted", (".",), "filesystem_control_path_denied"),
        ("outside.txt", ("allowed",), "filesystem_write_root_denied"),
    ],
)
def test_control_paths_and_non_writable_roots_are_denied_before_grant_consumption(
    tmp_path: Path, relative: str, writable: tuple[str, ...], code: str,
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root, writable_roots=writable)
    action = proposal("run-denied", relative, b"content")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    with pytest.raises(SandboxError) as rejected:
        service.write(
            grant_id=grant.grant_id, proposal=action, profile=active,
            relative_path=relative, content=b"content", now=101,
        )
    assert rejected.value.code == code
    assert grants.get(grant.grant_id).consumed_at is None
    assert filesystem.writes == []


def test_concurrent_retries_consume_one_grant_and_write_once(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    action = proposal("run-concurrent", "file.txt", b"content")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)

    def attempt(index: int) -> str:
        try:
            service.write(
                grant_id=grant.grant_id, proposal=action, profile=active,
                relative_path="file.txt", content=b"content",
                execution_id=f"execution-{index}", now=101,
            )
            return "succeeded"
        except Exception:
            return "denied"

    with ThreadPoolExecutor(max_workers=16) as pool:
        outcomes = list(pool.map(attempt, range(32)))
    assert outcomes.count("succeeded") == 1
    assert filesystem.writes == [("file.txt", b"content")]


def test_post_write_error_is_outcome_unknown_non_replayable_and_secret_free(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    secret = b"secret-file-content-canary"
    filesystem = FakeFilesystem(root, fail_after_write=True)
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    active = profile(root)
    action = proposal("run-unknown", "file.txt", secret)
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    with pytest.raises(OSError, match="post-write uncertainty"):
        service.write(
            grant_id=grant.grant_id, proposal=action, profile=active,
            relative_path="file.txt", content=secret,
            execution_id="execution-unknown", now=101,
        )
    effect = service.effects.get("execution-unknown")
    assert effect.status == "outcome_unknown"
    assert grants.get(grant.grant_id).consumed_at == 101
    assert secret not in database.read_bytes()
    assert service.audit.list()[-1].event_type == "filesystem.mutation_outcome_unknown"
    service.audit.verify()
    with pytest.raises(Exception) as replay:
        service.write(
            grant_id=grant.grant_id, proposal=action, profile=active,
            relative_path="file.txt", content=secret,
            execution_id="execution-replay", now=102,
        )
    assert getattr(replay.value, "code", "") == "grant_already_consumed"


def test_edit_binds_source_unique_match_and_result_without_persisting_text(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    source = b"prefix secret-old suffix"
    filesystem = FakeFilesystem(root)
    filesystem.contents["notes.txt"] = source
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    active = profile(root)
    action = edit_proposal("run-edit", "notes.txt", source, "secret-old", "secret-new")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants, clock=lambda: 101)

    receipt = service.edit(
        grant_id=grant.grant_id, proposal=action, profile=active,
        relative_path="notes.txt", old_text="secret-old", new_text="secret-new",
        execution_id="edit-1", now=101,
    )

    assert filesystem.contents["notes.txt"] == b"prefix secret-new suffix"
    assert receipt.operation == "file.edit" and receipt.status == "succeeded"
    persisted = database.read_bytes()
    assert b"secret-old" not in persisted and b"secret-new" not in persisted
    service.audit.verify()


@pytest.mark.parametrize(
    "old_text,new_text,code",
    [
        ("other", "replacement", "filesystem_edit_match_not_unique"),
        ("secret-old", "other-result", "proposal_payload_mismatch"),
    ],
)
def test_edit_argument_substitution_fails_before_grant_consumption(
    tmp_path: Path, old_text: str, new_text: str, code: str,
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    source = b"prefix secret-old suffix"
    filesystem = FakeFilesystem(root)
    filesystem.contents["notes.txt"] = source
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    action = edit_proposal("run-edit-substitute", "notes.txt", source, "secret-old", "secret-new")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)

    with pytest.raises(SandboxError) as rejected:
        service.edit(
            grant_id=grant.grant_id, proposal=action, profile=active,
            relative_path="notes.txt", old_text=old_text, new_text=new_text, now=101,
        )
    assert rejected.value.code == code
    assert grants.get(grant.grant_id).consumed_at is None
    assert filesystem.writes == []


def test_edit_cas_conflict_is_failed_non_replayable_and_does_not_overwrite(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    source = b"approved old value"
    filesystem = FakeFilesystem(root, cas_conflict=True)
    filesystem.contents["notes.txt"] = source
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    action = edit_proposal("run-edit-conflict", "notes.txt", source, "old", "new")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants, clock=lambda: 101)

    with pytest.raises(SandboxError) as rejected:
        service.edit(
            grant_id=grant.grant_id, proposal=action, profile=active,
            relative_path="notes.txt", old_text="old", new_text="new",
            execution_id="edit-conflict", now=101,
        )
    assert rejected.value.code == "filesystem_edit_conflict"
    assert filesystem.contents["notes.txt"] == source
    assert service.effects.get("edit-conflict").status == "failed"
    assert grants.get(grant.grant_id).consumed_at == 101
    assert service.audit.list()[-1].event_type == "filesystem.mutation_failed"


@pytest.mark.skipif(os.name != "nt", reason="real handle-backed adapter requires Windows")
def test_real_rename_binds_both_paths_and_delete_creates_deterministic_tombstone(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "source.txt").write_bytes(b"recoverable")
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    active = profile(root)
    service = AuthorizedFilesystemExecutionService.for_windows(
        root, grants, clock=lambda: 101, human_grant_verifier=lambda _grant_id: True,
    )

    rename_payload = service.rename_payload("source.txt", "renamed.txt")
    rename_action = mutation_proposal("run-mutations", "file.rename", rename_payload, "filesystem.rename")
    rename_grant = grants.issue(rename_action, active, now=100, ttl_seconds=60)
    rename_receipt = service.rename(
        grant_id=rename_grant.grant_id, proposal=rename_action, profile=active,
        source_relative="source.txt", destination_relative="renamed.txt",
        execution_id="rename-execution", now=101,
    )
    assert rename_receipt.status == "succeeded"
    assert not (root / "source.txt").exists()
    assert (root / "renamed.txt").read_bytes() == b"recoverable"

    delete_payload = service.delete_payload("renamed.txt")
    delete_action = mutation_proposal("run-mutations", "file.delete", delete_payload, "filesystem.delete")
    delete_grant = grants.issue(delete_action, active, now=102, ttl_seconds=60)
    delete_receipt = service.delete(
        grant_id=delete_grant.grant_id, proposal=delete_action, profile=active,
        relative_path="renamed.txt", execution_id="delete-execution", now=103,
    )
    expected_id = hashlib.sha256(b"delete-execution").hexdigest()[:32]
    tombstone = root / ".opendrsai-trash" / f"{expected_id}.deleted"
    assert not (root / "renamed.txt").exists()
    assert tombstone.read_bytes() == b"recoverable"
    assert delete_receipt.recovery_reference_digest is not None
    assert ".opendrsai-trash" not in repr(delete_receipt)
    assert service.tombstones.get_by_deletion_execution("delete-execution").state == "moved"

    restore_payload = service.restore_payload("delete-execution", "restored.txt")
    restore_action = mutation_proposal("run-mutations", "file.restore", restore_payload, "filesystem.restore")
    restore_grant = grants.issue(restore_action, active, now=104, ttl_seconds=60)
    restore_receipt = service.restore(
        grant_id=restore_grant.grant_id, proposal=restore_action, profile=active,
        deletion_execution_id="delete-execution", destination_relative="restored.txt",
        execution_id="restore-execution", now=105,
    )
    assert restore_receipt.status == "succeeded"
    assert (root / "restored.txt").read_bytes() == b"recoverable"
    assert not tombstone.exists()
    assert service.tombstones.get_by_deletion_execution("delete-execution").state == "restored"

    delete_again_payload = service.delete_payload("restored.txt")
    delete_again = mutation_proposal("run-mutations", "file.delete", delete_again_payload, "filesystem.delete")
    delete_again_grant = grants.issue(delete_again, active, now=106, ttl_seconds=60)
    service.delete(
        grant_id=delete_again_grant.grant_id, proposal=delete_again, profile=active,
        relative_path="restored.txt", execution_id="delete-for-purge", now=107,
    )
    purge_payload = service.purge_payload("delete-for-purge")
    purge_action = mutation_proposal(
        "run-mutations", "file.purge", purge_payload, "filesystem.purge",
        risk="irreversible", effect_categories=("irreversible_external_write",),
    )
    purge_grant = grants.issue(purge_action, active, now=108, ttl_seconds=60)
    purge_receipt = service.purge(
        grant_id=purge_grant.grant_id, proposal=purge_action, profile=active,
        deletion_execution_id="delete-for-purge", execution_id="purge-execution", now=109,
    )
    assert purge_receipt.status == "succeeded"
    assert service.tombstones.get_by_deletion_execution("delete-for-purge").state == "purged"
    mutation_events = [
        event for event in service.audit.list()
        if event.event_type == "filesystem.mutation_succeeded"
    ]
    assert [event.payload["operation"] for event in mutation_events] == [
        "file.rename", "file.delete", "file.restore", "file.delete", "file.purge",
    ]
    service.audit.verify()


@pytest.mark.parametrize(
    "actual_source,actual_destination",
    [("other.txt", "destination.txt"), ("source.txt", "different.txt")],
)
def test_rename_source_or_destination_substitution_does_not_consume_grant(
    tmp_path: Path, actual_source: str, actual_destination: str,
) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    approved = AuthorizedFilesystemExecutionService.rename_payload("source.txt", "destination.txt")
    action = mutation_proposal("run-rename", "file.rename", approved, "filesystem.rename")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    with pytest.raises(Exception) as rejected:
        service.rename(
            grant_id=grant.grant_id, proposal=action, profile=active,
            source_relative=actual_source, destination_relative=actual_destination, now=101,
        )
    assert getattr(rejected.value, "code", "") == "proposal_payload_mismatch"
    assert filesystem.renames == [] and grants.get(grant.grant_id).consumed_at is None


@pytest.mark.parametrize("operation", ["rename", "delete"])
def test_mutation_error_is_outcome_unknown_and_not_replayable(tmp_path: Path, operation: str) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root, fail_after_write=True)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    if operation == "rename":
        payload = service.rename_payload("source.txt", "destination.txt")
        action = mutation_proposal("run-unknown-mutation", "file.rename", payload, "filesystem.rename")
    else:
        payload = service.delete_payload("source.txt")
        action = mutation_proposal("run-unknown-mutation", "file.delete", payload, "filesystem.delete")
    grant = grants.issue(action, active, now=100, ttl_seconds=60)
    with pytest.raises(OSError):
        if operation == "rename":
            service.rename(
                grant_id=grant.grant_id, proposal=action, profile=active,
                source_relative="source.txt", destination_relative="destination.txt",
                execution_id="mutation-unknown", now=101,
            )
        else:
            service.delete(
                grant_id=grant.grant_id, proposal=action, profile=active,
                relative_path="source.txt", execution_id="mutation-unknown", now=101,
            )
    assert service.effects.get("mutation-unknown").status == "outcome_unknown"
    assert grants.get(grant.grant_id).consumed_at == 101


def test_purge_requires_irreversible_human_review_declaration_before_claim(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    delete_action = mutation_proposal(
        "run-purge", "file.delete", service.delete_payload("file.txt"), "filesystem.delete",
    )
    delete_grant = grants.issue(delete_action, active, now=100, ttl_seconds=60)
    service.delete(
        grant_id=delete_grant.grant_id, proposal=delete_action, profile=active,
        relative_path="file.txt", execution_id="delete-before-purge", now=101,
    )
    unsafe_purge = mutation_proposal(
        "run-purge", "file.purge", service.purge_payload("delete-before-purge"), "filesystem.purge",
    )
    purge_grant = grants.issue(unsafe_purge, active, now=102, ttl_seconds=60)
    with pytest.raises(SandboxError) as rejected:
        service.purge(
            grant_id=purge_grant.grant_id, proposal=unsafe_purge, profile=active,
            deletion_execution_id="delete-before-purge", now=103,
        )
    assert rejected.value.code == "filesystem_purge_human_review_missing"
    assert grants.get(purge_grant.grant_id).consumed_at is None
    assert filesystem.purges == []

    declared_only = mutation_proposal(
        "run-purge", "file.purge", service.purge_payload("delete-before-purge"), "filesystem.purge",
        risk="irreversible", effect_categories=("irreversible_external_write",),
    )
    declared_grant = grants.issue(declared_only, active, now=104, ttl_seconds=60)
    with pytest.raises(SandboxError) as no_human:
        service.purge(
            grant_id=declared_grant.grant_id, proposal=declared_only, profile=active,
            deletion_execution_id="delete-before-purge", now=105,
        )
    assert no_human.value.code == "filesystem_purge_human_grant_required"
    assert grants.get(declared_grant.grant_id).consumed_at is None


def test_restore_is_run_bound_and_only_one_concurrent_claim_wins(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    delete_action = mutation_proposal(
        "run-restore", "file.delete", service.delete_payload("file.txt"), "filesystem.delete",
    )
    delete_grant = grants.issue(delete_action, active, now=100, ttl_seconds=60)
    service.delete(
        grant_id=delete_grant.grant_id, proposal=delete_action, profile=active,
        relative_path="file.txt", execution_id="delete-before-restore", now=101,
    )
    restore_payload = service.restore_payload("delete-before-restore", "restored.txt")
    restore_action = mutation_proposal("run-restore", "file.restore", restore_payload, "filesystem.restore")
    restore_grant = grants.issue(restore_action, active, now=102, ttl_seconds=60)

    def attempt(index: int) -> str:
        try:
            service.restore(
                grant_id=restore_grant.grant_id, proposal=restore_action, profile=active,
                deletion_execution_id="delete-before-restore", destination_relative="restored.txt",
                execution_id=f"restore-{index}", now=103,
            )
            return "succeeded"
        except Exception:
            return "denied"

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(attempt, range(16)))
    assert outcomes.count("succeeded") == 1
    assert len(filesystem.restores) == 1


def test_reconciliation_uses_observed_tombstone_and_never_replays_side_effect(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    filesystem = FakeFilesystem(root, fail_after_write=True)
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    active = profile(root)
    service = AuthorizedFilesystemExecutionService(filesystem, grants)
    delete_action = mutation_proposal(
        "run-reconcile", "file.delete", service.delete_payload("file.txt"), "filesystem.delete",
    )
    delete_grant = grants.issue(delete_action, active, now=100, ttl_seconds=60)
    with pytest.raises(OSError):
        service.delete(
            grant_id=delete_grant.grant_id, proposal=delete_action, profile=active,
            relative_path="file.txt", execution_id="delete-reconcile", now=101,
        )
    record = service.tombstones.get_by_deletion_execution("delete-reconcile")
    assert record.state == "delete_unknown"
    writes_before = list(filesystem.tombstones)
    assert service.reconcile_tombstone("delete-reconcile").state == "moved"
    assert filesystem.tombstones == writes_before
