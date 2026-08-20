from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from drsai.backend.runtime.security_boundary import (
    HostLocalSecurityMetricsNamedPipeTransport,
    HostMetricsNamedPipeConfig,
    SecurityMetricsTransportError,
)


class FakeExporter:
    def __init__(self, payload: str = "security_audit_integrity{valid=\"true\"} 1\n"):
        self.payload = payload
        self.calls = 0

    def render(self, *, now=None):
        self.calls += 1
        return self.payload


class FakeSession:
    def __init__(self, *, peer_sid: str, request: bytes, entered=None, release=None):
        self._peer_sid = peer_sid
        self.request = request
        self.entered = entered
        self.release = release
        self.writes: list[bytes] = []
        self.closed = False

    @property
    def peer_sid(self):
        return self._peer_sid

    def read(self, maximum_bytes: int, timeout_seconds: float) -> bytes:
        if self.entered is not None:
            self.entered.set()
        if self.release is not None:
            assert self.release.wait(timeout=5)
        return self.request[:maximum_bytes]

    def write_all(self, payload: bytes, timeout_seconds: float) -> None:
        self.writes.append(payload)

    def close(self) -> None:
        self.closed = True


class FakeNativeApi:
    backend_id = "windows-authenticated-named-pipe"
    backend_version = "1"

    def __init__(self, sessions):
        self.sessions = list(sessions)
        self.accepts: list[dict[str, object]] = []

    def accept(self, **kwargs):
        self.accepts.append(kwargs)
        return self.sessions.pop(0)


def _config(**kwargs) -> HostMetricsNamedPipeConfig:
    values = {
        "enabled": True,
        "instance_id": "0123456789abcdef0123456789abcdef",
        "allowed_client_sids": frozenset({"S-1-5-18"}),
        "timeout_seconds": 1,
        "max_concurrent_scrapes": 1,
    }
    values.update(kwargs)
    return HostMetricsNamedPipeConfig(**values)


def test_named_pipe_transport_is_disabled_by_default_and_has_no_fallback() -> None:
    disabled = HostLocalSecurityMetricsNamedPipeTransport(FakeExporter(), HostMetricsNamedPipeConfig())
    with pytest.raises(SecurityMetricsTransportError) as stopped:
        disabled.serve_once()
    assert stopped.value.code == "security_metrics_pipe_disabled"
    with pytest.raises(SecurityMetricsTransportError):
        _ = disabled.pipe_name

    with pytest.raises(SecurityMetricsTransportError) as missing:
        HostLocalSecurityMetricsNamedPipeTransport(FakeExporter(), _config())
    assert missing.value.code == "security_metrics_pipe_backend_missing"


def test_named_pipe_happy_path_uses_fixed_name_protected_acl_and_read_only_request() -> None:
    exporter = FakeExporter()
    session = FakeSession(peer_sid="s-1-5-18", request=b"GET /metrics\n")
    native = FakeNativeApi([session])
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        exporter, _config(), native_api=native,
    )
    written = transport.serve_once(now=100)
    assert written == len(exporter.payload.encode())
    assert session.writes == [exporter.payload.encode()]
    assert session.closed
    assert native.accepts == [{
        "pipe_name": r"\\.\pipe\OpenDrSai.SecurityMetrics.0123456789abcdef0123456789abcdef",
        "security_descriptor_sddl": "D:P(A;;GRGW;;;S-1-5-18)",
        "timeout_seconds": 1,
    }]


def test_peer_and_protocol_are_rejected_before_metrics_are_rendered() -> None:
    for session, expected in (
        (FakeSession(peer_sid="S-1-5-21-999", request=b"GET /metrics\n"),
         "security_metrics_pipe_peer_denied"),
        (FakeSession(peer_sid="S-1-5-18", request=b"POST /approve\n"),
         "security_metrics_pipe_request_invalid"),
        (FakeSession(peer_sid="S-1-5-18", request=b"X" * 33),
         "security_metrics_pipe_request_too_large"),
    ):
        exporter = FakeExporter()
        transport = HostLocalSecurityMetricsNamedPipeTransport(
            exporter, _config(max_request_bytes=32), native_api=FakeNativeApi([session]),
        )
        with pytest.raises(SecurityMetricsTransportError) as rejected:
            transport.serve_once()
        assert rejected.value.code == expected
        assert exporter.calls == 0
        assert session.closed


def test_named_pipe_concurrency_limit_fails_closed_without_second_accept() -> None:
    entered = threading.Event()
    release = threading.Event()
    first = FakeSession(
        peer_sid="S-1-5-18", request=b"GET /metrics\n", entered=entered, release=release,
    )
    native = FakeNativeApi([first])
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        FakeExporter(), _config(max_concurrent_scrapes=1), native_api=native,
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(transport.serve_once)
        assert entered.wait(timeout=5)
        with pytest.raises(SecurityMetricsTransportError) as busy:
            transport.serve_once()
        assert busy.value.code == "security_metrics_pipe_busy"
        release.set()
        assert future.result(timeout=5) > 0
    assert len(native.accepts) == 1


def test_named_pipe_backend_identity_and_configuration_are_strict() -> None:
    untrusted = FakeNativeApi([])
    untrusted.backend_version = "2"
    with pytest.raises(SecurityMetricsTransportError) as rejected:
        HostLocalSecurityMetricsNamedPipeTransport(FakeExporter(), _config(), native_api=untrusted)
    assert rejected.value.code == "security_metrics_pipe_backend_untrusted"
    with pytest.raises(ValueError):
        _config(instance_id="workspace-controlled-name")
    with pytest.raises(ValueError):
        _config(allowed_client_sids=frozenset({"Everyone"}))
    with pytest.raises(ValueError):
        _config(max_concurrent_scrapes=2)
