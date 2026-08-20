"""DNS-aware, pinned-IP HTTP egress policy and credential injection."""

from __future__ import annotations

import ipaddress
import http.client
import socket
import ssl
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol, Sequence
from urllib.parse import urljoin, urlsplit, urlunsplit

from .audit import SecurityEventJournal
from .credentials import CredentialBroker, CredentialBrokerError, normalize_credential_target
from .models import ResolvedCapabilityProfile, canonical_digest


class NetworkPolicyError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


DnsResolver = Callable[[str, int], Sequence[str]]
_DENIED_HOSTNAMES = frozenset({
    "metadata.google.internal",
    "metadata.azure.internal",
    "instance-data.ec2.internal",
})
_REDIRECTS = frozenset({301, 302, 303, 307, 308})
_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"})
_FORBIDDEN_CALLER_HEADERS = frozenset({
    "authorization", "proxy-authorization", "host", "connection", "transfer-encoding", "upgrade",
})


def default_dns_resolver(hostname: str, port: int) -> tuple[str, ...]:
    try:
        records = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise NetworkPolicyError("network_dns_failed", "Network target could not be resolved.") from error
    return tuple(sorted({str(record[4][0]) for record in records}))


def _public_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as error:
        raise NetworkPolicyError("network_dns_invalid", "DNS returned an invalid IP address.") from error
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if (
        not address.is_global
        or address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise NetworkPolicyError("network_address_denied", f"Non-public network address is denied: {address}")
    return address


@dataclass(frozen=True)
class NetworkAuthorization:
    authorization_id: str
    run_id: str
    profile_digest: str
    url: str
    origin: str
    hostname: str
    port: int
    resolved_ips: tuple[str, ...]
    selected_ip: str
    expires_at: float

    @property
    def digest(self) -> str:
        return canonical_digest(self.__dict__)


@dataclass(frozen=True)
class PinnedHttpRequest:
    request_id: str
    method: str
    url: str
    connect_ip: str
    connect_port: int
    tls_server_name: str
    headers: Mapping[str, str] = field(default_factory=dict)
    sensitive_headers: Mapping[str, bytearray] = field(default_factory=dict)
    body: bytes = b""
    timeout_seconds: float = 30
    authorization_digest: str = ""


@dataclass(frozen=True)
class PinnedHttpResponse:
    status_code: int
    headers: Mapping[str, str]
    body: bytes
    peer_ip: str


class PinnedHttpTransport(Protocol):
    """Transport must connect to connect_ip while validating TLS server_name."""

    def send(self, request: PinnedHttpRequest) -> PinnedHttpResponse: ...


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to a reviewed IP while retaining hostname TLS verification."""

    def __init__(self, connect_ip: str, port: int, tls_server_name: str, timeout: float):
        super().__init__(tls_server_name, port=port, timeout=timeout, context=ssl.create_default_context())
        self.connect_ip = connect_ip
        self.peer_ip = ""

    def connect(self) -> None:
        raw = socket.create_connection((self.connect_ip, self.port), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
            self.peer_ip = str(self.sock.getpeername()[0])
        except BaseException:
            raw.close()
            raise


PinnedConnectionFactory = Callable[[str, int, str, float], Any]


class StdlibPinnedHttpsTransport:
    """Proxy-free HTTPS transport implementing the pinned connection contract."""

    def __init__(
        self,
        *,
        connection_factory: PinnedConnectionFactory | None = None,
        max_response_bytes: int = 16 * 1024 * 1024,
    ):
        self.connection_factory = connection_factory or _PinnedHTTPSConnection
        self.max_response_bytes = max_response_bytes

    def send(self, request: PinnedHttpRequest) -> PinnedHttpResponse:
        parsed = urlsplit(request.url)
        if parsed.hostname != request.tls_server_name or (parsed.port or 443) != request.connect_port:
            raise NetworkPolicyError("network_transport_scope_mismatch", "Transport URL differs from pinned TLS scope.")
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query
        connection = self.connection_factory(
            request.connect_ip, request.connect_port, request.tls_server_name, request.timeout_seconds,
        )
        headers: dict[str, str | bytes] = dict(request.headers)
        headers.update({name: bytes(value) for name, value in request.sensitive_headers.items()})
        try:
            connection.request(request.method, target, body=request.body or None, headers=headers)
            response = connection.getresponse()
            body = response.read(self.max_response_bytes + 1)
            if len(body) > self.max_response_bytes:
                raise NetworkPolicyError("network_response_too_large", "HTTP response exceeds the transport limit.")
            return PinnedHttpResponse(
                status_code=int(response.status),
                headers={str(name): str(value) for name, value in response.getheaders()},
                body=body,
                peer_ip=str(connection.peer_ip),
            )
        finally:
            connection.close()


class NetworkEgressBroker:
    MAX_REDIRECTS = 5
    MAX_BODY_BYTES = 16 * 1024 * 1024

    def __init__(
        self,
        database: object,
        *,
        resolver: DnsResolver = default_dns_resolver,
        credential_broker: CredentialBroker | None = None,
    ):
        self.audit = SecurityEventJournal(database)  # type: ignore[arg-type]
        self.resolver = resolver
        self.credential_broker = credential_broker

    def authorize(
        self,
        *,
        run_id: str,
        profile: ResolvedCapabilityProfile,
        url: str,
        now: float | None = None,
    ) -> NetworkAuthorization:
        checked_at = float(time.time() if now is None else now)
        if "network.connect" not in profile.capabilities:
            raise NetworkPolicyError("network_capability_denied", "Active profile does not allow network access.")
        parsed = urlsplit(url)
        if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise NetworkPolicyError("network_url_denied", "Only credential-free HTTPS URLs are allowed.")
        try:
            port = parsed.port or 443
        except ValueError as error:
            raise NetworkPolicyError("network_url_denied", "Network target port is invalid.") from error
        hostname = parsed.hostname.rstrip(".").lower().encode("idna").decode("ascii")
        if hostname in _DENIED_HOSTNAMES or hostname.endswith((".local", ".localhost", ".internal")):
            raise NetworkPolicyError("network_hostname_denied", "Local and metadata hostnames are denied.")
        authority_host = f"[{hostname}]" if ":" in hostname else hostname
        origin = normalize_credential_target(f"https://{authority_host}:{port}")
        allowed = {normalize_credential_target(rule) for rule in profile.network_rules}
        if origin not in allowed:
            raise NetworkPolicyError("network_origin_denied", "Network origin is outside the active profile.")

        try:
            literal = ipaddress.ip_address(hostname)
            raw_addresses = (str(literal),)
        except ValueError:
            raw_addresses = tuple(self.resolver(hostname, port))
        if not raw_addresses:
            raise NetworkPolicyError("network_dns_empty", "Network target resolved to no addresses.")
        addresses = tuple(sorted({str(_public_ip(value)) for value in raw_addresses}))
        canonical_url = urlunsplit(("https", f"{authority_host}:{port}", parsed.path or "/", parsed.query, ""))
        authorization = NetworkAuthorization(
            authorization_id=f"network-authorization-{uuid.uuid4()}",
            run_id=run_id,
            profile_digest=profile.digest,
            url=canonical_url,
            origin=origin,
            hostname=hostname,
            port=port,
            resolved_ips=addresses,
            selected_ip=addresses[0],
            expires_at=checked_at + 60,
        )
        self.audit.append("network.authorized", authorization.authorization_id, {
            "run_id": run_id,
            "profile_digest": profile.digest,
            "origin": origin,
            "hostname": hostname,
            "port": port,
            "resolved_ips": list(addresses),
            "selected_ip": authorization.selected_ip,
            "expires_at": authorization.expires_at,
        }, now=checked_at)
        return authorization

    @staticmethod
    def _headers(values: Mapping[str, str]) -> dict[str, str]:
        result: dict[str, str] = {}
        for name, value in values.items():
            normalized = str(name).strip().lower()
            if not normalized or normalized in _FORBIDDEN_CALLER_HEADERS or "\r" in value or "\n" in value:
                raise NetworkPolicyError("network_header_denied", f"Caller-controlled header is denied: {name}")
            result[normalized] = str(value)
        return result

    def request(
        self,
        *,
        run_id: str,
        profile: ResolvedCapabilityProfile,
        method: str,
        url: str,
        transport: PinnedHttpTransport,
        headers: Mapping[str, str] | None = None,
        body: bytes = b"",
        timeout_seconds: float = 30,
        credential_lease_id: str | None = None,
        credential_purpose: str | None = None,
        now: float | None = None,
    ) -> PinnedHttpResponse:
        normalized_method = method.upper()
        if normalized_method not in _METHODS:
            raise NetworkPolicyError("network_method_denied", "HTTP method is not allowed.")
        if len(body) > self.MAX_BODY_BYTES:
            raise NetworkPolicyError("network_body_too_large", "HTTP request body exceeds the broker limit.")
        if timeout_seconds <= 0 or timeout_seconds > 300:
            raise NetworkPolicyError("network_timeout_invalid", "HTTP timeout is outside the broker limit.")
        current_url = url
        caller_headers = self._headers(headers or {})
        credential_used = False
        for redirect_count in range(self.MAX_REDIRECTS + 1):
            authorization = self.authorize(run_id=run_id, profile=profile, url=current_url, now=now)
            request_headers = dict(caller_headers)
            sensitive_headers: dict[str, bytearray] = {}
            if credential_lease_id is not None:
                if credential_used:
                    raise NetworkPolicyError(
                        "credential_redirect_requires_new_lease",
                        "Credentials are never replayed across redirects; issue a new lease for the next origin.",
                    )
                if self.credential_broker is None or not credential_purpose:
                    raise NetworkPolicyError("credential_broker_unavailable", "Credential injection is unavailable.")
                try:
                    material = self.credential_broker.consume(
                        credential_lease_id,
                        run_id=run_id,
                        profile=profile,
                        purpose=credential_purpose,
                        target=authorization.origin,
                        now=now,
                    )
                except CredentialBrokerError as error:
                    raise NetworkPolicyError(error.code, str(error)) from error
                with material:
                    secret = material.read()
                    try:
                        value = secret.decode("utf-8")
                    except UnicodeDecodeError as error:
                        raise NetworkPolicyError("credential_encoding_invalid", "HTTP credential must be UTF-8.") from error
                    if "\r" in value or "\n" in value:
                        raise NetworkPolicyError("credential_header_invalid", "HTTP credential contains header delimiters.")
                    sensitive_headers["authorization"] = bytearray(f"Bearer {value}".encode("utf-8"))
                credential_used = True
            outbound = PinnedHttpRequest(
                request_id=f"network-request-{uuid.uuid4()}",
                method=normalized_method,
                url=authorization.url,
                connect_ip=authorization.selected_ip,
                connect_port=authorization.port,
                tls_server_name=authorization.hostname,
                headers=request_headers,
                sensitive_headers=sensitive_headers,
                body=body,
                timeout_seconds=timeout_seconds,
                authorization_digest=authorization.digest,
            )
            try:
                response = transport.send(outbound)
            finally:
                for sensitive_value in sensitive_headers.values():
                    for index in range(len(sensitive_value)):
                        sensitive_value[index] = 0
            if str(_public_ip(response.peer_ip)) != authorization.selected_ip:
                raise NetworkPolicyError("network_peer_mismatch", "Transport peer differs from the authorized pinned IP.")
            if len(response.body) > self.MAX_BODY_BYTES:
                raise NetworkPolicyError("network_response_too_large", "HTTP response exceeds the broker limit.")
            self.audit.append("network.response", outbound.request_id, {
                "run_id": run_id,
                "origin": authorization.origin,
                "selected_ip": authorization.selected_ip,
                "method": normalized_method,
                "status_code": response.status_code,
                "redirect_count": redirect_count,
                "credential_used": credential_used,
                "response_bytes": len(response.body),
            }, now=now)
            if response.status_code not in _REDIRECTS:
                return response
            location = next((value for name, value in response.headers.items() if name.lower() == "location"), "")
            if not location:
                raise NetworkPolicyError("network_redirect_invalid", "Redirect response is missing Location.")
            current_url = urljoin(authorization.url, location)
            if response.status_code == 303:
                normalized_method, body = "GET", b""
        raise NetworkPolicyError("network_redirect_limit", "HTTP redirect limit exceeded.")
