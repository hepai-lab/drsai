from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import RLock
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .generated_contract import CAPABILITIES, PROTOCOL_VERSION
from .models import RuntimeCapabilities, RuntimeIdentity, RuntimeStatus, RuntimeSummary, Workspace


class RelayRegistryError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False, source: str = "relay") -> None:
        super().__init__(message)
        if source not in {"relay", "runtime"}:
            raise ValueError("relay_error_source_invalid")
        self.code, self.message, self.retryable, self.source = code, message, retryable, source


@dataclass
class _Code:
    digest: str
    runtime_id: str | None
    expires_at: datetime
    used: bool = False


@dataclass
class _Runtime:
    runtime_id: str
    display_name: str
    public_key: bytes
    registration_token_digest: str
    version: str
    instance_id: str = "not-connected"
    generation: int = 1
    status: RuntimeStatus = RuntimeStatus.OFFLINE
    last_seen: datetime | None = None
    capabilities: frozenset[str] = field(default_factory=frozenset)
    backend_health: dict[str, str] = field(default_factory=dict)
    workspaces: dict[str, Workspace] = field(default_factory=dict)
    subjects: set[str] = field(default_factory=set)
    nonces: set[str] = field(default_factory=set)
    revoked: bool = False


class RelayRegistry:
    """Thread-safe reference registry. No canonical path is accepted or stored."""

    def __init__(self, *, code_ttl_seconds: int = 120, offline_after_seconds: int = 45) -> None:
        self._lock = RLock()
        self._runtimes: dict[str, _Runtime] = {}
        self._registration_codes: dict[str, _Code] = {}
        self._access_codes: dict[str, _Code] = {}
        self._idempotency: dict[tuple[str, str], object] = {}
        self.audit: list[dict[str, str]] = []
        self.code_ttl = timedelta(seconds=code_ttl_seconds)
        self.offline_after = timedelta(seconds=offline_after_seconds)

    @staticmethod
    def _digest(secret: str) -> str:
        return hashlib.sha256(secret.encode()).hexdigest()

    def issue_registration_code(self) -> str:
        code = secrets.token_urlsafe(18)
        self._registration_codes[self._digest(code)] = _Code(self._digest(code), None, datetime.now(UTC) + self.code_ttl)
        return code

    def register(self, code: str, display_name: str, version: str, public_key: str, idempotency_key: str) -> tuple[str, str]:
        key = ("register", idempotency_key)
        with self._lock:
            if key in self._idempotency:
                return self._idempotency[key]  # type: ignore[return-value]
            ticket = self._registration_codes.get(self._digest(code))
            self._consume(ticket, "registration_code_invalid")
            try:
                key_bytes = base64.urlsafe_b64decode(public_key + "=" * (-len(public_key) % 4))
                Ed25519PublicKey.from_public_bytes(key_bytes)
            except Exception as exc:
                raise RelayRegistryError("public_key_invalid", "Invalid Ed25519 public key") from exc
            runtime_id, token = f"rt_{uuid4().hex}", secrets.token_urlsafe(32)
            self._runtimes[runtime_id] = _Runtime(runtime_id, display_name, key_bytes, self._digest(token), version)
            result = (runtime_id, token)
            self._idempotency[key] = result
            self.audit.append({"action": "runtime.register", "runtime_id": runtime_id})
            return result

    @staticmethod
    def _consume(ticket: _Code | None, code: str) -> None:
        if ticket is None or ticket.used or ticket.expires_at <= datetime.now(UTC):
            raise RelayRegistryError(code, "Code is invalid, expired, or already used")
        ticket.used = True

    def issue_access_grant(self, runtime_id: str, registration_token: str) -> tuple[str, datetime]:
        runtime = self._authenticated(runtime_id, registration_token)
        code, expires = secrets.token_urlsafe(18), datetime.now(UTC) + self.code_ttl
        self._access_codes[self._digest(code)] = _Code(self._digest(code), runtime.runtime_id, expires)
        return code, expires

    def associate(self, subject: str, code: str) -> str:
        with self._lock:
            ticket = self._access_codes.get(self._digest(code))
            self._consume(ticket, "access_grant_invalid")
            assert ticket and ticket.runtime_id
            runtime = self._require_runtime(ticket.runtime_id)
            runtime.subjects.add(subject)
            self.audit.append({"action": "runtime.associate", "runtime_id": runtime.runtime_id, "subject": subject})
            return runtime.runtime_id

    def heartbeat(self, runtime_id: str, registration_token: str, *, instance_id: str, version: str,
                  capabilities: frozenset[str], backend_health: dict[str, str], nonce: str, signature: str) -> RuntimeIdentity:
        runtime = self._authenticated(runtime_id, registration_token)
        if not capabilities.issubset(CAPABILITIES):
            raise RelayRegistryError("capability_unknown", "Runtime advertised an unknown capability")
        message = f"{runtime_id}\n{instance_id}\n{nonce}".encode()
        if nonce in runtime.nonces:
            raise RelayRegistryError("heartbeat_replay", "Heartbeat nonce was already used")
        try:
            signature_bytes = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
            Ed25519PublicKey.from_public_bytes(runtime.public_key).verify(signature_bytes, message)
        except Exception as exc:
            raise RelayRegistryError("signature_invalid", "Heartbeat signature is invalid") from exc
        with self._lock:
            runtime.nonces.add(nonce)
            if len(runtime.nonces) > 512:
                runtime.nonces = set(list(runtime.nonces)[-256:])
            if runtime.instance_id != instance_id:
                runtime.generation += 1
            runtime.instance_id, runtime.version = instance_id, version
            runtime.capabilities, runtime.backend_health = capabilities, dict(backend_health)
            runtime.last_seen = datetime.now(UTC)
            runtime.status = RuntimeStatus.DEGRADED if any(value != "healthy" for value in backend_health.values()) else RuntimeStatus.ONLINE
            return self._identity(runtime)

    def rotate_public_key(self, runtime_id: str, registration_token: str, *, new_public_key: str,
                          nonce: str, old_signature: str) -> None:
        runtime = self._authenticated(runtime_id, registration_token)
        if nonce in runtime.nonces:
            raise RelayRegistryError("key_rotation_replay", "Key rotation nonce was already used")
        try:
            new_bytes = base64.urlsafe_b64decode(new_public_key + "=" * (-len(new_public_key) % 4))
            Ed25519PublicKey.from_public_bytes(new_bytes)
            signature = base64.urlsafe_b64decode(old_signature + "=" * (-len(old_signature) % 4))
            Ed25519PublicKey.from_public_bytes(runtime.public_key).verify(
                signature, f"{runtime_id}\nrotate\n{new_public_key}\n{nonce}".encode())
        except Exception as exc:
            raise RelayRegistryError("key_rotation_invalid", "Key rotation proof is invalid") from exc
        runtime.public_key = new_bytes
        runtime.nonces.add(nonce)
        self.audit.append({"action": "runtime.key.rotate", "runtime_id": runtime_id})

    def publish_workspaces(self, runtime_id: str, registration_token: str, workspaces: list[Workspace]) -> None:
        runtime = self._authenticated(runtime_id, registration_token)
        if any(item.runtime_id != runtime_id for item in workspaces):
            raise RelayRegistryError("workspace_scope_mismatch", "Workspace belongs to another runtime")
        runtime.workspaces = {item.workspace_id: item for item in workspaces}

    def list_runtimes(self, subject: str, *, cursor: str | None = None, limit: int = 20, query: str | None = None) -> tuple[list[RuntimeSummary], str | None]:
        items = [r for r in self._runtimes.values() if subject in r.subjects and not r.revoked]
        if query:
            items = [r for r in items if query.casefold() in r.display_name.casefold()]
        items.sort(key=lambda r: r.runtime_id)
        page, next_cursor = self._page(items, cursor, limit)
        return [RuntimeSummary(runtime=self._identity(r), display_name=r.display_name) for r in page], next_cursor

    def list_workspaces(self, subject: str, runtime_id: str, *, cursor: str | None = None, limit: int = 20, query: str | None = None) -> tuple[list[Workspace], str | None]:
        runtime = self._authorized(subject, runtime_id)
        items = sorted(runtime.workspaces.values(), key=lambda w: w.workspace_id)
        if query:
            items = [w for w in items if query.casefold() in w.display_name.casefold()]
        return self._page(items, cursor, limit)

    def authorize_workspace(self, subject: str, runtime_id: str, workspace_id: str) -> Workspace:
        runtime = self._authorized(subject, runtime_id)
        workspace = runtime.workspaces.get(workspace_id)
        if workspace is None:
            raise RelayRegistryError("workspace_forbidden", "Workspace is not authorized")
        return workspace

    @staticmethod
    def _page(items: list, cursor: str | None, limit: int) -> tuple[list, str | None]:
        if not 1 <= limit <= 100:
            raise RelayRegistryError("page_limit_invalid", "limit must be between 1 and 100")
        try:
            start = int(cursor or "0")
        except ValueError as exc:
            raise RelayRegistryError("cursor_invalid", "cursor is invalid") from exc
        if start < 0 or start > len(items):
            raise RelayRegistryError("cursor_invalid", "cursor is invalid")
        end = min(start + limit, len(items))
        return items[start:end], str(end) if end < len(items) else None

    def capabilities(self, subject: str, runtime_id: str) -> RuntimeCapabilities:
        runtime = self._authorized(subject, runtime_id)
        return RuntimeCapabilities(values=runtime.capabilities, backend_health=runtime.backend_health)

    def identity(self, subject: str, runtime_id: str) -> RuntimeIdentity:
        return self._identity(self._authorized(subject, runtime_id))

    def revoke(self, runtime_id: str) -> None:
        runtime = self._require_runtime(runtime_id)
        runtime.revoked, runtime.status = True, RuntimeStatus.REVOKED
        runtime.subjects.clear()
        self.audit.append({"action": "runtime.revoke", "runtime_id": runtime_id})

    def _identity(self, runtime: _Runtime) -> RuntimeIdentity:
        status = runtime.status
        if not runtime.revoked and runtime.last_seen and datetime.now(UTC) - runtime.last_seen > self.offline_after:
            status = RuntimeStatus.OFFLINE
        return RuntimeIdentity(runtime_id=runtime.runtime_id, instance_id=runtime.instance_id, version=runtime.version,
                               protocol_version=PROTOCOL_VERSION, status=status, connection_generation=runtime.generation)

    def _require_runtime(self, runtime_id: str) -> _Runtime:
        runtime = self._runtimes.get(runtime_id)
        if runtime is None or runtime.revoked:
            raise RelayRegistryError("runtime_not_found", "Runtime was not found")
        return runtime

    def _authenticated(self, runtime_id: str, token: str) -> _Runtime:
        runtime = self._require_runtime(runtime_id)
        if not hmac.compare_digest(runtime.registration_token_digest, self._digest(token)):
            raise RelayRegistryError("runtime_auth_invalid", "Runtime authentication failed")
        return runtime

    def _authorized(self, subject: str, runtime_id: str) -> _Runtime:
        runtime = self._require_runtime(runtime_id)
        if subject not in runtime.subjects:
            raise RelayRegistryError("runtime_forbidden", "Runtime is not authorized")
        return runtime
