from __future__ import annotations

import re
from uuid import uuid4
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlencode, urlparse, urlunparse

import aiohttp

from .runtime_client import RuntimeCredential, RuntimeCredentialStore


GRANT_ID = re.compile(r"^ag_[0-9a-f]{32}$")
GRANT_CODE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
GRANT_STATUS = frozenset({"pending", "consumed", "expired", "revoked"})
TRUSTED_RELAY_HOSTS = frozenset({"ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"})


class MobilePairingError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool, action: str,
                 correlation_id: str | None = None) -> None:
        super().__init__(message)
        self.code, self.message = code, message
        self.retryable, self.action = retryable, action
        self.correlation_id = correlation_id


@dataclass(frozen=True)
class MobilePairingGrant:
    grant_id: str
    code: str | None
    expires_at: datetime
    status: str
    payload: str | None = None

    def public(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "grant_id": self.grant_id,
            "expires_at": self.expires_at.isoformat(),
            "status": self.status,
        }
        if self.payload is not None:
            result["payload"] = self.payload
        return result


class MobilePairingTransport(Protocol):
    async def create(self, credential: RuntimeCredential) -> MobilePairingGrant: ...
    async def read(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant: ...
    async def revoke(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant: ...


def relay_https_from_wss(raw: str) -> str:
    parsed = urlparse(raw.strip())
    try:
        port = parsed.port
    except ValueError as exc:
        raise MobilePairingError("relay_configuration_invalid", "Runtime Relay configuration is invalid.",
                                 retryable=False, action="repair_runtime") from exc
    if (parsed.scheme != "wss" or not parsed.hostname or parsed.hostname.lower() not in TRUSTED_RELAY_HOSTS
            or port not in {None, 443} or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise MobilePairingError("relay_configuration_invalid", "Runtime Relay configuration is invalid.",
                                 retryable=False, action="repair_runtime")
    path = parsed.path.rstrip("/")
    if path.endswith("/v1/runtime-connect"):
        path = path[:-len("/v1/runtime-connect")]
    return urlunparse(("https", parsed.netloc, path, "", "", "")).rstrip("/")


def pairing_environment(relay_https_url: str) -> tuple[str, str]:
    host = (urlparse(relay_https_url).hostname or "").lower()
    if host == "ai.ihep.ac.cn":
        return "production", "https://ai.ihep.ac.cn"
    if host == "ai-dev.ihep.ac.cn":
        return "development", "https://ai-dev.ihep.ac.cn"
    raise MobilePairingError("relay_configuration_invalid", "Runtime Relay configuration is invalid.",
                             retryable=False, action="repair_runtime")


def build_pairing_payload(code: str, relay_https_url: str) -> str:
    if not GRANT_CODE.fullmatch(code):
        raise MobilePairingError("access_grant_invalid", "Relay returned an invalid access grant.",
                                 retryable=False, action="retry")
    environment, issuer = pairing_environment(relay_https_url)
    return "opendrsai://associate?" + urlencode({
        "v": "1", "environment": environment, "issuer": issuer, "code": code,
    })


class AiohttpMobilePairingTransport:
    def __init__(self, relay_https_url: str, *, timeout_seconds: float = 10.0,
                 session_factory: Callable[..., Any] = aiohttp.ClientSession) -> None:
        parsed = urlparse(relay_https_url)
        try:
            port = parsed.port
        except ValueError as exc:
            raise MobilePairingError("relay_configuration_invalid", "Runtime Relay configuration is invalid.",
                                     retryable=False, action="repair_runtime") from exc
        if (parsed.scheme != "https" or not parsed.hostname or parsed.hostname.lower() not in TRUSTED_RELAY_HOSTS
                or port not in {None, 443} or parsed.username or parsed.password
                or parsed.query or parsed.fragment):
            raise MobilePairingError("relay_configuration_invalid", "Runtime Relay configuration is invalid.",
                                     retryable=False, action="repair_runtime")
        self.root = relay_https_url.rstrip("/")
        self.timeout = aiohttp.ClientTimeout(total=timeout_seconds, connect=min(timeout_seconds, 5.0))
        self.session_factory = session_factory

    async def create(self, credential: RuntimeCredential) -> MobilePairingGrant:
        return await self._request(credential, "POST", f"/v1/runtimes/{credential.runtime_id}/access-grants", True)

    async def read(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant:
        self._validate_grant_id(grant_id)
        return await self._request(credential, "GET",
                                   f"/v1/runtimes/{credential.runtime_id}/access-grants/{grant_id}", False)

    async def revoke(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant:
        self._validate_grant_id(grant_id)
        return await self._request(credential, "DELETE",
                                   f"/v1/runtimes/{credential.runtime_id}/access-grants/{grant_id}", False)

    async def _request(self, credential: RuntimeCredential, method: str, path: str,
                       include_code: bool) -> MobilePairingGrant:
        last_error: MobilePairingError | None = None
        for attempt in range(2):
            correlation_id = str(uuid4())
            try:
                return await self._request_once(credential, method, path, include_code, correlation_id)
            except MobilePairingError as exc:
                last_error = exc
                if not exc.retryable or attempt == 1:
                    raise
        assert last_error is not None
        raise last_error

    async def _request_once(self, credential: RuntimeCredential, method: str, path: str,
                            include_code: bool, correlation_id: str) -> MobilePairingGrant:
        try:
            async with self.session_factory(timeout=self.timeout, raise_for_status=False) as session:
                async with session.request(method, f"{self.root}{path}",
                                           headers={"X-Runtime-Token": credential.registration_token,
                                                    "X-Correlation-ID": correlation_id},
                                           allow_redirects=False) as response:
                    if response.status >= 400:
                        self._raise_http(response.status, response.headers.get("X-Correlation-ID") or correlation_id)
                    body = await response.json()
        except MobilePairingError:
            raise
        except (aiohttp.ClientConnectionError, aiohttp.ServerTimeoutError, TimeoutError) as exc:
            raise MobilePairingError("relay_unavailable", "Runtime Relay is unavailable.",
                                     retryable=True, action="retry", correlation_id=correlation_id) from exc
        except (aiohttp.ClientError, ValueError, TypeError) as exc:
            raise MobilePairingError("relay_response_invalid", "Runtime Relay returned an invalid response.",
                                     retryable=True, action="retry", correlation_id=correlation_id) from exc
        return self._decode(body, include_code)

    @staticmethod
    def _raise_http(status: int, correlation_id: str | None = None) -> None:
        if status in {401, 403}:
            raise MobilePairingError("runtime_credential_invalid", "Runtime Relay credential was rejected.",
                                     retryable=False, action="repair_runtime", correlation_id=correlation_id)
        if status == 404:
            raise MobilePairingError("access_grant_not_found", "Access grant was not found.",
                                     retryable=False, action="refresh", correlation_id=correlation_id)
        if status == 429:
            raise MobilePairingError("pairing_rate_limited", "Too many pairing requests.",
                                     retryable=True, action="wait", correlation_id=correlation_id)
        raise MobilePairingError("relay_http_error", "Runtime Relay request failed.",
                                 retryable=status >= 500, action="retry" if status >= 500 else "repair_runtime",
                                 correlation_id=correlation_id)

    @staticmethod
    def _decode(body: Any, include_code: bool) -> MobilePairingGrant:
        if not isinstance(body, dict):
            raise MobilePairingError("relay_response_invalid", "Runtime Relay returned an invalid response.",
                                     retryable=True, action="retry")
        grant_id, status = str(body.get("grant_id", "")), str(body.get("status", ""))
        code = str(body.get("code", "")) if include_code else None
        try:
            expires_at = datetime.fromisoformat(str(body.get("expires_at", "")).replace("Z", "+00:00"))
        except ValueError as exc:
            raise MobilePairingError("relay_response_invalid", "Runtime Relay returned an invalid response.",
                                     retryable=True, action="retry") from exc
        if not GRANT_ID.fullmatch(grant_id) or status not in GRANT_STATUS or (include_code and not GRANT_CODE.fullmatch(code or "")):
            raise MobilePairingError("relay_response_invalid", "Runtime Relay returned an invalid response.",
                                     retryable=True, action="retry")
        return MobilePairingGrant(grant_id, code, expires_at, status)

    @staticmethod
    def _validate_grant_id(grant_id: str) -> None:
        if not GRANT_ID.fullmatch(grant_id):
            raise MobilePairingError("access_grant_id_invalid", "Access grant ID is invalid.",
                                     retryable=False, action="refresh")


class MobilePairingService:
    def __init__(self, state_root: Path, *, credential_store: RuntimeCredentialStore | None = None,
                 transport_factory: Callable[[str], MobilePairingTransport] = AiohttpMobilePairingTransport) -> None:
        self.relay_state = state_root / "runtime" / "relay"
        self.credential_store = credential_store or RuntimeCredentialStore(self.relay_state / "credential.dpapi")
        self.transport_factory = transport_factory
        self._offline = False

    def readiness(self) -> dict[str, str]:
        credential_path, url_path = self.credential_store.path, self.relay_state / "relay-wss-url"
        if not credential_path.is_file() or not url_path.is_file():
            return {"state": "not_registered", "action": "register_runtime"}
        try:
            credential = self.credential_store.load()
            relay_url = relay_https_from_wss(url_path.read_text(encoding="utf-8"))
            environment, _ = pairing_environment(relay_url)
            if self._offline:
                return {"state": "offline", "action": "retry", "runtime_id": credential.runtime_id,
                        "environment": environment}
            return {"state": "ready", "action": "create", "runtime_id": credential.runtime_id,
                    "environment": environment}
        except Exception:
            return {"state": "credential_invalid", "action": "repair_runtime"}

    async def create(self) -> MobilePairingGrant:
        credential, relay_url, transport = self._configured()
        grant = await self._with_connectivity_state(transport.create(credential))
        return MobilePairingGrant(grant.grant_id, None, grant.expires_at, grant.status,
                                  build_pairing_payload(grant.code or "", relay_url))

    async def read(self, grant_id: str) -> MobilePairingGrant:
        credential, _, transport = self._configured()
        return await self._with_connectivity_state(transport.read(credential, grant_id))

    async def revoke(self, grant_id: str) -> MobilePairingGrant:
        credential, _, transport = self._configured()
        return await self._with_connectivity_state(transport.revoke(credential, grant_id))

    async def _with_connectivity_state(self, operation):
        try:
            result = await operation
            self._offline = False
            return result
        except MobilePairingError as exc:
            if exc.code in {"relay_unavailable", "relay_http_error"} and exc.retryable:
                self._offline = True
            raise

    def _configured(self) -> tuple[RuntimeCredential, str, MobilePairingTransport]:
        url_path = self.relay_state / "relay-wss-url"
        if not self.credential_store.path.is_file() or not url_path.is_file():
            raise MobilePairingError("runtime_not_registered", "Runtime is not registered with Relay.",
                                     retryable=False, action="register_runtime")
        try:
            credential = self.credential_store.load()
        except Exception as exc:
            raise MobilePairingError("runtime_credential_invalid", "Runtime Relay credential is unavailable.",
                                     retryable=False, action="repair_runtime") from exc
        relay_url = relay_https_from_wss(url_path.read_text(encoding="utf-8"))
        return credential, relay_url, self.transport_factory(relay_url)
