"""Host-enforced security domain primitives for the OpenDrSai Runtime.

This package intentionally has no dependency on Agent Core or client protocols.
Clients propose actions; the Runtime resolves capabilities and consumes grants.
"""

from .grants import AuthorizationGrantStore, GrantError
from .hard_deny import (
    HARD_DENY_POLICY_VERSION,
    MANDATORY_HARD_DENIES,
    HardDenyDecision,
    HardDenyError,
    HardDenyPolicy,
    infer_effect_categories,
)
from .audit import SecurityAuditError, SecurityAuditEvent, SecurityEventJournal
from .approval_slo_monitor import (
    ApprovalSecuritySloEvaluation,
    ApprovalSecuritySloMonitor,
    ApprovalSecuritySloThresholds,
)
from .approval_slo_policy import (
    ApprovalSloPolicyError,
    SignedApprovalSloPolicy,
    SignedApprovalSloPolicyLoader,
)
from .credentials import (
    CredentialBroker,
    CredentialBrokerError,
    CredentialLease,
    CredentialMaterial,
    normalize_credential_target,
)
from .effects import EffectExecution, EffectExecutionError, EffectExecutionStore
from .filesystem import WindowsWorkspaceFilesystem, normalize_workspace_relative_path
from .filesystem_execution import (
    AuthorizedFilesystemExecutionService,
    FilesystemExecutionReceipt,
    FilesystemMutationReceipt,
    FilesystemReadReceipt,
    FilesystemReadResult,
)
from .models import ActionProposal, ResolvedCapabilityProfile, canonical_digest
from .isolation_leases import IsolationAttestationLeaseStore, ScopedIsolationLease
from .isolated_effect_execution import (
    IsolatedEffectExecutionError,
    IsolatedEffectExecutionService,
    IsolatedEffectReconciliation,
    IsolatedEffectRecoveryMetrics,
    IsolatedEffectReceipt,
    SimulatedIsolatedEffectCrash,
)
from .isolated_effect_recovery_monitor import (
    IsolatedEffectRecoveryAlertEvaluation,
    IsolatedEffectRecoveryMonitor,
    IsolatedEffectRecoveryThresholds,
)
from .isolated_worker_artifact import (
    AuthenticodeEvidence,
    IsolatedWorkerArtifact,
    IsolatedWorkerArtifactError,
    IsolatedWorkerArtifactResolver,
)
from .metrics import SecurityMetric, SecurityMetricsCollector
from .security_metrics_exporter import (
    HostLocalSecurityMetricsExporter,
    SecurityMetricsExportError,
)
from .security_metrics_named_pipe import (
    AuthenticatedNamedPipeSession,
    HostLocalSecurityMetricsNamedPipeTransport,
    HostMetricsNamedPipeConfig,
    SecureNamedPipeApi,
    SecurityMetricsTransportError,
)
from .windows_security_metrics_pipe_api import (
    WindowsAuthenticatedNamedPipeApi,
    WindowsAuthenticatedNamedPipeSession,
    WindowsSecurityMetricsPipeError,
    current_process_sid,
    current_process_handle_count,
)
from .security_observability_factory import (
    HostSecurityObservabilityConfig,
    SecurityObservabilityRuntime,
    SecurityObservabilityRuntimeFactory,
)
from .security_observability_deployment import (
    SecurityObservabilityDeploymentError,
    SignedSecurityObservabilityDeploymentLoader,
    VerifiedSecurityObservabilityDeployment,
)
from .security_observability_release import (
    SecurityObservabilityReleaseError,
    SecurityObservabilityReleasePins,
    SecurityObservabilityReleaseTool,
    VerifiedSecurityObservabilityRelease,
)
from .windows_installation_verifier import (
    NativeWindowsInstallationSecurityApi,
    NativeWindowsServiceConfigurationApi,
    VerifiedWindowsSecurityInstallation,
    WindowsAccessControlEntry,
    WindowsFileSecurityEvidence,
    WindowsInstallationVerificationError,
    WindowsInstalledArtifact,
    WindowsServiceConfigurationEvidence,
    WindowsSecurityInstallationVerifier,
)
from .windows_package_catalog import (
    SignedWindowsSecurityPackageCatalogLoader,
    VerifiedWindowsSecurityPackageCatalog,
    WindowsSecurityPackageCatalogTool,
    WindowsSecurityPackageCatalogError,
)
from .windows_package_key_policy import (
    SignedWindowsPackageKeyPolicyLoader,
    VerifiedWindowsPackageKeyPolicy,
    WindowsPackageCatalogKey,
    WindowsPackageKeyPolicyError,
)
from .windows_installer_journal import (
    ConsumedWindowsServiceBootstrapReceipt,
    NativeWindowsInstallerSafetyController,
    WindowsInstallerJournalError,
    WindowsInstallerOperation,
    WindowsInstallerOperationJournal,
    WindowsInstallerServiceSafetyEvidence,
    WindowsServiceBootstrapAuthorization,
)
from .windows_service_bootstrap_envelope import (
    BootstrapEnvelopeFileApi,
    BootstrapEnvelopeProtector,
    NativeWindowsBootstrapEnvelopeFileApi,
    NativeWindowsMachineDpapiProtector,
    PublishedWindowsServiceBootstrapEnvelope,
    WindowsServiceBootstrapEnvelopeChannel,
    WindowsServiceBootstrapEnvelopeError,
)
from .windows_installer_service_activation import (
    NativeWindowsInstallerServiceActivationApi,
    WindowsInstallerServiceActivationApi,
    WindowsInstallerServiceActivationController,
    WindowsInstallerServiceActivationError,
    WindowsInstallerServiceStartEvidence,
)
from .windows_installer_filesystem_actions import (
    NativeWindowsInstallerFilesystemApi,
    NativeWindowsInstallerTreeAclApi,
    WindowsInstallerArtifactInput,
    WindowsInstallerDirectoryIdentity,
    WindowsInstallerFilesystemAction,
    WindowsInstallerFilesystemActionError,
    WindowsInstallerFilesystemActionJournal,
    WindowsInstallerFilesystemApi,
    WindowsInstallerTreeAclApi,
)
from .windows_installer_coordinator import (
    WindowsInstallerCoordinator,
    WindowsInstallerCoordinatorError,
    WindowsInstallerCoordinatorRun,
)
from .windows_installer_scm_actions import (
    NativeWindowsInstallerScmApi,
    WindowsInstallerScmAction,
    WindowsInstallerScmActionError,
    WindowsInstallerScmActionJournal,
    WindowsInstallerScmApi,
    WindowsInstallerScmConfiguration,
)
from .network import (
    NetworkAuthorization,
    NetworkEgressBroker,
    NetworkPolicyError,
    PinnedHttpRequest,
    PinnedHttpResponse,
    PinnedHttpTransport,
    StdlibPinnedHttpsTransport,
)
from .policy import CapabilityPolicyLayer, CapabilityPolicyResolver, PolicyError
from .sandbox import (
    IsolationAttestation,
    SandboxBackend,
    SandboxBroker,
    SandboxError,
    SandboxExecutionReceipt,
    SandboxExecutionRequest,
)
from .storage import SecurityBoundaryStore, SecurityBoundaryStoreError
from .tombstones import TombstoneError, TombstoneRecord, TombstoneStore
from .windows_backend import (
    WindowsIsolationCapabilities,
    WindowsIsolationProbe,
    WindowsRestrictedProcessBackend,
)
from .windows_job import WindowsJobError, WindowsJobLauncher, WindowsJobLimits, WindowsJobResult
from .windows_token import (
    RestrictedToken,
    RestrictedTokenEvidence,
    WindowsRestrictedTokenFactory,
    WindowsTokenError,
)
from .windows_worker import WindowsRestrictedWorkerLauncher, WindowsRestrictedWorkerResult
from .windows_appcontainer import (
    AppContainerProfile,
    NativeAppContainerApi,
    WindowsAppContainerError,
    WindowsAppContainerProfileFactory,
    WindowsAppContainerWorkerLauncher,
    WindowsAppContainerWorkerResult,
)
from .windows_acl_projection import (
    AclProjection,
    NativeWindowsAclApi,
    WindowsAclProjectionError,
    WindowsAclProjectionService,
)
from .windows_isolated_session import (
    SimulatedIsolatedSessionCrash,
    WindowsIsolatedExecutionSessionService,
    WindowsIsolatedSession,
    WindowsIsolatedSessionError,
)

