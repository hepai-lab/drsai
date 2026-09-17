"""Windows Job Object process-tree launcher with suspended assignment."""

from __future__ import annotations

import ctypes
import os
import subprocess
import time
import uuid
import re
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence


class WindowsJobError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class WindowsJobLimits:
    active_process_limit: int = 16
    process_memory_limit_bytes: int | None = 512 * 1024 * 1024
    job_memory_limit_bytes: int | None = 1024 * 1024 * 1024

    def validate(self) -> None:
        if self.active_process_limit < 1:
            raise WindowsJobError("job_process_limit_invalid", "Active process limit must be positive.")
        for value in (self.process_memory_limit_bytes, self.job_memory_limit_bytes):
            if value is not None and value < 16 * 1024 * 1024:
                raise WindowsJobError("job_memory_limit_invalid", "Memory limits below 16 MiB are unsupported.")


@dataclass(frozen=True)
class WindowsJobResult:
    exit_code: int | None
    stdout: bytes
    stderr: bytes
    status: str


if os.name == "nt":
    ULONG_PTR = wintypes.WPARAM

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ULONG_PTR),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_uint64),
            ("WriteOperationCount", ctypes.c_uint64),
            ("OtherOperationCount", ctypes.c_uint64),
            ("ReadTransferCount", ctypes.c_uint64),
            ("WriteTransferCount", ctypes.c_uint64),
            ("OtherTransferCount", ctypes.c_uint64),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    class JOBOBJECT_BASIC_ACCOUNTING_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("TotalUserTime", ctypes.c_int64), ("TotalKernelTime", ctypes.c_int64),
            ("ThisPeriodTotalUserTime", ctypes.c_int64), ("ThisPeriodTotalKernelTime", ctypes.c_int64),
            ("TotalPageFaultCount", wintypes.DWORD), ("TotalProcesses", wintypes.DWORD),
            ("ActiveProcesses", wintypes.DWORD), ("TotalTerminatedProcesses", wintypes.DWORD),
        ]


JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS = 1
JOB_OBJECT_QUERY = 0x0004
JOB_OBJECT_TERMINATE = 0x0008
ERROR_ALREADY_EXISTS = 183
ERROR_FILE_NOT_FOUND = 2
CREATE_SUSPENDED = 0x00000004
CREATE_NO_WINDOW = 0x08000000


class WindowsJobProcess:
    def __init__(self, process: subprocess.Popen[bytes], job_handle: int):
        self.process = process
        self._job_handle = job_handle
        self._closed = False

    @property
    def pid(self) -> int:
        return int(self.process.pid)

    def close_job(self) -> None:
        if self._closed:
            return
        self._closed = True
        if os.name == "nt":
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(wintypes.HANDLE(self._job_handle))

    def communicate(self, timeout_seconds: float) -> WindowsJobResult:
        try:
            stdout, stderr = self.process.communicate(timeout=timeout_seconds)
            return WindowsJobResult(self.process.returncode, stdout or b"", stderr or b"", "succeeded" if self.process.returncode == 0 else "failed")
        except subprocess.TimeoutExpired:
            self.close_job()
            try:
                stdout, stderr = self.process.communicate(timeout=5)
            except subprocess.TimeoutExpired as error:
                raise WindowsJobError("job_termination_failed", "Job process tree did not terminate.") from error
            return WindowsJobResult(self.process.returncode, stdout or b"", stderr or b"", "timed_out")
        finally:
            self.close_job()

    def __enter__(self) -> "WindowsJobProcess":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close_job()


