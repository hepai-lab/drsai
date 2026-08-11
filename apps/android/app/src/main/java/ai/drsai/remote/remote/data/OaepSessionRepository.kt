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
    private val wallClockMs: () -> Long = System::currentTimeMillis,
) {
    private val latencyLock = Any()
    private val receivedAtMs = LinkedHashMap<String, Long>()

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
        val receivedAt = wallClockMs().coerceAtLeast(0)
        synchronized(latencyLock) {
            receivedAtMs.putIfAbsent(event.eventId, receivedAt)
            while (receivedAtMs.size > MAX_PENDING_LATENCY_EVENTS) {
                receivedAtMs.remove(receivedAtMs.keys.first())
            }
        }
    }

    suspend fun recordLatencyRendered(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        event: OaepEvent,
    ) {
        val renderedAt = wallClockMs().coerceAtLeast(0)
        val receivedAt = synchronized(latencyLock) {
            receivedAtMs.remove(event.eventId)
        } ?: renderedAt
        relay.recordConversationLatency(
            runtimeId,
            workspaceId,
            sessionId,
            event.eventId,
            receivedAt.coerceAtMost(renderedAt),
            renderedAt,
        )
    }

    private companion object {
        const val MAX_PENDING_LATENCY_EVENTS = 4096
    }
}
