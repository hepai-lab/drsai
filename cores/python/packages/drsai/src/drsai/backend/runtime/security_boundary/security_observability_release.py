"""Offline release tooling for security-observability policy bundles.

This module deliberately has no Runtime bootstrap integration.  Release automation may
use it to create and verify install artifacts; a Desktop or Gateway process must not use
it to manufacture trust at startup.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from .approval_slo_policy import SignedApprovalSloPolicyLoader
from .models import canonical_digest
from .security_observability_deployment import (
    SignedSecurityObservabilityDeploymentLoader,
    VerifiedSecurityObservabilityDeployment,
)


class SecurityObservabilityReleaseError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SecurityObservabilityReleasePins:
    manifest_filename: str
    manifest_id: str
    minimum_manifest_version: int
    manifest_digest: str
    manifest_file_digest: str
    product: str
    channel: str
    runtime_build_digest: str
    release_key_id: str
    release_public_key_digest: str
    slo_policy_filename: str
    slo_policy_id: str
    slo_policy_minimum_version: int
    slo_policy_digest: str
    slo_policy_file_digest: str
    slo_policy_key_id: str
    slo_public_key_digest: str


@dataclass(frozen=True)
class VerifiedSecurityObservabilityRelease:
    deployment: VerifiedSecurityObservabilityDeployment
    pins: SecurityObservabilityReleasePins


class SecurityObservabilityReleaseTool:
    INPUT_SCHEMA = "security-observability-release-input/1"
    PINS_SCHEMA = "runtime-security-observability-release-pins/1"
    _INPUT_FIELDS = frozenset({
        "schema_version", "manifest_filename", "release_key_id", "slo_policy_filename",
        "slo_policy_key_id", "policy_payload", "deployment_payload",
    })
    _DEPLOYMENT_FIELDS = frozenset({
        "manifest_id", "version", "product", "channel", "runtime_build_digest", "enabled",
        "service_sid", "pipe_instance_id", "not_before", "expires_at",
    })
    _POLICY_FIELDS = SignedApprovalSloPolicyLoader._PAYLOAD_FIELDS
    _PINS_FIELDS = frozenset({
        "schema_version", "manifest_filename", "manifest_id", "minimum_manifest_version",
        "manifest_digest", "product", "channel", "runtime_build_digest", "release_key_id",
        "manifest_file_digest",
        "release_public_key_digest", "slo_policy_filename", "slo_policy_id",
        "slo_policy_minimum_version", "slo_policy_digest", "slo_policy_key_id",
        "slo_policy_file_digest",
        "slo_public_key_digest",
    })
    _DIGEST = re.compile(r"sha256:[a-f0-9]{64}")

    @staticmethod
    def canonical_bytes(value: Mapping[str, object]) -> bytes:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8")

    @staticmethod
    def _basename(value: object, label: str) -> str:
        if (
            not isinstance(value, str) or not value.endswith(".json")
            or Path(value).name != value or value in {".", ".."}
        ):
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", f"{label} must be a JSON basename.",
            )
        return value

    @staticmethod
    def _public_raw(key: Ed25519PrivateKey | Ed25519PublicKey) -> bytes:
        public = key.public_key() if isinstance(key, Ed25519PrivateKey) else key
        return public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    @classmethod
    def _key_digest(cls, key: Ed25519PrivateKey | Ed25519PublicKey) -> str:
        return canonical_digest({"ed25519_public_key": base64.b64encode(cls._public_raw(key)).decode("ascii")})

    @classmethod
    def _envelope(
        cls, payload: Mapping[str, object], key_id: str, private_key: Ed25519PrivateKey,
    ) -> dict[str, object]:
        return {
            "payload": dict(payload),
            "key_id": key_id,
            "signature": base64.b64encode(private_key.sign(cls.canonical_bytes(payload))).decode("ascii"),
        }

    @staticmethod
    def _write_new(path: Path, value: Mapping[str, object]) -> None:
        data = SecurityObservabilityReleaseTool.canonical_bytes(value) + b"\n"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError as error:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_output_exists",
                "Release output already exists; versioned artifacts are never overwritten.",
            ) from error
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    @classmethod
    def _serialized_digest(cls, value: Mapping[str, object]) -> str:
        return "sha256:" + hashlib.sha256(cls.canonical_bytes(value) + b"\n").hexdigest()

    @classmethod
    def build(
        cls,
        release_input: Mapping[str, object],
        output_root: Path,
        *,
        release_private_key: Ed25519PrivateKey,
        slo_private_key: Ed25519PrivateKey,
    ) -> SecurityObservabilityReleasePins:
        if set(release_input) != cls._INPUT_FIELDS or release_input.get("schema_version") != cls.INPUT_SCHEMA:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "Release input schema or fields are invalid.",
            )
        manifest_filename = cls._basename(release_input["manifest_filename"], "manifest_filename")
        policy_filename = cls._basename(release_input["slo_policy_filename"], "slo_policy_filename")
        if (
            manifest_filename == policy_filename
            or "security-observability-release-pins.json" in {manifest_filename, policy_filename}
        ):
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "Manifest and policy filenames must differ.",
            )
        release_key_id = release_input["release_key_id"]
        policy_key_id = release_input["slo_policy_key_id"]
        if (
            not isinstance(release_key_id, str) or not release_key_id
            or not isinstance(policy_key_id, str) or not policy_key_id
        ):
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "Both signing key IDs are required.",
            )
        policy = release_input["policy_payload"]
        deployment_source = release_input["deployment_payload"]
        if not isinstance(policy, dict) or set(policy) != cls._POLICY_FIELDS:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "SLO policy payload fields are invalid.",
            )
        if not isinstance(deployment_source, dict) or set(deployment_source) != cls._DEPLOYMENT_FIELDS:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "Deployment payload fields are invalid.",
            )
        if policy.get("schema_version") != SignedApprovalSloPolicyLoader.SCHEMA_VERSION:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "SLO policy schema is unsupported.",
            )
        policy_id = policy.get("policy_id")
        policy_version = policy.get("version")
        deployment_version = deployment_source.get("version")
        if (
            not isinstance(policy_id, str) or not policy_id
            or isinstance(policy_version, bool) or not isinstance(policy_version, int) or policy_version < 1
            or isinstance(deployment_version, bool) or not isinstance(deployment_version, int)
            or deployment_version < 1
        ):
            raise SecurityObservabilityReleaseError(
                "security_observability_release_input_invalid", "Policy and deployment identities are invalid.",
            )
        policy_digest = canonical_digest(policy)
        deployment = {
            "schema_version": SignedSecurityObservabilityDeploymentLoader.SCHEMA_VERSION,
            **deployment_source,
            "slo_policy_filename": policy_filename,
            "slo_policy_id": policy_id,
            "slo_policy_digest": policy_digest,
            "slo_policy_key_id": policy_key_id,
            "slo_policy_minimum_version": policy_version,
        }
        root = Path(output_root)
        root.mkdir(parents=False, exist_ok=True)
        if root.is_symlink():
            raise SecurityObservabilityReleaseError(
                "security_observability_release_output_untrusted", "Release output root cannot be a symlink.",
            )
        policy_envelope = cls._envelope(policy, policy_key_id, slo_private_key)
        manifest_envelope = cls._envelope(deployment, release_key_id, release_private_key)
        manifest_digest = canonical_digest(deployment)
        pins = SecurityObservabilityReleasePins(
            manifest_filename=manifest_filename,
            manifest_id=str(deployment_source["manifest_id"]),
            minimum_manifest_version=deployment_version,
            manifest_digest=manifest_digest,
            manifest_file_digest=cls._serialized_digest(manifest_envelope),
            product=str(deployment_source["product"]), channel=str(deployment_source["channel"]),
            runtime_build_digest=str(deployment_source["runtime_build_digest"]),
            release_key_id=release_key_id,
            release_public_key_digest=cls._key_digest(release_private_key),
            slo_policy_filename=policy_filename, slo_policy_id=policy_id,
            slo_policy_minimum_version=policy_version, slo_policy_digest=policy_digest,
            slo_policy_file_digest=cls._serialized_digest(policy_envelope),
            slo_policy_key_id=policy_key_id,
            slo_public_key_digest=cls._key_digest(slo_private_key),
        )
        pins_json = {"schema_version": cls.PINS_SCHEMA, **pins.__dict__}
        cls._write_new(root / policy_filename, policy_envelope)
        try:
            cls._write_new(root / manifest_filename, manifest_envelope)
            cls._write_new(root / "security-observability-release-pins.json", pins_json)
            try:
                verification_time = (float(deployment["not_before"]) + float(deployment["expires_at"])) / 2
                cls.verify(
                    root, pins, release_public_key=release_private_key.public_key(),
                    slo_public_key=slo_private_key.public_key(), clock=lambda: verification_time,
                )
            except (TypeError, ValueError) as error:
                raise SecurityObservabilityReleaseError(
                    "security_observability_release_input_invalid",
                    "Release validity interval is invalid.",
                ) from error
        except BaseException:
            (root / policy_filename).unlink(missing_ok=True)
            (root / manifest_filename).unlink(missing_ok=True)
            (root / "security-observability-release-pins.json").unlink(missing_ok=True)
            raise
        return pins

    @classmethod
    def load_pins(cls, path: Path) -> SecurityObservabilityReleasePins:
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_pins_invalid", "Release pins are unreadable.",
            ) from error
        if not isinstance(raw, dict) or set(raw) != cls._PINS_FIELDS or raw["schema_version"] != cls.PINS_SCHEMA:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_pins_invalid", "Release pins schema or fields are invalid.",
            )
        values = {name: raw[name] for name in SecurityObservabilityReleasePins.__dataclass_fields__}
        if (
            any(not isinstance(values[name], str) or not values[name] for name in (
                "manifest_id", "product", "channel", "release_key_id", "slo_policy_id",
                "slo_policy_key_id",
            ))
            or any(
                isinstance(values[name], bool) or not isinstance(values[name], int) or values[name] < 1
                for name in ("minimum_manifest_version", "slo_policy_minimum_version")
            )
        ):
            raise SecurityObservabilityReleaseError(
                "security_observability_release_pins_invalid", "Release pin identities are invalid.",
            )
        try:
            cls._basename(values["manifest_filename"], "manifest_filename")
            cls._basename(values["slo_policy_filename"], "slo_policy_filename")
        except SecurityObservabilityReleaseError as error:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_pins_invalid", "Release pin filenames are invalid.",
            ) from error
        if any(
            not isinstance(values[name], str) or not cls._DIGEST.fullmatch(values[name])
            for name in (
                "manifest_digest", "runtime_build_digest", "release_public_key_digest",
                "manifest_file_digest", "slo_policy_digest", "slo_policy_file_digest",
                "slo_public_key_digest",
            )
        ):
            raise SecurityObservabilityReleaseError(
                "security_observability_release_pins_invalid", "Release pin digests are invalid.",
            )
        return SecurityObservabilityReleasePins(**values)

    @classmethod
    def verify(
        cls,
        bundle_root: Path,
        pins: SecurityObservabilityReleasePins,
        *,
        release_public_key: Ed25519PublicKey,
        slo_public_key: Ed25519PublicKey,
        clock,
    ) -> VerifiedSecurityObservabilityRelease:
        if cls._key_digest(release_public_key) != pins.release_public_key_digest:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_key_mismatch", "Release public key does not match build pins.",
            )
        if cls._key_digest(slo_public_key) != pins.slo_public_key_digest:
            raise SecurityObservabilityReleaseError(
                "security_observability_release_key_mismatch", "SLO public key does not match build pins.",
            )
        root = Path(bundle_root).resolve(strict=True)
        with tempfile.TemporaryDirectory(prefix="drsai-release-verify-") as state:
            database = Path(state) / "verify.sqlite3"
            deployment = SignedSecurityObservabilityDeploymentLoader(
                database, root,
                trusted_release_keys={pins.release_key_id: cls._public_raw(release_public_key)},
                expected_manifest_id=pins.manifest_id, expected_product=pins.product,
                expected_channel=pins.channel,
                expected_runtime_build_digest=pins.runtime_build_digest,
                minimum_manifest_version=pins.minimum_manifest_version, clock=clock,
            ).load(pins.manifest_filename)
            if deployment.digest != pins.manifest_digest:
                raise SecurityObservabilityReleaseError(
                    "security_observability_release_manifest_mismatch", "Manifest does not match build pins.",
                )
            if (
                deployment.slo_policy_filename != pins.slo_policy_filename
                or deployment.slo_policy_id != pins.slo_policy_id
                or deployment.slo_policy_digest != pins.slo_policy_digest
                or deployment.slo_policy_key_id != pins.slo_policy_key_id
                or deployment.slo_policy_minimum_version != pins.slo_policy_minimum_version
            ):
                raise SecurityObservabilityReleaseError(
                    "security_observability_release_policy_binding_mismatch",
                    "Deployment policy binding does not match build pins.",
                )
            policy = SignedApprovalSloPolicyLoader(
                database, root,
                trusted_public_keys={pins.slo_policy_key_id: cls._public_raw(slo_public_key)},
                expected_policy_id=pins.slo_policy_id,
                minimum_version=pins.slo_policy_minimum_version,
                expected_policy_digest=pins.slo_policy_digest, clock=clock,
            ).load(pins.slo_policy_filename)
            if policy.digest != pins.slo_policy_digest:
                raise SecurityObservabilityReleaseError(
                    "security_observability_release_policy_mismatch", "SLO policy does not match build pins.",
                )
        return VerifiedSecurityObservabilityRelease(deployment=deployment, pins=pins)


def _load_private(path: Path) -> Ed25519PrivateKey:
    try:
        key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
    except (OSError, ValueError, TypeError) as error:
        raise SecurityObservabilityReleaseError(
            "security_observability_release_key_invalid", "Signing key is unreadable or invalid.",
        ) from error
    if not isinstance(key, Ed25519PrivateKey):
        raise SecurityObservabilityReleaseError(
            "security_observability_release_key_invalid", "Signing key must be Ed25519 PEM.",
        )
    return key


def _load_public(path: Path) -> Ed25519PublicKey:
    try:
        key = serialization.load_pem_public_key(Path(path).read_bytes())
    except (OSError, ValueError, TypeError) as error:
        raise SecurityObservabilityReleaseError(
            "security_observability_release_key_invalid", "Verification key is unreadable or invalid.",
        ) from error
    if not isinstance(key, Ed25519PublicKey):
        raise SecurityObservabilityReleaseError(
            "security_observability_release_key_invalid", "Verification key must be Ed25519 PEM.",
        )
    return key


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="drsai-security-observability-release")
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build")
    build.add_argument("--input", required=True, type=Path)
    build.add_argument("--output-root", required=True, type=Path)
    build.add_argument("--release-private-key", required=True, type=Path)
    build.add_argument("--slo-private-key", required=True, type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("--bundle-root", required=True, type=Path)
    verify.add_argument("--pins", required=True, type=Path)
    verify.add_argument("--release-public-key", required=True, type=Path)
    verify.add_argument("--slo-public-key", required=True, type=Path)
    verify.add_argument("--now", required=True, type=float)
    args = parser.parse_args(argv)
    if args.command == "build":
        release_input = json.loads(args.input.read_text(encoding="utf-8"))
        SecurityObservabilityReleaseTool.build(
            release_input, args.output_root,
            release_private_key=_load_private(args.release_private_key),
            slo_private_key=_load_private(args.slo_private_key),
        )
    else:
        pins = SecurityObservabilityReleaseTool.load_pins(args.pins)
        SecurityObservabilityReleaseTool.verify(
            args.bundle_root, pins,
            release_public_key=_load_public(args.release_public_key),
            slo_public_key=_load_public(args.slo_public_key), clock=lambda: args.now,
        )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the console entry point
    raise SystemExit(main())
