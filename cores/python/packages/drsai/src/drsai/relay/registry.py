from __future__ import annotations

import base64
import bisect
import hashlib
import hmac
import secrets
import ipaddress
import json
from urllib.parse import parse_qsl, urlencode
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import RLock
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .generated_contract import CAPABILITIES, PROTOCOL_VERSION
from .models import ResourceLifecycle, RuntimeCapabilities, RuntimeIdentity, RuntimeStatus, RuntimeSummary, Workspace


ASSOCIATION_PERMISSIONS = frozenset({"read", "send", "approve", "files"})


class RelayRegistryError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False,
                 source: str = "relay", details: dict | None = None) -> None:
        super().__init__(message)
        if source not in {"relay", "runtime"}:
            raise ValueError("relay_error_source_invalid")
        self.code, self.message, self.retryable, self.source = code, message, retryable, source
        self.details = dict(details or {})


@dataclass
class _Code:
    digest: str
    runtime_id: str | None
    expires_at: datetime
    used: bool = False
    grant_id: str | None = None
    revoked: bool = False
    consumed_subject_summary: str | None = None
    workspace_scope: str = "all"
    allowed_workspace_ids: frozenset[str] = field(default_factory=frozenset)
    permissions: frozenset[str] = ASSOCIATION_PERMISSIONS


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
    workspace_scope: str = "all"
    allowed_workspace_ids: frozenset[str] = field(default_factory=frozenset)
    permissions: frozenset[str] = ASSOCIATION_PERMISSIONS
    last_seen_at: datetime | None = None
    accessing_until: datetime | None = None
    revoked_at: datetime | None = None
    proof_nonces: dict[str, datetime] = field(default_factory=dict)
    push_provider: str | None = None
    push_token_digest: str | None = None
    push_generation: int = 0
    push_updated_at: datetime | None = None


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
    paused: bool = False
    revoked: bool = False


