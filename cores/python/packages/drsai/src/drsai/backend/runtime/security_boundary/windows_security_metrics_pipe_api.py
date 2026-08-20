"""Native Win32 authenticated named-pipe provider for security metrics."""

from __future__ import annotations

import ctypes
import os
import platform
import time
from ctypes import wintypes


class WindowsSecurityMetricsPipeError(OSError):
    pass


if platform.system() == "Windows":
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

    class _SECURITY_ATTRIBUTES(ctypes.Structure):
        _fields_ = [
            ("nLength", wintypes.DWORD),
            ("lpSecurityDescriptor", wintypes.LPVOID),
            ("bInheritHandle", wintypes.BOOL),
        ]

    class _SID_AND_ATTRIBUTES(ctypes.Structure):
        _fields_ = [("Sid", wintypes.LPVOID), ("Attributes", wintypes.DWORD)]

    class _TOKEN_USER(ctypes.Structure):
        _fields_ = [("User", _SID_AND_ATTRIBUTES)]

    _kernel32.CreateNamedPipeW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
        wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(_SECURITY_ATTRIBUTES),
    ]
    _kernel32.CreateNamedPipeW.restype = wintypes.HANDLE
    _kernel32.ConnectNamedPipe.argtypes = [wintypes.HANDLE, wintypes.LPVOID]
    _kernel32.ConnectNamedPipe.restype = wintypes.BOOL
    _kernel32.DisconnectNamedPipe.argtypes = [wintypes.HANDLE]
    _kernel32.DisconnectNamedPipe.restype = wintypes.BOOL
    _kernel32.ReadFile.argtypes = [
        wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
    ]
    _kernel32.ReadFile.restype = wintypes.BOOL
    _kernel32.WriteFile.argtypes = [
        wintypes.HANDLE, wintypes.LPCVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
    ]
    _kernel32.WriteFile.restype = wintypes.BOOL
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel32.CloseHandle.restype = wintypes.BOOL
    _kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    _kernel32.LocalFree.restype = wintypes.HLOCAL
    _kernel32.GetCurrentThread.restype = wintypes.HANDLE
    _kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    _kernel32.GetProcessHandleCount.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    _kernel32.GetProcessHandleCount.restype = wintypes.BOOL
    _advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.DWORD),
    ]
    _advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    _advapi32.ImpersonateNamedPipeClient.argtypes = [wintypes.HANDLE]
    _advapi32.ImpersonateNamedPipeClient.restype = wintypes.BOOL
    _advapi32.RevertToSelf.restype = wintypes.BOOL
    _advapi32.OpenThreadToken.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.BOOL,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    _advapi32.OpenThreadToken.restype = wintypes.BOOL
    _advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE),
    ]
    _advapi32.OpenProcessToken.restype = wintypes.BOOL
    _advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    _advapi32.GetTokenInformation.restype = wintypes.BOOL
    _advapi32.ConvertSidToStringSidW.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.LPWSTR)]
    _advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL


_INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
_PIPE_ACCESS_DUPLEX = 0x00000003
_FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000
_PIPE_TYPE_BYTE = 0x00000000
_PIPE_READMODE_BYTE = 0x00000000
_PIPE_NOWAIT = 0x00000001
_PIPE_REJECT_REMOTE_CLIENTS = 0x00000008
_ERROR_NO_DATA = 232
_ERROR_PIPE_CONNECTED = 535
_ERROR_PIPE_LISTENING = 536
_ERROR_MORE_DATA = 234
_TOKEN_QUERY = 0x0008
_TOKEN_USER_CLASS = 1
_SDDL_REVISION_1 = 1


def _win_error(operation: str) -> WindowsSecurityMetricsPipeError:
    code = ctypes.get_last_error()
    return WindowsSecurityMetricsPipeError(code, f"Win32 named-pipe {operation} failed")


def _sid_from_token(token: int) -> str:
    needed = wintypes.DWORD()
    _advapi32.GetTokenInformation(token, _TOKEN_USER_CLASS, None, 0, ctypes.byref(needed))
    if not needed.value:
        raise _win_error("token-size")
    buffer = ctypes.create_string_buffer(needed.value)
    if not _advapi32.GetTokenInformation(
        token, _TOKEN_USER_CLASS, buffer, needed.value, ctypes.byref(needed),
    ):
        raise _win_error("token-user")
    token_user = ctypes.cast(buffer, ctypes.POINTER(_TOKEN_USER)).contents
    text = wintypes.LPWSTR()
    if not _advapi32.ConvertSidToStringSidW(token_user.User.Sid, ctypes.byref(text)):
        raise _win_error("sid-string")
    try:
        return str(text.value)
    finally:
        _kernel32.LocalFree(text)


def current_process_sid() -> str:
    if platform.system() != "Windows":
        raise WindowsSecurityMetricsPipeError("Windows named pipes are unavailable")
    token = wintypes.HANDLE()
    if not _advapi32.OpenProcessToken(
        _kernel32.GetCurrentProcess(), _TOKEN_QUERY, ctypes.byref(token),
    ):
        raise _win_error("open-process-token")
    try:
        return _sid_from_token(token)
    finally:
        _kernel32.CloseHandle(token)


def current_process_handle_count() -> int:
    if platform.system() != "Windows":
        raise WindowsSecurityMetricsPipeError("Windows handle counts are unavailable")
    count = wintypes.DWORD()
    if not _kernel32.GetProcessHandleCount(_kernel32.GetCurrentProcess(), ctypes.byref(count)):
        raise _win_error("process-handle-count")
    return int(count.value)


