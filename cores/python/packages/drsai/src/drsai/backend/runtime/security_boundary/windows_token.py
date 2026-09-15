"""Windows restricted primary-token creation and evidence inspection."""

from __future__ import annotations

import ctypes
import os
from ctypes import wintypes
from dataclasses import dataclass


class WindowsTokenError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


TOKEN_ASSIGN_PRIMARY = 0x0001
TOKEN_DUPLICATE = 0x0002
TOKEN_QUERY = 0x0008
TOKEN_ADJUST_PRIVILEGES = 0x0020
TOKEN_ADJUST_DEFAULT = 0x0080
TOKEN_ADJUST_SESSIONID = 0x0100
DISABLE_MAX_PRIVILEGE = 0x0001
LUA_TOKEN = 0x0004
WRITE_RESTRICTED = 0x0008
TOKEN_PRIVILEGES_CLASS = 3
TOKEN_GROUPS_CLASS = 2
TOKEN_ELEVATION_CLASS = 20
TOKEN_INTEGRITY_LEVEL_CLASS = 25
SE_PRIVILEGE_ENABLED = 0x00000002
SE_GROUP_ENABLED = 0x00000004
SE_GROUP_USE_FOR_DENY_ONLY = 0x00000010
WIN_BUILTIN_ADMINISTRATORS_SID = 26
SECURITY_MAX_SID_SIZE = 68
SECURITY_IMPERSONATION = 2
TOKEN_PRIMARY = 1
SE_GROUP_INTEGRITY = 0x00000020
FALLBACK_NONADMIN_LOW_INTEGRITY = 0x00010000


class LUID(ctypes.Structure):
    _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]


class LUID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Luid", LUID), ("Attributes", wintypes.DWORD)]


class SID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", wintypes.DWORD)]


class TOKEN_MANDATORY_LABEL(ctypes.Structure):
    _fields_ = [("Label", SID_AND_ATTRIBUTES)]


class TOKEN_GROUPS_ONE(ctypes.Structure):
    _fields_ = [("GroupCount", wintypes.DWORD), ("Groups", SID_AND_ATTRIBUTES * 1)]


@dataclass(frozen=True)
class RestrictedTokenEvidence:
    elevated: bool
    administrator_member: bool
    enabled_privilege_count: int
    integrity_level_rid: int
    restriction_flags: int = 0

    @property
    def non_admin_verified(self) -> bool:
        return not self.elevated and not self.administrator_member and self.enabled_privilege_count == 0


