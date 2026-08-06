package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedSessionEvent
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.flow.Flow

/**
 * Explicit compatibility boundary for pre-OAEP Windows Runtimes.
 * New Session synchronization code must depend on OaepSessionRepository.
 */
class LegacyConversationAdapter(
    private val relay: RelayRemoteRepository,
    private val stream: RelaySseClient,
) {
    suspend fun snapshot(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        cursor: String? = null,
    ): GeneratedConversationSnapshot = relay.conversationSnapshot(runtimeId, workspaceId, sessionId, cursor)

    suspend fun events(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        afterSequence: Long,
    ): Page<GeneratedSessionEvent> = relay.sessionEvents(runtimeId, workspaceId, sessionId, afterSequence)

    fun eventStream(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        afterSequence: Long,
    ): Flow<GeneratedSessionEvent> = stream.sessionStream(runtimeId, workspaceId, sessionId, afterSequence)
}
