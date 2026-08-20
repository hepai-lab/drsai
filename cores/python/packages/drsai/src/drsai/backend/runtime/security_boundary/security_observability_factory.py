"""Trusted Runtime assembly for security SLO monitoring and host export."""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from .approval_slo_monitor import ApprovalSecuritySloMonitor
from .approval_slo_policy import SignedApprovalSloPolicy, SignedApprovalSloPolicyLoader
from .metrics import SecurityMetricsCollector
from .security_metrics_exporter import HostLocalSecurityMetricsExporter
from .security_metrics_named_pipe import (
    HostLocalSecurityMetricsNamedPipeTransport,
    HostMetricsNamedPipeConfig,
    SecureNamedPipeApi,
    SecurityMetricsTransportError,
)
from .windows_security_metrics_pipe_api import WindowsAuthenticatedNamedPipeApi


_VERIFIED_ENABLED_FACTORY_CAPABILITY = object()


@dataclass(frozen=True)
class HostSecurityObservabilityConfig:
    trusted_policy_root: Path
    policy_filename: str
    trusted_public_keys: tuple[tuple[str, bytes], ...]
    expected_policy_id: str
    minimum_policy_version: int
    expected_policy_digest: str | None = None
    workspace_roots: tuple[Path, ...] = ()
    pipe_enabled: bool = False
    pipe_instance_id: str = ""
    host_service_sid: str = ""
    pipe_timeout_seconds: float = 2.0

    def __post_init__(self) -> None:
        if not self.policy_filename or Path(self.policy_filename).name != self.policy_filename:
            raise ValueError("A signed SLO policy basename is required")
        if not self.expected_policy_id or self.minimum_policy_version < 1:
            raise ValueError("SLO policy identity and minimum version pins are required")
        keys = dict(self.trusted_public_keys)
        if len(keys) != len(self.trusted_public_keys) or not keys:
            raise ValueError("Unique trusted SLO policy keys are required")
        if self.pipe_enabled and (not self.pipe_instance_id or not self.host_service_sid):
            raise ValueError("Enabled host metrics pipe requires instance identity and service SID")
        if not self.pipe_enabled and (self.pipe_instance_id or self.host_service_sid):
            raise ValueError("Disabled host metrics pipe cannot retain live identity configuration")


@dataclass(frozen=True)
class SecurityObservabilityRuntime:
    policy: SignedApprovalSloPolicy
    monitor: ApprovalSecuritySloMonitor
    collector: SecurityMetricsCollector
    exporter: HostLocalSecurityMetricsExporter
    transport: HostLocalSecurityMetricsNamedPipeTransport | None


