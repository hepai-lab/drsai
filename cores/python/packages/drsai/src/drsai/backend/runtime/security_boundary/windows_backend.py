"""Windows isolation capability probe and deliberately unavailable backend.

API availability is evidence for implementation planning, not evidence that a
child process is isolated. Until restricted identity, Job assignment, projected
filesystem and sanitized environment are all enforced, attestation remains
insufficient and SandboxBroker refuses execution.
"""

from __future__ import annotations

import ctypes
import os
import platform
import time
from dataclasses import dataclass
from typing import Callable

from .models import ResolvedCapabilityProfile, canonical_digest
from .windows_appcontainer import WindowsAppContainerError, WindowsAppContainerProfileFactory
from .sandbox import (
    IsolationAttestation,
    SandboxError,
    SandboxExecutionReceipt,
    SandboxExecutionRequest,
)


@dataclass(frozen=True)
class WindowsIsolationCapabilities:
    platform_supported: bool
    current_process_is_admin: bool | None
    restricted_token_api: bool
    job_object_api: bool
    appcontainer_api: bool
    job_object_enforced: bool = False
    filesystem_projection_enforced: bool = False
    network_egress_enforced: bool = False
    appcontainer_profile_operational: bool = False
    appcontainer_profile_hresult: int | None = None

    def as_dict(self) -> dict[str, bool | int | None]:
        return {
            "platform_supported": self.platform_supported,
            "current_process_is_admin": self.current_process_is_admin,
            "restricted_token_api": self.restricted_token_api,
            "job_object_api": self.job_object_api,
            "appcontainer_api": self.appcontainer_api,
            "job_object_enforced": self.job_object_enforced,
            "filesystem_projection_enforced": self.filesystem_projection_enforced,
            "network_egress_enforced": self.network_egress_enforced,
            "appcontainer_profile_operational": self.appcontainer_profile_operational,
            "appcontainer_profile_hresult": self.appcontainer_profile_hresult,
        }


def _has_export(library: object, name: str) -> bool:
    try:
        getattr(library, name)
    except (AttributeError, OSError):
        return False
    return True


class WindowsIsolationProbe:
    def __init__(
        self,
        loader: Callable[[], WindowsIsolationCapabilities] | None = None,
        *,
        appcontainer_factory: WindowsAppContainerProfileFactory | None = None,
    ):
        self._loader = loader
        self._appcontainer_factory = appcontainer_factory
        self._appcontainer_result: tuple[bool, int | None] | None = None

    def _probe_appcontainer_profile(self) -> tuple[bool, int | None]:
        if self._appcontainer_result is not None:
            return self._appcontainer_result
        factory = self._appcontainer_factory or WindowsAppContainerProfileFactory()
        try:
            profile = factory.create("isolation-capability-probe")
            profile.close()
        except WindowsAppContainerError as error:
            self._appcontainer_result = (False, error.hresult)
        else:
            self._appcontainer_result = (True, None)
        return self._appcontainer_result

    def probe(self) -> WindowsIsolationCapabilities:
        if self._loader is not None:
            return self._loader()
        if os.name != "nt":
            return WindowsIsolationCapabilities(False, None, False, False, False)
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
            userenv = ctypes.WinDLL("userenv", use_last_error=True)
            shell32 = ctypes.WinDLL("shell32", use_last_error=True)
            is_admin = bool(shell32.IsUserAnAdmin())
        except (AttributeError, OSError):
            return WindowsIsolationCapabilities(True, None, False, False, False)
        appcontainer_api = all(
            _has_export(userenv, name)
            for name in ("CreateAppContainerProfile", "DeriveAppContainerSidFromAppContainerName")
        )
        operational, hresult = self._probe_appcontainer_profile() if appcontainer_api else (False, None)
        return WindowsIsolationCapabilities(
            platform_supported=True,
            current_process_is_admin=is_admin,
            restricted_token_api=_has_export(advapi32, "CreateRestrictedToken"),
            job_object_api=all(
                _has_export(kernel32, name)
                for name in ("CreateJobObjectW", "SetInformationJobObject", "AssignProcessToJobObject")
            ),
            appcontainer_api=appcontainer_api,
            appcontainer_profile_operational=operational,
            appcontainer_profile_hresult=hresult,
        )


class WindowsRestrictedProcessBackend:
    """Fail-closed placeholder until every P0 Windows guarantee is enforced."""

    backend_id = "windows-restricted-process"
    backend_version = "0-probe-only"

    def __init__(
        self,
        probe: WindowsIsolationProbe | None = None,
        *,
        clock: Callable[[], float] = time.time,
        job_launcher_verified: bool = False,
        restricted_identity_verified: bool = False,
    ):
        self.probe = probe or WindowsIsolationProbe()
        self.clock = clock
        self.job_launcher_verified = job_launcher_verified
        self.restricted_identity_verified = restricted_identity_verified

    def attest(self) -> IsolationAttestation:
        checked_at = self.clock()
        capabilities = self.probe.probe()
        # Deliberately do not translate API presence into isolation guarantees.
        # The implementation must demonstrate each guarantee with adversarial
        # integration tests before adding it here.
        guarantees = frozenset(
            guarantee for guarantee, verified in (
                ("process_tree_controlled", self.job_launcher_verified),
                ("non_admin_identity", self.restricted_identity_verified),
            ) if verified
        )
        evidence = {
            "backend_id": self.backend_id,
            "backend_version": self.backend_version,
            "host": platform.platform(),
            "capabilities": capabilities.as_dict(),
            "guarantees": sorted(guarantees),
        }
        return IsolationAttestation(
            backend_id=self.backend_id,
            backend_version=self.backend_version,
            platform="windows" if capabilities.platform_supported else "unsupported",
            verified_at=checked_at,
            expires_at=checked_at + 60,
            guarantees=guarantees,
            evidence_digest=canonical_digest(evidence),
        )

    def execute(
        self,
        request: SandboxExecutionRequest,
        profile: ResolvedCapabilityProfile,
    ) -> SandboxExecutionReceipt:
        raise SandboxError(
            "windows_isolation_not_enforced",
            "Windows isolation is probe-only; host process execution is denied.",
        )
