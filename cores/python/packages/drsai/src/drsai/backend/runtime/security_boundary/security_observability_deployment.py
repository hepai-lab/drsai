"""Signed install-time deployment identity for host security observability."""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .models import canonical_digest


class SecurityObservabilityDeploymentError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VerifiedSecurityObservabilityDeployment:
    manifest_id: str
    version: int
    digest: str
    install_root: Path
    product: str
    channel: str
    runtime_build_digest: str
    enabled: bool
    service_sid: str
    pipe_instance_id: str
    slo_policy_filename: str
    slo_policy_id: str
    slo_policy_digest: str
    slo_policy_key_id: str
    slo_policy_minimum_version: int
    not_before: float
    expires_at: float


class SignedSecurityObservabilityDeploymentLoader:
    SCHEMA_VERSION = "security-observability-deployment/1"
    _MAX_BYTES = 64 * 1024
    _FIELDS = frozenset({
        "schema_version", "manifest_id", "version", "product", "channel",
        "runtime_build_digest", "enabled", "service_sid", "pipe_instance_id",
        "slo_policy_filename", "slo_policy_digest", "slo_policy_key_id",
        "slo_policy_id", "slo_policy_minimum_version", "not_before", "expires_at",
    })
    _SID = re.compile(r"^S-1-(?:\d+-){1,14}\d+$", re.IGNORECASE)
    _INSTANCE = re.compile(r"^[a-f0-9]{32}$")

    def __init__(
        self,
        database: Path,
        install_root: Path,
        *,
        trusted_release_keys: Mapping[str, bytes],
        expected_manifest_id: str,
        expected_product: str,
        expected_channel: str,
        expected_runtime_build_digest: str,
        minimum_manifest_version: int,
        forbidden_roots: Sequence[Path] = (),
        clock=time.time,
    ):
        self.database = Path(database)
        self.install_root = Path(install_root).resolve(strict=True)
        self.trusted_release_keys = dict(trusted_release_keys)
        self.expected_manifest_id = expected_manifest_id
        self.expected_product = expected_product
        self.expected_channel = expected_channel
        self.expected_runtime_build_digest = expected_runtime_build_digest
        self.minimum_manifest_version = minimum_manifest_version
        self.clock = clock
        if (
            not expected_manifest_id or not expected_product or not expected_channel
            or minimum_manifest_version < 1
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", expected_runtime_build_digest)
            or not self.trusted_release_keys
        ):
            raise ValueError("Deployment release pins are required")
        if any(not key_id or len(key) != 32 for key_id, key in self.trusted_release_keys.items()):
            raise ValueError("Deployment Ed25519 key pins are invalid")
        for forbidden in forbidden_roots:
            root = Path(forbidden).resolve(strict=False)
            if self.install_root == root or self.install_root.is_relative_to(root):
                raise SecurityObservabilityDeploymentError(
                    "security_observability_install_root_untrusted",
                    "Observability deployment cannot be loaded from a Workspace.",
                )
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_security_observability_deployments(
                manifest_id TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                manifest_digest TEXT NOT NULL,
                accepted_at REAL NOT NULL
            )""")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _canonical(payload: Mapping[str, object]) -> bytes:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

    def load(self, filename: str) -> VerifiedSecurityObservabilityDeployment:
        if Path(filename).name != filename or not filename.endswith(".json"):
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_path_invalid", "Manifest must be a JSON basename.",
            )
        path = (self.install_root / filename).resolve(strict=True)
        if not path.is_relative_to(self.install_root):
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_path_escape", "Manifest escaped its install root.",
            )
        try:
            if path.stat().st_size > self._MAX_BYTES:
                raise SecurityObservabilityDeploymentError(
                    "security_observability_manifest_too_large", "Manifest exceeds its size limit.",
                )
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except SecurityObservabilityDeploymentError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_unreadable", "Manifest is unreadable.",
            ) from error
        if not isinstance(envelope, dict) or set(envelope) != {"payload", "key_id", "signature"}:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_invalid", "Manifest envelope is invalid.",
            )
        payload = envelope["payload"]
        if not isinstance(payload, dict) or set(payload) != self._FIELDS:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_invalid", "Manifest payload is invalid.",
            )
        key_id = envelope["key_id"]
        if not isinstance(key_id, str) or key_id not in self.trusted_release_keys:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_key_untrusted", "Manifest key is not pinned.",
            )
        try:
            signature = base64.b64decode(envelope["signature"], validate=True)
            Ed25519PublicKey.from_public_bytes(self.trusted_release_keys[key_id]).verify(
                signature, self._canonical(payload),
            )
        except (TypeError, ValueError, binascii.Error, InvalidSignature) as error:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_signature_invalid", "Manifest signature is invalid.",
            ) from error
        if payload["schema_version"] != self.SCHEMA_VERSION:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_schema_invalid", "Manifest schema is unsupported.",
            )
        expected = (
            self.expected_manifest_id, self.expected_product, self.expected_channel,
            self.expected_runtime_build_digest,
        )
        actual = (
            payload["manifest_id"], payload["product"], payload["channel"],
            payload["runtime_build_digest"],
        )
        if actual != expected:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_identity_invalid", "Manifest release identity is not pinned.",
            )
        if (
            isinstance(payload["version"], bool) or not isinstance(payload["version"], int)
            or isinstance(payload["slo_policy_minimum_version"], bool)
            or not isinstance(payload["slo_policy_minimum_version"], int)
            or not isinstance(payload["enabled"], bool)
        ):
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_invalid", "Manifest value types are invalid.",
            )
        version = payload["version"]
        if version < self.minimum_manifest_version or payload["slo_policy_minimum_version"] < 1:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_version_rollback", "Manifest version is below its pin.",
            )
        try:
            not_before = float(payload["not_before"])
            expires_at = float(payload["expires_at"])
        except (TypeError, ValueError) as error:
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_invalid", "Manifest times are invalid.",
            ) from error
        now = float(self.clock())
        if (
            not math.isfinite(not_before) or not math.isfinite(expires_at)
            or not_before > now or expires_at <= now or expires_at <= not_before
        ):
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_not_current", "Manifest is not currently valid.",
            )
        filename_value = payload["slo_policy_filename"]
        if (
            not isinstance(filename_value, str) or Path(filename_value).name != filename_value
            or not filename_value.endswith(".json")
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(payload["slo_policy_digest"]))
            or not isinstance(payload["slo_policy_key_id"], str)
            or not payload["slo_policy_key_id"]
            or not isinstance(payload["slo_policy_id"], str)
            or not payload["slo_policy_id"]
        ):
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_invalid", "Manifest SLO policy binding is invalid.",
            )
        enabled = payload["enabled"]
        service_sid = payload["service_sid"]
        instance_id = payload["pipe_instance_id"]
        if enabled:
            if not isinstance(service_sid, str) or not self._SID.fullmatch(service_sid):
                raise SecurityObservabilityDeploymentError(
                    "security_observability_manifest_service_invalid", "Service SID is invalid.",
                )
            if not isinstance(instance_id, str) or not self._INSTANCE.fullmatch(instance_id):
                raise SecurityObservabilityDeploymentError(
                    "security_observability_manifest_pipe_invalid", "Pipe identity is invalid.",
                )
        elif service_sid != "" or instance_id != "":
            raise SecurityObservabilityDeploymentError(
                "security_observability_manifest_disabled_identity",
                "Disabled deployment cannot retain a live service or pipe identity.",
            )
        digest = canonical_digest(payload)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute(
                "SELECT version,manifest_digest FROM runtime_security_observability_deployments "
                "WHERE manifest_id=?", (self.expected_manifest_id,),
            ).fetchone()
            if previous is not None and version < int(previous["version"]):
                db.rollback()
                raise SecurityObservabilityDeploymentError(
                    "security_observability_manifest_version_rollback", "Manifest was superseded.",
                )
            if previous is not None and version == int(previous["version"]):
                if digest != str(previous["manifest_digest"]):
                    db.rollback()
                    raise SecurityObservabilityDeploymentError(
                        "security_observability_manifest_version_redefined", "Manifest version changed.",
                    )
                db.rollback()
            else:
                db.execute(
                    "INSERT INTO runtime_security_observability_deployments"
                    "(manifest_id,version,manifest_digest,accepted_at) VALUES(?,?,?,?) "
                    "ON CONFLICT(manifest_id) DO UPDATE SET version=excluded.version,"
                    "manifest_digest=excluded.manifest_digest,accepted_at=excluded.accepted_at",
                    (self.expected_manifest_id, version, digest, now),
                )
                self.journal.append_in_transaction(
                    db, "security_observability.deployment_accepted", self.expected_manifest_id,
                    {"version": version, "manifest_digest": digest, "enabled": enabled}, now=now,
                )
                db.commit()
        return VerifiedSecurityObservabilityDeployment(
            manifest_id=self.expected_manifest_id, version=version, digest=digest,
            install_root=self.install_root, product=self.expected_product,
            channel=self.expected_channel, runtime_build_digest=self.expected_runtime_build_digest,
            enabled=enabled, service_sid=service_sid, pipe_instance_id=instance_id,
            slo_policy_filename=filename_value, slo_policy_digest=payload["slo_policy_digest"],
            slo_policy_id=payload["slo_policy_id"],
            slo_policy_key_id=payload["slo_policy_key_id"],
            slo_policy_minimum_version=payload["slo_policy_minimum_version"],
            not_before=not_before, expires_at=expires_at,
        )
