"""Release identity gate for the packaged isolated-effect worker."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from .models import canonical_digest


class IsolatedWorkerArtifactError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AuthenticodeEvidence:
    status: str
    subject: str
    thumbprint: str


@dataclass(frozen=True)
class IsolatedWorkerArtifact:
    manifest_path: Path
    executable_path: Path
    manifest_digest: str
    executable_digest: str
    worker_version: str
    publisher_subject: str
    signer_thumbprint: str


def windows_authenticode_evidence(path: Path) -> AuthenticodeEvidence:
    if os.name != "nt":
        raise IsolatedWorkerArtifactError(
            "isolated_worker_signature_unsupported", "Authenticode verification requires Windows.",
        )
    environment = dict(os.environ)
    environment["OPENDRSAI_ISOLATED_WORKER_SIGNATURE_TARGET"] = str(path)
    script = (
        "$s=Get-AuthenticodeSignature -LiteralPath $env:OPENDRSAI_ISOLATED_WORKER_SIGNATURE_TARGET;"
        "$o=[pscustomobject]@{status=[string]$s.Status;"
        "subject=if($s.SignerCertificate){[string]$s.SignerCertificate.Subject}else{''};"
        "thumbprint=if($s.SignerCertificate){[string]$s.SignerCertificate.Thumbprint}else{''}};"
        "$o|ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, timeout=10, check=False, env=environment,
            creationflags=0x08000000,
        )
        value = json.loads(completed.stdout) if completed.returncode == 0 else {}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise IsolatedWorkerArtifactError(
            "isolated_worker_signature_unreadable", "Worker signature evidence is unavailable.",
        ) from error
    return AuthenticodeEvidence(
        str(value.get("status", "")), str(value.get("subject", "")),
        str(value.get("thumbprint", "")),
    )


class IsolatedWorkerArtifactResolver:
    SCHEMA_VERSION = "isolated-effect-worker-manifest/1"
    PROTOCOL_VERSION = "isolated-effect/1"
    RECEIPT_VERSION = "isolated-effect-receipt/1"

    def __init__(
        self,
        *,
        expected_manifest_digest: str,
        trusted_publisher_subjects: Sequence[str],
        signature_verifier: Callable[[Path], AuthenticodeEvidence] = windows_authenticode_evidence,
    ):
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", expected_manifest_digest):
            raise ValueError("A pinned manifest SHA-256 is required.")
        if not trusted_publisher_subjects or any(not value.strip() for value in trusted_publisher_subjects):
            raise ValueError("At least one exact trusted publisher subject is required.")
        self.expected_manifest_digest = expected_manifest_digest
        self.trusted_publisher_subjects = frozenset(
            value.strip().casefold() for value in trusted_publisher_subjects
        )
        self.signature_verifier = signature_verifier

    def resolve(self, manifest_path: Path) -> IsolatedWorkerArtifact:
        try:
            manifest_path = Path(manifest_path).resolve(strict=True)
        except OSError as error:
            raise IsolatedWorkerArtifactError(
                "isolated_worker_manifest_missing", "Worker manifest does not exist.",
            ) from error
        try:
            parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise IsolatedWorkerArtifactError(
                "isolated_worker_manifest_unreadable", "Worker manifest is unavailable or invalid.",
            ) from error
        if not isinstance(parsed, Mapping):
            raise IsolatedWorkerArtifactError("isolated_worker_manifest_invalid", "Worker manifest must be an object.")
        manifest = dict(parsed)
        digest = canonical_digest(manifest)
        if digest != self.expected_manifest_digest:
            raise IsolatedWorkerArtifactError(
                "isolated_worker_manifest_digest_mismatch", "Worker manifest differs from the Runtime pin.",
            )
        required = {
            "schema_version": self.SCHEMA_VERSION,
            "protocol_version": self.PROTOCOL_VERSION,
            "receipt_version": self.RECEIPT_VERSION,
            "platform": "windows-x64",
        }
        if any(manifest.get(key) != value for key, value in required.items()):
            raise IsolatedWorkerArtifactError(
                "isolated_worker_manifest_contract_mismatch", "Worker manifest protocol is incompatible.",
            )
        version, executable, expected_hash = (
            manifest.get("worker_version"), manifest.get("executable"), manifest.get("sha256"),
        )
        if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
            raise IsolatedWorkerArtifactError("isolated_worker_version_invalid", "Worker version is invalid.")
        if not isinstance(executable, str) or Path(executable).name != executable or not executable.casefold().endswith(".exe"):
            raise IsolatedWorkerArtifactError(
                "isolated_worker_executable_path_invalid", "Worker executable must be a local manifest sibling.",
            )
        if not isinstance(expected_hash, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", expected_hash):
            raise IsolatedWorkerArtifactError("isolated_worker_digest_invalid", "Worker digest is invalid.")
        worker = (manifest_path.parent / executable).resolve(strict=True)
        try:
            if os.path.commonpath((str(manifest_path.parent), str(worker))) != str(manifest_path.parent):
                raise ValueError
        except ValueError as error:
            raise IsolatedWorkerArtifactError(
                "isolated_worker_executable_escape", "Worker executable escapes its artifact directory.",
            ) from error
        actual_hash = "sha256:" + hashlib.sha256(worker.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise IsolatedWorkerArtifactError(
                "isolated_worker_binary_digest_mismatch", "Worker binary differs from its pinned manifest.",
            )
        evidence = self.signature_verifier(worker)
        if (
            evidence.status != "Valid" or not evidence.thumbprint
            or evidence.subject.strip().casefold() not in self.trusted_publisher_subjects
        ):
            raise IsolatedWorkerArtifactError(
                "isolated_worker_signature_invalid", "Worker Authenticode publisher is not trusted.",
            )
        return IsolatedWorkerArtifact(
            manifest_path, worker, digest, actual_hash, version,
            evidence.subject, evidence.thumbprint,
        )
