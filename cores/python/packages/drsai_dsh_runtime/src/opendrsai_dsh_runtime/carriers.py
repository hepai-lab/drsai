"""Signed side-by-side carrier installation, canary activation and rollback."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import re
import shutil
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .contracts import canonical_json_sha256


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RELEASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


class CarrierReleaseError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CarrierArtifact:
    path: str
    sha256: str
    size: int


@dataclass(frozen=True)
class CarrierReleaseManifest:
    release_id: str
    platform: str
    architecture: str
    profile_id: str
    artifact: CarrierArtifact
    key_id: str
    signature: bytes
    signed_payload: dict[str, Any]

    @classmethod
    def verify(
        cls,
        value: Mapping[str, Any],
        *,
        trusted_keys: Mapping[str, bytes],
    ) -> "CarrierReleaseManifest":
        expected = {"schema_version", "release_id", "platform", "architecture", "profile_id", "artifact", "signature"}
        if set(value) != expected or value.get("schema_version") != 1:
            raise CarrierReleaseError("carrier_manifest_invalid", "Carrier manifest schema is invalid")
        release_id = value.get("release_id")
        if not isinstance(release_id, str) or not _RELEASE_ID.fullmatch(release_id):
            raise CarrierReleaseError("carrier_release_id_invalid", "Carrier release id is invalid")
        strings = [value.get("platform"), value.get("architecture"), value.get("profile_id")]
        if not all(isinstance(item, str) and item and len(item) <= 160 for item in strings):
            raise CarrierReleaseError("carrier_manifest_invalid", "Carrier identity fields are invalid")
        raw_artifact = value.get("artifact")
        if not isinstance(raw_artifact, Mapping) or set(raw_artifact) != {"path", "sha256", "size"}:
            raise CarrierReleaseError("carrier_artifact_invalid", "Carrier artifact is invalid")
        path = raw_artifact.get("path")
        digest = raw_artifact.get("sha256")
        size = raw_artifact.get("size")
        if not isinstance(path, str) or not _safe_relative(path):
            raise CarrierReleaseError("carrier_artifact_path_invalid", "Carrier artifact path is unsafe")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise CarrierReleaseError("carrier_artifact_digest_invalid", "Carrier artifact digest is invalid")
        if not isinstance(size, int) or isinstance(size, bool) or size < 1 or size > 2 * 1024 * 1024 * 1024:
            raise CarrierReleaseError("carrier_artifact_size_invalid", "Carrier artifact size is invalid")
        signature = value.get("signature")
        if not isinstance(signature, Mapping) or set(signature) != {"algorithm", "key_id", "value"}:
            raise CarrierReleaseError("carrier_signature_invalid", "Carrier signature is invalid")
        if signature.get("algorithm") != "ed25519" or not isinstance(signature.get("key_id"), str):
            raise CarrierReleaseError("carrier_signature_invalid", "Carrier signature algorithm is unsupported")
        key_id = signature["key_id"]
        public_key = trusted_keys.get(key_id)
        if public_key is None:
            raise CarrierReleaseError("carrier_signing_key_untrusted", "Carrier signing key is not trusted")
        try:
            signature_bytes = base64.b64decode(signature.get("value"), validate=True)
            signed_payload = {name: value[name] for name in sorted(expected - {"signature"})}
            encoded = _canonical_bytes(signed_payload)
            Ed25519PublicKey.from_public_bytes(public_key).verify(signature_bytes, encoded)
        except (ValueError, TypeError, InvalidSignature) as exc:
            raise CarrierReleaseError("carrier_signature_invalid", "Carrier signature verification failed") from exc
        return cls(
            release_id=release_id,
            platform=str(value["platform"]),
            architecture=str(value["architecture"]),
            profile_id=str(value["profile_id"]),
            artifact=CarrierArtifact(path, digest, size),
            key_id=key_id,
            signature=signature_bytes,
            signed_payload=signed_payload,
        )


Canary = Callable[[Path, CarrierReleaseManifest], Awaitable[Mapping[str, Any]]]


class CarrierReleaseManager:
    def __init__(
        self,
        root: Path,
        *,
        trusted_keys: Mapping[str, bytes],
        platform_name: str | None = None,
        architecture: str | None = None,
    ):
        self.root = root.expanduser().resolve(strict=False)
        self.releases = self.root / "releases"
        self.trusted_keys = dict(trusted_keys)
        self.platform_name = (platform_name or platform.system()).lower()
        self.architecture = (architecture or platform.machine()).lower()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.releases.mkdir(parents=True, exist_ok=True, mode=0o700)

    def install(self, source_root: Path, raw_manifest: Mapping[str, Any]) -> dict[str, Any]:
        manifest = CarrierReleaseManifest.verify(raw_manifest, trusted_keys=self.trusted_keys)
        if manifest.platform.lower() != self.platform_name or manifest.architecture.lower() != self.architecture:
            raise CarrierReleaseError("carrier_platform_incompatible", "Carrier platform is incompatible")
        source_root = source_root.expanduser().resolve(strict=True)
        source = _contained(source_root, manifest.artifact.path)
        if not source.is_file() or source.stat().st_size != manifest.artifact.size:
            raise CarrierReleaseError("carrier_artifact_missing", "Carrier artifact is missing or has the wrong size")
        if _file_sha256(source) != manifest.artifact.sha256:
            raise CarrierReleaseError("carrier_artifact_digest_mismatch", "Carrier artifact digest does not match")
        release_root = self.releases / manifest.release_id
        target = _contained(release_root, manifest.artifact.path)
        if release_root.exists():
            if target.is_file() and target.stat().st_size == manifest.artifact.size and _file_sha256(target) == manifest.artifact.sha256:
                return self._release_record(manifest, target, "installed")
            raise CarrierReleaseError("carrier_release_conflict", "Installed release id has different content")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = target.with_name(f".{target.name}.tmp")
        try:
            shutil.copyfile(source, temporary)
            os.chmod(temporary, 0o700)
            if temporary.stat().st_size != manifest.artifact.size or _file_sha256(temporary) != manifest.artifact.sha256:
                raise CarrierReleaseError("carrier_copy_verification_failed", "Installed carrier verification failed")
            os.replace(temporary, target)
            _atomic_json(release_root / "release.json", self._release_record(manifest, target, "installed"))
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        return self._release_record(manifest, target, "installed")

    async def canary_and_activate(
        self,
        release_id: str,
        *,
        canary: Canary,
    ) -> dict[str, Any]:
        record = self._read_release(release_id)
        manifest = CarrierReleaseManifest.verify(record["manifest"], trusted_keys=self.trusted_keys)
        executable = Path(record["executable"])
        if not executable.is_file() or _file_sha256(executable) != manifest.artifact.sha256:
            raise CarrierReleaseError("carrier_installation_corrupt", "Installed carrier is corrupt")
        evidence = dict(await canary(executable, manifest))
        if evidence.get("accepted") is not True:
            raise CarrierReleaseError("carrier_canary_failed", "Carrier canary did not pass")
        active = self._read_active()
        previous = active.get("release_id") if active else None
        pointer = {
            "schema_version": 1,
            "release_id": release_id,
            "previous_release_id": previous if previous != release_id else active.get("previous_release_id"),
            "profile_id": manifest.profile_id,
            "canary_evidence_sha256": canonical_json_sha256(evidence),
        }
        _atomic_json(self.root / "active.json", pointer)
        return pointer

    def rollback(self) -> dict[str, Any]:
        active = self._read_active()
        previous = active.get("previous_release_id") if active else None
        if not isinstance(previous, str) or not previous:
            raise CarrierReleaseError("carrier_rollback_unavailable", "No previous carrier release is available")
        record = self._read_release(previous)
        manifest = CarrierReleaseManifest.verify(record["manifest"], trusted_keys=self.trusted_keys)
        pointer = {
            "schema_version": 1,
            "release_id": previous,
            "previous_release_id": active["release_id"],
            "profile_id": manifest.profile_id,
            "rollback_from": active["release_id"],
        }
        _atomic_json(self.root / "active.json", pointer)
        return pointer

    def resolve_active(self) -> dict[str, Any] | None:
        active = self._read_active()
        if not active:
            return None
        record = self._read_release(str(active["release_id"]))
        return {**record, "activation": active}

    def _read_active(self) -> dict[str, Any] | None:
        path = self.root / "active.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    def _read_release(self, release_id: str) -> dict[str, Any]:
        if not _RELEASE_ID.fullmatch(release_id):
            raise CarrierReleaseError("carrier_release_id_invalid", "Carrier release id is invalid")
        path = self.releases / release_id / "release.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CarrierReleaseError("carrier_release_not_found", "Carrier release is not installed") from exc
        if not isinstance(value, dict) or value.get("release_id") != release_id:
            raise CarrierReleaseError("carrier_release_corrupt", "Carrier release metadata is corrupt")
        return value

    @staticmethod
    def _release_record(manifest: CarrierReleaseManifest, target: Path, state: str) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "release_id": manifest.release_id,
            "profile_id": manifest.profile_id,
            "state": state,
            "executable": str(target),
            "artifact_sha256": manifest.artifact.sha256,
            "manifest": {**manifest.signed_payload, "signature": {
                "algorithm": "ed25519", "key_id": manifest.key_id,
                "value": base64.b64encode(manifest.signature).decode("ascii"),
            }},
        }


def _canonical_bytes(value: Mapping[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _safe_relative(value: str) -> bool:
    path = PurePosixPath(value)
    return not path.is_absolute() and bool(path.parts) and all(part not in {"", ".", ".."} for part in path.parts)


def _contained(root: Path, relative_path: str) -> Path:
    root = root.resolve(strict=False)
    target = root.joinpath(*PurePosixPath(relative_path).parts).resolve(strict=False)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise CarrierReleaseError("carrier_artifact_path_invalid", "Carrier artifact escapes its release root") from exc
    return target


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
