"""Handle-backed Windows workspace filesystem boundary."""

from __future__ import annotations

import ctypes
import hashlib
import os
import re
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Iterator

from .sandbox import SandboxError

_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")
_OPEN_EXISTING = 3
_GENERIC_READ, _GENERIC_WRITE = 0x80000000, 0x40000000
_CREATE_NEW = 1
_CAS_LOCKS_GUARD = threading.Lock()
_CAS_LOCKS: dict[str, threading.RLock] = {}


def _workspace_cas_lock(root: Path) -> threading.RLock:
    identity = os.path.normcase(os.path.abspath(root))
    with _CAS_LOCKS_GUARD:
        return _CAS_LOCKS.setdefault(identity, threading.RLock())


def normalize_workspace_relative_path(value: str) -> tuple[str, ...]:
    """Reject Windows namespace tricks before any filesystem lookup."""

    if not isinstance(value, str) or not value or "\x00" in value:
        raise SandboxError("filesystem_path_invalid", "A non-empty relative path is required.")
    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or normalized.startswith("//") or _DRIVE_PREFIX.match(normalized):
        raise SandboxError("filesystem_namespace_denied", "Absolute, UNC and device paths are denied.")
    if "//" in normalized:
        raise SandboxError("filesystem_path_ambiguous", "Empty path components are denied.")
    parts = PurePosixPath(normalized).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise SandboxError("filesystem_traversal_denied", "Path traversal is denied.")
    for part in parts:
        if ":" in part:
            raise SandboxError("filesystem_ads_denied", "Alternate data streams are denied.")
        if part.endswith((" ", ".")):
            raise SandboxError("filesystem_name_ambiguous", "Trailing dots and spaces are denied.")
        if part.split(".", 1)[0].upper() in _RESERVED_NAMES:
            raise SandboxError("filesystem_device_name_denied", "Windows device names are denied.")
    return tuple(parts)


if os.name == "nt":
    from ctypes import wintypes

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
    _GENERIC_READ, _GENERIC_WRITE = 0x80000000, 0x40000000
    _DELETE = 0x00010000
    _FILE_SHARE_READ, _FILE_SHARE_WRITE = 0x1, 0x2
    _CREATE_NEW, _OPEN_EXISTING = 1, 3
    _FILE_ATTRIBUTE_NORMAL, _FILE_ATTRIBUTE_DIRECTORY = 0x80, 0x10
    _FILE_ATTRIBUTE_REPARSE_POINT = 0x400
    _FILE_FLAG_OPEN_REPARSE_POINT, _FILE_FLAG_BACKUP_SEMANTICS = 0x00200000, 0x02000000
    _MOVEFILE_REPLACE_EXISTING, _MOVEFILE_WRITE_THROUGH = 0x1, 0x8

    class _BY_HANDLE_FILE_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD), ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME), ("ftLastWriteTime", wintypes.FILETIME),
            ("dwVolumeSerialNumber", wintypes.DWORD), ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD), ("nNumberOfLinks", wintypes.DWORD),
            ("nFileIndexHigh", wintypes.DWORD), ("nFileIndexLow", wintypes.DWORD),
        ]

    _kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    _kernel32.CreateFileW.restype = wintypes.HANDLE
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel32.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(_BY_HANDLE_FILE_INFORMATION)]
    _kernel32.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    _kernel32.WriteFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    _kernel32.FlushFileBuffers.argtypes = [wintypes.HANDLE]
    _kernel32.MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    _kernel32.DeleteFileW.argtypes = [wintypes.LPCWSTR]
    _kernel32.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    _kernel32.SetFileInformationByHandle.restype = wintypes.BOOL

    class _FILE_RENAME_INFO(ctypes.Structure):
        _fields_ = [
            ("ReplaceIfExists", ctypes.c_ubyte),
            ("RootDirectory", wintypes.HANDLE),
            ("FileNameLength", wintypes.DWORD),
            ("FileName", ctypes.c_wchar * 1),
        ]

    class _FILE_DISPOSITION_INFO(ctypes.Structure):
        _fields_ = [("DeleteFile", ctypes.c_ubyte)]


