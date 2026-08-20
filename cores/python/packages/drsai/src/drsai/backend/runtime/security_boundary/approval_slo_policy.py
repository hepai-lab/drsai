"""Signed, rollback-resistant policy loading for Approval security SLOs."""

from __future__ import annotations

import base64
import binascii
import json
import math
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .approval_slo_monitor import ApprovalSecuritySloThresholds
from .audit import SecurityEventJournal
from .models import canonical_digest


class ApprovalSloPolicyError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SignedApprovalSloPolicy:
    policy_id: str
    version: int
    key_id: str
    digest: str
    not_before: float
    expires_at: float
    thresholds: ApprovalSecuritySloThresholds


class SignedApprovalSloPolicyLoader:
    SCHEMA_VERSION = "approval-security-slo-policy/1"
    _PAYLOAD_FIELDS = frozenset({
        "schema_version", "policy_id", "version", "not_before", "expires_at", "thresholds",
    })
    _THRESHOLD_FIELDS = frozenset({
        "window_seconds", "minimum_decisions", "minimum_effects",
        "max_timeout_ratio_basis_points", "max_expired_grant_ratio_basis_points",
        "max_outcome_unknown_ratio_basis_points", "max_adapter_failures",
    })
    _MAX_POLICY_BYTES = 64 * 1024

    def __init__(
        self,
        database: Path,
        trusted_policy_root: Path,
        *,
        trusted_public_keys: Mapping[str, bytes],
        expected_policy_id: str,
        minimum_version: int,
        expected_policy_digest: str | None = None,
        forbidden_roots: Sequence[Path] = (),
        clock=time.time,
    ):
        self.database = Path(database)
        self.trusted_policy_root = Path(trusted_policy_root).resolve(strict=True)
        self.trusted_public_keys = dict(trusted_public_keys)
        self.expected_policy_id = expected_policy_id
        self.minimum_version = minimum_version
        self.expected_policy_digest = expected_policy_digest
        self.clock = clock
        if not expected_policy_id or minimum_version < 1 or not self.trusted_public_keys:
            raise ValueError("Signed Approval SLO policy pins are required")
        for key_id, key in self.trusted_public_keys.items():
            if not key_id or len(key) != 32:
                raise ValueError("Trusted Ed25519 key pins are invalid")
        for forbidden in forbidden_roots:
            root = Path(forbidden).resolve(strict=False)
            if self.trusted_policy_root == root or self.trusted_policy_root.is_relative_to(root):
                raise ApprovalSloPolicyError(
                    "approval_slo_policy_root_untrusted",
                    "Signed SLO policy root cannot be inside a Workspace.",
                )
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_approval_slo_policy_versions(
                policy_id TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                policy_digest TEXT NOT NULL,
                key_id TEXT NOT NULL,
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
        return json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8")

    def load(self, filename: str) -> SignedApprovalSloPolicy:
        if Path(filename).name != filename or not filename.endswith(".json"):
            raise ApprovalSloPolicyError(
                "approval_slo_policy_path_invalid", "Policy must be a JSON basename.",
            )
        path = (self.trusted_policy_root / filename).resolve(strict=True)
        if not path.is_relative_to(self.trusted_policy_root):
            raise ApprovalSloPolicyError(
                "approval_slo_policy_path_escape", "Policy escaped the trusted root.",
            )
        try:
            if path.stat().st_size > self._MAX_POLICY_BYTES:
                raise ApprovalSloPolicyError(
                    "approval_slo_policy_too_large", "Signed SLO policy exceeds its size limit.",
                )
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except ApprovalSloPolicyError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ApprovalSloPolicyError(
                "approval_slo_policy_unreadable", "Signed SLO policy is unreadable.",
            ) from error
        if not isinstance(envelope, dict) or set(envelope) != {"payload", "key_id", "signature"}:
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy envelope is invalid.")
        payload = envelope["payload"]
        if not isinstance(payload, dict) or set(payload) != self._PAYLOAD_FIELDS:
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy payload is invalid.")
        thresholds_raw = payload["thresholds"]
        if not isinstance(thresholds_raw, dict) or set(thresholds_raw) != self._THRESHOLD_FIELDS:
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy thresholds are invalid.")
        integer_thresholds = self._THRESHOLD_FIELDS - {"window_seconds"}
        if (
            isinstance(thresholds_raw["window_seconds"], bool)
            or not isinstance(thresholds_raw["window_seconds"], (int, float))
            or not math.isfinite(float(thresholds_raw["window_seconds"]))
            or any(
                isinstance(thresholds_raw[name], bool)
                or not isinstance(thresholds_raw[name], int)
                for name in integer_thresholds
            )
        ):
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy threshold types are invalid.")
        key_id = envelope["key_id"]
        if not isinstance(key_id, str) or key_id not in self.trusted_public_keys:
            raise ApprovalSloPolicyError("approval_slo_policy_key_untrusted", "Policy key is not pinned.")
        try:
            signature = base64.b64decode(envelope["signature"], validate=True)
            Ed25519PublicKey.from_public_bytes(self.trusted_public_keys[key_id]).verify(
                signature, self._canonical(payload),
            )
        except (TypeError, ValueError, binascii.Error, InvalidSignature) as error:
            raise ApprovalSloPolicyError(
                "approval_slo_policy_signature_invalid", "Policy signature is invalid.",
            ) from error
        if payload["schema_version"] != self.SCHEMA_VERSION:
            raise ApprovalSloPolicyError("approval_slo_policy_schema_invalid", "Policy schema is unsupported.")
        if payload["policy_id"] != self.expected_policy_id:
            raise ApprovalSloPolicyError("approval_slo_policy_identity_invalid", "Policy identity is not pinned.")
        try:
            version = int(payload["version"])
            not_before = float(payload["not_before"])
            expires_at = float(payload["expires_at"])
            thresholds = ApprovalSecuritySloThresholds(**thresholds_raw)
        except (TypeError, ValueError) as error:
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy values are invalid.") from error
        if isinstance(payload["version"], bool) or version != payload["version"]:
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy version is invalid.")
        if not math.isfinite(not_before) or not math.isfinite(expires_at):
            raise ApprovalSloPolicyError("approval_slo_policy_invalid", "Policy times are invalid.")
        if version < self.minimum_version:
            raise ApprovalSloPolicyError("approval_slo_policy_version_rollback", "Policy version is below its pin.")
        now = float(self.clock())
        if not_before > now or expires_at <= now or expires_at <= not_before:
            raise ApprovalSloPolicyError("approval_slo_policy_not_current", "Policy is not currently valid.")
        digest = canonical_digest(payload)
        if self.expected_policy_digest is not None and digest != self.expected_policy_digest:
            raise ApprovalSloPolicyError(
                "approval_slo_policy_digest_mismatch",
                "Policy digest does not match the deployment manifest.",
            )
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute(
                "SELECT version,policy_digest FROM runtime_approval_slo_policy_versions WHERE policy_id=?",
                (self.expected_policy_id,),
            ).fetchone()
            if previous is not None and version < int(previous["version"]):
                db.rollback()
                raise ApprovalSloPolicyError(
                    "approval_slo_policy_version_rollback", "Policy version was already superseded.",
                )
            if previous is not None and version == int(previous["version"]):
                if digest != str(previous["policy_digest"]):
                    db.rollback()
                    raise ApprovalSloPolicyError(
                        "approval_slo_policy_version_redefined", "Policy version identity changed.",
                    )
                db.rollback()
            else:
                db.execute(
                    "INSERT INTO runtime_approval_slo_policy_versions"
                    "(policy_id,version,policy_digest,key_id,accepted_at) VALUES(?,?,?,?,?) "
                    "ON CONFLICT(policy_id) DO UPDATE SET version=excluded.version,"
                    "policy_digest=excluded.policy_digest,key_id=excluded.key_id,accepted_at=excluded.accepted_at",
                    (self.expected_policy_id, version, digest, key_id, now),
                )
                self.journal.append_in_transaction(
                    db, "approval_slo.policy_accepted", self.expected_policy_id,
                    {"version": version, "policy_digest": digest, "key_id": key_id}, now=now,
                )
                db.commit()
        return SignedApprovalSloPolicy(
            policy_id=self.expected_policy_id, version=version, key_id=key_id,
            digest=digest, not_before=not_before, expires_at=expires_at,
            thresholds=thresholds,
        )