class SecurityObservabilityRuntimeFactory:
    """Consumes host deployment facts only; no request or client inputs."""

    def __init__(
        self,
        database: Path,
        config: HostSecurityObservabilityConfig,
        *,
        native_pipe_api: SecureNamedPipeApi | None = None,
        clock=time.time,
        _enabled_capability=None,
    ):
        if config.pipe_enabled and _enabled_capability is not _VERIFIED_ENABLED_FACTORY_CAPABILITY:
            raise SecurityMetricsTransportError(
                "security_observability_bootstrap_required",
                "Enabled observability factory requires claimed installer bootstrap authority.",
            )
        self.database = Path(database)
        self.config = config
        self.native_pipe_api = native_pipe_api
        self.clock = clock
        self._enabled_build_consumed = False

    def build(self) -> SecurityObservabilityRuntime:
        if self.config.pipe_enabled:
            if self._enabled_build_consumed:
                raise SecurityMetricsTransportError(
                    "security_observability_bootstrap_replayed",
                    "Enabled observability factory bootstrap authority was already consumed.",
                )
            # Consume before any policy or transport work.  Failure is fail-closed
            # and requires a new installer operation; it never retries authority.
            self._enabled_build_consumed = True
        pipe_config = None
        native_api = None
        if self.config.pipe_enabled:
            pipe_config = HostMetricsNamedPipeConfig(
                enabled=True,
                instance_id=self.config.pipe_instance_id,
                allowed_client_sids=frozenset({self.config.host_service_sid}),
                timeout_seconds=self.config.pipe_timeout_seconds,
                max_concurrent_scrapes=1,
            )
            native_api = self.native_pipe_api or WindowsAuthenticatedNamedPipeApi()
            if (
                getattr(native_api, "backend_id", "") != "windows-authenticated-named-pipe"
                or getattr(native_api, "backend_version", "") != "1"
            ):
                raise SecurityMetricsTransportError(
                    "security_metrics_pipe_backend_untrusted",
                    "Named-pipe backend identity is not trusted.",
                )
        loader = SignedApprovalSloPolicyLoader(
            self.database,
            self.config.trusted_policy_root,
            trusted_public_keys=dict(self.config.trusted_public_keys),
            expected_policy_id=self.config.expected_policy_id,
            minimum_version=self.config.minimum_policy_version,
            expected_policy_digest=self.config.expected_policy_digest,
            forbidden_roots=self.config.workspace_roots,
            clock=self.clock,
        )
        policy = loader.load(self.config.policy_filename)
        monitor = ApprovalSecuritySloMonitor.from_signed_policy(
            self.database, policy, clock=self.clock,
        )
        collector = SecurityMetricsCollector(self.database)
        exporter = HostLocalSecurityMetricsExporter(collector)
        transport = None
        if pipe_config is not None and native_api is not None:
            transport = HostLocalSecurityMetricsNamedPipeTransport(
                exporter,
                pipe_config,
                native_api=native_api,
            )
        return SecurityObservabilityRuntime(
            policy=policy, monitor=monitor, collector=collector,
            exporter=exporter, transport=transport,
        )

    @classmethod
    def from_verified_deployment(
        cls, database: Path, deployment, *, trusted_slo_public_keys,
        native_pipe_api: SecureNamedPipeApi | None = None, clock=time.time,
    ):
        from .security_observability_deployment import VerifiedSecurityObservabilityDeployment

        if not isinstance(deployment, VerifiedSecurityObservabilityDeployment):
            raise ValueError("A verified observability deployment is required")
        if deployment.enabled:
            raise SecurityMetricsTransportError(
                "security_observability_bootstrap_required",
                "Enabled observability requires consumed installer bootstrap authority.",
            )
        return cls._from_verified_deployment_unchecked(
            database, deployment, trusted_slo_public_keys=trusted_slo_public_keys,
            native_pipe_api=native_pipe_api, clock=clock,
        )

    @classmethod
    def from_verified_service_bootstrap(
        cls, database: Path, deployment, bootstrap_receipt, *, trusted_slo_public_keys,
        native_pipe_api: SecureNamedPipeApi | None = None, clock=time.time,
    ):
        from .security_observability_deployment import VerifiedSecurityObservabilityDeployment
        from .windows_installer_journal import (
            ConsumedWindowsServiceBootstrapReceipt,
            WindowsInstallerOperationJournal,
        )

        if (
            not isinstance(deployment, VerifiedSecurityObservabilityDeployment)
            or not deployment.enabled
        ):
            raise ValueError("An enabled verified observability deployment is required")
        if not isinstance(bootstrap_receipt, ConsumedWindowsServiceBootstrapReceipt):
            raise ValueError("A consumed Windows service bootstrap receipt is required")
        if (
            bootstrap_receipt.install_root != str(deployment.install_root)
            or bootstrap_receipt.runtime_build_digest != deployment.runtime_build_digest
            or bootstrap_receipt.service_sid != deployment.service_sid
        ):
            raise SecurityMetricsTransportError(
                "security_observability_bootstrap_identity_mismatch",
                "Bootstrap receipt differs from the observability deployment.",
            )
        WindowsInstallerOperationJournal.claim_bootstrap_for_runtime(
            database, bootstrap_receipt, clock=clock,
        )
        return cls._from_verified_deployment_unchecked(
            database, deployment, trusted_slo_public_keys=trusted_slo_public_keys,
            native_pipe_api=native_pipe_api, clock=clock,
        )

    @classmethod
    def from_verified_service_envelope(
        cls, database: Path, deployment, bootstrap_channel, catalog, installation, *,
        trusted_slo_public_keys, native_pipe_api: SecureNamedPipeApi | None = None,
        clock=time.time,
    ):
        """Consume the service-only envelope without exposing its token to a client."""
        from .windows_installer_journal import WindowsInstallerOperationJournal
        from .windows_service_bootstrap_envelope import WindowsServiceBootstrapEnvelopeChannel

        if not isinstance(bootstrap_channel, WindowsServiceBootstrapEnvelopeChannel):
            raise ValueError("A Windows service bootstrap envelope channel is required")
        journal = WindowsInstallerOperationJournal(
            database, _RuntimeReadOnlyInstallerSafetyController(), clock=clock,
        )
        receipt = bootstrap_channel.consume(journal, catalog, installation)
        return cls.from_verified_service_bootstrap(
            database, deployment, receipt,
            trusted_slo_public_keys=trusted_slo_public_keys,
            native_pipe_api=native_pipe_api, clock=clock,
        )

    @classmethod
    def _from_verified_deployment_unchecked(
        cls, database: Path, deployment, *, trusted_slo_public_keys,
        native_pipe_api: SecureNamedPipeApi | None = None, clock=time.time,
    ):
        keys = dict(trusted_slo_public_keys)
        if deployment.slo_policy_key_id not in keys:
            raise ValueError("Deployment SLO policy key is not pinned by this Runtime")
        config = HostSecurityObservabilityConfig(
            trusted_policy_root=deployment.install_root,
            policy_filename=deployment.slo_policy_filename,
            trusted_public_keys=((deployment.slo_policy_key_id, keys[deployment.slo_policy_key_id]),),
            expected_policy_id=deployment.slo_policy_id,
            minimum_policy_version=deployment.slo_policy_minimum_version,
            expected_policy_digest=deployment.slo_policy_digest,
            pipe_enabled=deployment.enabled,
            pipe_instance_id=deployment.pipe_instance_id,
            host_service_sid=deployment.service_sid,
        )
        return cls(
            database, config, native_pipe_api=native_pipe_api, clock=clock,
            _enabled_capability=(
                _VERIFIED_ENABLED_FACTORY_CAPABILITY if deployment.enabled else None
            ),
        )


class _RuntimeReadOnlyInstallerSafetyController:
    """The envelope consumer never performs installer safety transitions."""

    def ensure_disabled_and_stopped(self, service_name: str):
        raise RuntimeError(
            f"Runtime bootstrap cannot perform installer safety operations for {service_name}.",
        )
