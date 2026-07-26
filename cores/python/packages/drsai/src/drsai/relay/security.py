from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .registry import RelayRegistryError


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class RuntimePrincipal:
    subject: str
    organization: str
    runtime_id: str
    workspace_id: str
    scopes: frozenset[str]
    device_id: str
    session_id: str
    jti: str


class RelayTicketIssuer:
    def __init__(self, private_key: Ed25519PrivateKey | None = None, *, ttl_seconds: int = 300,
                 clock_skew_seconds: int = 30) -> None:
        self.private_key = private_key or Ed25519PrivateKey.generate()
        self.public_key = self.private_key.public_key()
        self.ttl, self.skew = timedelta(seconds=ttl_seconds), timedelta(seconds=clock_skew_seconds)
        self.revoked: set[str] = set()

    def issue(self, *, subject: str, organization: str, runtime_id: str, workspace_id: str,
              scopes: set[str], device_id: str, session_id: str, now: datetime | None = None) -> str:
        issued = now or datetime.now(UTC)
        payload = {"sub": subject, "org": organization, "runtime_id": runtime_id, "workspace_id": workspace_id,
                   "scope": sorted(scopes), "device_id": device_id, "session_id": session_id,
                   "iat": int(issued.timestamp()), "exp": int((issued + self.ttl).timestamp()), "jti": str(uuid4())}
        header = {"alg": "EdDSA", "typ": "JWT"}
        signing = f"{_b64(json.dumps(header, separators=(',', ':'), sort_keys=True).encode())}.{_b64(json.dumps(payload, separators=(',', ':'), sort_keys=True).encode())}"
        return f"{signing}.{_b64(self.private_key.sign(signing.encode()))}"

    def verify(self, ticket: str, *, expected_runtime: str, expected_workspace: str,
               required_scope: str, now: datetime | None = None) -> RuntimePrincipal:
        try:
            header_text, payload_text, signature_text = ticket.split(".")
            signing = f"{header_text}.{payload_text}"
            self.public_key.verify(_decode(signature_text), signing.encode())
            header, payload = json.loads(_decode(header_text)), json.loads(_decode(payload_text))
        except Exception as exc:
            raise RelayRegistryError("ticket_invalid", "Relay ticket is invalid") from exc
        if header != {"alg": "EdDSA", "typ": "JWT"}:
            raise RelayRegistryError("ticket_invalid", "Relay ticket algorithm is invalid")
        current = int((now or datetime.now(UTC)).timestamp())
        if current > int(payload["exp"]) + int(self.skew.total_seconds()):
            raise RelayRegistryError("ticket_expired", "Relay ticket expired")
        if payload["jti"] in self.revoked:
            raise RelayRegistryError("ticket_revoked", "Relay ticket was revoked")
        if payload["runtime_id"] != expected_runtime or payload["workspace_id"] != expected_workspace:
            raise RelayRegistryError("ticket_scope_mismatch", "Relay ticket resource scope does not match")
        scopes = frozenset(payload["scope"])
        if required_scope not in scopes:
            raise RelayRegistryError("permission_denied", "Relay ticket lacks the required scope")
        return RuntimePrincipal(payload["sub"], payload["org"], payload["runtime_id"], payload["workspace_id"],
                                scopes, payload["device_id"], payload["session_id"], payload["jti"])

    def revoke(self, ticket: str) -> None:
        try:
            payload = json.loads(_decode(ticket.split(".")[1]))
            self.revoked.add(payload["jti"])
        except Exception as exc:
            raise RelayRegistryError("ticket_invalid", "Relay ticket is invalid") from exc


class RuntimePermissionEnforcer:
    """Runtime-side final authorization; Relay verification cannot bypass it."""

    def __init__(self, permissions: dict[tuple[str, str], set[str]]) -> None:
        self.permissions = permissions

    def authorize(self, principal: RuntimePrincipal, operation: str) -> None:
        allowed = self.permissions.get((principal.subject, principal.workspace_id), set())
        if operation not in allowed:
            raise RelayRegistryError("runtime_permission_denied", "Runtime denied this workspace operation")


_BEARER = re.compile(r"(?i)\b(Bearer\s+)[A-Za-z0-9._~+/=-]+")
_SECRET = re.compile(
    r"""(?ix)(
      ["']?
      (?:authorization|cookie|token|secret|code|state|api[_-]?key|
         access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|
         registration[_-]?token|access[_-]?grant[_-]?code|password|
         file[_-]?content|message|prompt|command|arguments)
      ["']?\s*[:=]\s*["']?
    )([^\s"',;&}\]]+)"""
)
_QUERY_SECRET = re.compile(
    r"(?i)([?&](?:code|state|token|access_token|refresh_token|id_token|client_secret)=)[^&#\s]+"
)


def redact_secrets(value: str) -> str:
    redacted = _BEARER.sub(r"\1[REDACTED]", value)
    redacted = _QUERY_SECRET.sub(r"\1[REDACTED]", redacted)
    return _SECRET.sub(r"\1[REDACTED]", redacted)
