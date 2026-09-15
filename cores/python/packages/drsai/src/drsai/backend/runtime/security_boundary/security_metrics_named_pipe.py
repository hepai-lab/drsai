"""Fail-closed Windows named-pipe contract for host-local security metrics."""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import Protocol

from .security_metrics_exporter import HostLocalSecurityMetricsExporter


class SecurityMetricsTransportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class AuthenticatedNamedPipeSession(Protocol):
    @property
    def peer_sid(self) -> str: ...
    def read(self, maximum_bytes: int, timeout_seconds: float) -> bytes: ...
    def write_all(self, payload: bytes, timeout_seconds: float) -> None: ...
    def close(self) -> None: ...


class SecureNamedPipeApi(Protocol):
    """Native provider must create the ACL and authenticate the connected token."""

    backend_id: str
    backend_version: str

    def accept(
        self, *, pipe_name: str, security_descriptor_sddl: str,
        timeout_seconds: float,
    ) -> AuthenticatedNamedPipeSession: ...


_SID = re.compile(r"^S-1-(?:\d+-){1,14}\d+$", re.IGNORECASE)
_INSTANCE = re.compile(r"^[a-f0-9]{32}$")


@dataclass(frozen=True)
class HostMetricsNamedPipeConfig:
    enabled: bool = False
    instance_id: str = ""
    allowed_client_sids: frozenset[str] = frozenset()
    timeout_seconds: float = 2.0
    max_request_bytes: int = 32
    max_response_bytes: int = 1024 * 1024
    max_concurrent_scrapes: int = 1

    def __post_init__(self) -> None:
        if not self.enabled:
            return
        if not _INSTANCE.fullmatch(self.instance_id):
            raise ValueError("Named-pipe instance identity must be 128-bit lowercase hex")
        if not self.allowed_client_sids or any(not _SID.fullmatch(sid) for sid in self.allowed_client_sids):
            raise ValueError("At least one valid host client SID is required")
        if self.timeout_seconds <= 0 or not 8 <= self.max_request_bytes <= 4096:
            raise ValueError("Named-pipe request limits are invalid")
        if not 1024 <= self.max_response_bytes <= 16 * 1024 * 1024:
            raise ValueError("Named-pipe response limit is invalid")
        if self.max_concurrent_scrapes != 1:
            raise ValueError("Named-pipe transport currently requires one scrape slot")


class HostLocalSecurityMetricsNamedPipeTransport:
    REQUEST = b"GET /metrics\n"

    def __init__(
        self,
        exporter: HostLocalSecurityMetricsExporter,
        config: HostMetricsNamedPipeConfig,
        *,
        native_api: SecureNamedPipeApi | None = None,
    ):
        self.exporter = exporter
        self.config = config
        self.native_api = native_api
        self._slots = threading.BoundedSemaphore(config.max_concurrent_scrapes)
        if config.enabled:
            if native_api is None:
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_backend_missing",
                    "An authenticated native named-pipe backend is required.",
                )
            if (
                getattr(native_api, "backend_id", "") != "windows-authenticated-named-pipe"
                or getattr(native_api, "backend_version", "") != "1"
            ):
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_backend_untrusted",
                    "Named-pipe backend identity is not trusted.",
                )

    @property
    def pipe_name(self) -> str:
        if not self.config.enabled:
            raise SecurityMetricsTransportError(
                "security_metrics_pipe_disabled", "Security metrics transport is disabled.",
            )
        return rf"\\.\pipe\OpenDrSai.SecurityMetrics.{self.config.instance_id}"

    @property
    def security_descriptor_sddl(self) -> str:
        # Protected DACL: only the exact configured host identities get read/write.
        aces = "".join(
            f"(A;;GRGW;;;{sid.upper()})" for sid in sorted(self.config.allowed_client_sids)
        )
        return f"D:P{aces}"

    def serve_once(self, *, now: float | None = None) -> int:
        if not self.config.enabled or self.native_api is None:
            raise SecurityMetricsTransportError(
                "security_metrics_pipe_disabled", "Security metrics transport is disabled.",
            )
        if not self._slots.acquire(blocking=False):
            raise SecurityMetricsTransportError(
                "security_metrics_pipe_busy", "Security metrics scrape concurrency is exhausted.",
            )
        session: AuthenticatedNamedPipeSession | None = None
        try:
            session = self.native_api.accept(
                pipe_name=self.pipe_name,
                security_descriptor_sddl=self.security_descriptor_sddl,
                timeout_seconds=self.config.timeout_seconds,
            )
            request = session.read(self.config.max_request_bytes + 1, self.config.timeout_seconds)
            if len(request) > self.config.max_request_bytes:
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_request_too_large", "Metrics request exceeds its limit.",
                )
            if request != self.REQUEST:
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_request_invalid", "Metrics request is invalid.",
                )
            peer_sid = str(session.peer_sid).upper()
            allowed = {sid.upper() for sid in self.config.allowed_client_sids}
            if peer_sid not in allowed:
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_peer_denied", "Named-pipe peer identity is not allowed.",
                )
            payload = self.exporter.render(now=now).encode("utf-8")
            if len(payload) > self.config.max_response_bytes:
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_response_too_large", "Metrics response exceeds its limit.",
                )
            session.write_all(payload, self.config.timeout_seconds)
            return len(payload)
        except SecurityMetricsTransportError:
            raise
        except Exception as error:
            raise SecurityMetricsTransportError(
                "security_metrics_pipe_io_failed", "Security metrics pipe operation failed.",
            ) from error
        finally:
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
            self._slots.release()
