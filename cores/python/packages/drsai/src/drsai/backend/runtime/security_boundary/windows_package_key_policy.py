"""Root-signed lifecycle policy for Windows package catalog signing keys."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import re
import sqlite3
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .models import canonical_digest


class WindowsPackageKeyPolicyError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class WindowsPackageCatalogKey:
    key_id: str
    public_key: bytes
    not_before: float
    not_after: float
    revoked_at: float | None
    revocation_reason: str


@dataclass(frozen=True)
class VerifiedWindowsPackageKeyPolicy:
    policy_id: str
    version: int
    digest: str
    root_key_id: str
    product: str
    channel: str
    emergency_disable: bool
    not_before: float
    expires_at: float
    keys: tuple[WindowsPackageCatalogKey, ...]

    def trusted_catalog_keys(self, *, now: float) -> dict[str, bytes]:
        if self.emergency_disable or not (self.not_before <= now < self.expires_at):
            return {}
        return {
            key.key_id: key.public_key
            for key in self.keys
            if key.not_before <= now < key.not_after
            and (key.revoked_at is None or now < key.revoked_at)
        }


class SignedWindowsPackageKeyPolicyLoader:
    SCHEMA_VERSION = "windows-package-catalog-key-policy/1"
    _MAX_BYTES = 64 * 1024
    _FIELDS = frozenset({
        "schema_version", "policy_id", "version", "product", "channel",
        "emergency_disable", "not_before", "expires_at", "keys",
    })
    _KEY_FIELDS = frozenset({
        "key_id", "public_key", "not_before", "not_after", "revoked_at",
        "revocation_reason",
    })
    _KEY_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")
    _REASON = re.compile(r"[a-z0-9][a-z0-9_]{0,63}")

    @staticmethod
    def _is_reparse(path: Path) -> bool:
        information = path.stat(follow_symlinks=False)
        return bool(
            stat.S_ISLNK(information.st_mode)
            or getattr(information, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )

    def __init__(
        self,
        database: Path,
        policy_root: Path,
        *,
        trusted_root_keys: Mapping[str, bytes],
        expected_policy_id: str,
        expected_product: str,
        expected_channel: str,
        minimum_policy_version: int,
        forbidden_roots: Sequence[Path] = (),
        clock=time.time,
    ):
        self.database = Path(database)
        raw_root = Path(policy_root)
        try:
            if self._is_reparse(raw_root):
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_root_untrusted", "Key policy root cannot be a reparse point.",
                )
            self.policy_root = raw_root.resolve(strict=True)
        except WindowsPackageKeyPolicyError:
            raise
        except OSError as error:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_root_missing", "Key policy root is unavailable.",
            ) from error
        self.trusted_root_keys = dict(trusted_root_keys)
        self.expected_policy_id = expected_policy_id
        self.expected_product = expected_product
        self.expected_channel = expected_channel
        self.minimum_policy_version = minimum_policy_version
        self.clock = clock
        if (
            not expected_policy_id or not expected_product or not expected_channel
            or minimum_policy_version < 1 or not self.trusted_root_keys
            or any(not key_id or len(key) != 32 for key_id, key in self.trusted_root_keys.items())
        ):
            raise ValueError("Windows package key-policy root pins are required.")
        for forbidden in forbidden_roots:
            root = Path(forbidden).resolve(strict=False)
            if self.policy_root == root or self.policy_root.is_relative_to(root):
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_root_untrusted", "Key policy cannot be loaded from a Workspace.",
                )
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_windows_package_key_policies(
                    policy_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                    policy_digest TEXT NOT NULL, root_key_id TEXT NOT NULL,
                    emergency_disable INTEGER NOT NULL, accepted_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_windows_package_key_states(
                    policy_id TEXT NOT NULL, key_id TEXT NOT NULL,
                    public_key_digest TEXT NOT NULL, not_before REAL NOT NULL,
                    not_after REAL NOT NULL, revoked_at REAL, revocation_reason TEXT NOT NULL,
                    PRIMARY KEY(policy_id,key_id)
                );
                CREATE TABLE IF NOT EXISTS runtime_windows_package_key_policy_versions(
                    policy_id TEXT NOT NULL, version INTEGER NOT NULL,
                    policy_digest TEXT NOT NULL, root_key_id TEXT NOT NULL,
                    emergency_disable INTEGER NOT NULL, accepted_at REAL NOT NULL,
                    PRIMARY KEY(policy_id,version)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_windows_package_key_policy_versions_no_update
                BEFORE UPDATE ON runtime_windows_package_key_policy_versions
                BEGIN SELECT RAISE(ABORT, 'package key policy versions are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_windows_package_key_policy_versions_no_delete
                BEFORE DELETE ON runtime_windows_package_key_policy_versions
                BEGIN SELECT RAISE(ABORT, 'package key policy versions are append-only'); END;
            """)

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

    @staticmethod
    def _key_digest(key: bytes) -> str:
        return "sha256:" + hashlib.sha256(key).hexdigest()

    def load(self, filename: str) -> VerifiedWindowsPackageKeyPolicy:
        if Path(filename).name != filename or not filename.endswith(".json"):
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_path_invalid", "Key policy must be a JSON basename.",
            )
        unresolved = self.policy_root / filename
        try:
            if self._is_reparse(unresolved) or unresolved.stat().st_size > self._MAX_BYTES:
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_path_invalid", "Key policy path or size is invalid.",
                )
            path = unresolved.resolve(strict=True)
            if path != unresolved or not path.is_relative_to(self.policy_root):
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_path_escape", "Key policy escaped its trusted root.",
                )
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except WindowsPackageKeyPolicyError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_unreadable", "Key policy is unreadable.",
            ) from error
        if not isinstance(envelope, dict) or set(envelope) != {"payload", "key_id", "signature"}:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_invalid", "Key policy envelope is invalid.",
            )
        payload, root_key_id = envelope["payload"], envelope["key_id"]
        if not isinstance(payload, dict) or set(payload) != self._FIELDS:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_invalid", "Key policy payload fields are invalid.",
            )
        if not isinstance(root_key_id, str) or root_key_id not in self.trusted_root_keys:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_root_key_untrusted", "Key policy root key is not pinned.",
            )
        try:
            signature = base64.b64decode(envelope["signature"], validate=True)
            Ed25519PublicKey.from_public_bytes(self.trusted_root_keys[root_key_id]).verify(
                signature, self._canonical(payload),
            )
        except (TypeError, ValueError, binascii.Error, InvalidSignature) as error:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_signature_invalid", "Key policy signature is invalid.",
            ) from error
        identity = (payload["policy_id"], payload["product"], payload["channel"])
        expected = (self.expected_policy_id, self.expected_product, self.expected_channel)
        if (
            payload["schema_version"] != self.SCHEMA_VERSION or identity != expected
            or not isinstance(payload["emergency_disable"], bool)
        ):
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_identity_mismatch", "Key policy identity is not pinned.",
            )
        version = payload["version"]
        if (
            isinstance(version, bool) or not isinstance(version, int)
            or version < self.minimum_policy_version
        ):
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_version_rollback", "Key policy version is below its pin.",
            )
        try:
            if isinstance(payload["not_before"], bool) or isinstance(payload["expires_at"], bool):
                raise TypeError("boolean policy time")
            policy_not_before = float(payload["not_before"])
            policy_expires = float(payload["expires_at"])
        except (TypeError, ValueError) as error:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_invalid", "Key policy validity is invalid.",
            ) from error
        now = float(self.clock())
        if (
            not math.isfinite(policy_not_before) or not math.isfinite(policy_expires)
            or policy_not_before > now or policy_expires <= now or policy_expires <= policy_not_before
        ):
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_not_current", "Key policy is not currently valid.",
            )
        raw_keys = payload["keys"]
        if not isinstance(raw_keys, list) or not raw_keys:
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_keys_invalid", "Key policy must contain catalog keys.",
            )
        keys: list[WindowsPackageCatalogKey] = []
        for raw in raw_keys:
            if not isinstance(raw, dict) or set(raw) != self._KEY_FIELDS:
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_keys_invalid", "Catalog key entry is invalid.",
                )
            key_id = raw["key_id"]
            reason = raw["revocation_reason"]
            try:
                public_key = base64.b64decode(raw["public_key"], validate=True)
                Ed25519PublicKey.from_public_bytes(public_key)
                key_not_before = float(raw["not_before"])
                key_not_after = float(raw["not_after"])
                revoked_at = None if raw["revoked_at"] is None else float(raw["revoked_at"])
            except (TypeError, ValueError, binascii.Error) as error:
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_keys_invalid", "Catalog key material is invalid.",
                ) from error
            if (
                not isinstance(key_id, str) or not self._KEY_ID.fullmatch(key_id)
                or not isinstance(reason, str)
                or isinstance(raw["not_before"], bool) or isinstance(raw["not_after"], bool)
                or isinstance(raw["revoked_at"], bool)
                or len(public_key) != 32
                or not all(math.isfinite(value) for value in (key_not_before, key_not_after))
                or key_not_after <= key_not_before
                or key_not_before < policy_not_before or key_not_after > policy_expires
                or (revoked_at is not None and (
                    not math.isfinite(revoked_at)
                    or revoked_at < key_not_before or revoked_at > key_not_after
                    or not self._REASON.fullmatch(reason)
                ))
                or (revoked_at is None and reason)
            ):
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_keys_invalid", "Catalog key lifecycle is invalid.",
                )
            keys.append(WindowsPackageCatalogKey(
                key_id, public_key, key_not_before, key_not_after, revoked_at, reason,
            ))
        if [key.key_id for key in keys] != sorted({key.key_id for key in keys}):
            raise WindowsPackageKeyPolicyError(
                "windows_package_key_policy_keys_invalid", "Catalog key IDs must be sorted and unique.",
            )
        digest = canonical_digest(payload)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous_policy = connection.execute(
                "SELECT * FROM runtime_windows_package_key_policies WHERE policy_id=?",
                (self.expected_policy_id,),
            ).fetchone()
            previous_keys = {
                str(row["key_id"]): row for row in connection.execute(
                    "SELECT * FROM runtime_windows_package_key_states WHERE policy_id=?",
                    (self.expected_policy_id,),
                ).fetchall()
            }
            if previous_policy is not None and version < int(previous_policy["version"]):
                connection.rollback()
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_version_rollback", "Key policy was superseded.",
                )
            if previous_policy is not None and version == int(previous_policy["version"]):
                if digest != str(previous_policy["policy_digest"]):
                    connection.rollback()
                    raise WindowsPackageKeyPolicyError(
                        "windows_package_key_policy_version_redefined", "Key policy version changed.",
                    )
                connection.rollback()
                return VerifiedWindowsPackageKeyPolicy(
                    self.expected_policy_id, version, digest, root_key_id,
                    self.expected_product, self.expected_channel, payload["emergency_disable"],
                    policy_not_before, policy_expires, tuple(keys),
                )
            new_by_id = {key.key_id: key for key in keys}
            if previous_keys.keys() - new_by_id.keys():
                connection.rollback()
                raise WindowsPackageKeyPolicyError(
                    "windows_package_key_policy_key_removed", "Catalog keys cannot disappear from policy history.",
                )
            newly_revoked = [
                key for key in keys if key.key_id not in previous_keys and key.revoked_at is not None
            ]
            for key_id, previous in previous_keys.items():
                key = new_by_id[key_id]
                if (
                    self._key_digest(key.public_key) != str(previous["public_key_digest"])
                    or key.not_before != float(previous["not_before"])
                    or key.not_after > float(previous["not_after"])
                ):
                    connection.rollback()
                    raise WindowsPackageKeyPolicyError(
                        "windows_package_key_policy_key_redefined", "Catalog key identity or lifetime expanded.",
                    )
                previous_revoked = previous["revoked_at"]
                if previous_revoked is not None and (
                    key.revoked_at != float(previous_revoked)
                    or key.revocation_reason != str(previous["revocation_reason"])
                ):
                    connection.rollback()
                    raise WindowsPackageKeyPolicyError(
                        "windows_package_key_policy_key_reactivated", "Revoked catalog key cannot reactivate.",
                    )
                if previous_revoked is None and key.revoked_at is not None:
                    newly_revoked.append(key)
            connection.execute(
                "INSERT INTO runtime_windows_package_key_policies"
                "(policy_id,version,policy_digest,root_key_id,emergency_disable,accepted_at) "
                "VALUES(?,?,?,?,?,?) ON CONFLICT(policy_id) DO UPDATE SET version=excluded.version,"
                "policy_digest=excluded.policy_digest,root_key_id=excluded.root_key_id,"
                "emergency_disable=excluded.emergency_disable,accepted_at=excluded.accepted_at",
                (self.expected_policy_id, version, digest, root_key_id,
                 int(payload["emergency_disable"]), now),
            )
            connection.execute(
                "INSERT INTO runtime_windows_package_key_policy_versions VALUES(?,?,?,?,?,?)",
                (self.expected_policy_id, version, digest, root_key_id,
                 int(payload["emergency_disable"]), now),
            )
            for key in keys:
                connection.execute(
                    "INSERT INTO runtime_windows_package_key_states VALUES(?,?,?,?,?,?,?) "
                    "ON CONFLICT(policy_id,key_id) DO UPDATE SET not_after=excluded.not_after,"
                    "revoked_at=excluded.revoked_at,revocation_reason=excluded.revocation_reason",
                    (self.expected_policy_id, key.key_id, self._key_digest(key.public_key),
                     key.not_before, key.not_after, key.revoked_at, key.revocation_reason),
                )
            self.journal.append_in_transaction(
                connection, "windows_package.key_policy_accepted", self.expected_policy_id,
                {"version": version, "policy_digest": digest,
                 "emergency_disable": payload["emergency_disable"]}, now=now,
            )
            previous_emergency = bool(previous_policy["emergency_disable"]) if previous_policy else False
            if previous_emergency != bool(payload["emergency_disable"]):
                event = (
                    "windows_package.catalog_keys_emergency_disabled"
                    if payload["emergency_disable"]
                    else "windows_package.catalog_keys_emergency_enabled"
                )
                self.journal.append_in_transaction(
                    connection, event, self.expected_policy_id,
                    {"policy_version": version, "policy_digest": digest}, now=now,
                )
            for key in newly_revoked:
                self.journal.append_in_transaction(
                    connection, "windows_package.catalog_key_revoked", key.key_id,
                    {"policy_version": version, "revoked_at": key.revoked_at,
                     "reason": key.revocation_reason}, now=now,
                )
            connection.commit()
        return VerifiedWindowsPackageKeyPolicy(
            self.expected_policy_id, version, digest, root_key_id,
            self.expected_product, self.expected_channel, payload["emergency_disable"],
            policy_not_before, policy_expires, tuple(keys),
        )
