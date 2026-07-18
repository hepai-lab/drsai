from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
import time
from pathlib import Path

import pytest


MODULE = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "runtime_security.py"
SPEC = importlib.util.spec_from_file_location("runtime_security_test_module", MODULE)
assert SPEC and SPEC.loader
security = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = security
SPEC.loader.exec_module(security)


def principal(name: str = "owner"):
    return security.RuntimePrincipal(name, "org-1", f"session-{name}", int(time.time()) + 600)


def context(name: str = "owner", workspace: str = "workspace-1"):
    return security.OperationContext(name, "runtime-1", workspace, "session-1", "run-1", "tool-1", "correlation-1")


def system(tmp_path: Path):
    permissions = security.WorkspacePermissionStore(tmp_path / "permissions.sqlite3")
    approvals = security.ApprovalRegistry(tmp_path / "approvals.sqlite3")
    audit = security.AuditLog(tmp_path / "audit.sqlite3")
    return security.RuntimeSecurity(permissions, approvals, audit), permissions, approvals, audit


def test_owner_editor_viewer_denied_matrix(tmp_path: Path) -> None:
    runtime, permissions, _, _ = system(tmp_path)
    expected = {
        "owner": {"workspace.read", "file.write", "git.write", "git.push", "worktree.write", "pty.execute", "shell.execute", "run.execute", "workspace.restore", "permission.manage"},
        "editor": {"workspace.read", "file.write", "git.write", "git.push", "worktree.write", "pty.execute", "shell.execute", "run.execute", "workspace.restore"},
        "viewer": {"workspace.read"},
        "denied": set(),
    }
    for role, allowed in expected.items():
        permissions.set_role("workspace-1", role, role)
        for action in set().union(*expected.values()):
            assert permissions.allowed("workspace-1", role, action) == (action in allowed)


def test_permission_is_checked_before_approval(tmp_path: Path) -> None:
    runtime, permissions, approvals, audit = system(tmp_path)
    permissions.set_role("workspace-1", "viewer", "viewer")
    with pytest.raises(security.SecurityError) as caught:
        runtime.authorize(principal("viewer"), "file.write", context("viewer"), {"path": "file.txt"})
    assert caught.value.code == "permission_denied"
    assert approvals.request_count == 0
    assert [row["event"] for row in audit.list()] == ["permission.denied"]


@pytest.mark.parametrize("action", ["shell.execute", "file.write", "git.push", "worktree.write", "workspace.restore", "pty.execute"])
def test_sensitive_operations_require_scoped_one_time_approval(tmp_path: Path, action: str) -> None:
    runtime, permissions, approvals, audit = system(tmp_path)
    permissions.set_role("workspace-1", "owner", "owner")
    resource = {"path": "safe.txt", "command_hash": "abc"}
    with pytest.raises(security.ApprovalRequired) as requested:
        runtime.authorize(principal(), action, context(), resource)
    approvals.decide(requested.value.approval_id, "approved")
    runtime.authorize(principal(), action, context(), resource, requested.value.approval_id)
    with pytest.raises(security.SecurityError) as reused:
        runtime.authorize(principal(), action, context(), resource, requested.value.approval_id)
    assert reused.value.code == "approval_not_approved"
    assert "approval.consumed" in [row["event"] for row in audit.list()]


def test_complete_audit_chain_is_append_only_and_redacted(tmp_path: Path) -> None:
    runtime, permissions, approvals, audit = system(tmp_path)
    permissions.set_role("workspace-1", "owner", "owner")
    resource = {
        "authorization": "Bearer super-secret-token",
        "nested": {"password": "password-canary", "output": "Bearer raw-secret-value"},
        "private": "-----BEGIN PRIVATE KEY-----\nprivate-canary\n-----END PRIVATE KEY-----",
    }
    with pytest.raises(security.ApprovalRequired) as requested:
        runtime.authorize(principal(), "file.write", context(), resource)
    approvals.decide(requested.value.approval_id, "approved")
    runtime.authorize(principal(), "file.write", context(), resource, requested.value.approval_id)
    serialized = str(audit.list())
    for required in ("principal_id", "runtime_id", "workspace_id", "session_id", "run_id", "tool_id", "correlation_id"):
        assert required in serialized
    for forbidden in ("super-secret-token", "password-canary", "raw-secret-value", "private-canary"):
        assert forbidden not in serialized
    with sqlite3.connect(audit.database) as db, pytest.raises(sqlite3.IntegrityError):
        db.execute("DELETE FROM runtime_audit")


def test_audit_payloads_are_bounded_and_resource_correlation_is_complete(tmp_path: Path) -> None:
    _, _, _, audit = system(tmp_path)
    correlated = security.OperationContext(
        "owner", "runtime-1", "workspace-1", "session-1", "run-1", "tool-1", "correlation-1",
        host_id="host-1", worktree_id="worktree-1", terminal_id="terminal-1", operation_id="operation-1",
    )
    row = audit.record("bounded", correlated, {
        "terminal_tail": "token=canary " + "x" * 10_000,
        "snapshot": list(range(200)),
    })
    serialized = str(row)
    assert "canary" not in serialized
    assert "TRUNCATED" in serialized
    for identity in ("host-1", "runtime-1", "workspace-1", "worktree-1", "terminal-1", "session-1", "run-1", "operation-1", "correlation-1"):
        assert identity in serialized


@pytest.mark.skipif(os.name == "nt", reason="openat/O_NOFOLLOW acceptance runs in Linux Docker")
def test_secure_workspace_fs_rejects_traversal_symlinks_and_swap_race(tmp_path: Path) -> None:
    root, outside = tmp_path / "workspace", tmp_path / "outside"
    root.mkdir(); outside.mkdir()
    (root / "safe").mkdir(); (root / "safe" / "file.txt").write_text("inside")
    (outside / "file.txt").write_text("outside")
    (root / "link").symlink_to(outside, target_is_directory=True)
    filesystem = security.SecureWorkspaceFS(root)
    assert filesystem.read_bytes("safe/file.txt") == b"inside"
    for path in ("../outside/file.txt", str(outside / "file.txt"), "link/file.txt"):
        with pytest.raises(security.SecurityError):
            filesystem.read_bytes(path)

    original = root / "race"
    original.mkdir()
    moved = root / "race-original"
    def swap() -> None:
        original.rename(moved)
        original.symlink_to(outside, target_is_directory=True)
    filesystem.atomic_write("race/target.txt", b"secure", before_replace=swap)
    assert (moved / "target.txt").read_bytes() == b"secure"
    assert not (outside / "target.txt").exists()
