"""Fail-closed Windows AppContainer profile and worker primitives."""

from __future__ import annotations

import ctypes
import hashlib
import os
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from .windows_job import WindowsJobLauncher, WindowsJobLimits


class WindowsAppContainerError(RuntimeError):
    def __init__(self, code: str, message: str, *, hresult: int | None = None):
        super().__init__(message)
        self.code = code
        self.hresult = hresult


class AppContainerApi(Protocol):
    def create_profile(self, name: str) -> tuple[int, int]: ...
    def delete_profile(self, name: str) -> int: ...
    def free_sid(self, sid: int) -> None: ...
    def sid_to_string(self, sid: int) -> str: ...


def _unsigned_hresult(value: int) -> int:
    return ctypes.c_uint32(value).value


def _failed_hresult(value: int) -> bool:
    return bool(_unsigned_hresult(value) & 0x80000000)


if os.name == "nt":
    from ctypes import wintypes

    _userenv = ctypes.WinDLL("userenv", use_last_error=True)
    _ole32 = ctypes.WinDLL("ole32", use_last_error=True)
    _advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _userenv.CreateAppContainerProfile.argtypes = [
        wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
        ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p),
    ]
    _userenv.CreateAppContainerProfile.restype = ctypes.c_long
    _userenv.DeleteAppContainerProfile.argtypes = [wintypes.LPCWSTR]
    _userenv.DeleteAppContainerProfile.restype = ctypes.c_long
    _ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    _advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    _advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    _kernel32.LocalFree.argtypes = [ctypes.c_void_p]

    class _STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD), ("lpReserved", wintypes.LPWSTR),
            ("lpDesktop", wintypes.LPWSTR), ("lpTitle", wintypes.LPWSTR),
            ("dwX", wintypes.DWORD), ("dwY", wintypes.DWORD),
            ("dwXSize", wintypes.DWORD), ("dwYSize", wintypes.DWORD),
            ("dwXCountChars", wintypes.DWORD), ("dwYCountChars", wintypes.DWORD),
            ("dwFillAttribute", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
            ("wShowWindow", wintypes.WORD), ("cbReserved2", wintypes.WORD),
            ("lpReserved2", ctypes.POINTER(ctypes.c_byte)),
            ("hStdInput", wintypes.HANDLE), ("hStdOutput", wintypes.HANDLE),
            ("hStdError", wintypes.HANDLE),
        ]

    class _STARTUPINFOEXW(ctypes.Structure):
        _fields_ = [("StartupInfo", _STARTUPINFOW), ("lpAttributeList", ctypes.c_void_p)]

    class _PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("hProcess", wintypes.HANDLE), ("hThread", wintypes.HANDLE),
            ("dwProcessId", wintypes.DWORD), ("dwThreadId", wintypes.DWORD),
        ]

    class _SECURITY_CAPABILITIES(ctypes.Structure):
        _fields_ = [
            ("AppContainerSid", ctypes.c_void_p), ("Capabilities", ctypes.c_void_p),
            ("CapabilityCount", wintypes.DWORD), ("Reserved", wintypes.DWORD),
        ]

    _kernel32.InitializeProcThreadAttributeList.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_size_t)]
    _kernel32.UpdateProcThreadAttribute.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
    _kernel32.DeleteProcThreadAttributeList.argtypes = [ctypes.c_void_p]
    _kernel32.GetProcessHeap.restype = wintypes.HANDLE
    _kernel32.HeapAlloc.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_size_t]
    _kernel32.HeapAlloc.restype = ctypes.c_void_p
    _kernel32.HeapFree.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p]
    _kernel32.CreateProcessW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p, ctypes.c_void_p,
        wintypes.BOOL, wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR,
        ctypes.POINTER(_STARTUPINFOW), ctypes.POINTER(_PROCESS_INFORMATION),
    ]
    _kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    _kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    _kernel32.ResumeThread.argtypes = [wintypes.HANDLE]
    _kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]


class NativeAppContainerApi:
    def __init__(self):
        if os.name != "nt":
            raise WindowsAppContainerError("appcontainer_unsupported", "AppContainer requires Windows.")

    def create_profile(self, name: str) -> tuple[int, int]:
        sid = ctypes.c_void_p()
        result = _userenv.CreateAppContainerProfile(
            name, "OpenDrSai isolated worker", "Ephemeral OpenDrSai execution profile",
            None, 0, ctypes.byref(sid),
        )
        return int(result), int(sid.value or 0)

    def delete_profile(self, name: str) -> int:
        return int(_userenv.DeleteAppContainerProfile(name))

    def free_sid(self, sid: int) -> None:
        if sid:
            _ole32.CoTaskMemFree(ctypes.c_void_p(sid))

    def sid_to_string(self, sid: int) -> str:
        value = wintypes.LPWSTR()
        if not sid or not _advapi32.ConvertSidToStringSidW(ctypes.c_void_p(sid), ctypes.byref(value)):
            raise WindowsAppContainerError("appcontainer_sid_conversion_failed", f"SID conversion failed: {ctypes.get_last_error()}")
        try:
            return str(value.value)
        finally:
            _kernel32.LocalFree(value)


