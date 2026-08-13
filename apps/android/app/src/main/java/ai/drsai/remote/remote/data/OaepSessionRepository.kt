package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepEventPage
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.flow.Flow

/** OAEP-only boundary used by the current mobile Session Sync path. */
class OaepSessionRepository(
    private val relay: RelayRemoteRepository,
    private val stream: RelaySseClient,
    private val latency: RemoteLatencyTracker = RemoteLatencyTracker(),
) {

    suspend fun snapshot(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        cursor: String? = null,
        limit: Int = 100,
    ): OaepSnapshot = relay.oaepSnapshot(runtimeId, workspaceId, sessionId, cursor, limit)

    suspend fun events(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        afterSequence: Long,
    ): OaepEventPage = relay.oaepEvents(runtimeId, workspaceId, sessionId, afterSequence)

    fun eventStream(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        afterSequence: Long,
        onConnected: () -> Unit = {},
        onReceived: (OaepEvent, Double) -> Unit = { _, _ -> },
    ): Flow<OaepEvent> = stream.oaepSessionStream(
        runtimeId,
        workspaceId,
        sessionId,
        afterSequence,
        onConnected,
        onReceived,
    )

    fun markLatencyReceived(event: OaepEvent) {
        latency.received(event)
    }

    suspend fun recordLatencyRendered(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        event: OaepEvent,
    ) {
        val (receivedAt, renderedAt) = latency.rendered(event)
        relay.recordConversationLatency(
            runtimeId,
            workspaceId,
            sessionId,
            event.eventId,
            receivedAt.coerceAtMost(renderedAt),
            renderedAt,
        )
    }

    suspend fun recordFirstScreen(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        observation: FirstScreenSloObservation,
    ) = relay.recordFirstScreenSlo(
        runtimeId, workspaceId, sessionId, observation.sampleId,
        observation.cacheLoadAtMs, observation.authorityRefreshAtMs, observation.firstRenderAtMs,
    )

    suspend fun recordOperationConfirmation(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        observation: OperationConfirmationSloObservation,
    ) = relay.recordOperationConfirmationSlo(
        runtimeId, workspaceId, sessionId, observation.sampleId,
        observation.requestDispatchAtMs, observation.runtimeCommitAtMs,
        observation.confirmationRenderAtMs,
    )

    suspend fun recordReconnect(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        observation: ReconnectSloObservation,
    ) = relay.recordReconnectSlo(
        runtimeId, workspaceId, sessionId, observation.sampleId,
        observation.disconnectDetectAtMs, observation.transportRestoreAtMs,
        observation.replayCatchupAtMs,
    )

}