class WindowsJobLauncher:
    def __init__(self, limits: WindowsJobLimits | None = None):
        if os.name != "nt":
            raise WindowsJobError("windows_job_unsupported", "Windows Job Objects are only available on Windows.")
        self.limits = limits or WindowsJobLimits()
        self.limits.validate()
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
        self.kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel32.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel32.CloseHandle.restype = wintypes.BOOL
        self.kernel32.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.kernel32.QueryInformationJobObject.restype = wintypes.BOOL
        self.kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel32.TerminateJobObject.restype = wintypes.BOOL
        self.kernel32.OpenJobObjectW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
        self.kernel32.OpenJobObjectW.restype = wintypes.HANDLE
        self.ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
        self.ntdll.NtResumeProcess.restype = ctypes.c_long

    @staticmethod
    def reserve_name() -> str:
        return f"Local\\OpenDrSai.Job.{uuid.uuid4().hex}"

    @staticmethod
    def _validate_name(name: str) -> None:
        if not re.fullmatch(r"Local\\OpenDrSai\.Job\.[0-9a-f]{32}", name):
            raise WindowsJobError("job_name_invalid", "Job name is not an owned OpenDrSai identity.")

    def _create_job(self, name: str | None = None) -> int:
        if name is not None:
            self._validate_name(name)
        ctypes.set_last_error(0)
        handle = self.kernel32.CreateJobObjectW(None, name)
        if not handle:
            raise WindowsJobError("job_create_failed", f"CreateJobObjectW failed: {ctypes.get_last_error()}")
        if name is not None and ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            self.kernel32.CloseHandle(handle)
            raise WindowsJobError("job_name_collision", "Reserved Job name already exists.")
        information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        information.BasicLimitInformation.ActiveProcessLimit = self.limits.active_process_limit
        if self.limits.process_memory_limit_bytes is not None:
            flags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY
            information.ProcessMemoryLimit = self.limits.process_memory_limit_bytes
        if self.limits.job_memory_limit_bytes is not None:
            flags |= JOB_OBJECT_LIMIT_JOB_MEMORY
            information.JobMemoryLimit = self.limits.job_memory_limit_bytes
        information.BasicLimitInformation.LimitFlags = flags
        configured = self.kernel32.SetInformationJobObject(
            handle,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            ctypes.byref(information),
            ctypes.sizeof(information),
        )
        if not configured:
            error = ctypes.get_last_error()
            self.kernel32.CloseHandle(handle)
            raise WindowsJobError("job_configure_failed", f"SetInformationJobObject failed: {error}")
        return int(handle)

    def open_owned_job(self, name: str) -> int | None:
        self._validate_name(name)
        ctypes.set_last_error(0)
        handle = self.kernel32.OpenJobObjectW(JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE, False, name)
        if handle:
            return int(handle)
        error = ctypes.get_last_error()
        if error == ERROR_FILE_NOT_FOUND:
            return None
        raise WindowsJobError("job_open_failed", f"OpenJobObjectW failed: {error}")

    def verify_owned_job_empty(self, name: str) -> bool:
        handle = self.open_owned_job(name)
        if handle is None:
            # The name was journaled before launch.  Absence means either the
            # suspended worker was never created, or the last Job handle closed
            # and KILL_ON_JOB_CLOSE destroyed its assigned process tree.
            return True
        try:
            return self.terminate_and_verify_empty(handle)
        finally:
            self.kernel32.CloseHandle(wintypes.HANDLE(handle))

    def active_process_count(self, job_handle: int) -> int:
        information = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION()
        if not self.kernel32.QueryInformationJobObject(
            wintypes.HANDLE(job_handle), JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS,
            ctypes.byref(information), ctypes.sizeof(information), None,
        ):
            raise WindowsJobError("job_accounting_failed", f"QueryInformationJobObject failed: {ctypes.get_last_error()}")
        return int(information.ActiveProcesses)

    def terminate_and_verify_empty(self, job_handle: int, *, timeout_seconds: float = 5) -> bool:
        if timeout_seconds <= 0:
            raise WindowsJobError("job_empty_timeout_invalid", "Job empty timeout must be positive.")
        if not self.kernel32.TerminateJobObject(wintypes.HANDLE(job_handle), 0xC000013A):
            raise WindowsJobError("job_terminate_failed", f"TerminateJobObject failed: {ctypes.get_last_error()}")
        deadline = time.monotonic() + timeout_seconds
        while True:
            if self.active_process_count(job_handle) == 0:
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.01)

    def launch(
        self,
        argv: Sequence[str],
        *,
        cwd: str | Path,
        environment: Mapping[str, str],
    ) -> WindowsJobProcess:
        if not argv or not str(argv[0]).strip():
            raise WindowsJobError("job_argv_missing", "An explicit executable argv is required.")
        if not Path(cwd).is_dir():
            raise WindowsJobError("job_cwd_invalid", "Job working directory does not exist.")
        job_handle = self._create_job()
        process: subprocess.Popen[bytes] | None = None
        try:
            process = subprocess.Popen(
                [str(value) for value in argv],
                cwd=str(cwd),
                env={str(key): str(value) for key, value in environment.items()},
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                close_fds=True,
                creationflags=CREATE_SUSPENDED | CREATE_NO_WINDOW,
            )
            process_handle = wintypes.HANDLE(int(process._handle))  # type: ignore[attr-defined]
            if not self.kernel32.AssignProcessToJobObject(wintypes.HANDLE(job_handle), process_handle):
                raise WindowsJobError("job_assign_failed", f"AssignProcessToJobObject failed: {ctypes.get_last_error()}")
            status = int(self.ntdll.NtResumeProcess(process_handle))
            if status != 0:
                raise WindowsJobError("job_resume_failed", f"NtResumeProcess failed: NTSTATUS {status:#x}")
            return WindowsJobProcess(process, job_handle)
        except BaseException:
            if process is not None:
                process.kill()
                process.wait(timeout=5)
            self.kernel32.CloseHandle(wintypes.HANDLE(job_handle))
            raise