def _winerror(code: str, message: str) -> SandboxError:
    return SandboxError(code, f"{message} (Win32 error {ctypes.get_last_error()}).")


class WindowsWorkspaceFilesystem:
    """Read/write broker that never returns a resolved host path to callers."""

    def __init__(self, root: Path):
        if os.name != "nt":
            raise SandboxError("filesystem_backend_unsupported", "Windows filesystem broker is unavailable.")
        # Do not call resolve(): resolving first would hide a junction supplied
        # as the projection root before we inspect it as a reparse point.
        self.root = Path(os.path.abspath(root))
        if not self.root.is_dir():
            raise ValueError("Workspace root must be a directory.")
        handle = self._open(self.root, directory=True)
        try:
            self._reject_reparse(handle, require_directory=True)
        finally:
            _kernel32.CloseHandle(handle)

    @staticmethod
    def _open(
        path: Path, *, directory: bool, access: int = 0,
        creation: int = _OPEN_EXISTING, share_delete: bool = False,
    ):
        flags = _FILE_FLAG_OPEN_REPARSE_POINT | (_FILE_FLAG_BACKUP_SEMANTICS if directory else _FILE_ATTRIBUTE_NORMAL)
        # Omitting FILE_SHARE_DELETE pins the object against rename/replacement.
        sharing = _FILE_SHARE_READ | _FILE_SHARE_WRITE | (0x4 if share_delete else 0)
        handle = _kernel32.CreateFileW(str(path), access, sharing, None, creation, flags, None)
        if handle == _INVALID_HANDLE_VALUE:
            raise _winerror("filesystem_open_denied", "The filesystem object could not be opened safely")
        return handle

    @staticmethod
    def _information(handle):
        information = _BY_HANDLE_FILE_INFORMATION()
        if not _kernel32.GetFileInformationByHandle(handle, ctypes.byref(information)):
            raise _winerror("filesystem_inspection_failed", "The filesystem object could not be inspected")
        return information

    @classmethod
    def _reject_reparse(cls, handle, *, require_directory: bool | None = None) -> None:
        information = cls._information(handle)
        attributes = information.dwFileAttributes
        if attributes & _FILE_ATTRIBUTE_REPARSE_POINT:
            raise SandboxError("filesystem_reparse_point_denied", "Reparse points are denied.")
        is_directory = bool(attributes & _FILE_ATTRIBUTE_DIRECTORY)
        if require_directory is not None and is_directory != require_directory:
            raise SandboxError("filesystem_object_type_denied", "Unexpected filesystem object type.")
        if require_directory is False and information.nNumberOfLinks != 1:
            raise SandboxError("filesystem_hardlink_denied", "Files with multiple hard links are denied.")

    @contextmanager
    def _pinned_parent(self, relative: str) -> Iterator[tuple[Path, str]]:
        parts = normalize_workspace_relative_path(relative)
        handles, current = [], self.root
        try:
            for part in (None, *parts[:-1]):
                if part is not None:
                    current = current / part
                handle = self._open(current, directory=True)
                handles.append(handle)
                self._reject_reparse(handle, require_directory=True)
            yield current, parts[-1]
        finally:
            for handle in reversed(handles):
                _kernel32.CloseHandle(handle)

    def read_bytes(self, relative: str, *, max_bytes: int = 16 * 1024 * 1024) -> bytes:
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive.")
        with self._pinned_parent(relative) as (parent, name):
            handle = self._open(parent / name, directory=False, access=_GENERIC_READ)
            try:
                self._reject_reparse(handle, require_directory=False)
                chunks, remaining = [], max_bytes + 1
                while remaining:
                    size = min(65536, remaining)
                    buffer, read = ctypes.create_string_buffer(size), wintypes.DWORD()
                    if not _kernel32.ReadFile(handle, buffer, size, ctypes.byref(read), None):
                        raise _winerror("filesystem_read_failed", "The file could not be read")
                    if not read.value:
                        break
                    chunks.append(buffer.raw[:read.value])
                    remaining -= read.value
                content = b"".join(chunks)
                if len(content) > max_bytes:
                    raise SandboxError("filesystem_read_limit_exceeded", "File exceeds the configured read limit.")
                return content
            finally:
                _kernel32.CloseHandle(handle)

    def atomic_write(self, relative: str, content: bytes) -> None:
        if not isinstance(content, bytes):
            raise TypeError("content must be bytes.")
        with self._pinned_parent(relative) as (parent, name):
            target = parent / name
            if target.exists() or target.is_symlink():
                existing = self._open(target, directory=False)
                try:
                    self._reject_reparse(existing, require_directory=False)
                finally:
                    _kernel32.CloseHandle(existing)
            temporary = parent / f".{name}.opendrsai-{uuid.uuid4().hex}.tmp"
            handle = self._open(temporary, directory=False, access=_GENERIC_WRITE, creation=_CREATE_NEW)
            try:
                offset = 0
                while offset < len(content):
                    chunk, written = content[offset:offset + 65536], wintypes.DWORD()
                    buffer = ctypes.create_string_buffer(chunk)
                    if not _kernel32.WriteFile(handle, buffer, len(chunk), ctypes.byref(written), None):
                        raise _winerror("filesystem_write_failed", "The temporary file could not be written")
                    if written.value != len(chunk):
                        raise SandboxError("filesystem_short_write", "The temporary file was only partially written.")
                    offset += written.value
                if not _kernel32.FlushFileBuffers(handle):
                    raise _winerror("filesystem_flush_failed", "The temporary file could not be flushed")
            except BaseException:
                _kernel32.CloseHandle(handle)
                _kernel32.DeleteFileW(str(temporary))
                raise
            else:
                _kernel32.CloseHandle(handle)
            if not _kernel32.MoveFileExW(str(temporary), str(target), _MOVEFILE_REPLACE_EXISTING | _MOVEFILE_WRITE_THROUGH):
                _kernel32.DeleteFileW(str(temporary))
                raise _winerror("filesystem_replace_failed", "The atomic replacement failed")

    def compare_and_swap(
        self, relative: str, expected_content_digest: str, content: bytes,
    ) -> None:
        """Replace only the broker-visible version whose digest was approved.

        The workspace-scoped lock serializes all CAS edits made by this Runtime
        process.  A final handle-backed read immediately precedes the atomic
        replacement, so stale proposals and concurrent broker edits fail
        closed instead of overwriting a newer version.
        """

        if not isinstance(expected_content_digest, str) or not expected_content_digest.startswith("sha256:"):
            raise SandboxError("filesystem_cas_digest_invalid", "A SHA-256 source digest is required.")
        with _workspace_cas_lock(self.root):
            current = self.read_bytes(relative)
            actual = "sha256:" + hashlib.sha256(current).hexdigest()
            if actual != expected_content_digest:
                raise SandboxError("filesystem_edit_conflict", "File changed after the edit was proposed.")
            self.atomic_write(relative, content)

    @staticmethod
    def _rename_open_handle(handle, destination: Path) -> None:
        encoded = str(destination).encode("utf-16-le")
        filename_offset = _FILE_RENAME_INFO.FileName.offset
        # Allocate the full declared structure plus the variable name.  The
        # trailing zeroed WCHAR/padding is required by observed Win32 builds
        # even though FileNameLength itself excludes a terminator.
        storage = ctypes.create_string_buffer(ctypes.sizeof(_FILE_RENAME_INFO) + len(encoded))
        header = _FILE_RENAME_INFO.from_buffer(storage)
        header.ReplaceIfExists = False
        header.RootDirectory = None
        header.FileNameLength = len(encoded)
        ctypes.memmove(ctypes.addressof(storage) + filename_offset, encoded, len(encoded))
        if not _kernel32.SetFileInformationByHandle(handle, 3, storage, len(storage)):
            raise _winerror("filesystem_rename_failed", "The handle-based rename failed")

    def atomic_rename(self, source_relative: str, destination_relative: str) -> None:
        source_parts = normalize_workspace_relative_path(source_relative)
        destination_parts = normalize_workspace_relative_path(destination_relative)
        with self._pinned_parent("/".join(source_parts)) as (source_parent, source_name):
            with self._pinned_parent("/".join(destination_parts)) as (destination_parent, destination_name):
                destination = destination_parent / destination_name
                if destination.exists() or destination.is_symlink():
                    raise SandboxError("filesystem_destination_exists", "Rename destination already exists.")
                source = source_parent / source_name
                handle = self._open(
                    source, directory=False, access=_DELETE,
                    share_delete=True,
                )
                try:
                    self._reject_reparse(handle, require_directory=False)
                    self._rename_open_handle(handle, destination)
                finally:
                    _kernel32.CloseHandle(handle)

    def move_to_tombstone(self, relative: str, tombstone_id: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{32}", tombstone_id):
            raise SandboxError("filesystem_tombstone_id_invalid", "Tombstone identity is invalid.")
        trash = self.root / ".opendrsai-trash"
        try:
            trash.mkdir(mode=0o700, exist_ok=True)
        except OSError as error:
            raise SandboxError("filesystem_tombstone_root_failed", "Tombstone directory is unavailable.") from error
        tombstone_relative = f".opendrsai-trash/{tombstone_id}.deleted"
        source_parts = normalize_workspace_relative_path(relative)
        with self._pinned_parent("/".join(source_parts)) as (source_parent, source_name):
            with self._pinned_parent(tombstone_relative) as (destination_parent, destination_name):
                destination = destination_parent / destination_name
                if destination.exists() or destination.is_symlink():
                    raise SandboxError("filesystem_tombstone_collision", "Tombstone already exists.")
                handle = self._open(
                    source_parent / source_name, directory=False,
                    access=_DELETE, share_delete=True,
                )
                try:
                    self._reject_reparse(handle, require_directory=False)
                    self._rename_open_handle(handle, destination)
                finally:
                    _kernel32.CloseHandle(handle)
        return tombstone_relative

    @staticmethod
    def _tombstone_relative(tombstone_id: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{32}", tombstone_id):
            raise SandboxError("filesystem_tombstone_id_invalid", "Tombstone identity is invalid.")
        return f".opendrsai-trash/{tombstone_id}.deleted"

    def restore_tombstone(self, tombstone_id: str, destination_relative: str) -> None:
        self.atomic_rename(self._tombstone_relative(tombstone_id), destination_relative)

    def purge_tombstone(self, tombstone_id: str) -> None:
        relative = self._tombstone_relative(tombstone_id)
        with self._pinned_parent(relative) as (parent, name):
            handle = self._open(parent / name, directory=False, access=_DELETE, share_delete=True)
            try:
                self._reject_reparse(handle, require_directory=False)
                disposition = _FILE_DISPOSITION_INFO(1)
                if not _kernel32.SetFileInformationByHandle(
                    handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition),
                ):
                    raise _winerror("filesystem_purge_failed", "Tombstone purge failed")
            finally:
                _kernel32.CloseHandle(handle)

    def tombstone_exists(self, tombstone_id: str) -> bool:
        relative = self._tombstone_relative(tombstone_id)
        path = self.root / Path(relative)
        if not path.exists() and not path.is_symlink():
            return False
        with self._pinned_parent(relative) as (parent, name):
            handle = self._open(parent / name, directory=False)
            try:
                self._reject_reparse(handle, require_directory=False)
                return True
            finally:
                _kernel32.CloseHandle(handle)
