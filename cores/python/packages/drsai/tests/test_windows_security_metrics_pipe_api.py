from __future__ import annotations

import os
import platform
import time
import uuid
import ctypes
from ctypes import wintypes
from concurrent.futures import ThreadPoolExecutor

import pytest

from drsai.backend.runtime.security_boundary import (
    HostLocalSecurityMetricsNamedPipeTransport,
    HostMetricsNamedPipeConfig,
    SecurityMetricsTransportError,
    WindowsAuthenticatedNamedPipeApi,
    current_process_handle_count,
    current_process_sid,
)


pytestmark = pytest.mark.skipif(platform.system() != "Windows", reason="Win32 named-pipe E2E")


class _Exporter:
    payload = "security_audit_integrity{valid=\"true\"} 1\n"

    def render(self, *, now=None):
        return self.payload


_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if platform.system() == "Windows" else None
_GENERIC_READ = 0x80000000
_GENERIC_WRITE = 0x40000000
_OPEN_EXISTING = 3
_INVALID_HANDLE = ctypes.c_void_p(-1).value
_ERROR_NO_DATA = 232
if _kernel32 is not None:
    _kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    ]
    _kernel32.CreateFileW.restype = wintypes.HANDLE


def _open_pipe_with_retry(pipe_name: str, timeout: float):
    deadline = time.monotonic() + timeout
    while True:
        handle = _kernel32.CreateFileW(
            pipe_name, _GENERIC_READ | _GENERIC_WRITE, 0, None, _OPEN_EXISTING, 0, None,
        )
        if handle != _INVALID_HANDLE:
            return handle
        error = ctypes.get_last_error()
        if time.monotonic() >= deadline:
            raise OSError(error, "Win32 pipe client connect failed")
        time.sleep(0.01)


def _exchange(handle, request: bytes, expected_bytes: int, timeout: float) -> bytes:
    written = wintypes.DWORD()
    request_buffer = ctypes.create_string_buffer(request)
    if not _kernel32.WriteFile(handle, request_buffer, len(request), ctypes.byref(written), None):
        raise ctypes.WinError(ctypes.get_last_error())
    deadline = time.monotonic() + timeout
    while True:
        response_buffer = ctypes.create_string_buffer(expected_bytes)
        read = wintypes.DWORD()
        if _kernel32.ReadFile(
            handle, response_buffer, expected_bytes, ctypes.byref(read), None,
        ):
            return bytes(response_buffer.raw[:read.value])
        error = ctypes.get_last_error()
        if error == _ERROR_NO_DATA and time.monotonic() < deadline:
            time.sleep(0.005)
            continue
        raise OSError(error, "Win32 pipe client read failed")


def _write(handle, payload: bytes) -> None:
    written = wintypes.DWORD()
    buffer = ctypes.create_string_buffer(payload)
    if not _kernel32.WriteFile(handle, buffer, len(payload), ctypes.byref(written), None):
        raise ctypes.WinError(ctypes.get_last_error())
    assert written.value == len(payload)


def test_real_win32_pipe_authenticates_current_process_sid_and_scrapes() -> None:
    sid = current_process_sid()
    config = HostMetricsNamedPipeConfig(
        enabled=True, instance_id=uuid.uuid4().hex,
        allowed_client_sids=frozenset({sid}), timeout_seconds=2,
    )
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        _Exporter(), config, native_api=WindowsAuthenticatedNamedPipeApi(),
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        served = pool.submit(transport.serve_once, now=100)
        client = _open_pipe_with_retry(transport.pipe_name, 2)
        try:
            try:
                response = _exchange(client, b"GET /metrics\n", len(_Exporter.payload.encode()), 2)
            except OSError as client_error:
                server_error = served.exception(timeout=3)
                raise AssertionError(
                    f"client={client_error!r}; server={server_error!r}; "
                    f"cause={getattr(server_error, '__cause__', None)!r}"
                ) from client_error
        finally:
            _kernel32.CloseHandle(client)
        assert served.result(timeout=3) == len(response)
    assert response.decode() == _Exporter.payload


