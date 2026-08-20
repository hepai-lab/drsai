from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    CredentialBroker,
    NetworkEgressBroker,
    NetworkPolicyError,
    PinnedHttpRequest,
    PinnedHttpResponse,
    ResolvedCapabilityProfile,
    StdlibPinnedHttpsTransport,
)


PUBLIC_ONE = "93.184.216.34"
PUBLIC_TWO = "142.250.72.14"


def network_profile(*origins: str, credential: bool = False) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id="network-profile",
        version=1,
        workspace_root="C:/workspace",
        capabilities=frozenset({"network.connect", *(("credential.use",) if credential else ())}),
        network_rules=origins,
        credential_refs=frozenset({"credential-ref-1"}) if credential else frozenset(),
        trusted_workspace=True,
    )


@dataclass
class FakeTransport:
    responses: list[PinnedHttpResponse]
    requests: list[PinnedHttpRequest] = field(default_factory=list)
    seen_sensitive_headers: list[dict[str, bytes]] = field(default_factory=list)

    def send(self, request: PinnedHttpRequest) -> PinnedHttpResponse:
        self.requests.append(request)
        self.seen_sensitive_headers.append({name: bytes(value) for name, value in request.sensitive_headers.items()})
        return self.responses.pop(0)


def response(status: int = 200, *, peer: str = PUBLIC_ONE, location: str | None = None) -> PinnedHttpResponse:
    headers = {"Location": location} if location else {}
    return PinnedHttpResponse(status, headers, b"ok", peer)


def test_network_is_default_deny_and_requires_exact_origin(tmp_path: Path) -> None:
    broker = NetworkEgressBroker(tmp_path / "security.sqlite3", resolver=lambda _host, _port: (PUBLIC_ONE,))
    no_network = ResolvedCapabilityProfile(
        profile_id="none", version=1, workspace_root="C:/workspace", capabilities=frozenset(),
    )
    with pytest.raises(NetworkPolicyError) as capability:
        broker.authorize(run_id="run-1", profile=no_network, url="https://example.com/data", now=100)
    assert capability.value.code == "network_capability_denied"

    active = network_profile("https://example.com:443")
    with pytest.raises(NetworkPolicyError) as origin:
        broker.authorize(run_id="run-1", profile=active, url="https://other.example/data", now=100)
    assert origin.value.code == "network_origin_denied"
    with pytest.raises(NetworkPolicyError) as plaintext:
        broker.authorize(run_id="run-1", profile=active, url="http://example.com/data", now=100)
    assert plaintext.value.code == "network_url_denied"


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1",
])
def test_network_rejects_non_public_dns_answers(tmp_path: Path, address: str) -> None:
    broker = NetworkEgressBroker(tmp_path / "security.sqlite3", resolver=lambda _host, _port: (address,))
    with pytest.raises(NetworkPolicyError) as denied:
        broker.authorize(
            run_id="run-1", profile=network_profile("https://example.com:443"),
            url="https://example.com/data", now=100,
        )
    assert denied.value.code == "network_address_denied"


def test_network_rejects_mixed_public_private_dns_and_metadata_names(tmp_path: Path) -> None:
    broker = NetworkEgressBroker(
        tmp_path / "security.sqlite3", resolver=lambda _host, _port: (PUBLIC_ONE, "127.0.0.1"),
    )
    with pytest.raises(NetworkPolicyError) as mixed:
        broker.authorize(
            run_id="run-1", profile=network_profile("https://example.com:443"),
            url="https://example.com", now=100,
        )
    assert mixed.value.code == "network_address_denied"

    metadata = NetworkEgressBroker(tmp_path / "metadata.sqlite3", resolver=lambda _host, _port: (PUBLIC_ONE,))
    with pytest.raises(NetworkPolicyError) as hostname:
        metadata.authorize(
            run_id="run-1", profile=network_profile("https://metadata.google.internal:443"),
            url="https://metadata.google.internal", now=100,
        )
    assert hostname.value.code == "network_hostname_denied"


