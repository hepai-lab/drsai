"""OWOP resources.v2 reference service and production ResourceHost SPI.

The service owns identity, authorization, version binding, safe errors, audit,
download sessions and subscriptions.  A host owns bytes and private locators;
physical paths never cross this boundary in descriptors or audit records.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol

from drsai.owop.protocol import OWOPError


CAPABILITY_NAMES = (
    "read_current", "read_snapshot", "preview", "download",
    "reveal", "open_external", "copy_logical_path",
)
SAFE_STATES = frozenset(("available", "moved", "changed", "deleted", "offline", "unsupported"))


class _ClosingSQLiteConnection(sqlite3.Connection):
    """Commit/rollback like sqlite3.Connection, then release the OS handle."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def conversation_resource_state_semantics(
    state: str, capabilities: Mapping[str, Any], *, has_observed_version: bool,
) -> dict[str, Any]:
    """Host-neutral UI semantics; invalid capabilities fail closed."""
    exact = set(capabilities) == set(CAPABILITY_NAMES) and all(type(capabilities[name]) is bool for name in CAPABILITY_NAMES)
    status = state if state in SAFE_STATES and exact else "unsupported"
    capability = lambda name: status != "unsupported" and capabilities.get(name) is True
    if status == "offline":
        return {"status": status, "primary": "details", "secondary": [], "recovery": ["retry", "switch_runtime"]}
    if status == "unsupported":
        return {"status": status, "primary": "details", "secondary": [], "recovery": []}
    observed = has_observed_version and capability("read_snapshot") and capability("preview")
    current = status != "deleted" and capability("read_current")
    primary = (
        "preview_current" if current and capability("preview") else
        "reveal_current" if current and capability("reveal") else
        "preview_observed" if observed else "details"
    )
    secondary: list[str] = []
    if observed and primary != "preview_observed": secondary.append("preview_observed")
    if capability("download"): secondary.append("download")
    if current and capability("copy_logical_path"): secondary.append("copy_logical_path")
    return {"status": status, "primary": primary, "secondary": secondary, "recovery": []}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


@dataclass(frozen=True)
class ResourceAccessContext:
    tenant_id: str
    principal_id: str
    session_id: str
    authority_id: str
    workspace_id: str
    correlation_id: str

    def __post_init__(self) -> None:
        if not all((
            self.tenant_id, self.principal_id, self.session_id,
            self.authority_id, self.workspace_id, self.correlation_id,
        )):
            raise ValueError("resource_access_context_incomplete")


@dataclass(frozen=True)
class HostResourceVersion:
    version_id: str
    digest: str
    size: int
    mime_type: str | None
    modified_at: str
    object_identity: str
    display_name: str
    logical_path: str | None


class ResourceHostSPI(Protocol):
    """Tenant-scoped byte store contract; implementations may use object storage."""

    is_local: bool

    def describe(self, tenant_id: str, handle: str) -> HostResourceVersion: ...

    def read_version(self, tenant_id: str, handle: str, version_id: str) -> bytes: ...

    def capabilities(self, tenant_id: str, handle: str) -> Mapping[str, bool]: ...


class ResourceServiceError(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = False, retry_after_ms: int | None = None):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.retry_after_ms = retry_after_ms

    def safe_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "retryable": self.retryable,
            **({"retry_after_ms": self.retry_after_ms} if self.retry_after_ms is not None else {}),
        }


class InMemoryObjectResourceHost:
    """Object-store emulator used by ResourceHost conformance suites."""

    is_local = False

    def __init__(self) -> None:
        self._objects: dict[tuple[str, str], dict[str, Any]] = {}

    def publish(
        self,
        tenant_id: str,
        handle: str,
        data: bytes,
        *,
        display_name: str,
        mime_type: str | None = None,
        logical_path: str | None = None,
        object_identity: str | None = None,
    ) -> HostResourceVersion:
        key = (tenant_id, handle)
        record = self._objects.setdefault(key, {"versions": {}, "capabilities": {}})
        version_id = f"version-{uuid.uuid4().hex}"
        version = HostResourceVersion(
            version_id=version_id,
            digest=_digest(data),
            size=len(data),
            mime_type=mime_type,
            modified_at=_now(),
            object_identity=object_identity or str(record.get("object_identity") or f"object-{uuid.uuid4().hex}"),
            display_name=display_name,
            logical_path=logical_path,
        )
        record["versions"][version_id] = bytes(data)
        record["current"] = version
        record["object_identity"] = version.object_identity
        record["capabilities"] = {
            "read_current": True,
            "read_snapshot": True,
            "preview": bool((mime_type or "").startswith("text/") or mime_type in {"application/json", "application/pdf"}),
            "download": True,
            "reveal": False,
            "open_external": False,
            "copy_logical_path": logical_path is not None,
        }
        return version

    def describe(self, tenant_id: str, handle: str) -> HostResourceVersion:
        try:
            return self._objects[(tenant_id, handle)]["current"]
        except KeyError as exc:
            raise ResourceServiceError("resource_not_found") from exc

    def read_version(self, tenant_id: str, handle: str, version_id: str) -> bytes:
        try:
            return bytes(self._objects[(tenant_id, handle)]["versions"][version_id])
        except KeyError as exc:
            raise ResourceServiceError("resource_not_found") from exc

    def capabilities(self, tenant_id: str, handle: str) -> Mapping[str, bool]:
        try:
            return dict(self._objects[(tenant_id, handle)]["capabilities"])
        except KeyError as exc:
            raise ResourceServiceError("resource_not_found") from exc

    def remove(self, tenant_id: str, handle: str) -> None:
        self._objects.pop((tenant_id, handle), None)