@dataclass
class AppContainerProfile:
    name: str
    sid: int
    sid_string: str
    _api: AppContainerApi
    _closed: bool = False

    def close(self) -> None:
        if self._closed:
            return
        if self.sid:
            self._api.free_sid(self.sid)
            self.sid = 0
        result = self._api.delete_profile(self.name)
        if _failed_hresult(result):
            raise WindowsAppContainerError(
                "appcontainer_profile_delete_failed",
                f"DeleteAppContainerProfile failed with HRESULT {_unsigned_hresult(result):#010x}.",
                hresult=_unsigned_hresult(result),
            )
        self._closed = True

    def __enter__(self) -> "AppContainerProfile":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class WindowsAppContainerProfileFactory:
    """Creates uniquely-owned profiles so cleanup never deletes shared state."""

    def __init__(self, api: AppContainerApi | None = None):
        self.api = api or NativeAppContainerApi()

    @staticmethod
    def reserve_name(run_id: str) -> str:
        if not run_id:
            raise WindowsAppContainerError("appcontainer_run_id_missing", "Run identity is required.")
        run_digest = hashlib.sha256(run_id.encode("utf-8")).hexdigest()[:16]
        # CreateAppContainerProfile limits the identity name to 64 chars.
        # Keep randomness while reserving room for the stable product prefix.
        return f"OpenDrSai.Worker.{run_digest}.{uuid.uuid4().hex[:20]}"

    @staticmethod
    def _validate_owned_name(name: str) -> None:
        if not name.startswith("OpenDrSai.Worker.") or len(name) > 64 or not all(
            character.isalnum() or character == "." for character in name
        ):
            raise WindowsAppContainerError("appcontainer_profile_name_invalid", "Profile name is not an owned OpenDrSai identity.")

    def create_reserved(self, name: str) -> AppContainerProfile:
        self._validate_owned_name(name)
        result, sid = self.api.create_profile(name)
        unsigned = _unsigned_hresult(result)
        if _failed_hresult(result) or not sid:
            if sid:
                self.api.free_sid(sid)
            # A failed create does not establish ownership; deleting by name
            # here could remove a profile created concurrently by another actor.
            raise WindowsAppContainerError(
                "appcontainer_profile_create_failed",
                f"CreateAppContainerProfile failed with HRESULT {unsigned:#010x}.",
                hresult=unsigned,
            )
        try:
            sid_string = self.api.sid_to_string(sid)
        except BaseException:
            self.api.free_sid(sid)
            delete_result = self.api.delete_profile(name)
            if _failed_hresult(delete_result):
                raise WindowsAppContainerError(
                    "appcontainer_sid_conversion_cleanup_failed",
                    f"SID conversion and profile cleanup failed with HRESULT {_unsigned_hresult(delete_result):#010x}.",
                )
            raise
        return AppContainerProfile(name, sid, sid_string, self.api)

    def create(self, run_id: str) -> AppContainerProfile:
        return self.create_reserved(self.reserve_name(run_id))

    def delete_owned_profile(self, name: str, *, allow_missing: bool = True) -> None:
        self._validate_owned_name(name)
        result = self.api.delete_profile(name)
        unsigned = _unsigned_hresult(result)
        if allow_missing and unsigned in {0x80070002, 0x80070490}:
            return
        if _failed_hresult(result):
            raise WindowsAppContainerError(
                "appcontainer_profile_delete_failed",
                f"DeleteAppContainerProfile failed with HRESULT {unsigned:#010x}.",
                hresult=unsigned,
            )


@dataclass(frozen=True)
class WindowsAppContainerWorkerResult:
    pid: int
    exit_code: int | None
    status: str
    process_tree_empty_verified: bool = False