class RestrictedToken:
    def __init__(self, handle: int, evidence: RestrictedTokenEvidence):
        self.handle = handle
        self.evidence = evidence
        self._closed = False

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if os.name == "nt":
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(wintypes.HANDLE(self.handle))

    def __enter__(self) -> "RestrictedToken":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class WindowsRestrictedTokenFactory:
    def __init__(self):
        if os.name != "nt":
            raise WindowsTokenError("windows_token_unsupported", "Restricted tokens require Windows.")
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
        self.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        self.kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel32.CloseHandle.restype = wintypes.BOOL
        self.advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        self.advapi32.OpenProcessToken.restype = wintypes.BOOL
        self.advapi32.CreateRestrictedToken.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(SID_AND_ATTRIBUTES),
            wintypes.DWORD, ctypes.POINTER(LUID_AND_ATTRIBUTES), wintypes.DWORD, ctypes.POINTER(SID_AND_ATTRIBUTES),
            ctypes.POINTER(wintypes.HANDLE),
        ]
        self.advapi32.CreateRestrictedToken.restype = wintypes.BOOL
        self.advapi32.GetTokenInformation.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi32.GetTokenInformation.restype = wintypes.BOOL
        self.advapi32.CreateWellKnownSid.argtypes = [
            ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi32.CreateWellKnownSid.restype = wintypes.BOOL
        self.advapi32.CheckTokenMembership.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL)]
        self.advapi32.CheckTokenMembership.restype = wintypes.BOOL
        self.advapi32.EqualSid.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.advapi32.EqualSid.restype = wintypes.BOOL
        self.advapi32.GetSidSubAuthorityCount.argtypes = [ctypes.c_void_p]
        self.advapi32.GetSidSubAuthorityCount.restype = ctypes.POINTER(ctypes.c_ubyte)
        self.advapi32.GetSidSubAuthority.argtypes = [ctypes.c_void_p, wintypes.DWORD]
        self.advapi32.GetSidSubAuthority.restype = ctypes.POINTER(wintypes.DWORD)
        self.advapi32.GetLengthSid.argtypes = [ctypes.c_void_p]
        self.advapi32.GetLengthSid.restype = wintypes.DWORD
        self.advapi32.DuplicateTokenEx.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
            ctypes.POINTER(wintypes.HANDLE),
        ]
        self.advapi32.DuplicateTokenEx.restype = wintypes.BOOL
        self.advapi32.AdjustTokenPrivileges.argtypes = [
            wintypes.HANDLE, wintypes.BOOL, ctypes.c_void_p, wintypes.DWORD,
            ctypes.c_void_p, ctypes.c_void_p,
        ]
        self.advapi32.AdjustTokenPrivileges.restype = wintypes.BOOL
        self.advapi32.ConvertStringSidToSidW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)]
        self.advapi32.ConvertStringSidToSidW.restype = wintypes.BOOL
        self.advapi32.SetTokenInformation.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
        ]
        self.advapi32.SetTokenInformation.restype = wintypes.BOOL
        self.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        self.kernel32.LocalFree.restype = ctypes.c_void_p

    def _token_information(self, handle: wintypes.HANDLE, information_class: int) -> ctypes.Array[ctypes.c_char]:
        required = wintypes.DWORD()
        self.advapi32.GetTokenInformation(handle, information_class, None, 0, ctypes.byref(required))
        if required.value == 0:
            raise WindowsTokenError("token_query_failed", f"GetTokenInformation size failed: {ctypes.get_last_error()}")
        buffer = ctypes.create_string_buffer(required.value)
        if not self.advapi32.GetTokenInformation(handle, information_class, buffer, required, ctypes.byref(required)):
            raise WindowsTokenError("token_query_failed", f"GetTokenInformation failed: {ctypes.get_last_error()}")
        return buffer

    def _inspect(self, handle: wintypes.HANDLE, restriction_flags: int) -> RestrictedTokenEvidence:
        elevation = self._token_information(handle, TOKEN_ELEVATION_CLASS)
        elevated = bool(ctypes.cast(elevation, ctypes.POINTER(wintypes.DWORD)).contents.value)

        privileges = self._token_information(handle, TOKEN_PRIVILEGES_CLASS)
        privilege_count = ctypes.cast(privileges, ctypes.POINTER(wintypes.DWORD)).contents.value
        first = ctypes.addressof(privileges) + ctypes.sizeof(wintypes.DWORD)
        enabled = 0
        stride = ctypes.sizeof(LUID_AND_ATTRIBUTES)
        for index in range(privilege_count):
            entry = LUID_AND_ATTRIBUTES.from_address(first + index * stride)
            if entry.Attributes & SE_PRIVILEGE_ENABLED:
                enabled += 1

        admin_sid = ctypes.create_string_buffer(SECURITY_MAX_SID_SIZE)
        admin_size = wintypes.DWORD(SECURITY_MAX_SID_SIZE)
        if not self.advapi32.CreateWellKnownSid(
            WIN_BUILTIN_ADMINISTRATORS_SID, None, admin_sid, ctypes.byref(admin_size),
        ):
            raise WindowsTokenError("admin_sid_failed", f"CreateWellKnownSid failed: {ctypes.get_last_error()}")
        groups = self._token_information(handle, TOKEN_GROUPS_CLASS)
        group_count = ctypes.cast(groups, ctypes.POINTER(wintypes.DWORD)).contents.value
        groups_first = ctypes.addressof(groups) + TOKEN_GROUPS_ONE.Groups.offset
        group_stride = ctypes.sizeof(SID_AND_ATTRIBUTES)
        admin_member = False
        for index in range(group_count):
            group = SID_AND_ATTRIBUTES.from_address(groups_first + index * group_stride)
            if self.advapi32.EqualSid(group.Sid, admin_sid):
                admin_member = bool(
                    group.Attributes & SE_GROUP_ENABLED
                    and not group.Attributes & SE_GROUP_USE_FOR_DENY_ONLY
                )
                break

        integrity = self._token_information(handle, TOKEN_INTEGRITY_LEVEL_CLASS)
        label = ctypes.cast(integrity, ctypes.POINTER(TOKEN_MANDATORY_LABEL)).contents
        count_pointer = self.advapi32.GetSidSubAuthorityCount(label.Label.Sid)
        if not count_pointer or count_pointer.contents.value < 1:
            raise WindowsTokenError("token_integrity_invalid", "Token integrity SID is invalid.")
        rid_pointer = self.advapi32.GetSidSubAuthority(label.Label.Sid, count_pointer.contents.value - 1)
        integrity_rid = int(rid_pointer.contents.value)
        return RestrictedTokenEvidence(elevated, admin_member, enabled, integrity_rid, restriction_flags)

    def create(self) -> RestrictedToken:
        source = wintypes.HANDLE()
        desired = TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY
        if not self.advapi32.OpenProcessToken(self.kernel32.GetCurrentProcess(), desired, ctypes.byref(source)):
            raise WindowsTokenError("process_token_open_failed", f"OpenProcessToken failed: {ctypes.get_last_error()}")
        restricted = wintypes.HANDLE()
        try:
            # Some Windows builds reject LUA_TOKEN combined with
            # WRITE_RESTRICTED. Try only documented strict combinations and
            # accept one solely after inspecting the resulting token.
            used_flags = 0
            for flags in (
                DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
                DISABLE_MAX_PRIVILEGE | LUA_TOKEN,
                DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED,
                DISABLE_MAX_PRIVILEGE,
            ):
                if self.advapi32.CreateRestrictedToken(
                    source, flags, 0, None, 0, None, 0, None, ctypes.byref(restricted),
                ):
                    used_flags = flags
                    break
            if not restricted.value:
                restricted = self._duplicate_verified_nonadmin_low(source)
                used_flags = FALLBACK_NONADMIN_LOW_INTEGRITY
            evidence = self._inspect(restricted, used_flags)
            if not evidence.non_admin_verified:
                self.kernel32.CloseHandle(restricted)
                raise WindowsTokenError("restricted_token_verification_failed", "Restricted token retained elevated authority.")
            return RestrictedToken(int(restricted.value), evidence)
        finally:
            self.kernel32.CloseHandle(source)

    def _duplicate_verified_nonadmin_low(self, source: wintypes.HANDLE) -> wintypes.HANDLE:
        source_evidence = self._inspect(source, 0)
        if source_evidence.elevated or source_evidence.administrator_member:
            raise WindowsTokenError(
                "restricted_token_create_failed",
                "CreateRestrictedToken is unavailable and the caller identity is not a safe non-admin fallback.",
            )
        duplicate = wintypes.HANDLE()
        desired = (
            TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES
            | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID
        )
        if not self.advapi32.DuplicateTokenEx(
            source, desired, None, SECURITY_IMPERSONATION, TOKEN_PRIMARY, ctypes.byref(duplicate),
        ):
            raise WindowsTokenError(
                "restricted_token_duplicate_failed", f"DuplicateTokenEx failed: {ctypes.get_last_error()}",
            )
        try:
            ctypes.set_last_error(0)
            if not self.advapi32.AdjustTokenPrivileges(duplicate, True, None, 0, None, None):
                raise WindowsTokenError(
                    "restricted_token_privileges_failed",
                    f"AdjustTokenPrivileges failed: {ctypes.get_last_error()}",
                )
            if ctypes.get_last_error() not in {0}:
                raise WindowsTokenError(
                    "restricted_token_privileges_failed",
                    f"AdjustTokenPrivileges did not remove every privilege: {ctypes.get_last_error()}",
                )
            low_sid = ctypes.c_void_p()
            if not self.advapi32.ConvertStringSidToSidW("S-1-16-4096", ctypes.byref(low_sid)):
                raise WindowsTokenError(
                    "restricted_token_integrity_failed",
                    f"ConvertStringSidToSidW failed: {ctypes.get_last_error()}",
                )
            try:
                label = TOKEN_MANDATORY_LABEL(SID_AND_ATTRIBUTES(low_sid.value, SE_GROUP_INTEGRITY))
                sid_length = self.advapi32.GetLengthSid(low_sid)
                if not self.advapi32.SetTokenInformation(
                    duplicate, TOKEN_INTEGRITY_LEVEL_CLASS, ctypes.byref(label),
                    ctypes.sizeof(TOKEN_MANDATORY_LABEL) + int(sid_length),
                ):
                    raise WindowsTokenError(
                        "restricted_token_integrity_failed",
                        f"SetTokenInformation failed: {ctypes.get_last_error()}",
                    )
            finally:
                self.kernel32.LocalFree(low_sid)
            return duplicate
        except Exception:
            self.kernel32.CloseHandle(duplicate)
            raise
