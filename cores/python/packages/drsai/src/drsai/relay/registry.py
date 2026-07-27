from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import ipaddress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import RLock
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .generated_contract import CAPABILITIES, PROTOCOL_VERSION
from .models import ResourceLifecycle, RuntimeCapabilities, RuntimeIdentity, RuntimeStatus, RuntimeSummary, Workspace


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
    grant_id: str | None = None
    revoked: bool = False
    consumed_subject_summary: str | None = None


@dataclass
class _Association:
    association_id: str
    subject: str
    subject_summary: str
    device_id: str
    device_summary: str
    device_name: str
    device_public_key: bytes
    created_at: datetime
    revoked_at: datetime | None = None


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
    associations: dict[tuple[str, str], _Association] = field(default_factory=dict)
    nonces: set[str] = field(default_factory=set)
    revoked: bool = False


class RelayRegistry:
    """Thread-safe reference registry. No canonical path is accepted or stored."""

    def __init__(self, *, code_ttl_seconds: int = 120, offline_after_seconds: int = 45) -> None:
        self._lock = RLock()
        self._runtimes: dict[str, _Runtime] = {}
        self._registration_codes: dict[str, _Code] = {}
        self._access_codes: dict[str, _Code] = {}
        self._access_grants: dict[str, _Code] = {}
        self._idempotency: dict[tuple[str, str], object] = {}
        self.audit: list[dict[str, str]] = []
        self.code_ttl = timedelta(seconds=code_ttl_seconds)
        self.offline_after = timedelta(seconds=offline_after_seconds)

    @staticmethod
    def _digest(secret: str) -> str:
        return hashlib.sha256(secret.encode()).hexdigest()

    @classmethod
    def _subject_summary(cls, subject: str) -> str:
        return f"sub_{cls._digest(subject)[:12]}"

    @classmethod
    def _device_summary(cls, subject: str, device_id: str) -> str:
        return f"dev_{cls._digest(subject + chr(0) + device_id)[:12]}"

    def issue_registration_code(self) -> str:
        code = secrets.token_urlsafe(18)
        with self._lock:
            self._registration_codes[self._digest(code)] = _Code(
                self._digest(code), None, datetime.now(UTC) + self.code_ttl
            )
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
            safe_name = self._validated_display_name(display_name)
            self._runtimes[runtime_id] = _Runtime(runtime_id, safe_name, key_bytes, self._digest(token), version)
            result = (runtime_id, token)
            self._idempotency[key] = result
            self.audit.append({"action": "runtime.register", "runtime_id": runtime_id})
            return result

    @staticmethod
    def _consume(ticket: _Code | None, code: str) -> None:
        if ticket is None or ticket.used or ticket.revoked or ticket.expires_at <= datetime.now(UTC):
            raise RelayRegistryError(code, "Code is invalid, expired, or already used")
        ticket.used = True

    @staticmethod
    def _consume_access_grant(ticket: _Code | None) -> None:
        if ticket is None:
            raise RelayRegistryError("access_grant_invalid", "Access grant is invalid")
        if ticket.used:
            raise RelayRegistryError("access_grant_consumed", "Access grant was already used")
        if ticket.revoked:
            raise RelayRegistryError("access_grant_revoked", "Access grant was revoked")
        if ticket.expires_at <= datetime.now(UTC):
            raise RelayRegistryError("access_grant_expired", "Access grant expired")
        ticket.used = True

    def issue_access_grant(self, runtime_id: str, registration_token: str) -> tuple[str, str, datetime]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            for ticket in self._access_grants.values():
                if ticket.runtime_id == runtime.runtime_id and self._grant_status(ticket) == "pending":
                    ticket.revoked = True
            grant_id, code = f"ag_{uuid4().hex}", secrets.token_urlsafe(18)
            ticket = _Code(self._digest(code), runtime.runtime_id, datetime.now(UTC) + self.code_ttl,
                           grant_id=grant_id)
            self._access_codes[ticket.digest] = ticket
            self._access_grants[grant_id] = ticket
            self.audit.append({"action": "runtime.access_grant.issue", "runtime_id": runtime.runtime_id,
                               "grant_id": grant_id})
            return grant_id, code, ticket.expires_at

    def access_grant_status(self, runtime_id: str, registration_token: str,
                            grant_id: str) -> tuple[str, datetime]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            ticket = self._access_grants.get(grant_id)
            if ticket is None or ticket.runtime_id != runtime.runtime_id:
                raise RelayRegistryError("access_grant_not_found", "Access grant was not found")
            return self._grant_status(ticket), ticket.expires_at

    def access_grant_subject_summary(
        self, runtime_id: str, registration_token: str, grant_id: str,
    ) -> str | None:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            ticket = self._access_grants.get(grant_id)
            if ticket is None or ticket.runtime_id != runtime.runtime_id:
                raise RelayRegistryError("access_grant_not_found", "Access grant was not found")
            return ticket.consumed_subject_summary if self._grant_status(ticket) == "consumed" else None

    def revoke_access_grant(self, runtime_id: str, registration_token: str,
                            grant_id: str) -> tuple[str, datetime]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            ticket = self._access_grants.get(grant_id)
            if ticket is None or ticket.runtime_id != runtime.runtime_id:
                raise RelayRegistryError("access_grant_not_found", "Access grant was not found")
            if self._grant_status(ticket) == "pending":
                ticket.revoked = True
                self.audit.append({"action": "runtime.access_grant.revoke", "runtime_id": runtime.runtime_id,
                                   "grant_id": grant_id})
            return self._grant_status(ticket), ticket.expires_at

    @staticmethod
    def _grant_status(ticket: _Code) -> str:
        if ticket.used:
            return "consumed"
        if ticket.revoked:
            return "revoked"
        if ticket.expires_at <= datetime.now(UTC):
            return "expired"
        return "pending"

    def associate(
        self,
        subject: str,
        code: str,
        device_id: str,
        device_name: str,
        device_public_key: str,
    ) -> str:
        with self._lock:
            ticket = self._access_codes.get(self._digest(code))
            self._consume_access_grant(ticket)
            assert ticket and ticket.runtime_id
            runtime = self._require_runtime(ticket.runtime_id)
            summary = self._subject_summary(subject)
            try:
                public_key = base64.urlsafe_b64decode(
                    device_public_key + "=" * (-len(device_public_key) % 4)
                )
                Ed25519PublicKey.from_public_bytes(public_key)
            except Exception as exc:
                raise RelayRegistryError(
                    "device_public_key_invalid",
                    "Invalid Ed25519 device public key",
                ) from exc
            safe_device_name = " ".join(device_name.split())
            if not safe_device_name:
                raise RelayRegistryError(
                    "device_name_invalid",
                    "Device name must not be blank",
                )
            ticket.consumed_subject_summary = summary
            association_key = (subject, device_id)
            existing = runtime.associations.get(association_key)
            if existing is None or existing.revoked_at is not None:
                runtime.associations[association_key] = _Association(
                    association_id=f"assoc_{uuid4().hex}",
                    subject=subject,
                    subject_summary=summary,
                    device_id=device_id,
                    device_summary=self._device_summary(subject, device_id),
                    device_name=safe_device_name,
                    device_public_key=public_key,
                    created_at=datetime.now(UTC),
                )
            runtime.subjects.add(subject)
            self.audit.append({"action": "runtime.associate", "runtime_id": runtime.runtime_id, "subject": subject})
            return runtime.runtime_id

    @staticmethod
    def _association_result(runtime_id: str, association: _Association) -> dict[str, str | None]:
        return {
            "association_id": association.association_id,
            "runtime_id": runtime_id,
            "subject_summary": association.subject_summary,
            "device_summary": association.device_summary,
            "device_name": association.device_name,
            "status": "revoked" if association.revoked_at is not None else "active",
            "created_at": association.created_at.isoformat(),
            "revoked_at": association.revoked_at.isoformat() if association.revoked_at else None,
        }

    def revoke_association(
        self,
        subject: str,
        runtime_id: str,
        device_id: str,
    ) -> dict[str, str | None]:
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            association = runtime.associations.get((subject, device_id))
            if association is None or association.revoked_at is not None:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            association.revoked_at = datetime.now(UTC)
            if not any(
                item.subject == subject and item.revoked_at is None
                for item in runtime.associations.values()
            ):
                runtime.subjects.discard(subject)
            self.audit.append({
                "action": "runtime.association.revoke",
                "runtime_id": runtime_id,
                "subject": subject,
            })
            return self._association_result(runtime_id, association)

    def list_associations(self, runtime_id: str, registration_token: str) -> list[dict[str, str | None]]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            return [
                self._association_result(runtime_id, association)
                for association in sorted(
                    runtime.associations.values(),
                    key=lambda item: item.association_id,
                )
            ]

    def revoke_runtime_association(
        self, runtime_id: str, registration_token: str, association_id: str,
    ) -> dict[str, str | None]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            association = next(
                (
                    item for item in runtime.associations.values()
                    if item.association_id == association_id
                ),
                None,
            )
            if association is None:
                raise RelayRegistryError("association_not_found", "Association was not found")
            if association.revoked_at is None:
                association.revoked_at = datetime.now(UTC)
                if not any(
                    item is not association
                    and item.subject == association.subject
                    and item.revoked_at is None
                    for item in runtime.associations.values()
                ):
                    runtime.subjects.discard(association.subject)
                self.audit.append({
                    "action": "runtime.association.revoke",
                    "runtime_id": runtime_id,
                    "association_id": association_id,
                })
            return self._association_result(runtime_id, association)

    def revoke_enrollment(
        self, runtime_id: str, registration_token: str,
    ) -> dict[str, str | None]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            now = datetime.now(UTC)
            for association in runtime.associations.values():
                if association.revoked_at is None:
                    association.revoked_at = now
            for ticket in self._access_grants.values():
                if ticket.runtime_id == runtime_id and not ticket.revoked:
                    ticket.revoked = True
            runtime.subjects.clear()
            runtime.revoked = True
            runtime.status = RuntimeStatus.REVOKED
            runtime.registration_token_digest = self._digest(secrets.token_urlsafe(32))
            self.audit.append({"action": "runtime.enrollment.revoke", "runtime_id": runtime_id})
            return {
                "runtime_id": runtime_id,
                "status": "revoked",
                "revoked_at": now.isoformat(),
            }

    def heartbeat(self, runtime_id: str, registration_token: str, *, instance_id: str, version: str,
                  capabilities: frozenset[str], backend_health: dict[str, str], nonce: str, signature: str) -> RuntimeIdentity:
        runtime = self._authenticated(runtime_id, registration_token)
        if not capabilities.issubset(CAPABILITIES):
            raise RelayRegistryError("capability_unknown", "Runtime advertised an unknown capability")
        message = f"{runtime_id}\n{instance_id}\n{nonce}".encode()
        try:
            signature_bytes = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
            Ed25519PublicKey.from_public_bytes(runtime.public_key).verify(signature_bytes, message)
        except Exception as exc:
            raise RelayRegistryError("signature_invalid", "Heartbeat signature is invalid") from exc
        with self._lock:
            runtime = self._authenticated(runtime_id, registration_token)
            if nonce in runtime.nonces:
                raise RelayRegistryError("heartbeat_replay", "Heartbeat nonce was already used")
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
        try:
            new_bytes = base64.urlsafe_b64decode(new_public_key + "=" * (-len(new_public_key) % 4))
            Ed25519PublicKey.from_public_bytes(new_bytes)
            signature = base64.urlsafe_b64decode(old_signature + "=" * (-len(old_signature) % 4))
        except Exception as exc:
            raise RelayRegistryError("key_rotation_invalid", "Key rotation proof is invalid") from exc
        with self._lock:
            runtime = self._authenticated(runtime_id, registration_token)
            if nonce in runtime.nonces:
                raise RelayRegistryError("key_rotation_replay", "Key rotation nonce was already used")
            try:
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
        with self._lock:
            runtime = self._authenticated(runtime_id, registration_token)
            runtime.workspaces = {item.workspace_id: item for item in workspaces}

    def list_runtimes(self, subject: str, *, cursor: str | None = None, limit: int = 20, query: str | None = None) -> tuple[list[RuntimeSummary], str | None]:
        items = [r for r in self._runtimes.values() if subject in r.subjects and not r.revoked]
        if query:
            items = [r for r in items if query.casefold() in r.display_name.casefold()]
        items.sort(key=lambda r: r.runtime_id)
        page, next_cursor = self._page(items, cursor, limit)
        return [RuntimeSummary(runtime=self._identity(r), display_name=r.display_name) for r in page], next_cursor

    @staticmethod
    def _validated_display_name(value: str) -> str:
        normalized = " ".join(value.split())
        if (
            not normalized
            or len(normalized) > 64
            or any(character in normalized for character in ("/", "\\", "\0"))
            or "://" in normalized
        ):
            raise RelayRegistryError(
                "runtime_display_name_invalid", "Runtime display name is invalid"
            )
        try:
            ipaddress.ip_address(normalized.strip("[]"))
        except ValueError:
            return normalized
        raise RelayRegistryError(
            "runtime_display_name_invalid", "Runtime display name is invalid"
        )

    def rename_runtime(
        self, subject: str, runtime_id: str, display_name: str,
    ) -> dict[str, str]:
        safe_name = self._validated_display_name(display_name)
        with self._lock:
            runtime = self._authorized(subject, runtime_id)
            runtime.display_name = safe_name
            self.audit.append({
                "action": "runtime.rename",
                "runtime_id": runtime_id,
                "subject": subject,
            })
            return {"runtime_id": runtime_id, "display_name": safe_name}

    def list_workspaces(self, subject: str, runtime_id: str, *, cursor: str | None = None, limit: int = 20,
                        query: str | None = None, lifecycle: ResourceLifecycle | None = ResourceLifecycle.ACTIVE
                        ) -> tuple[list[Workspace], str | None]:
        runtime = self._authorized(subject, runtime_id)
        items = sorted(runtime.workspaces.values(), key=lambda w: w.workspace_id)
        if lifecycle is not None:
            items = [item for item in items if item.lifecycle == lifecycle]
        if query:
            items = [w for w in items if query.casefold() in w.display_name.casefold()]
        return self._page(items, cursor, limit)

    def authorize_workspace(self, subject: str, runtime_id: str, workspace_id: str) -> Workspace:
        runtime = self._authorized(subject, runtime_id)
        workspace = runtime.workspaces.get(workspace_id)
        if workspace is None or workspace.lifecycle != ResourceLifecycle.ACTIVE:
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
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            runtime.revoked, runtime.status = True, RuntimeStatus.REVOKED
            runtime.subjects.clear()
            self.audit.append({"action": "runtime.revoke", "runtime_id": runtime_id})

    def _identity(self, runtime: _Runtime) -> RuntimeIdentity:
        status = runtime.status
        if not runtime.revoked and runtime.last_seen and datetime.now(UTC) - runtime.last_seen > self.offline_after:
            status = RuntimeStatus.OFFLINE
        return RuntimeIdentity(runtime_id=runtime.runtime_id, instance_id=runtime.instance_id, version=runtime.version,
                               protocol_version=PROTOCOL_VERSION, status=status,
                               connection_generation=runtime.generation, last_seen_at=runtime.last_seen)

    def _require_runtime(self, runtime_id: str) -> _Runtime:
        runtime = self._runtimes.get(runtime_id)
        if runtime is None or runtime.revoked:
            raise RelayRegistryError("runtime_not_found", "Runtime was not found")
        return runtime

    def _authenticated(self, runtime_id: str, token: str) -> _Runtime:
        runtime = self._runtimes.get(runtime_id)
        if runtime is None or runtime.revoked:
            raise RelayRegistryError("runtime_auth_invalid", "Runtime authentication failed")
        if not hmac.compare_digest(runtime.registration_token_digest, self._digest(token)):
            raise RelayRegistryError("runtime_auth_invalid", "Runtime authentication failed")
        return runtime

    def _authorized(self, subject: str, runtime_id: str) -> _Runtime:
        runtime = self._require_runtime(runtime_id)
        if subject not in runtime.subjects:
            raise RelayRegistryError("runtime_forbidden", "Runtime is not authorized")
        return runtime
