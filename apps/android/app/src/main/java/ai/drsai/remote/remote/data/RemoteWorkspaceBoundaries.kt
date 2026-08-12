package ai.drsai.remote.remote.data

import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.security.RelayDeviceProof

/**
 * Stable domain boundaries exposed by the process-owned container.
 *
 * A boundary may share the same authenticated transport, but callers only
 * receive the capability family they own. This keeps ViewModels from reaching
 * through the container to an unrelated protocol surface.
 */
data class RemoteAuthBoundary(
    val tokens: SecureTokenStore,
    val coordinator: AccessTokenCoordinator,
    val deviceProof: RelayDeviceProof,
)

data class RemoteAssociationBoundary(val service: RelayDiscoveryService)

data class RemoteCatalogBoundary(
    val discovery: RelayDiscoveryService,
    val sessionEvents: RelaySseClient,
)

data class RemoteSessionBoundary(
    val client: RelayRemoteRepository,
    val events: RelaySseClient,
    val oaep: OaepSessionRepository,
    val legacy: LegacyConversationAdapter,
)

data class RemoteRunBoundary(
    val client: RelayRemoteRepository,
    val events: RelaySseClient,
    val controls: RemoteRunControlLedger,
)

data class RemoteApprovalBoundary(
    val client: RelayRemoteRepository,
    val decisions: RemoteApprovalDecisionLedger,
)

class RemoteFileBoundary(
    private val clientFactory: (RuntimeId) -> RelayWorkspaceOperationsClient,
) {
    fun client(runtimeId: RuntimeId): RelayWorkspaceOperationsClient = clientFactory(runtimeId)
}

data class RemotePushBoundary(
    val catalog: RelayDiscoveryService,
    val registrations: PushRegistrationClient,
    val readiness: PushReadinessClient,
)

data class RemoteWorkspaceBoundaries(
    val auth: RemoteAuthBoundary,
    val association: RemoteAssociationBoundary,
    val catalog: RemoteCatalogBoundary,
    val session: RemoteSessionBoundary,
    val run: RemoteRunBoundary,
    val approval: RemoteApprovalBoundary,
    val file: RemoteFileBoundary,
    val push: RemotePushBoundary,
) {
    init {
        require(listOf(
            "auth", "association", "catalog", "session", "run", "approval", "file", "push",
        ).distinct().size == 8) { "remote_workspace_boundary_catalog_invalid" }
    }
}
