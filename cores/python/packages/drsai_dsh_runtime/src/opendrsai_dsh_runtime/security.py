"""Workspace and carrier security contracts for production Runtime extensions."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Any, Mapping


class WorkspaceBoundaryError(ValueError):
    pass


@dataclass(frozen=True)
class WorkspaceBoundary:
    """Resolve client-controlled resource paths without granting ambient host paths."""

    root: Path

    def __post_init__(self) -> None:
        resolved = self.root.expanduser().resolve(strict=True)
        if not resolved.is_dir():
            raise WorkspaceBoundaryError("Workspace root must be an existing directory")
        object.__setattr__(self, "root", resolved)

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(os.path.normcase(str(self.root)).encode("utf-8")).hexdigest()

    def resolve(self, value: str, *, must_exist: bool = False) -> Path:
        if not value or "\0" in value:
            raise WorkspaceBoundaryError("Workspace path is invalid")
        supplied = Path(value)
        if supplied.is_absolute() or supplied.drive or PurePath(value).anchor:
            raise WorkspaceBoundaryError("Absolute workspace paths are not accepted")
        candidate = (self.root / supplied).resolve(strict=must_exist)
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise WorkspaceBoundaryError("Workspace path escapes its fixed root") from exc
        return candidate

    def resource_id(self, value: str, *, must_exist: bool = False) -> str:
        return self.resolve(value, must_exist=must_exist).relative_to(self.root).as_posix() or "."


@dataclass(frozen=True)
class SandboxAttestation:
    """Fail-closed statement produced by a signed carrier sandbox extension."""

    workspace_fingerprint: str
    carrier_sha256: str
    enforcement: str
    generation: int

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "SandboxAttestation":
        if set(value) != {"workspace_fingerprint", "carrier_sha256", "enforcement", "generation"}:
            raise WorkspaceBoundaryError("Sandbox attestation fields are invalid")
        result = cls(
            str(value["workspace_fingerprint"]), str(value["carrier_sha256"]),
            str(value["enforcement"]), int(value["generation"]),
        )
        if (
            len(result.workspace_fingerprint) != 64 or len(result.carrier_sha256) != 64
            or result.enforcement not in {"linux-userns-seccomp", "macos-sandbox", "windows-appcontainer"}
            or result.generation < 1
        ):
            raise WorkspaceBoundaryError("Sandbox attestation is not production-grade")
        return result

    def verify(self, *, boundary: WorkspaceBoundary, carrier: Path, generation: int) -> None:
        if self.workspace_fingerprint != boundary.fingerprint or self.generation != generation:
            raise WorkspaceBoundaryError("Sandbox attestation binding does not match this Runtime")
        digest = hashlib.sha256(carrier.resolve(strict=True).read_bytes()).hexdigest()
        if digest != self.carrier_sha256:
            raise WorkspaceBoundaryError("Sandbox attestation carrier digest changed")