class WindowsAuthenticatedNamedPipeSession:
    def __init__(self, handle: int, peer_sid: str | None = None):
        self.handle = handle
        self._peer_sid = peer_sid
        self._closed = False

    @property
    def peer_sid(self) -> str:
        if self._peer_sid is None:
            self._peer_sid = WindowsAuthenticatedNamedPipeApi._peer_sid(self.handle)
        return self._peer_sid

    @staticmethod
    def _deadline(timeout_seconds: float) -> float:
        return time.monotonic() + timeout_seconds

    def read(self, maximum_bytes: int, timeout_seconds: float) -> bytes:
        deadline = self._deadline(timeout_seconds)
        while True:
            buffer = ctypes.create_string_buffer(maximum_bytes)
            read = wintypes.DWORD()
            if _kernel32.ReadFile(
                self.handle, buffer, maximum_bytes, ctypes.byref(read), None,
            ):
                return bytes(buffer.raw[:read.value])
            error = ctypes.get_last_error()
            if error in {_ERROR_NO_DATA, _ERROR_MORE_DATA} and time.monotonic() < deadline:
                time.sleep(0.005)
                continue
            if error in {_ERROR_NO_DATA, _ERROR_MORE_DATA}:
                raise TimeoutError("Named-pipe read timed out")
            raise _win_error("read")

    def write_all(self, payload: bytes, timeout_seconds: float) -> None:
        deadline = self._deadline(timeout_seconds)
        offset = 0
        while offset < len(payload):
            remaining = payload[offset:]
            written = wintypes.DWORD()
            buffer = ctypes.create_string_buffer(remaining)
            if _kernel32.WriteFile(
                self.handle, buffer, len(remaining), ctypes.byref(written), None,
            ):
                if not written.value:
                    raise WindowsSecurityMetricsPipeError("Named-pipe write made no progress")
                offset += written.value
                continue
            error = ctypes.get_last_error()
            if error == _ERROR_NO_DATA and time.monotonic() < deadline:
                time.sleep(0.005)
                continue
            if error == _ERROR_NO_DATA:
                raise TimeoutError("Named-pipe write timed out")
            raise _win_error("write")

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        _kernel32.DisconnectNamedPipe(self.handle)
        _kernel32.CloseHandle(self.handle)


class WindowsAuthenticatedNamedPipeApi:
    backend_id = "windows-authenticated-named-pipe"
    backend_version = "1"

    def __init__(self, *, input_buffer_bytes: int = 4096, output_buffer_bytes: int = 1024 * 1024):
        if platform.system() != "Windows":
            raise WindowsSecurityMetricsPipeError("Windows named pipes are unavailable")
        self.input_buffer_bytes = input_buffer_bytes
        self.output_buffer_bytes = output_buffer_bytes

    @staticmethod
    def _peer_sid(handle: int) -> str:
        if not _advapi32.ImpersonateNamedPipeClient(handle):
            raise _win_error("impersonate-client")
        token = wintypes.HANDLE()
        try:
            if not _advapi32.OpenThreadToken(
                _kernel32.GetCurrentThread(), _TOKEN_QUERY, False, ctypes.byref(token),
            ):
                raise _win_error("open-client-token")
            return _sid_from_token(token)
        finally:
            if token:
                _kernel32.CloseHandle(token)
            if not _advapi32.RevertToSelf():
                raise _win_error("revert-impersonation")

    def accept(self, *, pipe_name: str, security_descriptor_sddl: str, timeout_seconds: float):
        descriptor = wintypes.LPVOID()
        if not _advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            security_descriptor_sddl, _SDDL_REVISION_1, ctypes.byref(descriptor), None,
        ):
            raise _win_error("security-descriptor")
        attributes = _SECURITY_ATTRIBUTES(
            ctypes.sizeof(_SECURITY_ATTRIBUTES), descriptor, False,
        )
        handle = None
        try:
            handle = _kernel32.CreateNamedPipeW(
                pipe_name,
                _PIPE_ACCESS_DUPLEX | _FILE_FLAG_FIRST_PIPE_INSTANCE,
                _PIPE_TYPE_BYTE | _PIPE_READMODE_BYTE | _PIPE_NOWAIT | _PIPE_REJECT_REMOTE_CLIENTS,
                1, self.output_buffer_bytes, self.input_buffer_bytes,
                max(1, int(timeout_seconds * 1000)), ctypes.byref(attributes),
            )
        finally:
            _kernel32.LocalFree(descriptor)
        if handle == _INVALID_HANDLE_VALUE:
            raise _win_error("create")
        deadline = time.monotonic() + timeout_seconds
        try:
            while True:
                if _kernel32.ConnectNamedPipe(handle, None):
                    break
                error = ctypes.get_last_error()
                if error == _ERROR_PIPE_CONNECTED:
                    break
                if error == _ERROR_PIPE_LISTENING and time.monotonic() < deadline:
                    time.sleep(0.005)
                    continue
                if error == _ERROR_PIPE_LISTENING:
                    raise TimeoutError("Named-pipe connect timed out")
                raise _win_error("connect")
            return WindowsAuthenticatedNamedPipeSession(handle)
        except BaseException:
            _kernel32.DisconnectNamedPipe(handle)
            _kernel32.CloseHandle(handle)
            raise