def test_transport_is_pinned_to_reviewed_ip_and_tls_name(tmp_path: Path) -> None:
    broker = NetworkEgressBroker(tmp_path / "security.sqlite3", resolver=lambda _host, _port: (PUBLIC_ONE,))
    transport = FakeTransport([response()])
    result = broker.request(
        run_id="run-1", profile=network_profile("https://example.com:443"),
        method="GET", url="https://example.com/data?q=1", transport=transport, now=100,
    )
    assert result.status_code == 200
    outbound = transport.requests[0]
    assert outbound.connect_ip == PUBLIC_ONE
    assert outbound.connect_port == 443
    assert outbound.tls_server_name == "example.com"
    assert outbound.url == "https://example.com:443/data?q=1"
    assert outbound.authorization_digest.startswith("sha256:")

    mismatch = FakeTransport([response(peer=PUBLIC_TWO)])
    with pytest.raises(NetworkPolicyError) as peer:
        broker.request(
            run_id="run-1", profile=network_profile("https://example.com:443"),
            method="GET", url="https://example.com", transport=mismatch, now=101,
        )
    assert peer.value.code == "network_peer_mismatch"


def test_public_ipv6_literal_is_normalized_and_pinned(tmp_path: Path) -> None:
    public_ipv6 = "2606:4700:4700::1111"
    broker = NetworkEgressBroker(tmp_path / "security.sqlite3")
    transport = FakeTransport([response(peer=public_ipv6)])
    result = broker.request(
        run_id="run-1", profile=network_profile(f"https://[{public_ipv6}]:443"),
        method="GET", url=f"https://[{public_ipv6}]/dns-query", transport=transport, now=100,
    )
    assert result.status_code == 200
    assert transport.requests[0].connect_ip == public_ipv6
    assert transport.requests[0].url == f"https://[{public_ipv6}]:443/dns-query"


def test_redirect_is_reauthorized_for_each_origin(tmp_path: Path) -> None:
    addresses = {"first.example": PUBLIC_ONE, "second.example": PUBLIC_TWO}
    broker = NetworkEgressBroker(
        tmp_path / "security.sqlite3", resolver=lambda host, _port: (addresses[host],),
    )
    transport = FakeTransport([
        response(302, peer=PUBLIC_ONE, location="https://second.example/final"),
        response(200, peer=PUBLIC_TWO),
    ])
    profile = network_profile("https://first.example:443", "https://second.example:443")
    assert broker.request(
        run_id="run-1", profile=profile, method="GET",
        url="https://first.example/start", transport=transport, now=100,
    ).status_code == 200
    assert [item.connect_ip for item in transport.requests] == [PUBLIC_ONE, PUBLIC_TWO]

    denied_transport = FakeTransport([response(302, location="https://not-allowed.example/final")])
    with pytest.raises(NetworkPolicyError) as redirect:
        broker.request(
            run_id="run-1", profile=profile, method="GET",
            url="https://first.example/start", transport=denied_transport, now=100,
        )
    assert redirect.value.code == "network_origin_denied"