class RelayRegistry:
    """Thread-safe reference registry. No canonical path is accepted or stored."""

    def __init__(self, *, code_ttl_seconds: int = 120, offline_after_seconds: int = 45,
                 supported_push_providers: frozenset[str] = frozenset(),
                 device_proof_nonce_capacity: int = 4096,
                 cursor_secret: bytes | None = None) -> None:
        if not 1 <= device_proof_nonce_capacity <= 65536:
            raise ValueError("device_proof_nonce_capacity_invalid")
        self._lock = RLock()
        self._runtimes: dict[str, _Runtime] = {}
        self._registration_codes: dict[str, _Code] = {}
        self._access_codes: dict[str, _Code] = {}
        self._access_grants: dict[str, _Code] = {}
        self._idempotency: dict[tuple[str, str], object] = {}
        self.audit: list[dict[str, str]] = []
        self.code_ttl = timedelta(seconds=code_ttl_seconds)
        self.offline_after = timedelta(seconds=offline_after_seconds)
        self.supported_push_providers = frozenset(supported_push_providers)
        self.device_proof_nonce_capacity = device_proof_nonce_capacity
        self._cursor_secret = cursor_secret or secrets.token_bytes(32)
        if not isinstance(self._cursor_secret, bytes) or len(self._cursor_secret) < 32:
            raise ValueError("cursor_secret_invalid")

    @staticmethod
    def _digest(secret: str) -> str:
        return hashlib.sha256(secret.encode()).hexdigest()

    @classmethod
    def _subject_summary(cls, subject: str) -> str:
        return f"sub_{cls._digest(subject)[:12]}"

    @classmethod
    def _device_summary(cls, subject: str, device_id: str) -> str:
        return f"dev_{cls._digest(subject + chr(0) + device_id)[:12]}"

    @classmethod
    def authorization_key(cls, subject: str, device_id: str) -> tuple[str, str]:
        """Return a content-free identity suitable for live-stream ownership."""
        if not subject or not device_id:
            raise RelayRegistryError("device_proof_required", "Device identity is required")
        return cls._subject_summary(str(subject)), cls._device_summary(str(subject), str(device_id))

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

    def issue_access_grant(
        self,
        runtime_id: str,
        registration_token: str,
        *,
        workspace_scope: str = "all",
        workspace_ids: list[str] | None = None,
        permissions: list[str] | None = None,
    ) -> tuple[str, str, datetime]:
        runtime = self._authenticated(runtime_id, registration_token)
        requested_workspace_ids = frozenset(str(value) for value in (workspace_ids or []))
        self._validate_workspace_scope(workspace_scope, requested_workspace_ids)
        requested_permissions = self._validate_permissions(permissions)
        with self._lock:
            if runtime.paused:
                raise RelayRegistryError("runtime_paused", "Runtime remote access is paused")
            for ticket in self._access_grants.values():
                if ticket.runtime_id == runtime.runtime_id and self._grant_status(ticket) == "pending":
                    ticket.revoked = True
            grant_id, code = f"ag_{uuid4().hex}", secrets.token_urlsafe(18)
            ticket = _Code(self._digest(code), runtime.runtime_id, datetime.now(UTC) + self.code_ttl,
                           grant_id=grant_id, workspace_scope=workspace_scope,
                           allowed_workspace_ids=requested_workspace_ids,
                           permissions=requested_permissions)
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
        workspace_scope: str = "all",
        workspace_ids: list[str] | None = None,
        permissions: list[str] | None = None,
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
            requested_workspace_ids = frozenset(str(value) for value in (workspace_ids or []))
            self._validate_workspace_scope(workspace_scope, requested_workspace_ids)
            requested_permissions = self._validate_permissions(permissions)
            if (
                workspace_scope != ticket.workspace_scope
                or requested_workspace_ids != ticket.allowed_workspace_ids
                or requested_permissions != ticket.permissions
            ):
                raise RelayRegistryError(
                    "workspace_scope_mismatch", "Association scope does not match the access grant"
                )
            ticket.consumed_subject_summary = summary
            association_key = (subject, device_id)
            existing = runtime.associations.get(association_key)
            now = datetime.now(UTC)
            if existing is None or existing.revoked_at is not None:
                runtime.associations[association_key] = _Association(
                    association_id=f"assoc_{uuid4().hex}",
                    subject=subject,
                    subject_summary=summary,
                    device_id=device_id,
                    device_summary=self._device_summary(subject, device_id),
                    device_name=safe_device_name,
                    device_public_key=public_key,
                    created_at=now,
                    workspace_scope=workspace_scope,
                    allowed_workspace_ids=requested_workspace_ids,
                    permissions=requested_permissions,
                    last_seen_at=now,
                )
            else:
                existing.device_name = safe_device_name
                existing.workspace_scope = workspace_scope
                existing.allowed_workspace_ids = requested_workspace_ids
                existing.permissions = requested_permissions
                existing.last_seen_at = now
            runtime.subjects.add(subject)
            self.audit.append({"action": "runtime.associate", "runtime_id": runtime.runtime_id, "subject": subject})
            return runtime.runtime_id

    @staticmethod
    def _validate_workspace_scope(workspace_scope: str, workspace_ids: frozenset[str]) -> None:
        if workspace_scope not in {"all", "selected"}:
            raise RelayRegistryError("workspace_scope_invalid", "Workspace scope is invalid")
        if workspace_scope == "all" and workspace_ids:
            raise RelayRegistryError("workspace_scope_invalid", "All-Workspace scope cannot carry an allowlist")
        if workspace_scope == "selected" and not workspace_ids:
            raise RelayRegistryError("workspace_scope_invalid", "Selected Workspace scope requires an allowlist")
        if len(workspace_ids) > 1000 or any(not value or len(value) > 256 for value in workspace_ids):
            raise RelayRegistryError("workspace_scope_invalid", "Workspace allowlist is invalid")

    @staticmethod
    def _validate_permissions(permissions: list[str] | None) -> frozenset[str]:
        values = frozenset(permissions if permissions is not None else ASSOCIATION_PERMISSIONS)
        if not values or not values.issubset(ASSOCIATION_PERMISSIONS):
            raise RelayRegistryError("association_permissions_invalid", "Association permissions are invalid")
        return values

    def _association_access_state(self, association: _Association) -> str:
        now = datetime.now(UTC)
        if association.revoked_at is not None:
            return "revoked"
        if association.accessing_until is not None and association.accessing_until > now:
            return "accessing"
        if association.last_seen_at is not None and now - association.last_seen_at <= self.offline_after:
            return "online"
        return "offline"

    def _association_result(self, runtime_id: str, association: _Association) -> dict[str, str | None]:
        return {
            "association_id": association.association_id,
            "runtime_id": runtime_id,
            "subject_summary": association.subject_summary,
            "device_summary": association.device_summary,
            "device_name": association.device_name,
            "status": "revoked" if association.revoked_at is not None else "active",
            "access_state": self._association_access_state(association),
            "created_at": association.created_at.isoformat(),
            "last_seen_at": association.last_seen_at.isoformat() if association.last_seen_at else None,
            "revoked_at": association.revoked_at.isoformat() if association.revoked_at else None,
            "workspace_scope": association.workspace_scope,
            "workspace_ids": sorted(association.allowed_workspace_ids),
            "permissions": sorted(association.permissions),
        }

    def upsert_push_registration(self, subject: str, runtime_id: str, device_id: str,
                                 provider: str, token: str, generation: int) -> dict:
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            association = runtime.associations.get((str(subject), device_id))
            if association is None or association.revoked_at is not None:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            if "read" not in association.permissions:
                raise RelayRegistryError("permission_forbidden", "Association permission is not granted")
            if provider not in self.supported_push_providers:
                raise RelayRegistryError("push_provider_unavailable", "Push provider is not configured", retryable=True)
            digest = self._digest(token)
            if generation < association.push_generation:
                raise RelayRegistryError("push_registration_stale", "Push token generation is stale")
            if generation == association.push_generation and (
                association.push_token_digest not in {None, digest}
                or association.push_provider not in {None, provider}
            ):
                raise RelayRegistryError("push_registration_conflict", "Push token generation conflicts")
            association.push_provider = provider
            association.push_token_digest = digest
            association.push_generation = generation
            association.push_updated_at = datetime.now(UTC)
            self.audit.append({"action": "association.push.register", "runtime_id": runtime_id,
                               "association_id": association.association_id})
            return self._push_registration_result(runtime_id, association, "active")

    def revoke_push_registration(self, subject: str, runtime_id: str, device_id: str) -> dict:
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            association = runtime.associations.get((str(subject), device_id))
            if association is None or association.revoked_at is not None:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            if association.push_provider is None:
                raise RelayRegistryError("push_registration_not_found", "Push registration was not found")
            association.push_updated_at = datetime.now(UTC)
            result = self._push_registration_result(runtime_id, association, "revoked")
            association.push_provider = None
            association.push_token_digest = None
            self.audit.append({"action": "association.push.revoke", "runtime_id": runtime_id,
                               "association_id": association.association_id})
            return result

    @staticmethod
    def _push_registration_result(runtime_id: str, association: _Association, status: str) -> dict:
        if association.push_provider is None or association.push_updated_at is None:
            raise RelayRegistryError("push_registration_not_found", "Push registration was not found")
        return {"runtime_id": runtime_id, "device_summary": association.device_summary,
                "provider": association.push_provider, "generation": association.push_generation,
                "status": status, "updated_at": association.push_updated_at.isoformat()}

    def shrink_association_authorization(
        self,
        runtime_id: str,
        registration_token: str,
        association_id: str,
        *,
        workspace_scope: str | None,
        workspace_ids: list[str] | None,
        permissions: list[str] | None,
    ) -> dict[str, str | None]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            association = next((item for item in runtime.associations.values()
                                if item.association_id == association_id), None)
            if association is None or association.revoked_at is not None:
                raise RelayRegistryError("association_not_found", "Association was not found")
            requested_scope = workspace_scope or association.workspace_scope
            requested_ids = frozenset(
                workspace_ids if workspace_ids is not None else association.allowed_workspace_ids
            )
            self._validate_workspace_scope(requested_scope, requested_ids)
            requested_permissions = (
                self._validate_permissions(permissions)
                if permissions is not None else association.permissions
            )
            scope_expands = (
                association.workspace_scope == "selected"
                and (requested_scope == "all" or not requested_ids.issubset(association.allowed_workspace_ids))
            )
            if scope_expands or not requested_permissions.issubset(association.permissions):
                raise RelayRegistryError("authorization_expansion_forbidden", "Authorization can only be reduced")
            association.workspace_scope = requested_scope
            association.allowed_workspace_ids = requested_ids
            association.permissions = requested_permissions
            self.audit.append({
                "action": "runtime.association.authorization.shrink",
                "runtime_id": runtime_id,
                "association_id": association_id,
            })
            return self._association_result(runtime_id, association)

    def record_device_presence(
        self,
        subject: str,
        runtime_id: str,
        device_id: str,
        *,
        accessing: bool = False,
    ) -> dict[str, str | None]:
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            association = runtime.associations.get((subject, device_id))
            if association is None or association.revoked_at is not None:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            now = datetime.now(UTC)
            association.last_seen_at = now
            if accessing:
                association.accessing_until = now + timedelta(seconds=30)
            self.audit.append({
                "action": "runtime.association.presence",
                "runtime_id": runtime_id,
                "association_id": association.association_id,
            })
            return self._association_result(runtime_id, association)

    def verify_device_request(
        self,
        subject: str,
        device_id: str,
        *,
        runtime_id: str | None,
        method: str,
        path: str,
        query: str,
        body: bytes,
        timestamp: str,
        nonce: str,
        signature: str,
        access_token: str,
    ) -> str:
        """Verify a device-bound request and atomically consume its nonce."""
        try:
            timestamp_value = int(timestamp)
        except (TypeError, ValueError) as exc:
            raise RelayRegistryError("device_proof_invalid", "Device proof timestamp is invalid") from exc
        if abs(int(datetime.now(UTC).timestamp()) - timestamp_value) > 60:
            raise RelayRegistryError("device_proof_expired", "Device proof timestamp is outside the allowed window")
        if not (16 <= len(nonce) <= 128):
            raise RelayRegistryError("device_proof_invalid", "Device proof nonce is invalid")
        try:
            signature_bytes = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        except Exception as exc:
            raise RelayRegistryError("device_proof_invalid", "Device proof signature is invalid") from exc
        if len(signature_bytes) != 64:
            raise RelayRegistryError("device_proof_invalid", "Device proof signature is invalid")
        canonical_query = urlencode(sorted(parse_qsl(query, keep_blank_values=True)))
        canonical = "\n".join((
            "hai-runtime-relay-device-v1", method.upper(), path, canonical_query,
            hashlib.sha256(body).hexdigest(), timestamp, nonce,
            hashlib.sha256(access_token.encode()).hexdigest(),
        )).encode()
        with self._lock:
            runtimes = [self._require_runtime(runtime_id)] if runtime_id else list(self._runtimes.values())
            candidates: list[tuple[str, _Association]] = []
            for runtime in runtimes:
                association = runtime.associations.get((subject, device_id))
                if association is not None and association.revoked_at is None and not runtime.revoked:
                    candidates.append((runtime.runtime_id, association))
            if not candidates:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            public_keys = {association.device_public_key for _, association in candidates}
            if len(public_keys) != 1:
                raise RelayRegistryError("device_identity_conflict", "Device identity is inconsistent")
            now = datetime.now(UTC)
            cutoff = now - timedelta(seconds=60)
            for _, association in candidates:
                association.proof_nonces = {
                    value: observed_at
                    for value, observed_at in association.proof_nonces.items()
                    if observed_at >= cutoff
                }
            if any(nonce in association.proof_nonces for _, association in candidates):
                raise RelayRegistryError("device_proof_replay", "Device proof nonce was already used")
            if any(
                len(association.proof_nonces) >= self.device_proof_nonce_capacity
                for _, association in candidates
            ):
                raise RelayRegistryError(
                    "backpressure_overflow",
                    "Device proof replay window is full",
                    retryable=True,
                )
            try:
                Ed25519PublicKey.from_public_bytes(next(iter(public_keys))).verify(signature_bytes, canonical)
            except Exception as exc:
                raise RelayRegistryError("device_proof_invalid", "Device proof signature is invalid") from exc
            for _, association in candidates:
                association.proof_nonces[nonce] = now
                association.last_seen_at = now
            return device_id

    def rotate_association_device_key(
        self,
        subject: str,
        runtime_id: str,
        device_id: str,
        new_public_key: str,
    ) -> dict[str, str | None]:
        """Atomically replace the device key across every active association.

        Android intentionally has one device identity shared by all Runtime
        associations. Updating only the Runtime named by the route would leave
        the catalog with conflicting keys and lock the device out of its other
        Runtimes. The request is authenticated with the old key for the target
        association before entering this method; while holding the registry
        lock we require all active copies to still agree, then rotate them as a
        single transaction.
        """
        try:
            public_key = base64.urlsafe_b64decode(
                new_public_key + "=" * (-len(new_public_key) % 4)
            )
            Ed25519PublicKey.from_public_bytes(public_key)
        except Exception as exc:
            raise RelayRegistryError(
                "device_public_key_invalid", "Invalid Ed25519 device public key"
            ) from exc
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            association = runtime.associations.get((subject, device_id))
            if association is None or association.revoked_at is not None:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            active = [
                candidate
                for candidate_runtime in self._runtimes.values()
                if not candidate_runtime.revoked
                for candidate in [candidate_runtime.associations.get((subject, device_id))]
                if candidate is not None and candidate.revoked_at is None
            ]
            current_keys = {candidate.device_public_key for candidate in active}
            if len(current_keys) != 1:
                raise RelayRegistryError(
                    "device_identity_conflict",
                    "Device identity is inconsistent",
                )
            if hmac.compare_digest(next(iter(current_keys)), public_key):
                # Crash recovery: the new key has authenticated this request,
                # so replaying the exact replacement is an idempotent success.
                # The old key remains fenced by request authentication.
                return self._association_result(runtime_id, association)
            now = datetime.now(UTC)
            for candidate in active:
                candidate.device_public_key = public_key
                candidate.proof_nonces.clear()
                candidate.last_seen_at = now
            self.audit.append({
                "action": "runtime.association.device_key.rotate",
                "runtime_id": runtime_id,
                "association_id": association.association_id,
                "association_count": len(active),
            })
            return self._association_result(runtime_id, association)

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
            association.push_provider = None
            association.push_token_digest = None
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
                association.push_provider = None
                association.push_token_digest = None
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
                association.push_provider = None
                association.push_token_digest = None
            for ticket in self._access_grants.values():
                if ticket.runtime_id == runtime_id and not ticket.revoked:
                    ticket.revoked = True
            runtime.subjects.clear()
            runtime.revoked = True
            runtime.paused = False
            runtime.status = RuntimeStatus.REVOKED
            runtime.registration_token_digest = self._digest(secrets.token_urlsafe(32))
            self.audit.append({"action": "runtime.enrollment.revoke", "runtime_id": runtime_id})
            return {
                "runtime_id": runtime_id,
                "status": "revoked",
                "revoked_at": now.isoformat(),
            }

    def set_enrollment_paused(
        self, runtime_id: str, registration_token: str, *, paused: bool,
    ) -> dict[str, str | None]:
        runtime = self._authenticated(runtime_id, registration_token)
        with self._lock:
            runtime.paused = paused
            if paused:
                runtime.status = RuntimeStatus.PAUSED
            elif runtime.last_seen is None:
                runtime.status = RuntimeStatus.OFFLINE
            else:
                runtime.status = RuntimeStatus.ONLINE
            action = "runtime.enrollment.pause" if paused else "runtime.enrollment.resume"
            self.audit.append({"action": action, "runtime_id": runtime_id})
            return {
                "runtime_id": runtime_id,
                "status": "paused" if paused else "active",
                "updated_at": datetime.now(UTC).isoformat(),
            }

    def heartbeat(self, runtime_id: str, registration_token: str, *, instance_id: str, version: str,
                  capabilities: frozenset[str], backend_health: dict[str, str], nonce: str, signature: str) -> RuntimeIdentity:
        runtime = self._authenticated(runtime_id, registration_token)
        if runtime.paused:
            raise RelayRegistryError("runtime_paused", "Runtime remote access is paused")
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

    def authenticate_runtime(self, runtime_id: str, registration_token: str) -> None:
        self._authenticated(runtime_id, registration_token)

    def runtime_version(self, runtime_id: str) -> str:
        """Return the aggregate-safe Runtime version without exposing identity data."""
        with self._lock:
            return self._require_runtime(runtime_id).version

    def supported_runtime_capability_summary(
        self, required_capabilities: frozenset[str]
    ) -> tuple[int, int]:
        """Return content-free compatibility counts for active enrollments.

        A registered Runtime remains part of the supported fleet while it is
        offline or paused.  An enrollment that has never advertised the full
        capability profile therefore fails closed as Legacy-dependent.
        """
        if not required_capabilities:
            raise ValueError("required_runtime_capabilities_empty")
        with self._lock:
            supported = [runtime for runtime in self._runtimes.values() if not runtime.revoked]
            requires_legacy = sum(
                1 for runtime in supported
                if not required_capabilities.issubset(runtime.capabilities)
            )
            return len(supported), requires_legacy

    def active_device_ids(self, runtime_id: str, workspace_id: str | None = None) -> list[str]:
        """Return opaque delivery IDs that may read the event Workspace."""
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            return sorted({association.device_id for association in runtime.associations.values()
                           if association.revoked_at is None
                           and "read" in association.permissions
                           and (
                               workspace_id is None
                               or association.workspace_scope == "all"
                               or workspace_id in association.allowed_workspace_ids
                           )})

    def replace_workspace_projection(self, runtime_id: str, workspaces: list[Workspace]) -> None:
        if any(item.runtime_id != runtime_id for item in workspaces):
            raise RelayRegistryError("workspace_scope_mismatch", "Workspace belongs to another runtime")
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            runtime.workspaces = {item.workspace_id: item for item in workspaces}

    def list_runtimes(self, subject: str, *, cursor: str | None = None, limit: int = 20, query: str | None = None) -> tuple[list[RuntimeSummary], str | None]:
        device_id = getattr(subject, "device_id", None)
        items = [
            r for r in self._runtimes.values()
            if subject in r.subjects and not r.revoked and (
                device_id is None
                or (
                    (association := r.associations.get((str(subject), str(device_id)))) is not None
                    and association.revoked_at is None
                    and "read" in association.permissions
                )
            )
        ]
        if query:
            items = [r for r in items if query.casefold() in self._public_display_name(r.display_name).casefold()]
        items.sort(key=lambda r: r.runtime_id)
        page, next_cursor = self._page(
            items,
            cursor,
            limit,
            kind="runtimes",
            context=(str(subject), str(device_id or ""), str(query or "").casefold()),
            key=lambda runtime: runtime.runtime_id,
        )
        return [RuntimeSummary(runtime=self._identity(r), display_name=self._public_display_name(r.display_name)) for r in page], next_cursor

    @classmethod
    def _public_display_name(cls, value: str) -> str:
        try:
            return cls._validated_display_name(value)
        except RelayRegistryError:
            return "Windows Runtime"

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
            runtime = self._authorized(subject, runtime_id, "send")
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
        association = self._device_association(runtime, subject)
        if association is not None and association.workspace_scope == "selected":
            items = [item for item in items if item.workspace_id in association.allowed_workspace_ids]
        if lifecycle is not None:
            items = [item for item in items if item.lifecycle == lifecycle]
        if query:
            items = [w for w in items if query.casefold() in w.display_name.casefold()]
        return self._page(
            items,
            cursor,
            limit,
            kind="workspaces",
            context=(
                str(subject), runtime_id, str(query or "").casefold(),
                lifecycle.value if lifecycle is not None else "all",
            ),
            key=lambda workspace: workspace.workspace_id,
        )

    def authorize_workspace(
        self, subject: str, runtime_id: str, workspace_id: str, permission: str = "read"
    ) -> Workspace:
        runtime = self._authorized(subject, runtime_id, permission)
        association = self._device_association(runtime, subject)
        if (
            association is not None
            and association.workspace_scope == "selected"
            and workspace_id not in association.allowed_workspace_ids
        ):
            raise RelayRegistryError("workspace_forbidden", "Workspace is not authorized")
        workspace = runtime.workspaces.get(workspace_id)
        if workspace is None or workspace.lifecycle != ResourceLifecycle.ACTIVE:
            raise RelayRegistryError("workspace_forbidden", "Workspace is not authorized")
        return workspace

    def _cursor_context(self, kind: str, context: tuple[str, ...]) -> str:
        return hmac.new(
            self._cursor_secret,
            "\0".join((kind, *context)).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _encode_page_cursor(self, kind: str, context: tuple[str, ...], after: str) -> str:
        payload = json.dumps(
            {"v": 1, "kind": kind, "context": self._cursor_context(kind, context), "after": after},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        signature = hmac.new(self._cursor_secret, payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(payload + signature).rstrip(b"=").decode("ascii")

    def _decode_page_cursor(self, cursor: str, kind: str, context: tuple[str, ...]) -> str:
        try:
            if not isinstance(cursor, str) or not 1 <= len(cursor) <= 2048:
                raise ValueError
            packed = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            if len(packed) <= 32:
                raise ValueError
            payload, signature = packed[:-32], packed[-32:]
            expected_signature = hmac.new(self._cursor_secret, payload, hashlib.sha256).digest()
            if not hmac.compare_digest(signature, expected_signature):
                raise ValueError
            value = json.loads(payload.decode("utf-8"))
            if not isinstance(value, dict) or set(value) != {"v", "kind", "context", "after"}:
                raise ValueError
            after = value.get("after")
            if (
                value.get("v") != 1
                or value.get("kind") != kind
                or value.get("context") != self._cursor_context(kind, context)
                or not isinstance(after, str)
                or not 1 <= len(after) <= 500
            ):
                raise ValueError
            return after
        except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RelayRegistryError("cursor_invalid", "cursor is invalid") from exc

    def _page(
        self,
        items: list,
        cursor: str | None,
        limit: int,
        *,
        kind: str,
        context: tuple[str, ...],
        key,
    ) -> tuple[list, str | None]:
        if not 1 <= limit <= 100:
            raise RelayRegistryError("page_limit_invalid", "limit must be between 1 and 100")
        keys = [str(key(item)) for item in items]
        if keys != sorted(keys) or len(keys) != len(set(keys)):
            raise RelayRegistryError("catalog_order_invalid", "catalog ordering is invalid")
        start = 0
        if cursor is not None:
            after = self._decode_page_cursor(cursor, kind, context)
            # Keyset semantics remain stable when the prior page's final item
            # is deleted or new items are inserted before it.
            start = bisect.bisect_right(keys, after)
        end = min(start + limit, len(items))
        page = items[start:end]
        next_cursor = (
            self._encode_page_cursor(kind, context, str(key(page[-1])))
            if page and end < len(items) else None
        )
        return page, next_cursor

    def capabilities(self, subject: str, runtime_id: str) -> RuntimeCapabilities:
        runtime = self._authorized(subject, runtime_id)
        return RuntimeCapabilities(values=runtime.capabilities, backend_health=runtime.backend_health)

    def identity(self, subject: str, runtime_id: str) -> RuntimeIdentity:
        return self._identity(self._authorized(subject, runtime_id))

    def authorize_runtime_permission(self, subject: str, runtime_id: str, permission: str) -> None:
        self._authorized(subject, runtime_id, permission)

    def revoke(self, runtime_id: str) -> None:
        with self._lock:
            runtime = self._require_runtime(runtime_id)
            runtime.revoked, runtime.status = True, RuntimeStatus.REVOKED
            runtime.subjects.clear()
            self.audit.append({"action": "runtime.revoke", "runtime_id": runtime_id})

    def _identity(self, runtime: _Runtime) -> RuntimeIdentity:
        status = RuntimeStatus.PAUSED if runtime.paused else runtime.status
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

    def _authorized(self, subject: str, runtime_id: str, permission: str = "read") -> _Runtime:
        runtime = self._require_runtime(runtime_id)
        if subject not in runtime.subjects:
            raise RelayRegistryError("runtime_forbidden", "Runtime is not authorized")
        if getattr(subject, "device_id", None) is not None:
            association = self._device_association(runtime, subject)
            if association is None:
                raise RelayRegistryError("association_required", "Runtime association is not active")
            if permission not in association.permissions:
                raise RelayRegistryError("permission_forbidden", "Association permission is not granted")
        if runtime.paused:
            raise RelayRegistryError("runtime_paused", "Runtime remote access is paused")
        return runtime

    @staticmethod
    def _device_association(runtime: _Runtime, subject: str) -> _Association | None:
        device_id = getattr(subject, "device_id", None)
        if device_id is None:
            return None
        association = runtime.associations.get((str(subject), str(device_id)))
        if association is None or association.revoked_at is not None:
            return None
        return association