def test_real_win32_pipe_dacl_rejects_current_process_when_sid_not_allowed() -> None:
    current = current_process_sid().upper()
    denied_sid = "S-1-5-18" if current != "S-1-5-18" else "S-1-5-19"
    config = HostMetricsNamedPipeConfig(
        enabled=True, instance_id=uuid.uuid4().hex,
        allowed_client_sids=frozenset({denied_sid}), timeout_seconds=0.25,
    )
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        _Exporter(), config, native_api=WindowsAuthenticatedNamedPipeApi(),
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        served = pool.submit(transport.serve_once)
        with pytest.raises(OSError):
            client = _open_pipe_with_retry(transport.pipe_name, 0.1)
            _kernel32.CloseHandle(client)
        with pytest.raises(SecurityMetricsTransportError) as timed_out:
            served.result(timeout=2)
    assert timed_out.value.code == "security_metrics_pipe_io_failed"


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        (None, "security_metrics_pipe_io_failed"),
        (b"GET /met", "security_metrics_pipe_request_invalid"),
    ],
)
def test_real_win32_pipe_disconnect_and_partial_request_fail_closed(payload, expected_code: str) -> None:
    config = HostMetricsNamedPipeConfig(
        enabled=True, instance_id=uuid.uuid4().hex,
        allowed_client_sids=frozenset({current_process_sid()}), timeout_seconds=0.25,
    )
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        _Exporter(), config, native_api=WindowsAuthenticatedNamedPipeApi(),
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        served = pool.submit(transport.serve_once)
        client = _open_pipe_with_retry(transport.pipe_name, 1)
        if payload is not None:
            _write(client, payload)
        else:
            _kernel32.CloseHandle(client)
        try:
            with pytest.raises(SecurityMetricsTransportError) as rejected:
                served.result(timeout=2)
        finally:
            if payload is not None:
                _kernel32.CloseHandle(client)
    assert rejected.value.code == expected_code


def test_real_win32_pipe_read_timeout_cleans_handle_and_same_identity_restarts() -> None:
    instance_id = uuid.uuid4().hex
    config = HostMetricsNamedPipeConfig(
        enabled=True, instance_id=instance_id,
        allowed_client_sids=frozenset({current_process_sid()}), timeout_seconds=0.1,
    )
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        _Exporter(), config, native_api=WindowsAuthenticatedNamedPipeApi(),
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        served = pool.submit(transport.serve_once)
        client = _open_pipe_with_retry(transport.pipe_name, 1)
        with pytest.raises(SecurityMetricsTransportError) as timed_out:
            served.result(timeout=2)
        _kernel32.CloseHandle(client)
    assert timed_out.value.code == "security_metrics_pipe_io_failed"

    with ThreadPoolExecutor(max_workers=1) as pool:
        served = pool.submit(transport.serve_once)
        client = _open_pipe_with_retry(transport.pipe_name, 1)
        try:
            response = _exchange(client, b"GET /metrics\n", len(_Exporter.payload.encode()), 1)
        finally:
            _kernel32.CloseHandle(client)
        assert served.result(timeout=2) == len(response)


def test_real_win32_pipe_connect_timeout_stress_does_not_leak_handles() -> None:
    config = HostMetricsNamedPipeConfig(
        enabled=True, instance_id=uuid.uuid4().hex,
        allowed_client_sids=frozenset({current_process_sid()}), timeout_seconds=0.02,
    )
    transport = HostLocalSecurityMetricsNamedPipeTransport(
        _Exporter(), config, native_api=WindowsAuthenticatedNamedPipeApi(),
    )
    before = current_process_handle_count()
    for _ in range(25):
        with pytest.raises(SecurityMetricsTransportError) as timed_out:
            transport.serve_once()
        assert timed_out.value.code == "security_metrics_pipe_io_failed"
    after = current_process_handle_count()
    assert after <= before + 1