class WindowsAppContainerWorkerLauncher:
    """Launch with zero capability SIDs: AppContainer networking is denied by default."""

    _SECURITY_CAPABILITIES_ATTRIBUTE = 0x00020005
    _EXTENDED_STARTUPINFO_PRESENT = 0x00080000
    _CREATE_SUSPENDED = 0x00000004
    _CREATE_NO_WINDOW = 0x08000000
    _CREATE_UNICODE_ENVIRONMENT = 0x00000400
    _WAIT_TIMEOUT = 0x102

    def __init__(self, limits: WindowsJobLimits | None = None):
        if os.name != "nt":
            raise WindowsAppContainerError("appcontainer_worker_unsupported", "AppContainer worker requires Windows.")
        self.job = WindowsJobLauncher(limits)

    @staticmethod
    def _environment_block(environment: Mapping[str, str]):
        values = []
        for key, value in environment.items():
            key, value = str(key), str(value)
            if not key or "=" in key or "\x00" in key or "\x00" in value:
                raise WindowsAppContainerError("appcontainer_environment_invalid", "Worker environment is invalid.")
            values.append(f"{key}={value}")
        return ctypes.create_unicode_buffer("\x00".join(sorted(values, key=str.upper)) + "\x00\x00")

    def run(
        self, profile: AppContainerProfile, argv: Sequence[str], *, cwd: str | Path,
        environment: Mapping[str, str], timeout_seconds: float, job_name: str | None = None,
    ) -> WindowsAppContainerWorkerResult:
        if profile._closed or not profile.sid:
            raise WindowsAppContainerError("appcontainer_profile_closed", "AppContainer profile is closed.")
        if not argv or not str(argv[0]).strip() or timeout_seconds <= 0 or not Path(cwd).is_dir():
            raise WindowsAppContainerError("appcontainer_worker_request_invalid", "Worker request is invalid.")

        size = ctypes.c_size_t()
        _kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
        if not size.value:
            raise WindowsAppContainerError("appcontainer_attribute_size_failed", f"Attribute sizing failed: {ctypes.get_last_error()}")
        heap = _kernel32.GetProcessHeap()
        attributes = _kernel32.HeapAlloc(heap, 0, size.value)
        if not attributes:
            raise WindowsAppContainerError("appcontainer_attribute_alloc_failed", "Attribute allocation failed.")
        initialized = False
        job_handle = process_handle = thread_handle = 0
        terminal = False
        try:
            if not _kernel32.InitializeProcThreadAttributeList(attributes, 1, 0, ctypes.byref(size)):
                raise WindowsAppContainerError("appcontainer_attribute_init_failed", f"Attribute initialization failed: {ctypes.get_last_error()}")
            initialized = True
            capabilities = _SECURITY_CAPABILITIES(ctypes.c_void_p(profile.sid), None, 0, 0)
            if not _kernel32.UpdateProcThreadAttribute(
                attributes, 0, self._SECURITY_CAPABILITIES_ATTRIBUTE,
                ctypes.byref(capabilities), ctypes.sizeof(capabilities), None, None,
            ):
                raise WindowsAppContainerError("appcontainer_attribute_update_failed", f"Security capabilities failed: {ctypes.get_last_error()}")
            startup = _STARTUPINFOEXW()
            startup.StartupInfo.cb = ctypes.sizeof(startup)
            startup.lpAttributeList = attributes
            process = _PROCESS_INFORMATION()
            command = ctypes.create_unicode_buffer(subprocess.list2cmdline([str(item) for item in argv]))
            env = self._environment_block(environment)
            flags = self._EXTENDED_STARTUPINFO_PRESENT | self._CREATE_SUSPENDED | self._CREATE_NO_WINDOW | self._CREATE_UNICODE_ENVIRONMENT
            if not _kernel32.CreateProcessW(
                str(argv[0]), command, None, None, False, flags, env, str(Path(cwd)),
                ctypes.byref(startup.StartupInfo), ctypes.byref(process),
            ):
                raise WindowsAppContainerError("appcontainer_worker_create_failed", f"CreateProcessW failed: {ctypes.get_last_error()}")
            process_handle, thread_handle = int(process.hProcess), int(process.hThread)
            job_handle = self.job._create_job(job_name)
            if not self.job.kernel32.AssignProcessToJobObject(job_handle, process_handle):
                raise WindowsAppContainerError("appcontainer_job_assign_failed", f"Job assignment failed: {ctypes.get_last_error()}")
            if _kernel32.ResumeThread(thread_handle) == 0xFFFFFFFF:
                raise WindowsAppContainerError("appcontainer_worker_resume_failed", f"ResumeThread failed: {ctypes.get_last_error()}")
            wait = _kernel32.WaitForSingleObject(process_handle, int(timeout_seconds * 1000))
            if wait == self._WAIT_TIMEOUT:
                status = "timed_out"
            elif wait != 0:
                raise WindowsAppContainerError("appcontainer_worker_wait_failed", f"Wait failed: {ctypes.get_last_error()}")
            else:
                status = "completed"
            empty_verified = self.job.terminate_and_verify_empty(job_handle)
            if not empty_verified:
                raise WindowsAppContainerError("appcontainer_job_not_empty", "Job process tree did not become empty.")
            _kernel32.WaitForSingleObject(process_handle, 5000)
            exit_code = wintypes.DWORD()
            if not _kernel32.GetExitCodeProcess(process_handle, ctypes.byref(exit_code)):
                raise WindowsAppContainerError("appcontainer_exit_code_failed", f"Exit inspection failed: {ctypes.get_last_error()}")
            if status == "completed":
                status = "succeeded" if exit_code.value == 0 else "failed"
            terminal = True
            return WindowsAppContainerWorkerResult(
                int(process.dwProcessId), int(exit_code.value), status, process_tree_empty_verified=True,
            )
        finally:
            if process_handle and not terminal:
                # A failure between CreateProcess and Job assignment must not
                # leak the suspended process outside Job ownership.
                _kernel32.TerminateProcess(process_handle, 0xC0000022)
                _kernel32.WaitForSingleObject(process_handle, 5000)
            if thread_handle:
                _kernel32.CloseHandle(thread_handle)
            if process_handle:
                _kernel32.CloseHandle(process_handle)
            if job_handle:
                self.job.kernel32.CloseHandle(job_handle)
            if initialized:
                _kernel32.DeleteProcThreadAttributeList(attributes)
            _kernel32.HeapFree(heap, 0, attributes)
