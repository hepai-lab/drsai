from __future__ import annotations

import base64
from pathlib import Path

import pytest

from drsai.backend.runtime.resource_host import TenantFilesystemResourceHost, TenantResourceContext
from drsai.owop.protocol import OWOPError


def _context(tenant: str, principal: str, workspace: str = "workspace") -> TenantResourceContext:
    return TenantResourceContext(tenant, principal, workspace, "session")


def _all_permissions(*_permission: str) -> bool:
    return True


def test_docmaster_resource_ids_are_durable_and_tenant_workspace_scoped(tmp_path: Path) -> None:
    roots = {
        ("tenant-a", "workspace"): tmp_path / "tenant-a",
        ("tenant-b", "workspace"): tmp_path / "tenant-b",
        ("tenant-a", "other"): tmp_path / "tenant-a-other",
    }
    for (tenant, workspace), root in roots.items():
        root.mkdir()
        (root / "report.txt").write_text(f"{tenant}:{workspace}", encoding="utf-8")
    arguments = (tmp_path / "state", lambda tenant, workspace: roots[(tenant, workspace)], _all_permissions)
    host = TenantFilesystemResourceHost(*arguments)
    context = _context("tenant-a", "alice")
    registered = host.register(context, {"path": "report.txt"})["resource"]

    restarted = TenantFilesystemResourceHost(*arguments)
    resolved = restarted.resolve(context, registered["file_id"])["resource"]
    content = restarted.read(context, registered["file_id"], 0, 100)

    assert resolved["file_id"] == registered["file_id"]
    assert base64.b64decode(content["content_base64"]) == b"tenant-a:workspace"
    assert str(roots[("tenant-a", "workspace")]) not in repr(resolved)
    with pytest.raises(OWOPError) as wrong_tenant:
        restarted.resolve(_context("tenant-b", "bob"), registered["file_id"])
    assert wrong_tenant.value.code == "resource_not_found"
    with pytest.raises(OWOPError) as wrong_workspace:
        restarted.resolve(_context("tenant-a", "alice", "other"), registered["file_id"])
    assert wrong_workspace.value.code == "resource_not_found"


def test_docmaster_resource_host_reauthorizes_every_access_and_filters_capabilities(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "report.txt").write_text("tenant content", encoding="utf-8")
    grants = {
        ("tenant", "editor", "workspace", "resource.register"),
        ("tenant", "editor", "workspace", "resource.resolve"),
        ("tenant", "editor", "workspace", "resource.preview"),
        ("tenant", "viewer", "workspace", "resource.resolve"),
        ("tenant", "viewer", "workspace", "resource.read"),
    }
    host = TenantFilesystemResourceHost(
        tmp_path / "state",
        lambda _tenant, _workspace: root,
        lambda *permission: permission in grants,
    )
    editor = _context("tenant", "editor")
    registered = host.register(editor, {"path": "report.txt"})["resource"]
    viewer = host.resolve(_context("tenant", "viewer"), registered["file_id"])["resource"]

    assert viewer["capabilities"] == {
        "read": True, "preview": False, "download": False, "reveal": False, "open_external": False,
    }
    with pytest.raises(OWOPError) as editor_read:
        host.read(editor, registered["file_id"], 0, 100)
    assert editor_read.value.code == "resource_access_denied"
    with pytest.raises(OWOPError) as viewer_preview:
        host.read(_context("tenant", "viewer"), registered["file_id"], 0, 100, purpose="preview")
    assert viewer_preview.value.code == "resource_access_denied"


def test_docmaster_resource_status_and_digest_guard_survive_rename(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    source = root / "draft.txt"
    source.write_text("v1", encoding="utf-8")
    host = TenantFilesystemResourceHost(tmp_path / "state", lambda _tenant, _workspace: root, _all_permissions)
    context = _context("tenant", "alice")
    registered = host.register(context, {"path": "draft.txt"})["resource"]
    reference = host.resource_ref(context, registered, relation="output_artifact", presentation="card")

    source.write_text("v2", encoding="utf-8")
    changed = host.resolve(context, registered["file_id"])["resource"]
    assert changed["state"] == "changed"
    with pytest.raises(OWOPError) as guarded:
        host.read(context, registered["file_id"], 0, 100, expected_digest=registered["digest"])
    assert guarded.value.code == "resource_changed"

    moved_path = root / "final.txt"
    source.replace(moved_path)
    moved = host.resolve(context, registered["file_id"])["resource"]
    assert moved["state"] == "moved"
    assert moved["path"] == "final.txt"
    assert reference["workspace_id"] == "workspace"
    assert reference["resource_id"] == registered["file_id"]
    assert str(root) not in repr(reference)


def test_docmaster_resource_host_rejects_path_escape_and_invalid_ranges(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    host = TenantFilesystemResourceHost(tmp_path / "state", lambda _tenant, _workspace: root, _all_permissions)
    context = _context("tenant", "alice")

    with pytest.raises(OWOPError) as escaped:
        host.register(context, {"path": "../outside.txt"})
    assert escaped.value.code == "workspace_escape_rejected"
    (root / "file.txt").write_text("safe", encoding="utf-8")
    resource = host.register(context, {"path": "file.txt"})["resource"]
    with pytest.raises(OWOPError) as oversized:
        host.read(context, resource["file_id"], 0, 8 * 1024 * 1024 + 1)
    assert oversized.value.code == "resource_range_invalid"