__all__ = [
    "ActionProposal",
    "AppContainerProfile",
    "AclProjection",
    "AuthorizationGrantStore",
    "AuthorizedFilesystemExecutionService",
    "CapabilityPolicyLayer",
    "CapabilityPolicyResolver",
    "EffectExecution",
    "EffectExecutionError",
    "EffectExecutionStore",
    "FilesystemExecutionReceipt",
    "FilesystemMutationReceipt",
    "FilesystemReadReceipt",
    "FilesystemReadResult",
    "WindowsWorkspaceFilesystem",
    "CredentialBroker",
    "CredentialBrokerError",
    "CredentialLease",
    "CredentialMaterial",
    "GrantError",
    "HARD_DENY_POLICY_VERSION",
    "MANDATORY_HARD_DENIES",
    "HardDenyDecision",
    "HardDenyError",
    "HardDenyPolicy",
    "IsolationAttestation",
    "IsolationAttestationLeaseStore",
    "IsolatedEffectExecutionError",
    "IsolatedEffectExecutionService",
    "IsolatedEffectReconciliation",
    "IsolatedEffectRecoveryMetrics",
    "IsolatedEffectReceipt",
    "SimulatedIsolatedEffectCrash",
    "IsolatedEffectRecoveryAlertEvaluation",
    "IsolatedEffectRecoveryMonitor",
    "IsolatedEffectRecoveryThresholds",
    "AuthenticodeEvidence",
    "IsolatedWorkerArtifact",
    "IsolatedWorkerArtifactError",
    "IsolatedWorkerArtifactResolver",
    "NetworkAuthorization",
    "NativeAppContainerApi",
    "NativeWindowsAclApi",
    "NetworkEgressBroker",
    "NetworkPolicyError",
    "PolicyError",
    "PinnedHttpRequest",
    "PinnedHttpResponse",
    "PinnedHttpTransport",
    "StdlibPinnedHttpsTransport",
    "ResolvedCapabilityProfile",
    "RestrictedToken",
    "RestrictedTokenEvidence",
    "SandboxBackend",
    "SandboxBroker",
    "SandboxError",
    "SandboxExecutionReceipt",
    "SandboxExecutionRequest",
    "SecurityAuditError",
    "ApprovalSecuritySloEvaluation",
    "ApprovalSecuritySloMonitor",
    "ApprovalSecuritySloThresholds",
    "ApprovalSloPolicyError",
    "SignedApprovalSloPolicy",
    "SignedApprovalSloPolicyLoader",
    "ScopedIsolationLease",
    "SecurityAuditEvent",
    "SecurityEventJournal",
    "SecurityMetric",
    "SimulatedIsolatedSessionCrash",
    "SecurityMetricsCollector",
    "HostLocalSecurityMetricsExporter",
    "SecurityMetricsExportError",
    "AuthenticatedNamedPipeSession",
    "HostLocalSecurityMetricsNamedPipeTransport",
    "HostMetricsNamedPipeConfig",
    "SecureNamedPipeApi",
    "SecurityMetricsTransportError",
    "WindowsAuthenticatedNamedPipeApi",
    "WindowsAuthenticatedNamedPipeSession",
    "WindowsSecurityMetricsPipeError",
    "current_process_sid",
    "current_process_handle_count",
    "HostSecurityObservabilityConfig",
    "SecurityObservabilityRuntime",
    "SecurityObservabilityRuntimeFactory",
    "SecurityObservabilityDeploymentError",
    "SignedSecurityObservabilityDeploymentLoader",
    "VerifiedSecurityObservabilityDeployment",
    "SecurityObservabilityReleaseError",
    "SecurityObservabilityReleasePins",
    "SecurityObservabilityReleaseTool",
    "VerifiedSecurityObservabilityRelease",
    "NativeWindowsInstallationSecurityApi",
    "NativeWindowsServiceConfigurationApi",
    "VerifiedWindowsSecurityInstallation",
    "WindowsAccessControlEntry",
    "WindowsFileSecurityEvidence",
    "WindowsInstallationVerificationError",
    "WindowsInstalledArtifact",
    "WindowsServiceConfigurationEvidence",
    "WindowsSecurityInstallationVerifier",
    "SignedWindowsSecurityPackageCatalogLoader",
    "VerifiedWindowsSecurityPackageCatalog",
    "WindowsSecurityPackageCatalogTool",
    "WindowsSecurityPackageCatalogError",
    "SignedWindowsPackageKeyPolicyLoader",
    "VerifiedWindowsPackageKeyPolicy",
    "WindowsPackageCatalogKey",
    "WindowsPackageKeyPolicyError",
    "WindowsInstallerJournalError",
    "ConsumedWindowsServiceBootstrapReceipt",
    "NativeWindowsInstallerSafetyController",
    "WindowsInstallerOperation",
    "WindowsInstallerOperationJournal",
    "WindowsInstallerServiceSafetyEvidence",
    "WindowsServiceBootstrapAuthorization",
    "BootstrapEnvelopeFileApi",
    "BootstrapEnvelopeProtector",
    "NativeWindowsBootstrapEnvelopeFileApi",
    "NativeWindowsMachineDpapiProtector",
    "PublishedWindowsServiceBootstrapEnvelope",
    "WindowsServiceBootstrapEnvelopeChannel",
    "WindowsServiceBootstrapEnvelopeError",
    "NativeWindowsInstallerServiceActivationApi",
    "WindowsInstallerServiceActivationApi",
    "WindowsInstallerServiceActivationController",
    "WindowsInstallerServiceActivationError",
    "WindowsInstallerServiceStartEvidence",
    "NativeWindowsInstallerFilesystemApi",
    "NativeWindowsInstallerTreeAclApi",
    "WindowsInstallerArtifactInput",
    "WindowsInstallerDirectoryIdentity",
    "WindowsInstallerFilesystemAction",
    "WindowsInstallerFilesystemActionError",
    "WindowsInstallerFilesystemActionJournal",
    "WindowsInstallerFilesystemApi",
    "WindowsInstallerTreeAclApi",
    "WindowsInstallerCoordinator",
    "WindowsInstallerCoordinatorError",
    "WindowsInstallerCoordinatorRun",
    "NativeWindowsInstallerScmApi",
    "WindowsInstallerScmAction",
    "WindowsInstallerScmActionError",
    "WindowsInstallerScmActionJournal",
    "WindowsInstallerScmApi",
    "WindowsInstallerScmConfiguration",
    "SecurityBoundaryStore",
    "SecurityBoundaryStoreError",
    "TombstoneError",
    "TombstoneRecord",
    "TombstoneStore",
    "WindowsIsolationCapabilities",
    "WindowsIsolatedExecutionSessionService",
    "WindowsIsolatedSession",
    "WindowsIsolatedSessionError",
    "WindowsAppContainerError",
    "WindowsAppContainerProfileFactory",
    "WindowsAppContainerWorkerLauncher",
    "WindowsAppContainerWorkerResult",
    "WindowsAclProjectionError",
    "WindowsAclProjectionService",
    "WindowsIsolationProbe",
    "WindowsJobError",
    "WindowsJobLauncher",
    "WindowsJobLimits",
    "WindowsJobResult",
    "WindowsRestrictedProcessBackend",
    "WindowsRestrictedTokenFactory",
    "WindowsTokenError",
    "WindowsRestrictedWorkerLauncher",
    "WindowsRestrictedWorkerResult",
    "canonical_digest",
    "normalize_credential_target",
    "normalize_workspace_relative_path",
    "infer_effect_categories",
]