AuthorizationPolicy = Callable[[ResourceAccessContext, str, Mapping[str, Any] | None], bool]
AuditSink = Callable[[Mapping[str, Any]], None]
AuditBatchSink = Callable[[list[Mapping[str, Any]]], None]
ContextProvider = Callable[[], ResourceAccessContext]


class ResourceService:
    MAX_BATCH = 100
    MAX_READ = 8 * 1024 * 1024
    MAX_PREVIEW = 1024 * 1024
    DOWNLOAD_TTL_SECONDS = 300

    def __init__(
        self,
        database: Path,
        host: ResourceHostSPI,
        *,
        authorize: AuthorizationPolicy,
        audit_salt: bytes,
        audit_sink: AuditSink | None = None,
        audit_batch_sink: AuditBatchSink | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if not audit_salt:
            raise ValueError("resource_audit_salt_required")
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.host = host
        self.authorize = authorize
        self.audit_salt = bytes(audit_salt)
        self.audit_sink = audit_sink
        self.audit_batch_sink = audit_batch_sink
        self.clock = clock
        self._lock = threading.RLock()
        self._downloads: dict[str, dict[str, Any]] = {}
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS owop_resources_v2 (
                  tenant_id TEXT NOT NULL,
                  authority_id TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  resource_type TEXT NOT NULL,
                  resource_id TEXT NOT NULL,
                  generation INTEGER NOT NULL,
                  host_handle TEXT NOT NULL,
                  object_identity TEXT NOT NULL,
                  display_name TEXT NOT NULL,
                  logical_path TEXT,
                  state TEXT NOT NULL,
                  current_version_id TEXT NOT NULL,
                  immutable INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(authority_id, workspace_id, resource_type, resource_id, generation)
                );
                CREATE INDEX IF NOT EXISTS owop_resources_v2_lookup
                  ON owop_resources_v2(authority_id, workspace_id, resource_type, resource_id, generation);
                CREATE INDEX IF NOT EXISTS owop_resources_v2_logical
                  ON owop_resources_v2(tenant_id, authority_id, workspace_id, resource_type, logical_path, generation);
                CREATE TABLE IF NOT EXISTS owop_resource_versions_v2 (
                  authority_id TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  resource_type TEXT NOT NULL,
                  resource_id TEXT NOT NULL,
                  generation INTEGER NOT NULL,
                  version_id TEXT NOT NULL,
                  digest TEXT NOT NULL,
                  size INTEGER NOT NULL,
                  mime_type TEXT,
                  modified_at TEXT NOT NULL,
                  PRIMARY KEY(authority_id, workspace_id, resource_type, resource_id, generation, version_id)
                );
                CREATE TABLE IF NOT EXISTS owop_resource_idempotency_v2 (
                  tenant_id TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  session_id TEXT NOT NULL,
                  idempotency_key TEXT NOT NULL,
                  resource_key_json TEXT NOT NULL,
                  PRIMARY KEY(tenant_id, workspace_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS owop_resource_session_grants_v2 (
                  tenant_id TEXT NOT NULL,
                  authority_id TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  resource_type TEXT NOT NULL,
                  resource_id TEXT NOT NULL,
                  generation INTEGER NOT NULL,
                  session_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(tenant_id, authority_id, workspace_id, resource_type, resource_id, generation, session_id)
                );
                CREATE TABLE IF NOT EXISTS owop_resource_events_v2 (
                  workspace_id TEXT NOT NULL,
                  sequence INTEGER NOT NULL,
                  event_id TEXT NOT NULL,
                  dedupe_key TEXT NOT NULL,
                  resource_id TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  data_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(workspace_id, sequence),
                  UNIQUE(workspace_id, dedupe_key)
                );
                """
            )
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(owop_resource_idempotency_v2)")}
            if "session_id" not in columns:
                db.execute("ALTER TABLE owop_resource_idempotency_v2 ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=_ClosingSQLiteConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def _resource_hash(self, key: Mapping[str, Any] | None) -> str | None:
        if key is None:
            return None
        canonical = json.dumps(dict(key), sort_keys=True, separators=(",", ":")).encode()
        return hmac.new(self.audit_salt, canonical, hashlib.sha256).hexdigest()

    def _audit(
        self,
        context: ResourceAccessContext,
        action: str,
        key: Mapping[str, Any] | None,
        result_code: str,
        *,
        version_id: str | None = None,
    ) -> None:
        if self.audit_sink is not None:
            self.audit_sink(self._audit_payload(
                context, action, key, result_code, version_id=version_id,
            ))

    def _audit_payload(
        self,
        context: ResourceAccessContext,
        action: str,
        key: Mapping[str, Any] | None,
        result_code: str,
        *,
        version_id: str | None = None,
    ) -> dict[str, Any]:
        return {
            "tenant_id": context.tenant_id,
            "principal_id": context.principal_id,
            "session_id": context.session_id,
            "authority_id": context.authority_id,
            "workspace_id": context.workspace_id,
            "resource_hash": self._resource_hash(key),
            "action": action,
            "version_id": version_id,
            "result_code": result_code,
            "correlation_id": context.correlation_id,
            "timestamp": _now(),
        }

    def _authorize(
        self,
        context: ResourceAccessContext,
        action: str,
        key: Mapping[str, Any] | None,
        *,
        db: sqlite3.Connection | None = None,
    ) -> None:
        scope_allowed = key is None or (
            key.get("authority_id") == context.authority_id
            and key.get("workspace_id") == context.workspace_id
        )
        policy_allowed = self.authorize(context, action, key)
        if key is not None:
            try:
                values = (
                    context.tenant_id, key["authority_id"], key["workspace_id"], key["resource_type"],
                    key["resource_id"], key["generation"], context.session_id,
                )
                key_valid = True
            except (KeyError, TypeError):
                # Keep malformed, cross-scope, unauthorized and unknown keys on
                # the same indexed grant lookup path to avoid an existence
                # timing oracle. Dummy values can never match a real grant.
                values = (
                    context.tenant_id, "invalid", context.workspace_id,
                    "invalid", "invalid", -1, context.session_id,
                )
                key_valid = False
            if db is None:
                with self._connect() as grant_db:
                    granted = grant_db.execute(
                        "SELECT 1 FROM owop_resource_session_grants_v2 WHERE tenant_id=? AND authority_id=? "
                        "AND workspace_id=? AND resource_type=? AND resource_id=? AND generation=? AND session_id=?",
                        values,
                    ).fetchone()
            else:
                granted = db.execute(
                    "SELECT 1 FROM owop_resource_session_grants_v2 WHERE tenant_id=? AND authority_id=? "
                    "AND workspace_id=? AND resource_type=? AND resource_id=? AND generation=? AND session_id=?",
                    values,
                ).fetchone()
            if not scope_allowed or not policy_allowed or not key_valid or granted is None:
                self._audit(context, action, key, "resource_not_found")
                raise ResourceServiceError("resource_not_found")
        elif not scope_allowed or not policy_allowed:
            self._audit(context, action, key, "resource_not_found")
            raise ResourceServiceError("resource_not_found")

    @staticmethod
    def _grant(db: sqlite3.Connection, context: ResourceAccessContext, key: Mapping[str, Any]) -> None:
        db.execute(
            "INSERT OR IGNORE INTO owop_resource_session_grants_v2 VALUES(?,?,?,?,?,?,?,?)",
            (context.tenant_id, key["authority_id"], key["workspace_id"], key["resource_type"],
             key["resource_id"], key["generation"], context.session_id, _now()),
        )

    @staticmethod
    def _key(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "protocol": "owop/1",
            "authority_id": row["authority_id"],
            "workspace_id": row["workspace_id"],
            "resource_type": row["resource_type"],
            "resource_id": row["resource_id"],
            "generation": int(row["generation"]),
        }

    @staticmethod
    def _version(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "version_id": row["version_id"], "digest": row["digest"],
            "size": int(row["size"]), "mime_type": row["mime_type"],
            "modified_at": row["modified_at"],
        }

    def _row(self, db: sqlite3.Connection, key: Mapping[str, Any], tenant_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT * FROM owop_resources_v2 WHERE tenant_id=? AND authority_id=? AND workspace_id=? "
            "AND resource_type=? AND resource_id=? AND generation=?",
            (tenant_id, key["authority_id"], key["workspace_id"], key["resource_type"], key["resource_id"], key["generation"]),
        ).fetchone()
        if row is None:
            raise ResourceServiceError("resource_not_found")
        return row

    def _version_row(self, db: sqlite3.Connection, key: Mapping[str, Any], version_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT * FROM owop_resource_versions_v2 WHERE authority_id=? AND workspace_id=? "
            "AND resource_type=? AND resource_id=? AND generation=? AND version_id=?",
            (key["authority_id"], key["workspace_id"], key["resource_type"], key["resource_id"], key["generation"], version_id),
        ).fetchone()
        if row is None:
            raise ResourceServiceError("resource_version_conflict")
        return row

    def _event(self, db: sqlite3.Connection, row: Mapping[str, Any], event_type: str, *, dedupe_key: str) -> None:
        sequence = int(db.execute(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM owop_resource_events_v2 WHERE workspace_id=?",
            (row["workspace_id"],),
        ).fetchone()[0])
        data = {"resource": self._key(row), "state": row["state"], "version_id": row["current_version_id"]}
        db.execute(
            "INSERT OR IGNORE INTO owop_resource_events_v2 VALUES(?,?,?,?,?,?,?,?)",
            (row["workspace_id"], sequence, f"resource-event-{uuid.uuid4().hex}", dedupe_key,
             row["resource_id"], event_type, json.dumps(data, sort_keys=True, separators=(",", ":")), _now()),
        )

    def register(
        self,
        context: ResourceAccessContext,
        *,
        host_handle: str,
        resource_type: str,
        idempotency_key: str,
        immutable: bool = False,
        continuity: str = "auto",
        resource_id_hint: str | None = None,
    ) -> dict[str, Any]:
        self._authorize(context, "register", None)
        if resource_type not in {"file", "artifact"} or continuity not in {"auto", "continuous", "new_object"}:
            raise ResourceServiceError("unsupported")
        if resource_id_hint is not None and (
            not resource_id_hint or len(resource_id_hint) > 256
            or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-" for character in resource_id_hint)
        ):
            raise ResourceServiceError("unsupported")
        with self._lock, self._connect() as db:
            existing_idempotent = db.execute(
                "SELECT resource_key_json,session_id FROM owop_resource_idempotency_v2 WHERE tenant_id=? AND workspace_id=? AND idempotency_key=?",
                (context.tenant_id, context.workspace_id, idempotency_key),
            ).fetchone()
            if existing_idempotent is not None:
                if existing_idempotent["session_id"] != context.session_id:
                    raise ResourceServiceError("resource_not_found")
                key = json.loads(existing_idempotent[0])
                row = self._row(db, key, context.tenant_id)
                version = self._version_row(db, key, row["current_version_id"])
                self._grant(db, context, key)
                db.commit()
                return {"resource": key, "version": self._version(version)}
            host_version = self.host.describe(context.tenant_id, host_handle)
            if (
                not host_version.display_name or len(host_version.display_name) > 512
                or any(ord(character) < 32 for character in host_version.display_name)
                or host_version.mime_type is not None and (
                    len(host_version.mime_type) > 256
                    or any(ord(character) < 32 for character in host_version.mime_type)
                )
                or host_version.logical_path is not None and (
                    not host_version.logical_path or len(host_version.logical_path) > 4096
                    or host_version.logical_path.startswith(("/", "\\"))
                    or len(host_version.logical_path) >= 2 and host_version.logical_path[1] == ":"
                    or ".." in host_version.logical_path.replace("\\", "/").split("/")
                    or any(ord(character) < 32 for character in host_version.logical_path)
                )
            ):
                raise ResourceServiceError("unsupported")
            previous = db.execute(
                "SELECT * FROM owop_resources_v2 WHERE tenant_id=? AND authority_id=? AND workspace_id=? "
                "AND resource_type=? AND logical_path IS ? ORDER BY generation DESC LIMIT 1",
                (context.tenant_id, context.authority_id, context.workspace_id, resource_type, host_version.logical_path),
            ).fetchone()
            same_object = previous is not None and previous["object_identity"] == host_version.object_identity
            continuous = previous is not None and previous["state"] != "deleted" and (
                same_object or continuity == "continuous"
            ) and continuity != "new_object"
            now = _now()
            if continuous:
                if bool(previous["immutable"]) and previous["current_version_id"] != host_version.version_id:
                    raise ResourceServiceError("resource_version_conflict")
                resource_id = previous["resource_id"]
                generation = int(previous["generation"])
                db.execute(
                    "UPDATE owop_resources_v2 SET host_handle=?, object_identity=?, display_name=?, logical_path=?, "
                    "state='available', current_version_id=?, updated_at=? WHERE authority_id=? AND workspace_id=? "
                    "AND resource_type=? AND resource_id=? AND generation=?",
                    (host_handle, host_version.object_identity, host_version.display_name, host_version.logical_path,
                     host_version.version_id, now, context.authority_id, context.workspace_id,
                     resource_type, resource_id, generation),
                )
            else:
                if previous is not None and previous["state"] != "deleted":
                    db.execute(
                        "UPDATE owop_resources_v2 SET state='deleted', updated_at=? WHERE authority_id=? AND workspace_id=? "
                        "AND resource_type=? AND resource_id=? AND generation=?",
                        (now, previous["authority_id"], previous["workspace_id"], previous["resource_type"], previous["resource_id"], previous["generation"]),
                    )
                generation = int(previous["generation"]) + 1 if previous is not None else 1
                resource_id = resource_id_hint or f"{resource_type}-{uuid.uuid4().hex}"
                db.execute(
                    "INSERT INTO owop_resources_v2 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (context.tenant_id, context.authority_id, context.workspace_id, resource_type,
                     resource_id, generation, host_handle, host_version.object_identity,
                     host_version.display_name, host_version.logical_path, "available", host_version.version_id,
                     1 if immutable else 0, now, now),
                )
            key = {
                "protocol": "owop/1", "authority_id": context.authority_id,
                "workspace_id": context.workspace_id, "resource_type": resource_type,
                "resource_id": resource_id, "generation": generation,
            }
            db.execute(
                "INSERT OR IGNORE INTO owop_resource_versions_v2 VALUES(?,?,?,?,?,?,?,?,?,?)",
                (context.authority_id, context.workspace_id, resource_type, resource_id, generation,
                 host_version.version_id, host_version.digest, host_version.size,
                 host_version.mime_type, host_version.modified_at),
            )
            db.execute(
                "INSERT INTO owop_resource_idempotency_v2(tenant_id,workspace_id,session_id,idempotency_key,resource_key_json) VALUES(?,?,?,?,?)",
                (context.tenant_id, context.workspace_id, context.session_id, idempotency_key,
                 json.dumps(key, sort_keys=True, separators=(",", ":"))),
            )
            self._grant(db, context, key)
            row = self._row(db, key, context.tenant_id)
            self._event(db, row, "resource.registered", dedupe_key=idempotency_key)
            db.commit()
        self._audit(context, "register", key, "ok", version_id=host_version.version_id)
        return {"resource": key, "version": self._version({
            "version_id": host_version.version_id, "digest": host_version.digest,
            "size": host_version.size, "mime_type": host_version.mime_type,
            "modified_at": host_version.modified_at,
        })}

    def _capabilities(
        self,
        context: ResourceAccessContext,
        row: Mapping[str, Any],
        version: Mapping[str, Any] | None = None,
    ) -> dict[str, bool]:
        try:
            from_version = getattr(self.host, "capabilities_for_version", None)
            if callable(from_version) and version is not None:
                raw = from_version(
                    context.tenant_id, str(row["host_handle"]),
                    str(version["mime_type"] or "") or None,
                )
            else:
                raw = self.host.capabilities(context.tenant_id, str(row["host_handle"]))
        except ResourceServiceError:
            return {name: False for name in CAPABILITY_NAMES}
        if set(raw) != set(CAPABILITY_NAMES) or any(type(raw[name]) is not bool for name in CAPABILITY_NAMES):
            return {name: False for name in CAPABILITY_NAMES}
        capabilities = {name: bool(raw[name]) for name in CAPABILITY_NAMES}
        if not self.host.is_local:
            capabilities["reveal"] = False
            capabilities["open_external"] = False
        if row["state"] == "deleted":
            # A tombstone may still expose an explicitly retained version.
            # Current reads/reveal/open remain disabled; preview/download are
            # allowed only when the Host really retains snapshots.
            retained = capabilities["read_snapshot"]
            preview_snapshot = retained and capabilities["preview"]
            download_snapshot = retained and capabilities["download"]
            capabilities = {name: False for name in CAPABILITY_NAMES}
            capabilities["read_snapshot"] = retained
            capabilities["preview"] = preview_snapshot
            capabilities["download"] = download_snapshot
        elif row["state"] in {"offline", "unsupported"}:
            capabilities = {name: False for name in CAPABILITY_NAMES}
        return capabilities

    def _descriptor(
        self,
        context: ResourceAccessContext,
        row: Mapping[str, Any],
        observed_version_id: str | None,
        *,
        db: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        key = self._key(row)
        if db is None:
            with self._connect() as descriptor_db:
                version = self._version_row(descriptor_db, key, str(row["current_version_id"]))
                observed = self._version_row(descriptor_db, key, observed_version_id) if observed_version_id else None
        else:
            version = self._version_row(db, key, str(row["current_version_id"]))
            observed = self._version_row(db, key, observed_version_id) if observed_version_id else None
        state = str(row["state"])
        if state in {"available", "moved"} and observed_version_id and observed_version_id != row["current_version_id"]:
            state = "changed"
        descriptor = {
            "resource": key,
            "resolution_id": f"resolution-{uuid.uuid4().hex}",
            "state": state if state in SAFE_STATES else "unsupported",
            "display_name": row["display_name"],
            "kind": "artifact" if row["resource_type"] == "artifact" else "file",
            "current_version": self._version(version),
            "capabilities": self._capabilities(context, row, version),
        }
        if row["logical_path"] is not None:
            descriptor["logical_path"] = row["logical_path"]
        if observed is not None:
            descriptor["observed_version"] = self._version(observed)
        return descriptor

    def resolve_batch(
        self,
        context: ResourceAccessContext,
        observations: list[Mapping[str, Any]],
    ) -> dict[str, Any]:
        if not 1 <= len(observations) <= self.MAX_BATCH:
            raise ResourceServiceError("resource_too_large")
        results: list[dict[str, Any]] = []
        success_audits: list[Mapping[str, Any]] = []
        with self._connect() as db:
            for observation in observations:
                key = observation.get("resource")
                association_id = observation.get("association_id")
                requested_action = observation.get("requested_action", "resolve")
                try:
                    if not isinstance(key, Mapping):
                        raise ResourceServiceError("resource_not_found")
                    if requested_action not in {
                        "resolve", "reveal", "open_external", "copy_logical_path", "open_snapshot",
                    }:
                        raise ResourceServiceError("unsupported")
                    self._authorize(context, str(requested_action), key, db=db)
                    row = self._row(db, key, context.tenant_id)
                    descriptor = self._descriptor(
                        context, row, observation.get("observed_version_id"), db=db,
                    )
                    if requested_action != "resolve":
                        capability = "read_snapshot" if requested_action == "open_snapshot" else str(requested_action)
                        if not descriptor["capabilities"].get(capability, False):
                            self._audit(context, str(requested_action), key, "resource_not_found")
                            raise ResourceServiceError("resource_not_found")
                    results.append({"resource": dict(key), "descriptor": descriptor,
                                    **({"association_id": association_id} if association_id else {})})
                    success_audits.append(self._audit_payload(
                        context, str(requested_action), key, "ok", version_id=row["current_version_id"],
                    ))
                except ResourceServiceError as exc:
                    safe_key = dict(key) if isinstance(key, Mapping) else {
                        "protocol": "owop/1", "authority_id": context.authority_id,
                        "workspace_id": context.workspace_id, "resource_type": "file",
                        "resource_id": "unknown", "generation": 1,
                    }
                    results.append({"resource": safe_key, "error": exc.safe_payload(),
                                    **({"association_id": association_id} if association_id else {})})
        if success_audits:
            if self.audit_batch_sink is not None:
                self.audit_batch_sink(success_audits)
            elif self.audit_sink is not None:
                for event in success_audits:
                    self.audit_sink(event)
        return {"results": results}

    def read(
        self,
        context: ResourceAccessContext,
        key: Mapping[str, Any],
        *,
        version_id: str,
        offset: int,
        length: int,
        purpose: str,
    ) -> dict[str, Any]:
        self._authorize(context, "read", key)
        if purpose not in {"preview", "download", "open_snapshot"} or offset < 0 or not 1 <= length <= self.MAX_READ:
            raise ResourceServiceError("unsupported")
        try:
            with self._connect() as db:
                row = self._row(db, key, context.tenant_id)
                version = self._version_row(db, key, version_id)
            if row["state"] == "deleted" and not self._capabilities(context, row)["read_snapshot"]:
                raise ResourceServiceError("resource_not_found")
            data = self.host.read_version(context.tenant_id, row["host_handle"], version_id)
            if len(data) != version["size"] or _digest(data) != version["digest"]:
                raise ResourceServiceError("integrity_mismatch", retryable=True)
            chunk = data[offset:offset + length]
            result = {
                "content_base64": base64.b64encode(chunk).decode("ascii"),
                "offset": offset, "length": len(chunk), "eof": offset + len(chunk) >= len(data),
                "version_id": version_id, "chunk_digest": _digest(chunk),
            }
            self._audit(context, "read", key, "ok", version_id=version_id)
            return result
        except ResourceServiceError as exc:
            self._audit(context, "read", key, exc.code, version_id=version_id)
            raise

    def preview(
        self,
        context: ResourceAccessContext,
        key: Mapping[str, Any],
        *,
        version_id: str,
        accept_kinds: list[str],
        max_bytes: int,
    ) -> dict[str, Any]:
        try:
            self._authorize(context, "preview", key)
            if not 0 <= max_bytes <= self.MAX_PREVIEW or not accept_kinds:
                raise ResourceServiceError("resource_too_large")
            with self._connect() as db:
                row = self._row(db, key, context.tenant_id)
                version = self._version_row(db, key, version_id)
            capabilities = self._capabilities(context, row)
            if not capabilities["preview"] or version["size"] > max_bytes:
                raise ResourceServiceError("preview_unsupported")
            kind = "text" if str(version["mime_type"] or "").startswith("text/") else "binary"
            if kind not in accept_kinds:
                raise ResourceServiceError("preview_unsupported")
            read = self.read(context, key, version_id=version_id, offset=0, length=max(1, int(version["size"])), purpose="preview")
            result = {
                "kind": kind, "version_id": version_id, "mime_type": version["mime_type"],
                "content_base64": read["content_base64"], "digest": version["digest"],
            }
            self._audit(context, "preview", key, "ok", version_id=version_id)
            return result
        except ResourceServiceError as exc:
            self._audit(context, "preview", key, exc.code, version_id=version_id)
            raise

    def download_prepare(
        self,
        context: ResourceAccessContext,
        key: Mapping[str, Any],
        *,
        version_id: str,
        resume_offset: int = 0,
    ) -> dict[str, Any]:
        try:
            self._authorize(context, "download", key)
            with self._connect() as db:
                row = self._row(db, key, context.tenant_id)
                version = self._version_row(db, key, version_id)
            if not self._capabilities(context, row)["download"]:
                raise ResourceServiceError("resource_not_found")
            if resume_offset < 0 or resume_offset > int(version["size"]):
                raise ResourceServiceError("resource_version_conflict")
            # A resumed transfer is a continuation of the current version, not
            # an implicit request for a retained snapshot under a stale token.
            if resume_offset and row["current_version_id"] != version_id:
                raise ResourceServiceError("resource_version_conflict")
            download_id = f"download-{uuid.uuid4().hex}"
            expires = self.clock() + self.DOWNLOAD_TTL_SECONDS
            self._downloads[download_id] = {
                "tenant_id": context.tenant_id, "principal_id": context.principal_id,
                "session_id": context.session_id, "authority_id": context.authority_id,
                "workspace_id": context.workspace_id, "key": dict(key), "version_id": version_id,
                "resume_offset": resume_offset, "expires": expires, "cancelled": False,
            }
            self._audit(context, "download", key, "prepared", version_id=version_id)
            return {
                "download_id": download_id, "version_id": version_id,
                "size": version["size"], "digest": version["digest"],
                "transport": "owop_chunks",
                "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat(),
            }
        except ResourceServiceError as exc:
            self._audit(context, "download", key, exc.code, version_id=version_id)
            raise

    def _download(self, context: ResourceAccessContext, download_id: str) -> dict[str, Any]:
        download = self._downloads.get(download_id)
        expected = (
            context.tenant_id, context.principal_id, context.session_id,
            context.authority_id, context.workspace_id,
        )
        actual = tuple(download.get(name) if download else None for name in (
            "tenant_id", "principal_id", "session_id", "authority_id", "workspace_id",
        ))
        if download is None or actual != expected or download["expires"] <= self.clock():
            raise ResourceServiceError("resource_not_found")
        if download["cancelled"]:
            raise ResourceServiceError("action_cancelled")
        return download

    def download_chunk(
        self,
        context: ResourceAccessContext,
        download_id: str,
        *,
        offset: int,
        length: int,
    ) -> dict[str, Any]:
        download: dict[str, Any] | None = None
        try:
            download = self._download(context, download_id)
            if offset < int(download.get("resume_offset") or 0):
                raise ResourceServiceError("resource_version_conflict")
            result = self.read(
                context, download["key"], version_id=download["version_id"],
                offset=offset, length=length, purpose="download",
            )
            self._audit(context, "download.chunk", download["key"], "ok", version_id=download["version_id"])
            return {"download_id": download_id, **{key: value for key, value in result.items() if key != "version_id"}}
        except ResourceServiceError as exc:
            self._audit(
                context, "download.chunk", download["key"] if download else None, exc.code,
                version_id=download["version_id"] if download else None,
            )
            raise

    def download_cancel(self, context: ResourceAccessContext, download_id: str) -> dict[str, Any]:
        download: dict[str, Any] | None = None
        try:
            download = self._download(context, download_id)
            download["cancelled"] = True
            self._audit(context, "download.cancel", download["key"], "action_cancelled", version_id=download["version_id"])
            return {"cancelled": True}
        except ResourceServiceError as exc:
            self._audit(
                context, "download.cancel", download["key"] if download else None, exc.code,
                version_id=download["version_id"] if download else None,
            )
            raise

    def set_state(
        self,
        context: ResourceAccessContext,
        key: Mapping[str, Any],
        state: str,
        *,
        logical_path: str | None = None,
        dedupe_key: str,
    ) -> None:
        self._authorize(context, "register", key)
        if state not in SAFE_STATES:
            raise ResourceServiceError("unsupported")
        with self._lock, self._connect() as db:
            row = self._row(db, key, context.tenant_id)
            db.execute(
                "UPDATE owop_resources_v2 SET state=?, logical_path=COALESCE(?,logical_path), updated_at=? "
                "WHERE authority_id=? AND workspace_id=? AND resource_type=? AND resource_id=? AND generation=?",
                (state, logical_path, _now(), key["authority_id"], key["workspace_id"], key["resource_type"], key["resource_id"], key["generation"]),
            )
            updated = self._row(db, key, context.tenant_id)
            self._event(db, updated, f"resource.{state}", dedupe_key=dedupe_key)
            db.commit()

    def subscribe(
        self,
        context: ResourceAccessContext,
        *,
        after_sequence: int,
        resource_ids: list[str] | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        self._authorize(context, "subscribe", None)
        if after_sequence < 0 or not 1 <= limit <= 5000 or resource_ids is not None and len(resource_ids) > 100:
            raise ResourceServiceError("unsupported")
        query = (
            "SELECT * FROM owop_resource_events_v2 WHERE workspace_id=? AND sequence>? "
            + (f"AND resource_id IN ({','.join('?' for _ in resource_ids)}) " if resource_ids else "")
            + "ORDER BY sequence LIMIT ?"
        )
        params: list[Any] = [context.workspace_id, after_sequence]
        if resource_ids:
            params.extend(resource_ids)
        params.append(limit)
        with self._connect() as db:
            rows = db.execute(query, params).fetchall()
        events = [{
            "sequence": int(row["sequence"]), "event_id": row["event_id"],
            "dedupe_key": row["dedupe_key"], "type": row["event_type"],
            "data": json.loads(row["data_json"]),
        } for row in rows]
        cursor = events[-1]["sequence"] if events else after_sequence
        self._audit(context, "subscribe", None, "ok")
        return {"subscription_id": f"subscription-{uuid.uuid4().hex}", "cursor": str(cursor), "events": events}


class ResourceServiceOperations:
    """OWOP dispatcher adapter; authentication context stays outside params."""

    def __init__(self, service: ResourceService, context: ContextProvider):
        self.service = service
        self.context = context

    def handlers(self) -> dict[str, Callable[[Mapping[str, Any]], dict[str, Any]]]:
        raw = {
            "resources.register": self.register,
            "resources.resolve_batch": self.resolve_batch,
            "resources.read": self.read,
            "resources.preview": self.preview,
            "resources.download.prepare": self.download_prepare,
            "resources.download.chunk": self.download_chunk,
            "resources.download.cancel": self.download_cancel,
            "resources.subscribe": self.subscribe,
        }
        return {operation: (lambda params, handler=handler: self._safe(handler, params))
                for operation, handler in raw.items()}

    def _safe(
        self,
        handler: Callable[[Mapping[str, Any]], dict[str, Any]],
        params: Mapping[str, Any],
    ) -> dict[str, Any]:
        try:
            return handler(params)
        except ResourceServiceError as exc:
            context = self.context()
            raise OWOPError(
                exc.code,
                "The resource action could not be completed.",
                context.correlation_id,
                retryable=exc.retryable,
                details=({"retry_after_ms": exc.retry_after_ms} if exc.retry_after_ms is not None else {}),
            ) from exc

    def register(self, params: Mapping[str, Any]) -> dict[str, Any]:
        handle = params.get("host_handle") or params.get("logical_path")
        if not isinstance(handle, str) or not handle:
            raise ResourceServiceError("resource_not_found")
        return self.service.register(
            self.context(), host_handle=handle, resource_type=str(params["resource_type"]),
            idempotency_key=str(params["idempotency_key"]),
            immutable=params.get("resource_type") == "artifact",
        )

    def resolve_batch(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.resolve_batch(self.context(), list(params["observations"]))

    def read(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.read(
            self.context(), params["resource"], version_id=str(params["version_id"]),
            offset=int(params["offset"]), length=int(params["length"]), purpose=str(params["purpose"]),
        )

    def preview(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.preview(
            self.context(), params["resource"], version_id=str(params["version_id"]),
            accept_kinds=[str(value) for value in params["accept_kinds"]], max_bytes=int(params["max_bytes"]),
        )

    def download_prepare(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.download_prepare(
            self.context(), params["resource"], version_id=str(params["version_id"]),
            resume_offset=int(params.get("resume_offset", 0)),
        )

    def download_chunk(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.download_chunk(
            self.context(), str(params["download_id"]), offset=int(params["offset"]), length=int(params["length"]),
        )

    def download_cancel(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.download_cancel(self.context(), str(params["download_id"]))

    def subscribe(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.service.subscribe(
            self.context(), after_sequence=int(params["after_sequence"]),
            resource_ids=[str(value) for value in params.get("resource_ids", [])] or None,
            limit=int(params.get("limit", 100)),
        )
