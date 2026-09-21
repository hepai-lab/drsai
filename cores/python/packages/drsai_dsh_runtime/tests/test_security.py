from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.security import SandboxAttestation, WorkspaceBoundary, WorkspaceBoundaryError


def test_workspace_boundary_rejects_absolute_traversal_and_normalizes_resources(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    nested = root / "docs"
    nested.mkdir()
    (nested / "plan.md").write_text("safe", encoding="utf-8")
    boundary = WorkspaceBoundary(root)
    assert boundary.resource_id("docs/plan.md", must_exist=True) == "docs/plan.md"
    assert len(boundary.fingerprint) == 64
    with pytest.raises(WorkspaceBoundaryError, match="Absolute"):
        boundary.resolve(str((tmp_path / "outside.txt").resolve()))
    with pytest.raises(WorkspaceBoundaryError, match="escapes"):
        boundary.resolve("../outside.txt")


def test_workspace_boundary_resolves_symlinks_before_authorization(tmp_path: Path) -> None:
    root, outside = tmp_path / "workspace", tmp_path / "outside"
    root.mkdir(); outside.mkdir()
    link = root / "escape"
    try:
        os.symlink(outside, link, target_is_directory=True)
    except OSError:
        pytest.skip("Host does not permit an unprivileged directory symlink")
    with pytest.raises(WorkspaceBoundaryError, match="escapes"):
        WorkspaceBoundary(root).resolve("escape/secret.txt")


def test_signed_carrier_sandbox_attestation_is_bound_to_workspace_digest_and_generation(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"; workspace.mkdir()
    carrier = tmp_path / "carrier"; carrier.write_bytes(b"signed carrier fixture")
    boundary = WorkspaceBoundary(workspace)
    attestation = SandboxAttestation.from_mapping({
        "workspace_fingerprint": boundary.fingerprint,
        "carrier_sha256": hashlib.sha256(carrier.read_bytes()).hexdigest(),
        "enforcement": "windows-appcontainer" if os.name == "nt" else "linux-userns-seccomp",
        "generation": 3,
    })
    attestation.verify(boundary=boundary, carrier=carrier, generation=3)
    carrier.write_bytes(b"tampered")
    with pytest.raises(WorkspaceBoundaryError, match="digest"):
        attestation.verify(boundary=boundary, carrier=carrier, generation=3)

