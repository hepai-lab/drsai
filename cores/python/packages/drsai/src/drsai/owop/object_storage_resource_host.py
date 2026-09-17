"""Tenant-scoped object-storage ResourceHost for Web/DocMaster deployments."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol

from drsai.owop.resource_service import HostResourceVersion, ResourceServiceError


class _ClosingSQLiteConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class ObjectBlobStoreSPI(Protocol):
    def put(self, object_key: str, content: bytes) -> None: ...
    def get(self, object_key: str) -> bytes: ...
    def delete(self, object_key: str) -> None: ...


class ObjectStorageResourceHost:
    """Durable metadata index over an opaque object/blob store.

    Object keys are random internal locators. They never appear in descriptors,
    audit payloads, OAEP, or action errors.
    """

    is_local = False

    def __init__(
        self,
        database: Path,
        blobs: ObjectBlobStoreSPI,
        *,
        tenant_quota_bytes: int = 10 * 1024 * 1024 * 1024,
        object_limit_bytes: int = 2 * 1024 * 1024 * 1024,
        audit: Callable[[Mapping[str, Any]], None] | None = None,
    ) -> None:
        if tenant_quota_bytes < 1 or object_limit_bytes < 1:
            raise ValueError("object_resource_quota_invalid")
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.blobs = blobs
        self.tenant_quota_bytes = tenant_quota_bytes
        self.object_limit_bytes = object_limit_bytes
        self.audit = audit
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS object_resource_versions (
                  tenant_id TEXT NOT NULL, handle TEXT NOT NULL, version_id TEXT NOT NULL,
                  object_key TEXT NOT NULL, object_identity TEXT NOT NULL, digest TEXT NOT NULL,
                  size INTEGER NOT NULL, mime_type TEXT, modified_at TEXT NOT NULL,
                  display_name TEXT NOT NULL, logical_path TEXT, current INTEGER NOT NULL,
                  PRIMARY KEY (tenant_id, handle, version_id)
                );
                CREATE INDEX IF NOT EXISTS object_resource_current
                  ON object_resource_versions(tenant_id, handle, current);
            """)

    def publish(self, tenant_id: str, handle: str, content: bytes, *, display_name: str,
                mime_type: str | None = None, logical_path: str | None = None) -> HostResourceVersion:
        self._identity(tenant_id, handle)
        data = bytes(content)
        if len(data) > self.object_limit_bytes:
            raise ResourceServiceError("resource_too_large")
        with self._connect() as db:
            used = int(db.execute("SELECT COALESCE(SUM(size), 0) FROM object_resource_versions WHERE tenant_id=?", (tenant_id,)).fetchone()[0])
            if used + len(data) > self.tenant_quota_bytes:
                raise ResourceServiceError("resource_quota_exceeded")
            previous = db.execute(
                "SELECT object_identity FROM object_resource_versions WHERE tenant_id=? AND handle=? ORDER BY current DESC LIMIT 1",
                (tenant_id, handle),
            ).fetchone()
            version_id = f"version-{uuid.uuid4().hex}"
            object_key = f"objects/{secrets.token_urlsafe(32)}"
            version = HostResourceVersion(
                version_id=version_id,
                digest=f"sha256:{hashlib.sha256(data).hexdigest()}",
                size=len(data), mime_type=mime_type,
                modified_at=str(time.time()),
                object_identity=str(previous[0]) if previous else f"object-{uuid.uuid4().hex}",
                display_name=display_name[:512], logical_path=logical_path,
            )
            self.blobs.put(object_key, data)
            try:
                db.execute("UPDATE object_resource_versions SET current=0 WHERE tenant_id=? AND handle=?", (tenant_id, handle))
                db.execute(
                    "INSERT INTO object_resource_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,1)",
                    (tenant_id, handle, version.version_id, object_key, version.object_identity,
                     version.digest, version.size, version.mime_type, version.modified_at,
                     version.display_name, version.logical_path),
                )
            except Exception:
                self.blobs.delete(object_key)
                raise
        self._audit("publish", tenant_id, handle, version.version_id, "success")
        return version

    def describe(self, tenant_id: str, handle: str) -> HostResourceVersion:
        row = self._row(tenant_id, handle, current=True)
        return self._version(row)

    def read_version(self, tenant_id: str, handle: str, version_id: str) -> bytes:
        row = self._row(tenant_id, handle, version_id=version_id)
        try:
            content = self.blobs.get(str(row[3]))
        except Exception as exc:
            self._audit("read", tenant_id, handle, version_id, "not_found")
            raise ResourceServiceError("resource_not_found") from exc
        if len(content) != int(row[6]) or f"sha256:{hashlib.sha256(content).hexdigest()}" != row[5]:
            self._audit("read", tenant_id, handle, version_id, "integrity_mismatch")
            raise ResourceServiceError("integrity_mismatch")
        self._audit("read", tenant_id, handle, version_id, "success")
        return content

    def capabilities(self, tenant_id: str, handle: str) -> Mapping[str, bool]:
        version = self.describe(tenant_id, handle)
        return {
            "read_current": True, "read_snapshot": True,
            # Rich document conversion is deliberately unavailable until a
            # CPU/memory/page-limited isolated converter is configured.
            "preview": version.mime_type in {"text/plain", "text/markdown", "application/json"},
            "download": True, "reveal": False, "open_external": False, "copy_logical_path": False,
        }

    def internal_object_key(self, tenant_id: str, handle: str, version_id: str) -> str:
        """Internal hand-off for the download endpoint; never serialize this value."""
        return str(self._row(tenant_id, handle, version_id=version_id)[3])

    def _row(self, tenant_id: str, handle: str, *, version_id: str | None = None, current: bool = False) -> sqlite3.Row:
        self._identity(tenant_id, handle)
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM object_resource_versions WHERE tenant_id=? AND handle=? AND " + ("current=1" if current else "version_id=?"),
                (tenant_id, handle) if current else (tenant_id, handle, version_id),
            ).fetchone()
        if row is None:
            raise ResourceServiceError("resource_not_found")
        return row

    @staticmethod
    def _version(row: sqlite3.Row) -> HostResourceVersion:
        return HostResourceVersion(str(row[2]), str(row[5]), int(row[6]), row[7], str(row[8]), str(row[4]), str(row[9]), row[10])

    @staticmethod
    def _identity(tenant_id: str, handle: str) -> None:
        if not tenant_id or not handle or len(tenant_id) > 256 or len(handle) > 512:
            raise ResourceServiceError("resource_not_found")

    def _audit(self, action: str, tenant_id: str, handle: str, version_id: str, result: str) -> None:
        if self.audit:
            self.audit({"action": action, "tenant_hash": hashlib.sha256(tenant_id.encode()).hexdigest(),
                        "resource_hash": hashlib.sha256(handle.encode()).hexdigest(), "version_id": version_id, "result": result})

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, factory=_ClosingSQLiteConnection)
        db.row_factory = sqlite3.Row
        return db


