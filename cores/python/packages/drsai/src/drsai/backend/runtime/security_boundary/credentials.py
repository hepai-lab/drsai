"""Purpose/target-bound, short-lived credential leases.

Secrets are resolved only after an atomic lease consumption and are never
persisted in the Runtime database or security journal.
"""

from __future__ import annotations

import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .models import ResolvedCapabilityProfile, canonical_digest


class CredentialBrokerError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


CredentialResolver = Callable[[str], str | bytes | None]
_PURPOSE = re.compile(r"^[a-z][a-z0-9_.-]{2,127}$")


def normalize_credential_target(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise CredentialBrokerError(
            "credential_target_invalid", "Credential targets must be HTTPS origins without embedded identity.",
        )
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise CredentialBrokerError("credential_target_invalid", "Credential target must be an origin, not a URL path.")
    try:
        port = parsed.port or 443
    except ValueError as error:
        raise CredentialBrokerError("credential_target_invalid", "Credential target port is invalid.") from error
    host = parsed.hostname.rstrip(".").lower()
    authority_host = f"[{host}]" if ":" in host else host
    return f"https://{authority_host}:{port}"


@dataclass(frozen=True)
class CredentialLease:
    lease_id: str
    run_id: str
    credential_ref: str
    credential_ref_digest: str
    profile_digest: str
    purpose: str
    target: str
    expires_at: float
    remaining_uses: int
    status: str


class CredentialMaterial:
    """Best-effort zeroizable secret buffer; callers must close promptly."""

    def __init__(self, value: str | bytes):
        encoded = value.encode("utf-8") if isinstance(value, str) else bytes(value)
        if not encoded:
            raise CredentialBrokerError("credential_empty", "Credential resolver returned an empty secret.")
        self._buffer = bytearray(encoded)
        self._closed = False

    def read(self) -> bytes:
        if self._closed:
            raise CredentialBrokerError("credential_material_closed", "Credential material was already cleared.")
        return bytes(self._buffer)

    def close(self) -> None:
        for index in range(len(self._buffer)):
            self._buffer[index] = 0
        self._closed = True

    def __enter__(self) -> "CredentialMaterial":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class CredentialBroker:
    MAX_TTL_SECONDS = 900
    MAX_USES = 10

    def __init__(self, database: Path, resolver: CredentialResolver):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.resolver = resolver
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_credential_leases(
                    lease_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    credential_ref TEXT NOT NULL,
                    credential_ref_digest TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    purpose TEXT NOT NULL,
                    target TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    remaining_uses INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active','consumed','expired','revoked')),
                    created_at REAL NOT NULL,
                    consumed_at REAL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_credential_leases_identity_immutable
                BEFORE UPDATE OF lease_id,run_id,credential_ref,credential_ref_digest,profile_digest,purpose,target,expires_at,created_at
                ON runtime_credential_leases BEGIN SELECT RAISE(ABORT, 'credential lease identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_credential_leases_no_delete
                BEFORE DELETE ON runtime_credential_leases BEGIN SELECT RAISE(ABORT, 'credential lease is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row) -> CredentialLease:
        return CredentialLease(
            lease_id=str(row["lease_id"]),
            run_id=str(row["run_id"]),
            credential_ref=str(row["credential_ref"]),
            credential_ref_digest=str(row["credential_ref_digest"]),
            profile_digest=str(row["profile_digest"]),
            purpose=str(row["purpose"]),
            target=str(row["target"]),
            expires_at=float(row["expires_at"]),
            remaining_uses=int(row["remaining_uses"]),
            status=str(row["status"]),
        )

    def get(self, lease_id: str) -> CredentialLease:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_credential_leases WHERE lease_id=?", (lease_id,)).fetchone()
        if row is None:
            raise CredentialBrokerError("credential_lease_missing", "Credential lease does not exist.")
        return self._from_row(row)

    def issue(
        self,
        *,
        run_id: str,
        profile: ResolvedCapabilityProfile,
        credential_ref: str,
        purpose: str,
        target: str,
        ttl_seconds: float = 300,
        max_uses: int = 1,
        now: float | None = None,
    ) -> CredentialLease:
        issued_at = float(time.time() if now is None else now)
        if not run_id or credential_ref not in profile.credential_refs:
            raise CredentialBrokerError("credential_not_permitted", "Credential reference is outside the active profile.")
        if not _PURPOSE.fullmatch(purpose):
            raise CredentialBrokerError("credential_purpose_invalid", "Credential purpose is invalid.")
        normalized_target = normalize_credential_target(target)
        allowed_targets = {normalize_credential_target(rule) for rule in profile.network_rules}
        if normalized_target not in allowed_targets:
            raise CredentialBrokerError("credential_target_not_permitted", "Credential target is outside the active profile.")
        if ttl_seconds <= 0 or ttl_seconds > self.MAX_TTL_SECONDS:
            raise CredentialBrokerError("credential_ttl_invalid", "Credential TTL is outside the allowed range.")
        if max_uses < 1 or max_uses > self.MAX_USES:
            raise CredentialBrokerError("credential_uses_invalid", "Credential lease use count is outside the allowed range.")
        lease_id = f"credential-lease-{uuid.uuid4()}"
        ref_digest = canonical_digest({"credential_ref": credential_ref})
        expires_at = issued_at + ttl_seconds
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO runtime_credential_leases VALUES(?,?,?,?,?,?,?,?,?,'active',?,NULL)",
                (
                    lease_id, run_id, credential_ref, ref_digest, profile.digest,
                    purpose, normalized_target, expires_at, max_uses, issued_at,
                ),
            )
            self.audit.append_in_transaction(db, "credential.lease_issued", lease_id, {
                "run_id": run_id,
                "credential_ref_digest": ref_digest,
                "profile_digest": profile.digest,
                "purpose": purpose,
                "target": normalized_target,
                "expires_at": expires_at,
                "max_uses": max_uses,
            }, now=issued_at)
            db.commit()
        return self.get(lease_id)

    def consume(
        self,
        lease_id: str,
        *,
        run_id: str,
        profile: ResolvedCapabilityProfile,
        purpose: str,
        target: str,
        now: float | None = None,
    ) -> CredentialMaterial:
        consumed_at = float(time.time() if now is None else now)
        normalized_target = normalize_credential_target(target)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_credential_leases WHERE lease_id=?", (lease_id,)).fetchone()
            if row is None:
                db.rollback()
                raise CredentialBrokerError("credential_lease_missing", "Credential lease does not exist.")
            lease = self._from_row(row)
            expected = (run_id, profile.digest, purpose, normalized_target)
            actual = (lease.run_id, lease.profile_digest, lease.purpose, lease.target)
            if actual != expected or lease.credential_ref not in profile.credential_refs:
                db.rollback()
                raise CredentialBrokerError("credential_lease_scope_mismatch", "Credential lease scope does not match.")
            if lease.expires_at <= consumed_at:
                db.execute(
                    "UPDATE runtime_credential_leases SET status='expired' WHERE lease_id=? AND status='active'",
                    (lease_id,),
                )
                self.audit.append_in_transaction(db, "credential.lease_expired", lease_id, {
                    "run_id": run_id, "credential_ref_digest": lease.credential_ref_digest,
                }, now=consumed_at)
                db.commit()
                raise CredentialBrokerError("credential_lease_expired", "Credential lease expired.")
            if lease.status != "active" or lease.remaining_uses < 1:
                db.rollback()
                raise CredentialBrokerError("credential_lease_consumed", "Credential lease is not active.")
            remaining = lease.remaining_uses - 1
            status = "consumed" if remaining == 0 else "active"
            changed = db.execute(
                "UPDATE runtime_credential_leases SET remaining_uses=?,status=?,consumed_at=? "
                "WHERE lease_id=? AND status='active' AND remaining_uses=?",
                (remaining, status, consumed_at, lease_id, lease.remaining_uses),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise CredentialBrokerError("credential_lease_consumed", "Credential lease was consumed concurrently.")
            self.audit.append_in_transaction(db, "credential.lease_consumed", lease_id, {
                "run_id": run_id,
                "credential_ref_digest": lease.credential_ref_digest,
                "purpose": purpose,
                "target": normalized_target,
                "remaining_uses": remaining,
            }, now=consumed_at)
            db.commit()
        resolved = self.resolver(lease.credential_ref)
        if resolved is None:
            raise CredentialBrokerError("credential_unavailable", "Credential could not be resolved.")
        return CredentialMaterial(resolved)

    def revoke(self, lease_id: str, *, now: float | None = None) -> CredentialLease:
        revoked_at = float(time.time() if now is None else now)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_credential_leases SET status='revoked',remaining_uses=0 WHERE lease_id=? AND status='active'",
                (lease_id,),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise CredentialBrokerError("credential_lease_not_active", "Credential lease is not active.")
            self.audit.append_in_transaction(db, "credential.lease_revoked", lease_id, {}, now=revoked_at)
            db.commit()
        return self.get(lease_id)
