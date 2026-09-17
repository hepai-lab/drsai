"""Signed, rollback-resistant Windows security package catalog."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import os
import re
import sqlite3
import stat
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .models import canonical_digest
from .windows_package_key_policy import VerifiedWindowsPackageKeyPolicy


class WindowsSecurityPackageCatalogError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VerifiedWindowsSecurityPackageCatalog:
    catalog_path: Path
    install_root: Path
    catalog_id: str
    version: int
    digest: str
    key_id: str
    product: str
    channel: str
    runtime_build_digest: str
    installation_metadata_filename: str
    installation_metadata_id: str
    installation_metadata_digest: str
    installation_metadata_minimum_version: int
    release_pins_filename: str
    release_pins_file_digest: str
    service_name: str
    service_sid: str
    service_start_account: str
    service_start_type: str
    service_sid_type: str
    service_delayed_auto_start: bool
    trusted_writer_sids: tuple[str, ...]
    not_before: float
    expires_at: float


class SignedWindowsSecurityPackageCatalogLoader:
    SCHEMA_VERSION = "windows-security-package-catalog/1"
    _MAX_BYTES = 64 * 1024
    _FIELDS = frozenset({
        "schema_version", "catalog_id", "version", "product", "channel",
        "runtime_build_digest", "installation_metadata_filename",
        "installation_metadata_id", "installation_metadata_digest",
        "installation_metadata_minimum_version",
        "release_pins_filename", "release_pins_file_digest", "service_name", "service_sid",
        "service_start_account", "service_start_type", "service_sid_type",
        "service_delayed_auto_start", "trusted_writer_sids", "not_before", "expires_at",
    })
    _DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
    _SID = re.compile(r"^S-1-(?:\d+-){1,14}\d+$", re.IGNORECASE)

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
        install_root: Path,
        *,
        trusted_release_keys: Mapping[str, bytes],
        expected_catalog_id: str,
        expected_product: str,
        expected_channel: str,
        expected_runtime_build_digest: str,
        minimum_catalog_version: int,
        forbidden_roots: Sequence[Path] = (),
        clock=time.time,
    ):
        self.database = Path(database)
        raw_root = Path(install_root)
        try:
            if self._is_reparse(raw_root):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_root_untrusted", "Package catalog root cannot be a reparse point.",
                )
            self.install_root = raw_root.resolve(strict=True)
        except WindowsSecurityPackageCatalogError:
            raise
        except OSError as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_root_missing", "Package catalog root is unavailable.",
            ) from error
        self.trusted_release_keys = dict(trusted_release_keys)
        self.expected_catalog_id = expected_catalog_id
        self.expected_product = expected_product
        self.expected_channel = expected_channel
        self.expected_runtime_build_digest = expected_runtime_build_digest
        self.minimum_catalog_version = minimum_catalog_version
        self.clock = clock
        self.verified_key_policy: VerifiedWindowsPackageKeyPolicy | None = None
        if (
            not expected_catalog_id or not expected_product or not expected_channel
            or not self._DIGEST.fullmatch(expected_runtime_build_digest)
            or minimum_catalog_version < 1 or not self.trusted_release_keys
            or any(not key_id or len(key) != 32 for key_id, key in self.trusted_release_keys.items())
        ):
            raise ValueError("Windows package catalog release pins are required.")
        for forbidden in forbidden_roots:
            root = Path(forbidden).resolve(strict=False)
            if self.install_root == root or self.install_root.is_relative_to(root):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_root_untrusted", "Package catalog cannot be loaded from a Workspace.",
                )
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as database_connection:
            database_connection.execute("""CREATE TABLE IF NOT EXISTS runtime_windows_package_catalogs(
                catalog_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                catalog_digest TEXT NOT NULL, key_id TEXT NOT NULL, accepted_at REAL NOT NULL
            )""")

    @classmethod
    def from_verified_key_policy(
        cls,
        database: Path,
        install_root: Path,
        policy: VerifiedWindowsPackageKeyPolicy,
        *,
        expected_catalog_id: str,
        expected_runtime_build_digest: str,
        minimum_catalog_version: int,
        forbidden_roots: Sequence[Path] = (),
        clock=time.time,
    ) -> "SignedWindowsSecurityPackageCatalogLoader":
        if not isinstance(policy, VerifiedWindowsPackageKeyPolicy):
            raise TypeError("A verified Windows package key policy is required.")
        now = float(clock())
        keys = policy.trusted_catalog_keys(now=now)
        if not keys:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_keys_disabled",
                "No catalog signing key is active under the verified key policy.",
            )
        loader = cls(
            database, install_root, trusted_release_keys=keys,
            expected_catalog_id=expected_catalog_id, expected_product=policy.product,
            expected_channel=policy.channel,
            expected_runtime_build_digest=expected_runtime_build_digest,
            minimum_catalog_version=minimum_catalog_version,
            forbidden_roots=forbidden_roots, clock=clock,
        )
        loader.verified_key_policy = policy
        return loader

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
    def _file_digest(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        return "sha256:" + digest.hexdigest()

    @staticmethod
    def _basename(value: object) -> str | None:
        if not isinstance(value, str) or not value.endswith(".json") or Path(value).name != value:
            return None
        return value

    def load(self, filename: str) -> VerifiedWindowsSecurityPackageCatalog:
        if self._basename(filename) is None:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_path_invalid", "Package catalog must be a JSON basename.",
            )
        unresolved = self.install_root / filename
        try:
            if self._is_reparse(unresolved):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_path_escape", "Package catalog cannot be a reparse point.",
                )
            if unresolved.lstat().st_size > self._MAX_BYTES:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_too_large", "Package catalog exceeds its size limit.",
                )
            path = unresolved.resolve(strict=True)
            if not path.is_relative_to(self.install_root) or path != unresolved:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_path_escape", "Package catalog escaped its install root.",
                )
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except WindowsSecurityPackageCatalogError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_unreadable", "Package catalog is unreadable.",
            ) from error
        if not isinstance(envelope, dict) or set(envelope) != {"payload", "key_id", "signature"}:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_invalid", "Package catalog envelope is invalid.",
            )
        payload, key_id = envelope["payload"], envelope["key_id"]
        if not isinstance(payload, dict) or set(payload) != self._FIELDS:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_invalid", "Package catalog payload fields are invalid.",
            )
        if not isinstance(key_id, str) or key_id not in self.trusted_release_keys:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_key_untrusted", "Package catalog key is not pinned.",
            )
        if (
            self.verified_key_policy is not None
            and key_id not in self.verified_key_policy.trusted_catalog_keys(now=float(self.clock()))
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_key_inactive",
                "Catalog key is retired, revoked, disabled, or outside the current policy lifetime.",
            )
        try:
            signature = base64.b64decode(envelope["signature"], validate=True)
            Ed25519PublicKey.from_public_bytes(self.trusted_release_keys[key_id]).verify(
                signature, self._canonical(payload),
            )
        except (TypeError, ValueError, binascii.Error, InvalidSignature) as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_signature_invalid", "Package catalog signature is invalid.",
            ) from error
        identity = (
            payload["catalog_id"], payload["product"], payload["channel"],
            payload["runtime_build_digest"],
        )
        expected = (
            self.expected_catalog_id, self.expected_product, self.expected_channel,
            self.expected_runtime_build_digest,
        )
        string_fields = (
            "schema_version", "catalog_id", "product", "channel", "runtime_build_digest",
            "installation_metadata_id", "installation_metadata_digest",
            "release_pins_file_digest", "service_name",
            "service_sid", "service_start_account", "service_start_type", "service_sid_type",
        )
        if (
            any(not isinstance(payload[name], str) for name in string_fields)
            or payload["schema_version"] != self.SCHEMA_VERSION or identity != expected
            or not payload["installation_metadata_id"]
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_identity_mismatch", "Package catalog identity is not pinned.",
            )
        version = payload["version"]
        metadata_minimum = payload["installation_metadata_minimum_version"]
        if (
            isinstance(version, bool) or not isinstance(version, int)
            or isinstance(metadata_minimum, bool) or not isinstance(metadata_minimum, int)
            or version < self.minimum_catalog_version or metadata_minimum < 1
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_version_rollback", "Package catalog version is below its pin.",
            )
        metadata_filename = self._basename(payload["installation_metadata_filename"])
        pins_filename = self._basename(payload["release_pins_filename"])
        if (
            metadata_filename is None or pins_filename is None or metadata_filename == pins_filename
            or not self._DIGEST.fullmatch(payload["installation_metadata_digest"])
            or not self._DIGEST.fullmatch(payload["release_pins_file_digest"])
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_artifact_binding_invalid", "Catalog artifact binding is invalid.",
            )
        writers = payload["trusted_writer_sids"]
        normalized_writers = (
            {value.upper() for value in writers}
            if isinstance(writers, list) and all(isinstance(value, str) for value in writers)
            else set()
        )
        if (
            not isinstance(writers, list) or not writers
            or any(not isinstance(value, str) or not self._SID.fullmatch(value) for value in writers)
            or len(normalized_writers) != len(writers)
            or writers != sorted(writers, key=str.upper)
            or not self._SID.fullmatch(payload["service_sid"])
            or payload["service_sid"].upper() in {value.upper() for value in writers}
            or payload["service_start_type"] not in {"automatic", "manual", "disabled"}
            or payload["service_sid_type"] != "unrestricted"
            or not isinstance(payload["service_delayed_auto_start"], bool)
            or not payload["service_name"] or not payload["service_start_account"]
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_service_invalid", "Catalog service or writer identity is invalid.",
            )
        try:
            not_before, expires_at = float(payload["not_before"]), float(payload["expires_at"])
        except (TypeError, ValueError) as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_invalid", "Catalog validity interval is invalid.",
            ) from error
        now = float(self.clock())
        if (
            not math.isfinite(not_before) or not math.isfinite(expires_at)
            or not_before > now or expires_at <= now or expires_at <= not_before
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_not_current", "Package catalog is not currently valid.",
            )
        unresolved_pins = self.install_root / pins_filename
        try:
            if self._is_reparse(unresolved_pins):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_artifact_escape", "Release pins cannot be a reparse point.",
                )
            pins_path = unresolved_pins.resolve(strict=True)
            if not pins_path.is_relative_to(self.install_root) or pins_path != unresolved_pins:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_artifact_escape", "Release pins escaped the install root.",
                )
            if pins_path.stat().st_size > self._MAX_BYTES:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_artifact_too_large", "Release pins exceed their size limit.",
                )
            pins_digest = self._file_digest(pins_path)
        except WindowsSecurityPackageCatalogError:
            raise
        except OSError as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_artifact_unreadable", "Release pins are unreadable.",
            ) from error
        if pins_digest != payload["release_pins_file_digest"]:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_release_pins_mismatch", "Release pins differ from the signed catalog.",
            )
        digest = canonical_digest(payload)
        with self._connect() as database_connection:
            database_connection.execute("BEGIN IMMEDIATE")
            previous = database_connection.execute(
                "SELECT version,catalog_digest FROM runtime_windows_package_catalogs WHERE catalog_id=?",
                (self.expected_catalog_id,),
            ).fetchone()
            if previous is not None and version < int(previous["version"]):
                database_connection.rollback()
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_version_rollback", "Package catalog was superseded.",
                )
            if previous is not None and version == int(previous["version"]):
                if digest != str(previous["catalog_digest"]):
                    database_connection.rollback()
                    raise WindowsSecurityPackageCatalogError(
                        "windows_package_catalog_version_redefined", "Catalog version identity changed.",
                    )
                database_connection.rollback()
            else:
                database_connection.execute(
                    "INSERT INTO runtime_windows_package_catalogs"
                    "(catalog_id,version,catalog_digest,key_id,accepted_at) VALUES(?,?,?,?,?) "
                    "ON CONFLICT(catalog_id) DO UPDATE SET version=excluded.version,"
                    "catalog_digest=excluded.catalog_digest,key_id=excluded.key_id,accepted_at=excluded.accepted_at",
                    (self.expected_catalog_id, version, digest, key_id, now),
                )
                self.journal.append_in_transaction(
                    database_connection, "windows_package.catalog_accepted", self.expected_catalog_id,
                    {"version": version, "catalog_digest": digest, "key_id": key_id}, now=now,
                )
                database_connection.commit()
        return VerifiedWindowsSecurityPackageCatalog(
            catalog_path=path, install_root=self.install_root,
            catalog_id=self.expected_catalog_id, version=version, digest=digest, key_id=key_id,
            product=self.expected_product, channel=self.expected_channel,
            runtime_build_digest=self.expected_runtime_build_digest,
            installation_metadata_filename=metadata_filename,
            installation_metadata_id=payload["installation_metadata_id"],
            installation_metadata_digest=payload["installation_metadata_digest"],
            installation_metadata_minimum_version=metadata_minimum,
            release_pins_filename=pins_filename,
            release_pins_file_digest=payload["release_pins_file_digest"],
            service_name=payload["service_name"], service_sid=payload["service_sid"],
            service_start_account=payload["service_start_account"],
            service_start_type=payload["service_start_type"],
            service_sid_type=payload["service_sid_type"],
            service_delayed_auto_start=payload["service_delayed_auto_start"],
            trusted_writer_sids=tuple(writers), not_before=not_before, expires_at=expires_at,
        )


class WindowsSecurityPackageCatalogTool:
    """Offline deterministic catalog builder; never used by Runtime bootstrap."""

    INPUT_SCHEMA = "windows-security-package-catalog-input/1"
    _INPUT_FIELDS = frozenset({
        "schema_version", "catalog_id", "version", "installation_metadata_filename",
        "release_pins_filename", "trusted_writer_sids", "not_before", "expires_at",
    })
    _METADATA_FIELDS = frozenset({
        "schema_version", "metadata_id", "version", "product", "channel",
        "runtime_build_digest", "service_name", "service_sid", "service_start_account",
        "service_start_type", "service_sid_type", "service_delayed_auto_start", "artifacts",
    })

    @staticmethod
    def _write_new(path: Path, envelope: Mapping[str, object]) -> None:
        data = SignedWindowsSecurityPackageCatalogLoader._canonical(envelope) + b"\n"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_output_exists", "Package catalog is never overwritten.",
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
    def build(
        cls,
        catalog_input: Mapping[str, object],
        install_root: Path,
        catalog_filename: str,
        *,
        key_id: str,
        private_key: Ed25519PrivateKey,
    ) -> VerifiedWindowsSecurityPackageCatalog:
        if (
            not isinstance(catalog_input, Mapping)
            or set(catalog_input) != cls._INPUT_FIELDS
            or catalog_input.get("schema_version") != cls.INPUT_SCHEMA
            or SignedWindowsSecurityPackageCatalogLoader._basename(catalog_filename) is None
            or not key_id or not isinstance(private_key, Ed25519PrivateKey)
            or isinstance(catalog_input.get("version"), bool)
            or not isinstance(catalog_input.get("version"), int)
            or int(catalog_input["version"]) < 1
        ):
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_input_invalid", "Catalog build input is invalid.",
            )
        root = Path(install_root)
        try:
            if SignedWindowsSecurityPackageCatalogLoader._is_reparse(root):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_root_untrusted", "Catalog output root cannot be a symlink.",
                )
            root = root.resolve(strict=True)
            metadata_filename = catalog_input["installation_metadata_filename"]
            pins_filename = catalog_input["release_pins_filename"]
            if (
                SignedWindowsSecurityPackageCatalogLoader._basename(metadata_filename) is None
                or SignedWindowsSecurityPackageCatalogLoader._basename(pins_filename) is None
                or catalog_filename in {metadata_filename, pins_filename}
            ):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_input_invalid", "Catalog artifact filenames are invalid.",
                )
            metadata_path = root / str(metadata_filename)
            pins_path = root / str(pins_filename)
            if (
                SignedWindowsSecurityPackageCatalogLoader._is_reparse(metadata_path)
                or SignedWindowsSecurityPackageCatalogLoader._is_reparse(pins_path)
            ):
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_artifact_escape", "Catalog inputs cannot be symlinks.",
                )
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata_path.stat().st_size > SignedWindowsSecurityPackageCatalogLoader._MAX_BYTES:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_input_invalid", "Installation metadata is too large.",
                )
            if pins_path.stat().st_size > SignedWindowsSecurityPackageCatalogLoader._MAX_BYTES:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_input_invalid", "Release pins are too large.",
                )
            if not isinstance(metadata, dict) or set(metadata) != cls._METADATA_FIELDS:
                raise WindowsSecurityPackageCatalogError(
                    "windows_package_catalog_input_invalid", "Installation metadata is invalid.",
                )
        except WindowsSecurityPackageCatalogError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_input_unreadable", "Catalog build inputs are unreadable.",
            ) from error
        payload = {
            "schema_version": SignedWindowsSecurityPackageCatalogLoader.SCHEMA_VERSION,
            "catalog_id": catalog_input["catalog_id"], "version": catalog_input["version"],
            "product": metadata["product"], "channel": metadata["channel"],
            "runtime_build_digest": metadata["runtime_build_digest"],
            "installation_metadata_filename": metadata_filename,
            "installation_metadata_id": metadata["metadata_id"],
            "installation_metadata_digest": canonical_digest(metadata),
            "installation_metadata_minimum_version": metadata["version"],
            "release_pins_filename": pins_filename,
            "release_pins_file_digest": SignedWindowsSecurityPackageCatalogLoader._file_digest(pins_path),
            "service_name": metadata["service_name"], "service_sid": metadata["service_sid"],
            "service_start_account": metadata["service_start_account"],
            "service_start_type": metadata["service_start_type"],
            "service_sid_type": metadata["service_sid_type"],
            "service_delayed_auto_start": metadata["service_delayed_auto_start"],
            "trusted_writer_sids": catalog_input["trusted_writer_sids"],
            "not_before": catalog_input["not_before"], "expires_at": catalog_input["expires_at"],
        }
        canonical = SignedWindowsSecurityPackageCatalogLoader._canonical(payload)
        envelope = {
            "payload": payload, "key_id": key_id,
            "signature": base64.b64encode(private_key.sign(canonical)).decode("ascii"),
        }
        output = root / catalog_filename
        cls._write_new(output, envelope)
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw,
        )
        try:
            verification_time = (float(payload["not_before"]) + float(payload["expires_at"])) / 2
            with tempfile.TemporaryDirectory(prefix="drsai-catalog-verify-") as state:
                return SignedWindowsSecurityPackageCatalogLoader(
                    Path(state) / "verify.sqlite3", root,
                    trusted_release_keys={key_id: public_key},
                    expected_catalog_id=str(payload["catalog_id"]),
                    expected_product=str(payload["product"]), expected_channel=str(payload["channel"]),
                    expected_runtime_build_digest=str(payload["runtime_build_digest"]),
                    minimum_catalog_version=int(payload["version"]), clock=lambda: verification_time,
                ).load(catalog_filename)
        except (TypeError, ValueError) as error:
            output.unlink(missing_ok=True)
            raise WindowsSecurityPackageCatalogError(
                "windows_package_catalog_input_invalid", "Catalog validity or version is invalid.",
            ) from error
        except BaseException:
            output.unlink(missing_ok=True)
            raise