class TemporaryResourceUrlService:
    """Issues server-side, short-lived, principal/version-bound opaque tickets.

    The URL contains only a random handle.  Identity, ResourceKey, version and
    optional endpoint state remain in the server-side ticket table, so a URL
    cannot be decoded into tenant or object metadata.
    """

    MAX_TTL_SECONDS = 300

    def __init__(self, secret: bytes, *, base_path: str = "/v1/resources/download", clock: Callable[[], float] = time.time) -> None:
        if len(secret) < 32:
            raise ValueError("temporary_resource_url_secret_too_short")
        self.secret, self.base_path, self.clock = bytes(secret), base_path.rstrip("/"), clock
        self._tickets: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def issue(self, *, tenant_id: str, principal_id: str, resource_id: str, version_id: str,
              ttl_seconds: int = 300, metadata: Mapping[str, Any] | None = None) -> str:
        if ttl_seconds not in range(1, self.MAX_TTL_SECONDS + 1) or not all((tenant_id, principal_id, resource_id, version_id)):
            raise ResourceServiceError("resource_download_url_invalid")
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._purge_expired_locked()
            self._tickets[token] = {
                "tenant": tenant_id, "principal": principal_id, "resource": resource_id,
                "version": version_id, "exp": int(self.clock()) + ttl_seconds,
                "metadata": dict(metadata or {}),
            }
        return f"{self.base_path}/{token}"

    def consume(self, url: str, *, tenant_id: str, principal_id: str, resource_id: str, version_id: str) -> Mapping[str, Any]:
        payload = self.consume_bound(url, tenant_id=tenant_id, principal_id=principal_id)
        if payload.get("resource_id") != resource_id or payload.get("version_id") != version_id:
            raise ResourceServiceError("resource_not_found")
        return payload

    def consume_bound(self, url: str, *, tenant_id: str, principal_id: str) -> Mapping[str, Any]:
        """Redeem an opaque endpoint ticket without client-supplied resource IDs."""
        token = url.rsplit("/", 1)[-1]
        with self._lock:
            payload = self._tickets.get(token)
            if (payload is None or int(payload.get("exp", 0)) <= int(self.clock()) or
                any(payload.get(key) != value for key, value in {
                    "tenant": tenant_id, "principal": principal_id,
                }.items())):
                raise ResourceServiceError("resource_not_found")
            self._tickets.pop(token, None)
        return {"resource_id": payload["resource"], "version_id": payload["version"], **dict(payload["metadata"])}

    def revoke(self, url: str) -> None:
        token = url.rsplit("/", 1)[-1]
        with self._lock:
            self._tickets.pop(token, None)

    def _purge_expired_locked(self) -> None:
        now = int(self.clock())
        for token, ticket in tuple(self._tickets.items()):
            if int(ticket["exp"]) <= now:
                self._tickets.pop(token, None)
