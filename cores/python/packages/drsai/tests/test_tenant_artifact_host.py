from __future__ import annotations

import base64
from pathlib import Path

import pytest

from drsai.backend.runtime.artifact_host import TenantArtifactContext, TenantFilesystemArtifactHost
from drsai.backend.runtime.artifacts import RuntimeArtifactError


def _context(tenant: str, principal: str, workspace: str = "workspace") -> TenantArtifactContext:
    return TenantArtifactContext(tenant, principal, workspace, "session", "run")


def test_docmaster_style_tenants_with_same_names_are_isolated(tmp_path: Path) -> None:
    roots = {
        ("tenant-a", "workspace"): tmp_path / "tenant-a-workspace",
        ("tenant-b", "workspace"): tmp_path / "tenant-b-workspace",
    }
    for (tenant, _workspace), root in roots.items():
        root.mkdir()
        (root / "poem.docx").write_bytes(tenant.encode("utf-8"))
    grants = {
        ("tenant-a", "alice", "workspace", "artifact.write"),
        ("tenant-a", "alice", "workspace", "artifact.read"),
        ("tenant-b", "bob", "workspace", "artifact.write"),
        ("tenant-b", "bob", "workspace", "artifact.read"),
    }
    host = TenantFilesystemArtifactHost(
        tmp_path / "host-state", lambda tenant, workspace: roots[(tenant, workspace)], lambda *permission: permission in grants,
    )

    artifact_a = host.deliver(_context("tenant-a", "alice"), {
        "source_path": "poem.docx", "destination_name": "短诗.docx", "idempotency_key": "create-poem",
    })
    artifact_b = host.deliver(_context("tenant-b", "bob"), {
        "source_path": "poem.docx", "destination_name": "短诗.docx", "idempotency_key": "create-poem",
    })

    assert artifact_a["relative_path"] == artifact_b["relative_path"] == "artifacts/短诗.docx"
    assert artifact_a["artifact_id"] != artifact_b["artifact_id"]
    content_a = host.chunk(_context("tenant-a", "alice"), artifact_a["artifact_id"], 0, 100)
    content_b = host.chunk(_context("tenant-b", "bob"), artifact_b["artifact_id"], 0, 100)
    assert base64.b64decode(content_a["content_base64"]) == b"tenant-a"
    assert base64.b64decode(content_b["content_base64"]) == b"tenant-b"


def test_tenant_host_reauthorizes_and_rejects_cross_tenant_artifact_id(tmp_path: Path) -> None:
    roots = {
        ("tenant-a", "workspace"): tmp_path / "a",
        ("tenant-b", "workspace"): tmp_path / "b",
    }
    for root in roots.values():
        root.mkdir()
        (root / "result.txt").write_text(root.name, encoding="utf-8")
    grants = {
        ("tenant-a", "alice", "workspace", "artifact.write"),
        ("tenant-a", "alice", "workspace", "artifact.read"),
        ("tenant-b", "bob", "workspace", "artifact.read"),
    }
    host = TenantFilesystemArtifactHost(
        tmp_path / "state", lambda tenant, workspace: roots[(tenant, workspace)], lambda *permission: permission in grants,
    )
    artifact = host.deliver(_context("tenant-a", "alice"), {"source_path": "result.txt"})

    with pytest.raises(RuntimeArtifactError) as wrong_principal:
        host.metadata(_context("tenant-a", "mallory"), artifact["artifact_id"])
    assert wrong_principal.value.code == "artifact_access_denied"

    with pytest.raises(RuntimeArtifactError) as wrong_tenant:
        host.metadata(_context("tenant-b", "bob"), artifact["artifact_id"])
    assert wrong_tenant.value.code == "artifact_not_found"


def test_tenant_host_supports_admission_mime_and_content_scan_policy(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "report.docx").write_bytes(b"office-package")
    admitted: list[str] = []
    scanned: list[str] = []
    host = TenantFilesystemArtifactHost(
        tmp_path / "state",
        lambda _tenant, _workspace: root,
        lambda *_permission: True,
        admit=lambda context, action, _arguments: admitted.append(f"{context.tenant_id}:{action}") is None,
        scan=lambda _context, path, _mime: scanned.append(path.name) is None,
    )
    context = _context("tenant-a", "alice")

    with pytest.raises(RuntimeArtifactError) as mismatch:
        host.deliver(context, {
            "source_path": "report.docx", "mime_type": "text/plain",
        })
    assert mismatch.value.code == "artifact_source_invalid"

    delivered = host.deliver(context, {
        "source_path": "report.docx",
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })
    assert delivered["relative_path"] == "artifacts/report.docx"
    assert admitted == ["tenant-a:artifact.write", "tenant-a:artifact.write"]
    assert scanned == ["report.docx"]


def test_tenant_host_metadata_survives_adapter_restart(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "result.txt").write_text("durable", encoding="utf-8")
    arguments = (tmp_path / "state", lambda _tenant, _workspace: root, lambda *_permission: True)
    context = _context("tenant-a", "alice")
    artifact = TenantFilesystemArtifactHost(*arguments).deliver(context, {"source_path": "result.txt"})

    restarted = TenantFilesystemArtifactHost(*arguments)
    metadata = restarted.metadata(context, artifact["artifact_id"])
    content = restarted.chunk(context, artifact["artifact_id"], 0, 100)

    assert metadata["sha256"] == artifact["sha256"]
    assert base64.b64decode(content["content_base64"]) == b"durable"


def test_tenant_host_enforces_total_capacity_and_delivery_rate(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "one.txt").write_bytes(b"123")
    (root / "two.txt").write_bytes(b"456")
    context = _context("tenant-a", "alice")
    capacity_host = TenantFilesystemArtifactHost(
        tmp_path / "capacity-state", lambda _tenant, _workspace: root,
        lambda *_permission: True, max_tenant_bytes=5,
    )
    capacity_host.deliver(context, {"source_path": "one.txt"})
    with pytest.raises(RuntimeArtifactError) as capacity:
        capacity_host.deliver(TenantArtifactContext("tenant-a", "alice", "workspace", "session", "run-b"), {"source_path": "two.txt"})
    assert capacity.value.code == "artifact_quota_exceeded"

    rate_host = TenantFilesystemArtifactHost(
        tmp_path / "rate-state", lambda _tenant, _workspace: root,
        lambda *_permission: True, max_deliveries_per_minute=1,
    )
    first = rate_host.deliver(context, {"source_path": "one.txt", "idempotency_key": "request-one"})
    replay = rate_host.deliver(context, {"source_path": "one.txt", "idempotency_key": "request-one"})
    assert replay["artifact_id"] == first["artifact_id"]
    assert replay["idempotent_replay"] is True
    with pytest.raises(RuntimeArtifactError) as rate:
        rate_host.deliver(context, {"source_path": "two.txt"})
    assert rate.value.code == "artifact_quota_exceeded"