def test_credential_is_consumed_only_at_transport_boundary_and_not_audited(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    secret = "network-secret-canary"
    credentials = CredentialBroker(database, lambda _ref: secret)
    profile = network_profile("https://api.example.com:443", credential=True)
    lease = credentials.issue(
        run_id="run-1", profile=profile, credential_ref="credential-ref-1",
        purpose="api.read", target="https://api.example.com", now=100,
    )
    broker = NetworkEgressBroker(
        database, resolver=lambda _host, _port: (PUBLIC_ONE,), credential_broker=credentials,
    )
    transport = FakeTransport([response()])
    result = broker.request(
        run_id="run-1", profile=profile, method="GET", url="https://api.example.com/data",
        transport=transport, credential_lease_id=lease.lease_id, credential_purpose="api.read", now=101,
    )
    assert result.status_code == 200
    assert transport.seen_sensitive_headers[0]["authorization"] == f"Bearer {secret}".encode()
    assert set(transport.requests[0].sensitive_headers["authorization"]) == {0}
    assert credentials.get(lease.lease_id).status == "consumed"
    assert secret.encode() not in database.read_bytes()
    assert secret not in str(broker.audit.list())
    broker.audit.verify()


def test_credentials_are_not_replayed_across_redirects(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    credentials = CredentialBroker(database, lambda _ref: "secret")
    profile = network_profile("https://api.example.com:443", credential=True)
    lease = credentials.issue(
        run_id="run-1", profile=profile, credential_ref="credential-ref-1",
        purpose="api.read", target="https://api.example.com", now=100,
    )
    broker = NetworkEgressBroker(
        database, resolver=lambda _host, _port: (PUBLIC_ONE,), credential_broker=credentials,
    )
    transport = FakeTransport([response(302, location="/next")])
    with pytest.raises(NetworkPolicyError) as redirect:
        broker.request(
            run_id="run-1", profile=profile, method="GET", url="https://api.example.com/start",
            transport=transport, credential_lease_id=lease.lease_id, credential_purpose="api.read", now=101,
        )
    assert redirect.value.code == "credential_redirect_requires_new_lease"
    assert len(transport.requests) == 1


def test_caller_cannot_supply_authorization_or_header_injection(tmp_path: Path) -> None:
    broker = NetworkEgressBroker(tmp_path / "security.sqlite3", resolver=lambda _host, _port: (PUBLIC_ONE,))
    for headers in ({"Authorization": "Bearer bypass"}, {"X-Test": "safe\r\nHost: internal"}):
        with pytest.raises(NetworkPolicyError) as denied:
            broker.request(
                run_id="run-1", profile=network_profile("https://example.com:443"),
                method="GET", url="https://example.com", transport=FakeTransport([response()]),
                headers=headers, now=100,
            )
        assert denied.value.code == "network_header_denied"


class FakeHttpResponse:
    status = 200

    def getheaders(self) -> list[tuple[str, str]]:
        return [("Content-Type", "application/json")]

    def read(self, limit: int) -> bytes:
        assert limit > 2
        return b"{}"


class FakePinnedConnection:
    def __init__(self, connect_ip: str, port: int, server_name: str, timeout: float):
        self.arguments = (connect_ip, port, server_name, timeout)
        self.peer_ip = connect_ip
        self.sent: tuple[object, ...] | None = None
        self.closed = False

    def request(self, method: str, target: str, *, body: bytes | None, headers: dict[str, str | bytes]) -> None:
        self.sent = (method, target, body, headers)

    def getresponse(self) -> FakeHttpResponse:
        return FakeHttpResponse()

    def close(self) -> None:
        self.closed = True


def test_stdlib_transport_uses_connect_ip_separate_from_tls_name() -> None:
    created: list[FakePinnedConnection] = []

    def factory(ip: str, port: int, name: str, timeout: float) -> FakePinnedConnection:
        connection = FakePinnedConnection(ip, port, name, timeout)
        created.append(connection)
        return connection

    transport = StdlibPinnedHttpsTransport(connection_factory=factory)
    request = PinnedHttpRequest(
        request_id="request-1", method="POST", url="https://example.com:443/path?q=1",
        connect_ip=PUBLIC_ONE, connect_port=443, tls_server_name="example.com",
        headers={"content-type": "application/json"},
        sensitive_headers={"authorization": bytearray(b"Bearer secret")},
        body=b"{}", timeout_seconds=12, authorization_digest="sha256:authorization",
    )
    result = transport.send(request)
    assert created[0].arguments == (PUBLIC_ONE, 443, "example.com", 12)
    assert created[0].sent == (
        "POST", "/path?q=1", b"{}",
        {"content-type": "application/json", "authorization": b"Bearer secret"},
    )
    assert created[0].closed is True
    assert result.peer_ip == PUBLIC_ONE
